const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const {
  detectSensitiveAI,
  verifyTables,
  summarize,
  generateAuditReport,
  chat,
} = require('../controllers/aiController');

router.post('/ai/detect-sensitive', asyncHandler(detectSensitiveAI));
router.post('/ai/verify-tables', asyncHandler(verifyTables));
router.post('/ai/summarize', asyncHandler(summarize));
router.post('/ai/audit-report', asyncHandler(generateAuditReport));
router.post('/ai/chat', asyncHandler(chat));

module.exports = router;
