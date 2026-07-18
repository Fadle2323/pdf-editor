const rateLimit = require('express-rate-limit');
const config = require('../config');

const apiLimiter = rateLimit({
  windowMs: config.rateLimitWindowMinutes * 60 * 1000,
  max: config.rateLimitMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'error',
    data: {},
    message: `Terlalu banyak request dari IP ini. Coba lagi setelah ${config.rateLimitWindowMinutes} menit.`,
  },
});

module.exports = apiLimiter;
