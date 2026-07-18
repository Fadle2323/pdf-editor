const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { convertToTxt, convertToWord, convertToExcel } = require('../controllers/convertController');

router.post('/convert-to-txt', asyncHandler(convertToTxt));
router.post('/convert-to-word', asyncHandler(convertToWord));
router.post('/convert-to-excel', asyncHandler(convertToExcel));

module.exports = router;
