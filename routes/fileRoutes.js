const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { downloadFile, cleanupFile } = require('../controllers/fileController');

router.get('/download/:filename', asyncHandler(downloadFile));
router.delete('/cleanup/:filename', asyncHandler(cleanupFile));

module.exports = router;
