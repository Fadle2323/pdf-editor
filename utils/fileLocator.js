const fs = require('fs');
const { safeJoin } = require('./sanitize');
const config = require('../config');

/**
 * Mencari file berdasarkan nama, memeriksa folder `converted/` lebih dulu
 * (hasil edit terbaru) baru `uploads/` (file asli). Ini memungkinkan
 * operasi edit "berantai" — misal: add-text -> hasilnya dipakai lagi
 * untuk blur-area -> hasilnya dipakai lagi untuk convert-to-word, dst,
 * tanpa perlu menimpa file asli maupun menyimpan state di database.
 *
 * Mengembalikan path absolut jika ditemukan, atau null jika tidak ada.
 */
function resolveFilePath(filename) {
  try {
    const convertedPath = safeJoin(config.convertedDir, filename);
    if (fs.existsSync(convertedPath)) return convertedPath;
  } catch (e) { /* lanjut cek uploadDir */ }

  try {
    const uploadPath = safeJoin(config.uploadDir, filename);
    if (fs.existsSync(uploadPath)) return uploadPath;
  } catch (e) { /* file tidak ditemukan di mana pun */ }

  return null;
}

module.exports = { resolveFilePath };
