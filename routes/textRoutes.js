const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const {
  extractText,
  detectWords,
  deleteText,
  blurText,
  replaceText,
  addText,
} = require('../controllers/textController');

router.post('/extract-text', asyncHandler(extractText));
router.post('/detect-words', asyncHandler(detectWords));
router.post('/delete-text', asyncHandler(deleteText));
router.post('/blur-text', asyncHandler(blurText));
router.post('/replace-text', asyncHandler(replaceText));
router.post('/add-text', asyncHandler(addText));

module.exports = router;
