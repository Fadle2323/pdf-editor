const fs = require('fs');
const { success, error } = require('../utils/response');
const { safeJoin } = require('../utils/sanitize');
const config = require('../config');

function locateFile(filename) {
  // File hasil proses/konversi disimpan di convertedDir,
  // file mentah hasil upload disimpan di uploadDir. Cek keduanya.
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

/**
 * GET /api/download/:filename
 */
async function downloadFile(req, res) {
  const { filename } = req.params;
  const filePath = locateFile(filename);

  if (!filePath) return error(res, 'File tidak ditemukan', 404);

  return res.download(filePath, filename, (err) => {
    if (err) {
      console.error('[DOWNLOAD] Gagal mengirim file:', err.message);
      if (!res.headersSent) {
        error(res, 'Gagal mengunduh file', 500);
      }
    }
  });
}

/**
 * DELETE /api/cleanup/:filename
 */
async function cleanupFile(req, res) {
  const { filename } = req.params;
  const filePath = locateFile(filename);

  if (!filePath) return error(res, 'File tidak ditemukan', 404);

  fs.unlinkSync(filePath);
  return success(res, { filename }, 'File berhasil dihapus');
}

module.exports = { downloadFile, cleanupFile };
