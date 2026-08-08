# syntax=docker/dockerfile:1

# Scripta PDF Editor -- Node.js backend + Python (pdf2docx) utk konversi
# PDF->Word dengan tabel/layout asli. qpdf sistem juga di-install supaya
# password-protection PDF pakai jalur tercepat (bukan fallback WASM).

FROM node:20-slim

# --- System deps ---
# python3 + pip           : menjalankan scripts/pdf_to_docx.py (pdf2docx)
# libgl1, libglib2.0-0     : dibutuhkan opencv-python-headless (dependency
#                            pdf2docx) walau varian "headless" -- dikonfirmasi
#                            lewat ldd, tanpa ini akan ImportError saat runtime
# qpdf                     : jalur tercepat utk password-protection PDF
#                            (services/pdfService.js sudah fallback otomatis
#                            ke qpdf-wasm kalau binary ini tidak ada, tapi
#                            binary asli lebih cepat & lebih robust utk PDF
#                            yang rusak/tidak standar)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    libgl1 \
    libglib2.0-0 \
    qpdf \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Python deps ---
# Di-install terpisah dari COPY kode aplikasi supaya layer ini di-cache dan
# tidak perlu di-install ulang tiap kali cuma kode JS yang berubah.
COPY scripts/requirements.txt ./scripts/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r scripts/requirements.txt

# --- Node deps ---
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- Kode aplikasi ---
COPY . .

# Cloud Run inject PORT env var sendiri; config.js sudah baca process.env.PORT
ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
