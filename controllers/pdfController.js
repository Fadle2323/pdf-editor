const { success, error } = require('../utils/response');
const { resolveFilePath } = require('../utils/fileLocator');
const pdfService = require('../services/pdfService');

/**
 * POST /api/merge-pdf
 * Body: { filenames: ['a.pdf', 'b.pdf'], originalNames?: ['Laporan.pdf', 'Lampiran.pdf'] }
 */
async function mergePdf(req, res) {
  const { filenames, originalNames = [] } = req.body;
  if (!Array.isArray(filenames) || filenames.length < 2) {
    return error(res, 'Parameter "filenames" wajib berupa array berisi minimal 2 file', 400);
  }

  const filePaths = filenames.map((name) => {
    const p = resolveFilePath(name);
    if (!p) throw Object.assign(new Error(`File tidak ditemukan: ${name}`), { statusCode: 404 });
    return p;
  });

  const outputName = await pdfService.mergePdfs(filePaths, originalNames);
  return success(res, { filename: outputName, downloadUrl: `/api/download/${outputName}` }, 'PDF berhasil digabungkan');
}

/**
 * POST /api/split-pdf
 * Body: { filename, ranges: [{ start: 1, end: 3 }, { start: 4, end: 5 }] }
 */
async function splitPdf(req, res) {
  const { filename, ranges } = req.body;
  if (!filename) return error(res, 'Parameter "filename" wajib diisi', 400);
  if (!Array.isArray(ranges) || ranges.length === 0) {
    return error(res, 'Parameter "ranges" wajib berupa array minimal 1 range', 400);
  }

  const filePath = resolveFilePath(filename);
  if (!filePath) return error(res, 'File tidak ditemukan', 404);

  const results = await pdfService.splitPdf(filePath, ranges);
  const withUrls = results.map((r) => ({ ...r, downloadUrl: `/api/download/${r.filename}` }));

  return success(res, { files: withUrls }, 'PDF berhasil dipisahkan');
}

/**
 * POST /api/compress-pdf
 * Body: { filename }
 */
async function compressPdf(req, res) {
  const { filename } = req.body;
  if (!filename) return error(res, 'Parameter "filename" wajib diisi', 400);

  const filePath = resolveFilePath(filename);
  if (!filePath) return error(res, 'File tidak ditemukan', 404);

  const result = await pdfService.compressPdf(filePath);

  return success(
    res,
    {
      filename: result.outputName,
      downloadUrl: `/api/download/${result.outputName}`,
      originalSize: result.originalSize,
      compressedSize: result.compressedSize,
      reductionPercent: result.reductionPercent,
      imagesProcessed: result.imagesProcessed,
      imagesSkipped: result.imagesSkipped,
    },
    'PDF berhasil dikompres'
  );
}

/**
 * POST /api/blur-area
 * Body: { filename, areas: [{ page, x, y, width, height, color? }] }
 * Menggambar kotak solid di atas area tertentu. `color` opsional (hex),
 * default abu-abu (untuk blur). Kirim color putih untuk efek "delete visual"
 * (menyamarkan area seolah kosong).
 */
async function blurArea(req, res) {
  const { filename, areas } = req.body;
  if (!filename) return error(res, 'Parameter "filename" wajib diisi', 400);
  if (!Array.isArray(areas) || areas.length === 0) {
    return error(res, 'Parameter "areas" wajib berupa array minimal 1 area', 400);
  }

  const filePath = resolveFilePath(filename);
  if (!filePath) return error(res, 'File tidak ditemukan', 404);

  const outputName = await pdfService.blurAreaInPdf(filePath, areas);
  return success(res, { filename: outputName, downloadUrl: `/api/download/${outputName}` }, 'Area berhasil diproses');
}

/**
 * POST /api/apply-patches
 * Body: { filename, patches: [{ page, x, y, width, height, imageBase64 }] }
 * Menempelkan potongan gambar (hasil proses blur/pixelate di browser)
 * secara presisi ke PDF. Satu request bisa menempel banyak patch sekaligus
 * (misal: beberapa kata yang dipilih untuk di-blur bersamaan).
 */
async function applyPatches(req, res) {
  const { filename, patches } = req.body;
  if (!filename) return error(res, 'Parameter "filename" wajib diisi', 400);
  if (!Array.isArray(patches) || patches.length === 0) {
    return error(res, 'Parameter "patches" wajib berupa array minimal 1 patch', 400);
  }

  const filePath = resolveFilePath(filename);
  if (!filePath) return error(res, 'File tidak ditemukan', 404);

  const outputName = await pdfService.applyImagePatches(filePath, patches);
  return success(res, { filename: outputName, downloadUrl: `/api/download/${outputName}` }, 'Patch berhasil diterapkan');
}

module.exports = { mergePdf, splitPdf, compressPdf, blurArea, applyPatches };
