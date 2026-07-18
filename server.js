const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const apiRoutes = require('./routes');
const apiLimiter = require('./middlewares/rateLimiter');
const { errorHandler, notFoundHandler } = require('./middlewares/errorHandler');
const { scheduleAutoCleanup } = require('./services/cleanupService');

// Pastikan folder kerja tersedia sebelum server start
[config.uploadDir, config.convertedDir].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const app = express();

// --- Security & utility middlewares ---
// helmet CSP default akan memblokir script/style dari CDN (Tailwind, pdf.js, Google Fonts)
// yang dipakai frontend di folder public/, jadi CSP dimatikan di sini (aplikasi ini
// memang hanya untuk dipakai lokal, bukan dipublikasikan ke internet).
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: config.corsOrigin }));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// --- Sajikan frontend (public/index.html) dari server yang sama ---
// Dengan ini, backend & frontend jadi satu aplikasi: cukup `npm start`,
// lalu buka http://localhost:3000 -- tidak perlu server terpisah/npx serve lagi.
app.use(express.static(path.join(__dirname, 'public')));

// --- Rate limiting untuk seluruh /api ---
app.use('/api', apiLimiter);

// --- Routes utama ---
app.use('/api', apiRoutes);

// --- 404 & error handler (selalu paling akhir) ---
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`\n🚀 PDF Editor berjalan di http://localhost:${config.port}`);
  console.log(`   Buka http://localhost:${config.port} di browser untuk mulai memakai aplikasinya.`);
  console.log(`   API base URL: http://localhost:${config.port}/api\n`);

  // Jalankan auto-cleanup langsung sekali saat start, lalu jadwalkan berkala
  scheduleAutoCleanup();
});

module.exports = app;
