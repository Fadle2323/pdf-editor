const express = require('express');
const router = express.Router();

router.use('/', require('./uploadRoutes'));
router.use('/', require('./textRoutes'));
router.use('/', require('./pdfRoutes'));
router.use('/', require('./convertRoutes'));
router.use('/', require('./fileRoutes'));

// GET /api/health - endpoint sederhana untuk cek status server
router.get('/health', (req, res) => {
  res.json({ status: 'success', data: { uptime: process.uptime() }, message: 'Server berjalan normal' });
});

module.exports = router;
