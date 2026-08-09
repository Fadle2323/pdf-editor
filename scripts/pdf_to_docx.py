#!/usr/bin/env python3
"""
Wrapper CLI tipis di atas pdf2docx utk dipanggil sbg subprocess dari Node.js
(services/convertService.js). Sengaja dibuat sesederhana mungkin: terima path
input & output, jalankan konversi, exit code 0 = sukses, non-zero = gagal
(pesan error di stderr, bisa dibaca Node utk fallback ke jalur JS).

Setelah konversi utama, ditambahkan post-processing opsional: PDF sering
punya link internal (mis. entri Daftar Isi -> heading terkait) yang TIDAK
direkonstruksi pdf2docx (cuma menangani hyperlink URI eksternal). Kalau ada,
link-link ini diekstrak lewat PyMuPDF lalu dipasang ulang sbg bookmark +
hyperlink internal Word. Ini enhancement, BUKAN bagian kritis -- kalau
gagal/error, konversi utama tetap dianggap berhasil (skip diam-diam, cuma
warning ke stderr), krn dokumen tanpa link internal masih jauh lebih baik
drpd tidak ada dokumen sama sekali.

Usage: python3 pdf_to_docx.py <input.pdf> <output.docx>
"""
import sys
import os
import re
import difflib


def strip_toc_label(src_text):
    """'Register......................5' -> 'Register'. Entri Daftar Isi PDF
    biasanya diakhiri deretan titik (dot leader) lalu nomor halaman -- ini
    dibuang supaya tersisa cuma judul section yg mau dicocokkan ke heading
    aslinya di halaman tujuan."""
    m = re.match(r'^(.*?)[.\s]{3,}\d*\s*$', src_text)
    return (m.group(1) if m else src_text).strip()


def get_page_text_blocks(page):
    """Ambil semua blok teks di satu halaman PDF, tiap blok jadi satu string
    (gabungan semua span di dalamnya), zero-width-space dibuang krn kadang
    dipakai PDF sbg pemisah 'tak terlihat' antara dua heading yg berdekatan
    tanpa jeda baris sungguhan (mis. 'BAB II' + ZWSP + 'PEMBAHASAN')."""
    blocks = page.get_text('dict')['blocks']
    out = []
    for b in blocks:
        if b.get('type') != 0:
            continue
        text = ''.join(s['text'] for l in b['lines'] for s in l['spans'])
        text = text.replace('\u200b', '').strip()
        if text:
            out.append(text)
    return out


def find_best_text_match(blocks, label):
    """3 lapis strategi cocokkan label Daftar Isi ke teks di halaman tujuan:
    1) exact match (kasus paling umum)
    2) startswith (utk blok gabungan spt 'BAB IIPEMBAHASAN')
    3) fuzzy match, ambang 0.75 (utk typo kecil di dokumen sumber, mis.
       'Desktop' di Daftar Isi vs 'Dekstop' di heading aslinya -- ditemukan
       nyata di salah satu dokumen uji, bukan kasus teoretis)
    Return None kalau tidak ada yg cukup yakin -- lebih baik skip drpd salah
    pasang link ke tempat yang salah."""
    label_norm = label.lower().strip()
    if not label_norm:
        return None
    for b in blocks:
        if b.lower().strip() == label_norm:
            return b
    for b in blocks:
        if len(label_norm) >= 3 and b.lower().strip().startswith(label_norm):
            return b
    best, best_ratio = None, 0
    for b in blocks:
        ratio = difflib.SequenceMatcher(None, b.lower().strip(), label_norm).ratio()
        if ratio > best_ratio:
            best_ratio, best = ratio, b
    return best if best_ratio >= 0.75 else None


def extract_internal_links(pdf_path):
    """Ekstrak semua link internal (GOTO, bukan URI eksternal) dari SETIAP
    halaman PDF, resolve teks sumber (label di halaman asal) & teks target
    (heading di halaman tujuan). Return list of {label, target_text}."""
    import fitz  # pylint: disable=import-outside-toplevel

    doc = fitz.open(pdf_path)
    results = []
    try:
        for page in doc:
            for link in page.get_links():
                if link.get('kind') != fitz.LINK_GOTO and link.get('kind') != 4:
                    continue  # cuma link internal, lewati URI eksternal (sudah ditangani pdf2docx)
                target_page_idx = link.get('page')
                target_point = link.get('to')
                if target_page_idx is None or target_point is None:
                    continue  # destinasi tidak ke-resolve di level PDF -- lewati, tidak bisa diperbaiki dari sini
                try:
                    src_text = page.get_textbox(link['from']).strip()
                except Exception:  # pylint: disable=broad-except
                    continue
                label = strip_toc_label(src_text)
                if not label:
                    continue
                target_blocks = get_page_text_blocks(doc[target_page_idx])
                target_text = find_best_text_match(target_blocks, label)
                if target_text:
                    results.append({'label': label, 'target_text': target_text})
    finally:
        doc.close()
    return results


def add_internal_hyperlinks(docx_path, links):
    """Pasang bookmark di paragraf/run yang cocok dgn target_text, lalu bungkus
    run yang cocok dgn label sbg hyperlink internal ke bookmark itu. Kerja di
    level RUN (bukan paragraf) krn pdf2docx sering menggabungkan banyak baris
    PDF (mis. seluruh Daftar Isi) jadi SATU paragraf dgn satu run per baris."""
    import docx  # pylint: disable=import-outside-toplevel
    from docx.oxml.ns import qn  # pylint: disable=import-outside-toplevel
    from docx.oxml import OxmlElement  # pylint: disable=import-outside-toplevel

    document = docx.Document(docx_path)
    all_paragraphs = document.paragraphs

    def make_bookmark(bookmark_id, name):
        start = OxmlElement('w:bookmarkStart')
        start.set(qn('w:id'), str(bookmark_id))
        start.set(qn('w:name'), name)
        end = OxmlElement('w:bookmarkEnd')
        end.set(qn('w:id'), str(bookmark_id))
        return start, end

    def wrap_run_as_hyperlink(run_element, anchor_name):
        hyperlink = OxmlElement('w:hyperlink')
        hyperlink.set(qn('w:anchor'), anchor_name)
        hyperlink.set(qn('w:history'), '1')
        parent = run_element.getparent()
        parent.insert(list(parent).index(run_element), hyperlink)
        parent.remove(run_element)
        hyperlink.append(run_element)

    bookmark_id = 100  # mulai dari angka besar, hindari bentrok id internal Word lain
    applied = 0
    used_target_paragraphs = set()  # id(paragraph) yg sudah dipakai -- cegah heading yg
    # teksnya berulang (mis. 'Register' muncul lagi utk section Desktop stlh Mobile)
    # selalu ke-bookmark ke kemunculan PERTAMA utk SEMUA link yg labelnya sama.
    for link in links:
        # 1) Cari paragraf target (persis/mengandung target_text) yg BELUM dipakai
        #    link lain & pasang bookmark -- urutan link mengikuti urutan halaman PDF,
        #    jadi maju ke kemunculan berikutnya scr alami utk heading yg berulang.
        target_para = None
        for p in all_paragraphs:
            if id(p) in used_target_paragraphs:
                continue
            if p.text.strip() == link['target_text'].strip() or p.text.strip().startswith(link['target_text'].strip()):
                target_para = p
                break
        if target_para is None or not target_para.runs:
            continue
        used_target_paragraphs.add(id(target_para))

        anchor_name = f"pdflink_{bookmark_id}"
        start_el, end_el = make_bookmark(bookmark_id, anchor_name)
        first_run_el = target_para.runs[0]._r  # pylint: disable=protected-access
        first_run_el.addprevious(start_el)
        first_run_el.addnext(end_el)
        bookmark_id += 1

        # 2) Cari run sumber (persis label ATAU diawali label -- run TOC biasa
        #    berisi label + dot leader + nomor halaman dalam satu run) & bungkus jadi hyperlink
        wrapped = False
        for p in all_paragraphs:
            if wrapped:
                break
            for r in p.runs:
                r_text = r.text.strip()
                if r_text.lower() == link['label'].strip().lower() or r_text.lower().startswith(link['label'].strip().lower() + '.'):
                    wrap_run_as_hyperlink(r._r, anchor_name)  # pylint: disable=protected-access
                    wrapped = True
                    applied += 1
                    break

    document.save(docx_path)
    return applied


def postprocess_internal_links(pdf_path, docx_path):
    """Enhancement non-kritis -- gagal di sini TIDAK menggagalkan konversi
    utama, cuma di-skip diam-diam (warning ke stderr saja)."""
    try:
        links = extract_internal_links(pdf_path)
        if not links:
            return
        applied = add_internal_hyperlinks(docx_path, links)
        print(f'Link internal terpasang: {applied}/{len(links)}', file=sys.stderr)
    except Exception as e:  # pylint: disable=broad-except
        print(f'Post-processing link internal dilewati (non-fatal): {type(e).__name__}: {e}', file=sys.stderr)


def main():
    if len(sys.argv) != 3:
        print('Usage: pdf_to_docx.py <input.pdf> <output.docx>', file=sys.stderr)
        sys.exit(2)

    input_path, output_path = sys.argv[1], sys.argv[2]

    if not os.path.isfile(input_path):
        print(f'File input tidak ditemukan: {input_path}', file=sys.stderr)
        sys.exit(1)

    try:
        # Import di dalam try -- kalau pdf2docx/PyMuPDF tidak ter-install
        # (mis. environment dev lokal tanpa Docker), ini akan gagal dgn
        # ImportError yang jelas, ditangkap Node sbg sinyal utk fallback ke
        # konversi berbasis pdfjs-dist yang sudah ada, bukan crash total.
        from pdf2docx import Converter
    except ImportError as e:
        print(f'pdf2docx tidak tersedia: {e}', file=sys.stderr)
        sys.exit(3)

    try:
        cv = Converter(input_path)
        try:
            cv.convert(output_path)
        finally:
            cv.close()
    except Exception as e:  # pylint: disable=broad-except
        print(f'Konversi gagal: {type(e).__name__}: {e}', file=sys.stderr)
        sys.exit(4)

    if not os.path.isfile(output_path) or os.path.getsize(output_path) == 0:
        print('Output tidak dihasilkan atau kosong.', file=sys.stderr)
        sys.exit(5)

    postprocess_internal_links(input_path, output_path)

    print(f'OK: {output_path} ({os.path.getsize(output_path)} bytes)')
    sys.exit(0)


if __name__ == '__main__':
    main()
