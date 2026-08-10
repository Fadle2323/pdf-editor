# Scripta Paper

### Ubah Cara Kamu Bekerja dengan Dokumen PDF, Langsung dari Browser

[![Status](https://img.shields.io/badge/status-active-brightgreen)]()
[![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?logo=node.js&logoColor=white)]()
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)]()
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)]()
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)]()

**Live Demo:** [scripta-paper.ai.studio](https://scripta-paper.ai.studio/)

---

## Tentang Scripta Paper

**Scripta Paper** adalah editor dan konverter PDF berbasis web yang dirancang untuk satu tujuan sederhana: membuat pekerjaan dengan dokumen digital terasa cepat, rapi, dan tidak merepotkan.

Tidak perlu instal aplikasi berat, tidak perlu upload ke layanan pihak ketiga yang mencurigakan. Cukup buka browser, unggah PDF-mu, dan mulai bekerja: sunting teks, tempelkan tanda tangan, sisipkan gambar di posisi manapun, sensor data sensitif, gabungkan berkas, hingga ubah PDF jadi dokumen Word yang benar benar rapi lengkap dengan tabel, gambar, dan format aslinya.

Dibangun dengan filosofi yang jelas: setiap fitur harus benar benar bekerja, bukan sekadar terlihat bekerja di atas kertas.

---

## Fitur Utama & Pembaruan Terkini

### Penyuntingan Dokumen yang Fleksibel

| Fitur | Deskripsi |
|---|---|
| Add Text & E-Sign | Tempelkan teks atau tanda tangan digital di posisi bebas, bisa digeser dan diubah ukurannya kapan saja |
| Sisipkan Gambar | Tambahkan JPG/PNG langsung ke halaman lewat klik atau drag and drop, posisi dan ukuran sepenuhnya bebas |
| Dua Mode Blur | Sensor otomatis berbasis deteksi kata, atau sensor area penuh sesuai kotak yang dipilih |
| Panel Kerja Fleksibel | Sidebar kiri dan kanan sama sama bisa diubah lebarnya sesuai kenyamanan |

### Konversi Dokumen Kelas Profesional

| Fitur | Deskripsi |
|---|---|
| PDF ke Word, dengan Tabel Asli | Ditenagai pdf2docx, bukan sekadar tempel teks: tabel, gambar, perataan paragraf, hingga ukuran font direkonstruksi seakurat mungkin dari dokumen aslinya |
| Tautan Internal Aktif | Daftar isi yang bisa diklik langsung menuju bagian terkait, tersambung otomatis lewat pencocokan cerdas antara PDF sumber dan hasil konversi |
| Lapisan Cadangan Otomatis | Jika komponen konversi utama tak tersedia, sistem otomatis beralih ke jalur alternatif tanpa membuat proses gagal total |

### Keamanan & Performa

| Fitur | Deskripsi |
|---|---|
| Proteksi Password Andal | Enkripsi PDF memakai qpdf, terverifikasi dapat dibuka kembali dengan password yang benar |
| Unggah & Unduh Berkas Besar | Berkas besar dipecah jadi bagian bagian kecil saat diunggah maupun diunduh, menjaga koneksi tetap stabil dan lolos dari batas ukuran server |
| Verifikasi Integritas File | Setiap unduhan diperiksa ukurannya sebelum disimpan, memastikan tidak ada berkas rusak yang lolos tanpa peringatan |

---

## Arsitektur & Tech Stack

Scripta Paper dibangun di atas kombinasi teknologi yang saling melengkapi, dipilih berdasarkan kekuatan masing masing untuk tugas spesifiknya.

**Backend & Server**
- Node.js dan Express sebagai fondasi REST API
- Python (dengan pdf2docx dan PyMuPDF) untuk konversi dokumen tingkat lanjut
- qpdf untuk enkripsi PDF yang sesuai standar

**Frontend**
- HTML5, CSS3, dan Tailwind CSS untuk antarmuka yang modern dan responsif
- PDF.js untuk rendering dan interaksi PDF langsung di browser
- JavaScript murni, ringan dan tanpa framework berat

**Infrastruktur**
- Docker untuk deployment yang konsisten dan portabel
- Dirancang untuk berjalan di platform container seperti Google Cloud Run

---

## Panduan Memulai (Local Development)

Ingin menjalankan Scripta Paper di komputermu sendiri? Ikuti langkah berikut.

**1. Clone repository**

```bash
git clone https://github.com/Fadle2323/pdf-editor.git
cd pdf-editor
```

**2. Instal dependensi**

```bash
npm install
```

Untuk fitur konversi Word lengkap (dengan tabel dan tautan internal), pastikan Python 3 dan pustaka di `scripts/requirements.txt` juga terpasang. Tanpa ini, aplikasi tetap berjalan normal lewat jalur cadangan berbasis JavaScript.

**3. Jalankan server lokal**

```bash
npm start
```

Buka `http://localhost:3000` di browser, dan Scripta Paper siap digunakan.

**4. Jalankan lewat Docker (opsional)**

```bash
docker build -t scripta-paper .
docker run -p 3000:3000 scripta-paper
```

---

## Lisensi & Kontak

Status lisensi: **Proprietary / Belum ditentukan**. Seluruh hak masih dipegang penulis proyek, penggunaan, modifikasi, atau distribusi kode di luar izin penulis belum diperbolehkan sampai lisensi resmi ditetapkan.

Ditemukan bug atau punya ide fitur baru? Silakan buka issue di repository ini.

**Live Demo:** [scripta-paper.ai.studio](https://scripta-paper.ai.studio/)
**Repository:** [github.com/Fadle2323/pdf-editor](https://github.com/Fadle2323/pdf-editor)
