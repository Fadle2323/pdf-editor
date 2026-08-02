# PDF Editor

Aplikasi web pengeditan PDF yang berjalan **100% lokal** — tanpa database,
tanpa autentikasi. **Satu folder, satu server**: backend menyajikan
frontend-nya sendiri lewat `express.static`.

## Instalasi & Menjalankan

```bash
cd pdf-editor
npm install
copy .env.example .env      REM  (Mac/Linux: cp .env.example .env)
npm start
```

Buka **http://localhost:3000** di browser.

> `npm install` gagal di PowerShell? Pakai Command Prompt (cmd), atau jalankan
> `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` di
> PowerShell sebagai Administrator.

## Perbaikan & Fitur Baru di Versi Ini

### 1. Add Text — font, style, dan list
Muncul toolbar format saat sedang mengetik/mengedit teks:
- **Font**: Helvetica, Times New Roman, Courier, Symbol, ZapfDingbats (14 font
  standar PDF, selalu tersedia tanpa perlu embed font file).
- **Bold, Italic, Underline** (underline digambar manual sebagai garis, karena
  pdf-lib tidak punya underline bawaan).
- **List**: Tanpa List / Numbering (1. 2. 3.) / Bullet (•) / **Multilevel**
  (tekan `Tab` di awal baris untuk membuat sub-level, otomatis diberi nomor
  hierarkis seperti 1., 1.1., 1.2., 2., dst — mirip Word).
- Warna teks bisa diatur lewat color picker.

### 2. Compress — sekarang benar-benar mengompres
Sebelumnya cuma optimasi struktural ringan (nyaris tidak berpengaruh untuk
PDF berisi gambar). Sekarang setiap gambar JPEG di dalam PDF di-decode lalu
**di-recompress ulang** (kualitas & lebar maksimum diturunkan) memakai
`sharp`, baru ditulis balik ke PDF. Response sekarang juga melaporkan berapa
gambar yang berhasil diproses.
> Catatan jujur: PDF yang murni teks (tanpa gambar) memang dari awal sudah
> kecil dan sulit dikompres lebih jauh — itu bukan bug, itu ekspektasi wajar.

### 3. Merge — pesan error lebih jelas + download diperbaiki
Ditambahkan penanganan error per-file (kalau ada 1 file yang rusak/gagal
dibaca, pesan errornya sekarang menyebutkan file mana). Mekanisme download
juga diganti dari `window.open()` (rawan diblokir popup blocker browser,
kemungkinan ini penyebab "gagal" sebelumnya) menjadi unduhan langsung via
`fetch` + blob.

### 4. Split Pages — preview interaktif
Klik "Split Pages" sekarang membuka **modal berisi thumbnail semua halaman**.
Klik thumbnail untuk pilih/batal pilih halaman (bisa "Pilih Semua"), lalu
"Pisahkan & Unduh". Halaman yang berurutan otomatis digabung jadi satu file
output, yang tidak berurutan jadi file terpisah.

### 5. Convert — tidak lagi menghasilkan file kosong
Kalau PDF tidak punya teks yang bisa diekstrak (biasanya PDF hasil scan tanpa
OCR, atau file rusak/terenkripsi), sekarang muncul **pesan error yang jelas**
alih-alih diam-diam menghasilkan file Word/Excel/TXT yang kosong saat dibuka.

### 6. Navigasi — scroll vertikal, bukan klik per halaman
Semua halaman PDF dirender sekaligus, ditumpuk vertikal — tinggal scroll ke
bawah untuk pindah halaman, tidak perlu klik tombol next/prev lagi. Indikator
"Halaman X / Y" di toolbar otomatis mengikuti halaman mana yang sedang paling
terlihat di layar (pakai IntersectionObserver).

### 7. Export — pilih folder penyimpanan
Export PDF, Convert, Merge, Split, dan Compress sekarang memakai **File
System Access API** (`showSaveFilePicker`) — di Chrome/Edge terbaru, Anda
akan diminta memilih folder & nama file sebelum disimpan. Di browser yang
belum mendukung (Firefox/Safari), otomatis fallback ke unduhan biasa ke
folder Downloads dengan pemberitahuan yang jelas.

## Fitur yang Sudah Ada Sebelumnya (tetap dipertahankan)

- Deteksi Kata (toggle manual) + Select All per halaman aktif.
- Snip manual multi-area (drag beberapa kali, semua tergabung dalam satu
  seleksi lintas halaman).
- 6 gaya blur: Ringan, Kuat, Piksel, Mosaik, Blok Hitam, Acak (Noise).
- Add Text & E-Sign sebagai **layer draft** yang selalu bisa digeser/dihapus/
  di-resize, baru permanen setelah tombol **Export PDF** ditekan.
- E-Sign: gambar manual atau upload gambar tanda tangan yang sudah ada.
- Undo/Redo berbasis riwayat nama file (di memori browser, tanpa database).
- Responsive (layar sempit → panel tumpuk vertikal).

## Keterbatasan yang Perlu Diketahui

- **Delete = redaksi visual** (ditimpa kotak putih solid), bukan penghapusan
  konten PDF secara teknis di content stream.
- **Blur/pixelate/noise diproses di browser**, ditempel sebagai gambar statis.
- **Deteksi kata pakai estimasi proporsional** dari lebar teks per baris,
  bisa meleset di font tertentu.
- **Kompresi gambar hanya menangani JPEG (filter DCTDecode)** — format gambar
  PDF lain (mis. raw bitmap FlateDecode) belum diproses; ini mencakup
  mayoritas kasus nyata (foto/scan berformat JPEG) tanpa menambah risiko
  merusak PDF dengan color-space/bit-depth yang rumit.
- **`showSaveFilePicker` (pilih folder) hanya didukung Chrome/Edge** — di
  browser lain otomatis fallback ke folder Downloads default.
- **Annotation (teks/tanda tangan) yang belum di-Export hilang kalau halaman
  di-refresh** — disimpan di memori browser, bukan database.
