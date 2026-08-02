const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
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

/**
 * POST /api/upload-chunk
 * Menerima chunk bagian file PDF/TXT untuk file berukuran besar.
 */
async function uploadChunk(req, res) {
  if (!req.file) {
    return error(res, 'Tidak ada chunk file yang diupload', 400);
  }

  const { uploadId, chunkIndex, totalChunks, originalName } = req.body;
  if (!uploadId || chunkIndex === undefined || !totalChunks || !originalName) {
    return error(res, 'Parameter chunk tidak lengkap', 400);
  }

  const idx = parseInt(chunkIndex, 10);
  const total = parseInt(totalChunks, 10);
  const ext = path.extname(originalName).toLowerCase();

  if (!config.allowedExtensions.includes(ext)) {
    return error(res, 'Tipe file tidak didukung', 400);
  }

  const tempPath = path.join(config.uploadDir, `temp-${uploadId}.tmp`);

  try {
    fs.appendFileSync(tempPath, req.file.buffer);

    if (idx === total - 1) {
      const uniqueName = `${Date.now()}-${uuidv4()}${ext}`;
      const finalPath = path.join(config.uploadDir, uniqueName);
      fs.renameSync(tempPath, finalPath);

      const stats = fs.statSync(finalPath);
      return success(
        res,
        {
          filename: uniqueName,
          originalName,
          size: stats.size,
          mimetype: req.file.mimetype || 'application/pdf',
          uploadedAt: new Date().toISOString(),
        },
        'File berhasil diupload lengkap',
        201
      );
    }

    return success(
      res,
      {
        uploadId,
        chunkIndex: idx,
        totalChunks: total,
        completed: false,
      },
      `Chunk ${idx + 1}/${total} berhasil disimpan`
    );
  } catch (err) {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
    throw err;
  }
}

module.exports = { uploadFile, uploadChunk };
