const express = require('express');
const router = express.Router();
const upload = require('../middlewares/upload');
const asyncHandler = require('../utils/asyncHandler');
const { uploadFile } = require('../controllers/uploadController');

// POST /api/upload
router.post('/upload', upload.single('file'), asyncHandler(uploadFile));

module.exports = router;
