const express = require('express');
const router = express.Router();
const { upload, uploadChunkMiddleware } = require('../middlewares/upload');
const asyncHandler = require('../utils/asyncHandler');
const { uploadFile, uploadChunk } = require('../controllers/uploadController');

// POST /api/upload
router.post('/upload', upload.single('file'), asyncHandler(uploadFile));

// POST /api/upload-chunk
router.post('/upload-chunk', uploadChunkMiddleware.single('file'), asyncHandler(uploadChunk));

module.exports = router;
