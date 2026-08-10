#!/usr/bin/env node
/**
 * postinstall: coba install dependency Python (pdf2docx dkk) lewat pip,
 * SUPAYA TIDAK BERGANTUNG PADA DOCKERFILE DIPAKAI ATAU TIDAK.
 *
 * Ditemukan lewat log produksi: platform hosting (Google AI Studio) ternyata
 * menjalankan app lewat `npm run dev` / `npm start` langsung, TIDAK memakai
 * Dockerfile custom sama sekali -- Python3 ADA di environment-nya (terbukti
 * dari pesan error "No module named 'pdf2docx'", bukan "python3 not found"),
 * tapi package pdf2docx-nya tidak pernah ter-install karena tahap
 * `pip3 install -r scripts/requirements.txt` di Dockerfile tidak pernah
 * jalan. Hook postinstall ini jadi jalan kedua yang jalan di MANAPUN `npm
 * install` dieksekusi, dengan atau tanpa Docker.
 *
 * SENGAJA tidak pernah membuat `npm install` gagal (selalu exit 0) --- ini
 * cuma enhancement opsional. Kalau pip/python3 tidak tersedia sama sekali
 * (mis. dev lokal tanpa Python), convertService.js sudah punya fallback ke
 * jalur JS (pdfjs-dist) yang sepenuhnya berfungsi tanpa Python.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const requirementsPath = path.join(__dirname, 'requirements.txt');

function tryInstall(pipBin, extraArgs) {
  const args = ['install', '--no-cache-dir', ...extraArgs, '-r', requirementsPath];
  const result = spawnSync(pipBin, args, { stdio: 'inherit' });
  return !result.error && result.status === 0;
}

function main() {
  if (!fs.existsSync(requirementsPath)) {
    console.log('[postinstall] scripts/requirements.txt tidak ada, lewati install Python deps.');
    return;
  }

  console.log('[postinstall] Mencoba install dependency Python (pdf2docx) via pip...');
  console.log('[postinstall] (opsional -- kalau gagal, app tetap berfungsi penuh lewat fallback JS)');

  // Coba beberapa kombinasi binary + flag, dari yang paling mungkin berhasil
  // di lingkungan modern (PEP 668, perlu --break-system-packages) sampai yang
  // paling sederhana (pip lama yang tidak kenal flag itu sama sekali).
  const attempts = [
    ['pip3', ['--break-system-packages']],
    ['pip3', []],
    ['pip', ['--break-system-packages']],
    ['pip', []],
    ['python3', ['-m', 'pip', 'install', '--break-system-packages']], // ditangani beda di bawah
  ];

  for (const [bin, extraArgs] of attempts) {
    try {
      if (bin === 'python3' && extraArgs[0] === '-m') {
        // Bentuk command beda: python3 -m pip install ...
        const args = [...extraArgs, '-r', requirementsPath];
        const result = spawnSync('python3', args, { stdio: 'inherit' });
        if (!result.error && result.status === 0) {
          console.log('[postinstall] Berhasil via "python3 -m pip".');
          return;
        }
        continue;
      }
      if (tryInstall(bin, extraArgs)) {
        console.log(`[postinstall] Berhasil via "${bin} ${extraArgs.join(' ')}".`);
        return;
      }
    } catch (_) {
      // binary tidak ditemukan sama sekali -- coba kandidat berikutnya
    }
  }

  console.log('[postinstall] Tidak berhasil install pdf2docx lewat pip apapun (python3/pip mungkin');
  console.log('[postinstall] tidak tersedia di environment ini). TIDAK MASALAH -- fitur konversi');
  console.log('[postinstall] PDF ke Word tetap berfungsi penuh lewat fallback berbasis JavaScript.');
}

main();
process.exit(0); // JANGAN PERNAH gagalkan npm install gara-gara ini
