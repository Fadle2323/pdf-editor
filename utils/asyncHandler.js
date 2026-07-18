/**
 * Membungkus async controller supaya error yang terjadi otomatis
 * diteruskan ke middleware errorHandler via next(err),
 * tanpa perlu try-catch berulang di setiap controller.
 */
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
