const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const {
  mergePdf, splitPdf, compressPdf, blurArea, applyPatches,
  stripPdfMetadata, addWatermarkToPdf, setPasswordPdf, addAnnotations,
} = require('../controllers/pdfController');

router.post('/merge-pdf', asyncHandler(mergePdf));
router.post('/split-pdf', asyncHandler(splitPdf));
router.post('/compress-pdf', asyncHandler(compressPdf));
router.post('/blur-area', asyncHandler(blurArea));
router.post('/apply-patches', asyncHandler(applyPatches));
router.post('/strip-metadata', asyncHandler(stripPdfMetadata));
router.post('/add-watermark', asyncHandler(addWatermarkToPdf));
router.post('/set-password', asyncHandler(setPasswordPdf));
router.post('/add-annotations', asyncHandler(addAnnotations));

module.exports = router;
