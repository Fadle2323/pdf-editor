const { success, error } = require('../utils/response');
const { resolveFilePath } = require('../utils/fileLocator');
const { extractTextFromFile } = require('../services/textService');
const aiService = require('../services/aiService');

/**
 * Helper to obtain text from either request body `text` or `filename`
 */
async function getTextFromRequest(req) {
  if (req.body.text && typeof req.body.text === 'string' && req.body.text.trim().length > 0) {
    return { text: req.body.text, pageCount: req.body.pageCount || 1 };
  }
  if (req.body.filename) {
    const filePath = resolveFilePath(req.body.filename);
    if (!filePath) throw new Error('File dokumen tidak ditemukan di server');
    const { text, pageCount } = await extractTextFromFile(filePath);
    return { text, pageCount };
  }
  throw new Error('Parameter "text" atau "filename" wajib disediakan');
}

/**
 * POST /api/ai/detect-sensitive
 * Hybrid LLM second-pass PII detection
 */
async function detectSensitiveAI(req, res) {
  try {
    const { text } = await getTextFromRequest(req);
    const findings = await aiService.detectSensitiveDataWithAI(text, req.body.sampleLines || []);
    return success(
      res,
      {
        findings,
        totalFound: findings.length,
      },
      'Deteksi AI untuk data sensitif berhasil'
    );
  } catch (err) {
    console.error('Error in detectSensitiveAI:', err);
    return error(res, err.message || 'Gagal menjalankan deteksi AI', 500);
  }
}

/**
 * POST /api/ai/verify-tables
 * Validate extracted table structures for Excel/Word conversion
 */
async function verifyTables(req, res) {
  try {
    const { text } = await getTextFromRequest(req);
    const docType = req.body.docType || 'Excel';
    const result = await aiService.verifyTableStructureWithAI(text, docType);
    return success(res, result, 'Verifikasi struktur tabel berhasil');
  } catch (err) {
    console.error('Error in verifyTables:', err);
    return error(res, err.message || 'Gagal memverifikasi struktur tabel', 500);
  }
}

/**
 * POST /api/ai/summarize
 * Generates 3-5 sentence document summary & highlights
 */
async function summarize(req, res) {
  try {
    const { text } = await getTextFromRequest(req);
    const summaryData = await aiService.summarizeDocumentWithAI(text);
    return success(res, summaryData, 'Ringkasan dokumen berhasil dibuat');
  } catch (err) {
    console.error('Error in summarize:', err);
    return error(res, err.message || 'Gagal membuat ringkasan dokumen', 500);
  }
}

/**
 * POST /api/ai/audit-report
 * Generates redaction audit compliance trail
 */
async function generateAuditReport(req, res) {
  try {
    const { filename, redactionList, blurStyle, pageCount } = req.body;
    const report = await aiService.generateRedactionAuditReport({
      filename: filename || 'Dokumen PDF',
      redactionList: Array.isArray(redactionList) ? redactionList : [],
      blurStyle: blurStyle || 'normal',
      pageCount: pageCount || 1,
    });
    return success(res, report, 'Laporan audit redaksi berhasil dibuat');
  } catch (err) {
    console.error('Error in generateAuditReport:', err);
    return error(res, err.message || 'Gagal membuat laporan audit', 500);
  }
}

/**
 * POST /api/ai/chat
 * Ask questions grounded on the PDF text content
 */
async function chat(req, res) {
  try {
    const { question, history } = req.body;
    if (!question || typeof question !== 'string') {
      return error(res, 'Parameter "question" wajib diisi', 400);
    }
    const { text } = await getTextFromRequest(req);
    const chatResult = await aiService.chatWithPdf(text, question, history || []);
    return success(res, chatResult, 'Jawaban berhasil dihasilkan');
  } catch (err) {
    console.error('Error in chat:', err);
    return error(res, err.message || 'Gagal menjawab pertanyaan', 500);
  }
}

module.exports = {
  detectSensitiveAI,
  verifyTables,
  summarize,
  generateAuditReport,
  chat,
};
