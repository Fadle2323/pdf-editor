const { success, error } = require('../utils/response');
const { resolveFilePath } = require('../utils/fileLocator');
const convertService = require('../services/convertService');

function getUploadedFilePath(req, res) {
  const { filename } = req.body;
  if (!filename) {
    error(res, 'Parameter "filename" wajib diisi', 400);
    return null;
  }
  const filePath = resolveFilePath(filename);
  if (!filePath) {
    error(res, 'File tidak ditemukan', 404);
    return null;
  }
  return filePath;
}

/** POST /api/convert-to-txt Body: { filename } */
async function convertToTxt(req, res) {
  const filePath = getUploadedFilePath(req, res);
  if (!filePath) return;

  const outputName = await convertService.convertToTxt(filePath);
  return success(res, { filename: outputName, downloadUrl: `/api/download/${outputName}` }, 'PDF berhasil dikonversi ke TXT');
}

/** POST /api/convert-to-word Body: { filename } */
async function convertToWord(req, res) {
  const filePath = getUploadedFilePath(req, res);
  if (!filePath) return;

  const outputName = await convertService.convertToWord(filePath);
  return success(res, { filename: outputName, downloadUrl: `/api/download/${outputName}` }, 'PDF berhasil dikonversi ke Word');
}

/** POST /api/convert-to-excel Body: { filename } */
async function convertToExcel(req, res) {
  const filePath = getUploadedFilePath(req, res);
  if (!filePath) return;

  const outputName = await convertService.convertToExcel(filePath);
  return success(res, { filename: outputName, downloadUrl: `/api/download/${outputName}` }, 'PDF berhasil dikonversi ke Excel');
}

module.exports = { convertToTxt, convertToWord, convertToExcel };
