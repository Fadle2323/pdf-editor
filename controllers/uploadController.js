const { success, error } = require('../utils/response');

/**
 * POST /api/upload
 * Menerima upload file PDF/TXT (sudah divalidasi oleh middleware multer).
 */
async function uploadFile(req, res) {
  if (!req.file) {
    return error(res, 'Tidak ada file yang diupload', 400);
  }

  return success(
    res,
    {
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      uploadedAt: new Date().toISOString(),
    },
    'File berhasil diupload',
    201
  );
}

module.exports = { uploadFile };
