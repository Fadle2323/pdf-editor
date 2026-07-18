require('dotenv').config();
const path = require('path');

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  uploadDir: path.join(__dirname, process.env.UPLOAD_DIR || 'uploads'),
  convertedDir: path.join(__dirname, process.env.CONVERTED_DIR || 'converted'),
  maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 50,
  fileMaxAgeMinutes: parseInt(process.env.FILE_MAX_AGE_MINUTES, 10) || 30,
  cleanupIntervalMinutes: parseInt(process.env.CLEANUP_INTERVAL_MINUTES, 10) || 60,
  rateLimitWindowMinutes: parseInt(process.env.RATE_LIMIT_WINDOW_MINUTES, 10) || 15,
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3001',
  allowedMimeTypes: ['application/pdf', 'text/plain'],
  allowedExtensions: ['.pdf', '.txt'],
};
