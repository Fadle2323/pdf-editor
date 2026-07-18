const multer = require('multer');
const { error } = require('../utils/response');

/**
 * Error handler global. Diletakkan paling akhir di stack middleware Express.
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error(`[ERROR] ${req.method} ${req.originalUrl} -`, err.message);

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return error(res, 'Ukuran file melebihi batas maksimal yang diizinkan (50MB)', 413);
    }
    return error(res, `Upload error: ${err.message}`, 400);
  }

  if (err.message && err.message.includes('Tipe file tidak didukung')) {
    return error(res, err.message, 415);
  }

  if (err.message && err.message.includes('path traversal')) {
    return error(res, err.message, 400);
  }

  const statusCode = err.statusCode || 500;
  return error(res, err.message || 'Internal Server Error', statusCode);
}

function notFoundHandler(req, res) {
  return error(res, `Endpoint tidak ditemukan: ${req.method} ${req.originalUrl}`, 404);
}

module.exports = { errorHandler, notFoundHandler };
