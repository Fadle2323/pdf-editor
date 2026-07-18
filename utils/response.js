/**
 * Helper untuk membentuk response JSON yang konsisten di seluruh API.
 * Format baku: { status: 'success' | 'error', data: {...}, message: '...' }
 */

function success(res, data = {}, message = 'OK', statusCode = 200) {
  return res.status(statusCode).json({
    status: 'success',
    data,
    message,
  });
}

function error(res, message = 'Terjadi kesalahan', statusCode = 500, data = {}) {
  return res.status(statusCode).json({
    status: 'error',
    data,
    message,
  });
}

module.exports = { success, error };
