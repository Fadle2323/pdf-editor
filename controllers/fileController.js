const fs = require('fs');
const { success, error } = require('../utils/response');
const { resolveFilePath } = require('../utils/fileLocator');
const { sanitizeFilename } = require('../utils/sanitize');

/**
 * GET /api/download/:filename
 */
async function downloadFile(req, res) {
  try {
    const { filename } = req.params;
    const { name } = req.query;
    const filePath = resolveFilePath(filename);

    if (!filePath) {
      console.error(`[DOWNLOAD] File tidak ditemukan: ${filename}`);
      return error(res, 'File tidak ditemukan di server', 404);
    }

    const downloadName = sanitizeFilename(name || filename);
    const ext = downloadName.split('.').pop().toLowerCase();
    const contentType = ext === 'txt' ? 'text/plain' : 'application/pdf';

    // Tambahkan Content-Length agar browser tahu ukuran file sesungguhnya
    // dan dapat menampilkan progress unduhan yang akurat
    const stat = fs.statSync(filePath);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition',
      `attachment; filename="${downloadName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
    // Nonaktifkan cache agar file baru selalu diunduh (bukan versi lama dari cache browser)
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');

    // Gunakan res.download() daripada res.sendFile() agar Express menangani
    // streaming dengan benar termasuk error handling untuk file besar
    return res.download(filePath, downloadName, (err) => {
      if (err) {
        console.error('[DOWNLOAD] Stream error:', err.message, '| file:', filename);
        // Headers sudah terkirim jika error terjadi di tengah streaming
        if (!res.headersSent) {
          return error(res, 'Gagal mengunduh file dari server', 500);
        }
      }
    });
  } catch (err) {
    console.error('[DOWNLOAD] Exception:', err);
    if (!res.headersSent) {
      return error(res, err.message || 'Gagal mengunduh file', 500);
    }
  }
}

/**
 * DELETE /api/cleanup/:filename
 */
async function cleanupFile(req, res) {
  const { filename } = req.params;
  const filePath = resolveFilePath(filename);

  if (!filePath) return error(res, 'File tidak ditemukan', 404);

  fs.unlinkSync(filePath);
  return success(res, { filename }, 'File berhasil dihapus');
}

module.exports = { downloadFile, cleanupFile };

