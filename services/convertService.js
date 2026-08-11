const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  HeadingLevel,
  AlignmentType,
} = require('docx');
const ExcelJS = require('exceljs');
const sharp = require('sharp');
const config = require('../config');
const { extractTextFromFile } = require('./textService');

// Feature 4: Ekstraksi terstruktur (heading/bold/italic/gambar) via pdfjs-dist.
// Jika gagal load, fallback ke pdf-parse (tetap bisa konversi, tapi teks polos
// tanpa formatting maupun gambar).
//
// PENTING: pdfjs-dist v6.x sudah ESM-only -- TIDAK ADA LAGI build CommonJS
// (file 'legacy/build/pdf.js' tidak eksis di versi ini). require() untuk path
// itu akan SELALU throw, tertangkap oleh catch, dan diam-diam membuat seluruh
// fitur formatting di bawah ini tidak pernah berjalan sama sekali -- inilah
// akar bug "hasil convert Word cuma teks polos tanpa formatting/gambar".
// Fix: pakai dynamic import() ke path '.mjs' yang benar, dan load LAZY (bukan
// di top-level module, karena top-level await tidak tersedia di CommonJS).
let pdfjsLibPromise = null;
function loadPdfjsLib() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('pdfjs-dist/legacy/build/pdf.mjs').catch((err) => {
      console.warn('[convertToWord] Gagal load pdfjs-dist, fallback ke pdf-parse:', err.message);
      pdfjsLibPromise = null; // izinkan retry di request berikutnya
      return null;
    });
  }
  return pdfjsLibPromise;
}

function ensureConvertedDir() {
  if (!fs.existsSync(config.convertedDir)) {
    fs.mkdirSync(config.convertedDir, { recursive: true });
  }
}

function assertHasExtractableText(text) {
  if (!text || !text.trim()) {
    throw new Error(
      'Tidak ada teks yang bisa diekstrak dari PDF ini. Kemungkinan PDF berupa '
      + 'hasil scan/gambar tanpa lapisan teks (butuh OCR, belum didukung), atau '
      + 'PDF-nya terenkripsi/rusak.'
    );
  }
}

// ================== FEATURE 4: Ekstraksi Terstruktur via pdfjs-dist ==================

/**
 * Kelompokkan teks items per-halaman menjadi baris berdasarkan posisi Y.
 */
function groupItemsIntoLines(items, tolerance = 3) {
  const sorted = [...items].sort((a, b) => a.transform[5] - b.transform[5] || a.transform[4] - b.transform[4]);
  const lines = [];
  sorted.forEach((item) => {
    const y = item.transform[5];
    const height = Math.abs(item.height) || 10;
    let line = lines.find((l) => Math.abs(l.y - y) <= tolerance);
    if (!line) { line = { y, height, items: [] }; lines.push(line); }
    line.items.push(item);
    line.height = Math.max(line.height, height);
  });
  lines.forEach((line) => {
    line.startX = Math.min(...line.items.map((it) => it.transform[4]));
    line.endX = Math.max(...line.items.map((it) => it.transform[4] + (it.width || 0)));
  });
  // Balik urutan: PDF y bertambah ke atas, kita ingin atas-ke-bawah
  return lines.reverse();
}

/**
 * Cari nilai yang paling sering muncul dalam array angka, dibulatkan ke
 * kelipatan bucketSize dulu supaya toleran thd variasi kecil (mis. 71.8 vs
 * 72.3 dianggap sama kalau bucketSize=3).
 */
function computeModeBucket(values, bucketSize) {
  if (!values.length) return 0;
  const counts = new Map();
  values.forEach((v) => {
    const bucket = Math.round(v / bucketSize) * bucketSize;
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
  });
  let mode = values[0];
  let maxCount = 0;
  counts.forEach((count, bucket) => {
    if (count > maxCount) { maxCount = count; mode = bucket; }
  });
  return mode;
}

/**
 * Deteksi alignment (kiri/tengah) tiap baris teks dalam satu halaman,
 * berdasarkan margin-kiri dominan yang sudah dihitung sekali utk SELURUH
 * dokumen (commonLeftX -- lihat catatan di extractStructuredContent soal
 * kenapa ini harus dihitung global, bukan per-halaman).
 */
function detectLineAlignment(lines, pageWidth, commonLeftX) {
  const pageCenterX = pageWidth / 2;
  const CENTER_TOLERANCE = 15;
  const LEFT_MARGIN_TOLERANCE = 6;

  lines.forEach((line) => {
    const centerX = (line.startX + line.endX) / 2;
    if (Math.abs(line.startX - commonLeftX) <= LEFT_MARGIN_TOLERANCE) {
      line.alignment = 'left';
    } else if (Math.abs(centerX - pageCenterX) <= CENTER_TOLERANCE) {
      line.alignment = 'center';
    } else {
      line.alignment = 'left'; // default aman kalau tidak jelas kasusnya
    }
  });
}

function average(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

// Kalikan 2 matrix transformasi PDF ([a,b,c,d,e,f], format standar PDF content
// stream) -- dipakai utk melacak CTM (current transformation matrix) sepanjang
// operator list, supaya tahu posisi & ukuran TAMPILAN tiap gambar di halaman.
function multiplyMatrix(a, b) {
  return [
    a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

/**
 * Ekstrak semua gambar (paintImageXObject) dari satu halaman, lengkap dengan
 * posisi Y (koordinat PDF, dari bawah -- konsisten dgn groupItemsIntoLines)
 * dan ukuran tampilannya di halaman (bukan resolusi piksel asli), supaya bisa
 * disisipkan pada urutan baca yang benar di antara baris-baris teks.
 */
async function extractImagesFromPage(pdfjsLib, page) {
  const OPS = pdfjsLib.OPS;
  const opList = await page.getOperatorList();
  const seenPng = new Map(); // cache per nama gambar -- 1 gambar bisa dipakai berkali-kali
  const images = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];

  for (let i = 0; i < opList.fnArray.length; i += 1) {
    const fn = opList.fnArray[i];
    if (fn === OPS.save) {
      stack.push(ctm);
    } else if (fn === OPS.restore) {
      ctm = stack.pop() || ctm;
    } else if (fn === OPS.transform) {
      ctm = multiplyMatrix(opList.argsArray[i], ctm);
    } else if (fn === OPS.paintImageXObject) {
      const imgName = opList.argsArray[i][0];
      const dispWidthPt = Math.hypot(ctm[0], ctm[1]);
      const dispHeightPt = Math.hypot(ctm[2], ctm[3]);
      const topY = ctm[5] + dispHeightPt; // tepi ATAS gambar, koordinat PDF (dari bawah)
      images.push({
        name: imgName, y: topY, dispWidthPt, dispHeightPt,
      });
    }
  }

  const results = [];
  for (const img of images) { // eslint-disable-line no-restricted-syntax
    if (img.dispWidthPt < 3 || img.dispHeightPt < 3) continue; // eslint-disable-line no-continue -- lewati gambar dekoratif super kecil (mis. bullet/ikon 1x1)
    try {
      let pngBuffer = seenPng.get(img.name);
      let pxWidth;
      let pxHeight;
      if (!pngBuffer) {
        const obj = await new Promise((resolve, reject) => { // eslint-disable-line no-await-in-loop
          try { page.objs.get(img.name, resolve); } catch (e) { reject(e); }
        });
        if (!obj || !obj.data || !obj.width || !obj.height) continue; // eslint-disable-line no-continue
        // ImageKind: 1=GRAYSCALE_1BPP (bit-packed, jarang di PDF modern -- di-
        // lewati drpd salah unpack), 2=RGB_24BPP, 3=RGBA_32BPP.
        if (obj.kind === 1) continue; // eslint-disable-line no-continue
        const channels = obj.kind === 3 ? 4 : 3;
        pngBuffer = await sharp(Buffer.from(obj.data), { // eslint-disable-line no-await-in-loop
          raw: { width: obj.width, height: obj.height, channels },
        }).png().toBuffer();
        pxWidth = obj.width; pxHeight = obj.height;
        seenPng.set(img.name, pngBuffer);
      }
      results.push({
        type: 'image', y: img.y, pngBuffer, dispWidthPt: img.dispWidthPt, dispHeightPt: img.dispHeightPt, pxWidth, pxHeight,
      });
    } catch (imgErr) {
      console.warn('[convertToWord] Gagal ekstrak gambar', img.name, ':', imgErr.message);
    }
  }
  return results;
}

// pdfjs-dist TIDAK mengekspos nama font PDF asli lewat getTextContent() --
// item.fontName cuma ID internal (mis. "g_d0_f2"), bukan nama font
// sesungguhnya (yang seringkali di-subset/di-embed & tak akan ada di
// komputer pembaca manapun). Yang tersedia hanya kategori CSS generik lewat
// content.styles[fontName].fontFamily ('sans-serif'/'serif'/'monospace') --
// dipetakan ke font Word yang wajar, jauh lebih aman drpd meneruskan ID
// internal itu sbg nama font (yang akan diabaikan/salah render di Word).
function mapGenericFontFamily(cssFamily) {
  if (!cssFamily) return undefined;
  if (/monospace/i.test(cssFamily)) return 'Courier New';
  if (/serif/i.test(cssFamily) && !/sans/i.test(cssFamily)) return 'Times New Roman';
  if (/sans-serif/i.test(cssFamily)) return 'Calibri';
  return undefined;
}

/**
 * Ekstrak konten terstruktur dari PDF menggunakan pdfjs-dist: teks dengan
 * formatting (heading/bold/italic/ukuran font) DAN gambar, digabung dalam
 * satu urutan baca (atas ke bawah) per halaman.
 * Mengembalikan array block: { type, newParagraph, runs } utk teks, atau
 * { type: 'image', ... } utk gambar.
 */
async function extractStructuredContent(filePath, pdfjsLib) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data, disableWorker: true }).promise;
  const blocks = [];

  // Pass 1: kumpulkan baris tiap halaman (di-cache, dipakai lagi di pass 2 --
  // supaya tidak nge-group ulang), sekaligus kumpulkan statistik SELURUH
  // dokumen: rata-rata ukuran font & margin-kiri yang paling umum dipakai.
  //
  // Margin-kiri dihitung GLOBAL (bukan per-halaman) supaya klaster kecil yg
  // startX-nya kebetulan sama di SATU halaman (mis. daftar nama penulis di
  // cover, rata-kiri thd satu sama lain tapi bloknya sendiri di-tengah-kan)
  // tidak salah dianggap sbg margin body-text -- margin body-text asli akan
  // mendominasi begitu dihitung dari SEMUA halaman sekaligus.
  const pageLines = [];
  const allFontSizes = [];
  const allStartX = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p); // eslint-disable-line no-await-in-loop
    const content = await page.getTextContent(); // eslint-disable-line no-await-in-loop
    const lines = groupItemsIntoLines(content.items).map((l) => ({ ...l, type: 'line' }));
    pageLines.push({ page, lines, styles: content.styles });
    content.items.forEach((it) => {
      if (it.height > 0) allFontSizes.push(Math.abs(it.height));
    });
    lines.forEach((l) => allStartX.push(l.startX));
  }
  const docAvgFontSize = average(allFontSizes) || 12;
  const commonLeftX = computeModeBucket(allStartX, 3);

  // Pass 2: ekstrak struktur per halaman (teks + gambar, digabung urutan baca)
  for (let p = 1; p <= doc.numPages; p++) {
    const { page, lines, styles } = pageLines[p - 1];
    detectLineAlignment(lines, page.view[2], commonLeftX);
    const images = await extractImagesFromPage(pdfjsLib, page); // eslint-disable-line no-await-in-loop

    // Gabungkan baris teks & gambar jadi satu urutan baca: y makin besar =
    // makin ke atas halaman (koordinat PDF), jadi urutkan DESCENDING.
    const merged = [...lines, ...images].sort((a, b) => b.y - a.y);

    merged.forEach((entry, i) => {
      if (entry.type === 'image') {
        blocks.push(entry);
        return;
      }
      const line = entry;
      if (!line.items.length) return;
      const prevLine = merged[i - 1];
      const gapAbove = prevLine ? Math.abs(line.y - prevLine.y) - prevLine.height : 0;
      const avgFontSize = average(line.items.map((it) => Math.abs(it.height) || docAvgFontSize));

      // Heading: font > 1.3x rata-rata dokumen ATAU semua huruf besar & font lebih besar dari rata-rata
      const lineText = line.items.map((it) => it.str).join('');
      const isHeading = avgFontSize > docAvgFontSize * 1.3
        || (lineText === lineText.toUpperCase() && lineText.trim().length > 2 && avgFontSize >= docAvgFontSize * 1.1);
      // Paragraph break: jarak vertikal antar baris > 0.6x tinggi baris
      const isNewParagraph = gapAbove > avgFontSize * 0.6;

      const runs = line.items
        .filter((it) => it.str && it.str.trim())
        .map((it) => ({
          text: it.str,
          bold: it.fontName ? /bold/i.test(it.fontName) : false,
          italic: it.fontName ? /italic|oblique/i.test(it.fontName) : false,
          // item.height dari pdfjs-dist SUDAH dalam satuan point (satuan yg sama
          // dgn page.view/koordinat PDF) -- BUKAN pixel@96dpi, jadi TIDAK PERLU
          // dibagi 96/72. Pembagian itu ada di versi sebelumnya & membuat semua
          // ukuran font di hasil Word 25% lebih kecil dari aslinya di PDF.
          sizePt: Math.round(Math.abs(it.height) || docAvgFontSize),
          font: mapGenericFontFamily(styles[it.fontName] && styles[it.fontName].fontFamily),
        }));

      if (runs.length) {
        blocks.push({
          type: isHeading ? 'heading' : 'paragraph', newParagraph: isNewParagraph, runs, alignment: line.alignment,
        });
      }
    });

    // Halaman baru → paragraph break
    if (p < doc.numPages) blocks.push({ type: 'pagebreak', newParagraph: true, runs: [] });
  }
  return blocks;
}

// Lebar konten halaman Word standar (A4/Letter, margin default docx.js ~1in
// tiap sisi) dalam pixel @96dpi -- dipakai utk membatasi ukuran gambar supaya
// tidak meluber keluar halaman, sambil menjaga rasio aspek aslinya.
const MAX_IMAGE_WIDTH_PX = 550;

/**
 * Konversi block terstruktur menjadi paragraf docx dengan formatting & gambar.
 */
function blocksToDocxParagraphs(blocks) {
  const paragraphs = [];
  blocks.forEach((block) => {
    if (block.type === 'pagebreak') {
      paragraphs.push(new Paragraph({ pageBreakBefore: true, children: [] }));
      return;
    }
    if (block.type === 'image') {
      // Konversi ukuran tampilan dari PDF (points) ke pixel @96dpi (konvensi
      // docx.js utk ImageRun.transformation), lalu batasi ke lebar maksimum
      // halaman sambil menjaga rasio aspek.
      const PT_TO_PX = 96 / 72;
      let widthPx = block.dispWidthPt * PT_TO_PX;
      let heightPx = block.dispHeightPt * PT_TO_PX;
      if (widthPx > MAX_IMAGE_WIDTH_PX) {
        const scale = MAX_IMAGE_WIDTH_PX / widthPx;
        widthPx *= scale; heightPx *= scale;
      }
      paragraphs.push(new Paragraph({
        spacing: { before: 120, after: 120 },
        alignment: AlignmentType.CENTER,
        children: [new ImageRun({
          data: block.pngBuffer,
          transformation: { width: Math.round(widthPx), height: Math.round(heightPx) },
        })],
      }));
      return;
    }
    const children = block.runs.map((r) => new TextRun({
      text: r.text,
      bold: r.bold,
      italics: r.italic,
      font: r.font,
      size: r.sizePt > 0 ? r.sizePt * 2 : undefined, // docx half-points
    }));
    if (!children.length) return;
    const para = new Paragraph({
      heading: block.type === 'heading' ? HeadingLevel.HEADING_1 : undefined,
      spacing: block.newParagraph ? { before: 120 } : undefined,
      alignment: block.alignment === 'center' ? AlignmentType.CENTER : undefined,
      children,
    });
    paragraphs.push(para);
  });
  return paragraphs;
}

/**
 * Coba konversi lewat pdf2docx (Python), yang bisa merekonstruksi tabel asli,
 * deteksi justify, dan positioning yang lebih presisi drpd jalur pdfjs-dist.
 * Return nama file output kalau berhasil, atau null kalau Python/pdf2docx
 * tidak tersedia atau gagal (supaya convertToWord bisa fallback dgn aman --
 * ini BUKAN error fatal, cuma sinyal "coba jalur lain").
 */
// Exit code 3 dari scripts/pdf_to_docx.py = pdf2docx spesifik tidak
// ter-install (ImportError), beda dari exit code lain (gagal konversi,
// binary python tidak ketemu, dst). Dipakai utk memicu self-heal di bawah.
const PDF2DOCX_NOT_INSTALLED_EXIT_CODE = 3;

// Self-heal runtime: DITEMUKAN lewat log produksi bahwa baik Dockerfile
// MAUPUN npm postinstall (dua mekanisme standar utk install dependency saat
// build) sama-sama TIDAK berjalan di platform hosting ini -- kemungkinan
// besar platform-nya menjalankan 'npm install' dengan --ignore-scripts demi
// keamanan (praktik umum di banyak platform managed hosting), yang membuat
// postinstall TIDAK PERNAH terpicu apapun yang kita lakukan di sana. Karena
// dua jalur "saat build" ini terbukti di luar kendali kita, install dicoba
// lagi di RUNTIME sekali saja saat pertama kali dibutuhkan -- ini satu-
// satunya titik yang PASTI kita kendalikan penuh, terlepas dari mekanisme
// build/deploy platform apapun.
let runtimePipInstallAttempted = false;

function attemptRuntimePipInstall() {
  return new Promise((resolve) => {
    if (runtimePipInstallAttempted) { resolve(false); return; }
    runtimePipInstallAttempted = true;

    const requirementsPath = path.join(__dirname, '..', 'scripts', 'requirements.txt');

    // LANGKAH 0 -- bootstrap pip dulu kalau belum ada sama sekali. DITEMUKAN
    // lewat log produksi: bukan cuma "pip tidak ada di PATH", tapi python3
    // sendiri eksplisit bilang "No module named pip" -- pip BENAR-BENAR tidak
    // ter-install di image ini (umum pada base image minimal yg sengaja
    // membuang pip demi ukuran). ensurepip me-restore pip dari wheel yg
    // dibundel LANGSUNG di dalam instalasi Python itu sendiri -- TIDAK butuh
    // akses internet sama sekali. Diverifikasi bekerja di venv terisolasi
    // tanpa pip sama sekali, mereplikasi persis kondisi produksi.
    const runEnsurepip = () => new Promise((res) => {
      console.warn('[convertToWord] pip tidak ditemukan -- coba bootstrap via "python3 -m ensurepip"...');
      const proc = spawn('python3', ['-m', 'ensurepip', '--default-pip'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', () => res(false));
      proc.on('close', (code) => {
        if (code === 0) {
          console.warn('[convertToWord] Bootstrap pip via ensurepip berhasil.');
        } else {
          console.warn('[convertToWord] Bootstrap pip via ensurepip gagal (exit', code, '):', stderr.trim().slice(-200));
        }
        res(code === 0);
      });
    });

    // Kombinasi yang sama dgn scripts/postinstall.js -- dicoba berurutan
    // sampai salah satu berhasil.
    const attempts = [
      ['pip3', ['install', '--no-cache-dir', '--break-system-packages', '-r', requirementsPath]],
      ['pip3', ['install', '--no-cache-dir', '-r', requirementsPath]],
      ['pip', ['install', '--no-cache-dir', '--break-system-packages', '-r', requirementsPath]],
      ['python3', ['-m', 'pip', 'install', '--no-cache-dir', '--break-system-packages', '-r', requirementsPath]],
    ];

    const tryNext = (i) => {
      if (i >= attempts.length) {
        console.warn('[convertToWord] Self-heal runtime pip install gagal di semua kombinasi -- tetap pakai fallback pdfjs-dist.');
        resolve(false);
        return;
      }
      const [bin, args] = attempts[i];
      console.warn(`[convertToWord] Mencoba self-heal: install pdf2docx via "${bin}" saat runtime (percobaan ${i + 1}/${attempts.length})...`);
      const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', () => tryNext(i + 1));
      proc.on('close', (code) => {
        if (code === 0) {
          console.warn(`[convertToWord] Self-heal berhasil via "${bin}". pdf2docx sekarang tersedia utk request berikutnya.`);
          resolve(true);
        } else {
          console.warn(`[convertToWord] Self-heal via "${bin}" gagal (exit ${code}):`, stderr.trim().slice(-200));
          tryNext(i + 1);
        }
      });
    };

    runEnsurepip().then(() => tryNext(0));
  });
}

function tryPdf2docx(filePath, outputPath, allowSelfHealRetry = true) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'pdf_to_docx.py');
    // Coba 'python3' dulu (standar di image Docker Linux), fallback ke
    // 'python' kalau tidak ada -- pola sama spt probe multi-path qpdf.
    const candidates = ['python3', 'python'];

    const tryNext = (i) => {
      if (i >= candidates.length) { resolve(null); return; }
      const bin = candidates[i];
      const proc = spawn(bin, [scriptPath, filePath, outputPath], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', () => tryNext(i + 1)); // binary tidak ditemukan -> coba kandidat berikutnya
      proc.on('close', async (code) => {
        if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
          resolve(outputPath);
          return;
        }
        try { fs.unlinkSync(outputPath); } catch (_) { /* mungkin belum sempat dibuat */ }

        if (code === PDF2DOCX_NOT_INSTALLED_EXIT_CODE && allowSelfHealRetry) {
          const healed = await attemptRuntimePipInstall();
          if (healed) {
            // Coba SEKALI lagi dari awal (allowSelfHealRetry=false spy tidak
            // bisa infinite-loop kalau ternyata masih gagal setelah "berhasil"
            // di-install -- misal krn alasan lain yg tak terduga).
            const retryResult = await tryPdf2docx(filePath, outputPath, false);
            resolve(retryResult);
            return;
          }
        }

        console.warn(`[convertToWord] pdf2docx (${bin}) gagal (exit ${code}), fallback ke pdfjs-dist:`, stderr.trim().slice(-300));
        resolve(null);
      });
    };
    tryNext(0);
  });
}

// ================== PUBLIC API ==================

async function convertToTxt(filePath) {
  const { text } = await extractTextFromFile(filePath);
  assertHasExtractableText(text);

  ensureConvertedDir();
  const outputName = `converted-${uuidv4()}.txt`;
  const outputPath = path.join(config.convertedDir, outputName);
  fs.writeFileSync(outputPath, text, 'utf-8');
  return outputName;
}

/**
 * Konversi PDF -> Word (.docx). Strategi 3 lapis, dari yang paling lengkap:
 * 1) pdf2docx (Python, via Docker) -- tabel asli, justify, layout presisi.
 * 2) pdfjs-dist (JS) -- heading/bold/italic/gambar/alignment, tanpa tabel.
 * 3) pdf-parse -- teks polos, fallback terakhir yang selalu berhasil.
 */
async function convertToWord(filePath) {
  ensureConvertedDir();
  const outputName = `converted-${uuidv4()}.docx`;
  const outputPath = path.join(config.convertedDir, outputName);

  const pdf2docxResult = await tryPdf2docx(filePath, outputPath);
  if (pdf2docxResult) return outputName;

  let paragraphs;

  const pdfjsLib = await loadPdfjsLib();
  if (pdfjsLib) {
    // Jalur ke-2: pdfjs-dist dengan formatting + gambar
    try {
      const blocks = await extractStructuredContent(filePath, pdfjsLib);
      paragraphs = blocksToDocxParagraphs(blocks);
    } catch (err) {
      console.warn('[convertToWord] pdfjs-dist gagal, fallback ke pdf-parse:', err.message);
    }
  }

  if (!paragraphs) {
    // Fallback terakhir: pdf-parse (teks polos, satu Paragraph per baris)
    const { text } = await extractTextFromFile(filePath);
    assertHasExtractableText(text);
    paragraphs = text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => new Paragraph({ children: [new TextRun(line)] }));
  }

  const doc = new Document({
    sections: [{
      properties: {},
      children: paragraphs.length ? paragraphs : [new Paragraph('')],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  return outputName;
}

async function convertToExcel(filePath) {
  const { text } = await extractTextFromFile(filePath);
  assertHasExtractableText(text);

  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Extracted Text');
  sheet.columns = [{ header: 'Content', key: 'content', width: 100 }];
  lines.forEach((line) => sheet.addRow({ content: line }));

  ensureConvertedDir();
  const outputName = `converted-${uuidv4()}.xlsx`;
  const outputPath = path.join(config.convertedDir, outputName);
  await workbook.xlsx.writeFile(outputPath);
  return outputName;
}

module.exports = { convertToTxt, convertToWord, convertToExcel };
