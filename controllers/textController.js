const { success, error } = require('../utils/response');
const { resolveFilePath } = require('../utils/fileLocator');
const textService = require('../services/textService');

/**
 * POST /api/extract-text
 * Body: { filename }
 */
async function extractText(req, res) {
  const { filename } = req.body;
  if (!filename) return error(res, 'Parameter "filename" wajib diisi', 400);

  const filePath = resolveFilePath(filename);
  if (!filePath) return error(res, 'File tidak ditemukan', 404);

  const { text, pageCount, wordCount } = await textService.extractTextFromFile(filePath);

  return success(res, { text, metadata: { pageCount, wordCount } }, 'Teks berhasil diekstrak');
}

/**
 * POST /api/detect-words
 * Body: { text }
 */
async function detectWords(req, res) {
  const { text } = req.body;
  if (typeof text !== 'string') return error(res, 'Parameter "text" wajib diisi (string)', 400);

  const words = textService.detectWords(text);
  return success(res, { words, totalWords: words.length }, 'Kata berhasil dideteksi');
}

/**
 * POST /api/delete-text
 * Body: { text, indexes: [0,1,2] }
 */
async function deleteText(req, res) {
  const { text, indexes } = req.body;
  if (typeof text !== 'string') return error(res, 'Parameter "text" wajib diisi (string)', 400);
  if (!Array.isArray(indexes)) return error(res, 'Parameter "indexes" wajib berupa array', 400);

  const newText = textService.deleteWordsByIndex(text, indexes);
  return success(res, { text: newText, deletedCount: indexes.length }, 'Kata berhasil dihapus');
}

/**
 * POST /api/blur-text
 * Body: { text, indexes: [0,1,2] }
 */
async function blurText(req, res) {
  const { text, indexes } = req.body;
  if (typeof text !== 'string') return error(res, 'Parameter "text" wajib diisi (string)', 400);
  if (!Array.isArray(indexes)) return error(res, 'Parameter "indexes" wajib berupa array', 400);

  const newText = textService.blurWordsByIndex(text, indexes);
  return success(res, { text: newText, blurredCount: indexes.length }, 'Kata berhasil di-blur');
}

/**
 * POST /api/replace-text
 * Body: { text, search, replace, caseSensitive }
 */
async function replaceText(req, res) {
  const { text, search, replace = '', caseSensitive = false } = req.body;
  if (typeof text !== 'string') return error(res, 'Parameter "text" wajib diisi (string)', 400);

  const { newText, occurrences } = textService.replaceText(text, search, replace, caseSensitive);
  return success(res, { text: newText, occurrences }, 'Teks berhasil diganti');
}

/**
 * POST /api/add-text
 * Body: { filename, page, x, y, text, fontSize, fontFamily, bold, italic, underline, color }
 */
async function addText(req, res) {
  const pdfService = require('../services/pdfService');
  const {
    filename, page = 0, x = 50, y = 50, text,
    fontSize = 12, fontFamily = 'Helvetica', bold = false, italic = false, underline = false,
    color = '#000000',
  } = req.body;

  if (!filename) return error(res, 'Parameter "filename" wajib diisi', 400);
  if (!text) return error(res, 'Parameter "text" wajib diisi', 400);

  const filePath = resolveFilePath(filename);
  if (!filePath) return error(res, 'File tidak ditemukan', 404);

  const outputName = await pdfService.addTextToPdf(filePath, {
    page: Number(page),
    x: Number(x),
    y: Number(y),
    text,
    fontSize: Number(fontSize),
    fontFamily,
    bold: !!bold,
    italic: !!italic,
    underline: !!underline,
    color,
  });

  return success(res, { filename: outputName, downloadUrl: `/api/download/${outputName}` }, 'Teks berhasil ditambahkan ke PDF');
}

module.exports = { extractText, detectWords, deleteText, blurText, replaceText, addText };
