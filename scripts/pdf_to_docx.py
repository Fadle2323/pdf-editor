#!/usr/bin/env python3
"""
Wrapper CLI tipis di atas pdf2docx utk dipanggil sbg subprocess dari Node.js
(services/convertService.js). Sengaja dibuat sesederhana mungkin: terima path
input & output, jalankan konversi, exit code 0 = sukses, non-zero = gagal
(pesan error di stderr, bisa dibaca Node utk fallback ke jalur JS).

Usage: python3 pdf_to_docx.py <input.pdf> <output.docx>
"""
import sys
import os


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

    print(f'OK: {output_path} ({os.path.getsize(output_path)} bytes)')
    sys.exit(0)


if __name__ == '__main__':
    main()
