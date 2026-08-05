const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { success, error } = require('../utils/response');

/**
 * POST /api/upload
 * Menerima upload file PDF/TXT (sudah divalidasi oleh middleware multer).
 */
async function uploadFile(req, res) {
  if (!req.file) {
    return error(res, 'Tidak ada file yang diupload', 400);
  }

  return success(
    res,
    {
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      uploadedAt: new Date().toISOString(),
    },
    'File berhasil diupload',
    201
  );
}

/**
 * POST /api/upload-chunk
 * Menerima chunk bagian file PDF/TXT untuk file berukuran besar.
 *
 * PENTING: setiap chunk disimpan sebagai file terpisah berdasarkan INDEX
 * chunk (bukan urutan kedatangan HTTP request). Ini membuat proses tahan
 * terhadap request yang datang out-of-order (mis. upload paralel atau
 * retry jaringan) — assembly file final selalu dilakukan berurutan
 * 0..N-1 setelah SEMUA chunk terbukti ada di disk, bukan saat chunk
 * dengan index terakhir "kebetulan" menjadi request terakhir yang tiba.
 */
async function uploadChunk(req, res) {
  if (!req.file || !req.file.buffer) {
    return error(res, 'Tidak ada chunk file yang diupload', 400);
  }

  const { uploadId, chunkIndex, totalChunks, originalName } = req.body;
  if (!uploadId || chunkIndex === undefined || !totalChunks || !originalName) {
    return error(res, 'Parameter chunk tidak lengkap', 400);
  }

  const idx = parseInt(chunkIndex, 10);
  const total = parseInt(totalChunks, 10);
  if (Number.isNaN(idx) || Number.isNaN(total) || idx < 0 || total <= 0 || idx >= total) {
    return error(res, 'Parameter chunk tidak valid', 400);
  }

  const ext = path.extname(originalName).toLowerCase();
  if (!config.allowedExtensions.includes(ext)) {
    return error(res, 'Tipe file tidak didukung', 400);
  }

  // uploadId dipakai untuk membangun nama file di disk — sanitasi agar
  // tidak bisa dipakai untuk path traversal.
  const safeUploadId = String(uploadId).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeUploadId) return error(res, 'uploadId tidak valid', 400);

  const partPathFor = (i) => path.join(config.uploadDir, `temp-${safeUploadId}-${i}.part`);

  try {
    // Tulis (bukan append) — idempoten terhadap retry chunk yang sama.
    fs.writeFileSync(partPathFor(idx), req.file.buffer);
  } catch (writeErr) {
    return error(res, 'Gagal menyimpan chunk: ' + writeErr.message, 500);
  }

  // Hitung berapa banyak chunk yang sudah benar-benar ada di disk —
  // BUKAN mengandalkan idx === total - 1 dari request yang sedang diproses.
  let receivedCount = 0;
  for (let i = 0; i < total; i++) {
    if (fs.existsSync(partPathFor(i))) receivedCount++;
  }

  if (receivedCount < total) {
    return success(
      res,
      { uploadId, chunkIndex: idx, totalChunks: total, received: receivedCount, completed: false },
      `Chunk ${idx + 1}/${total} berhasil disimpan`
    );
  }

  // Semua chunk sudah diterima → assembly dalam urutan index 0..N-1
  const uniqueName = `${Date.now()}-${uuidv4()}${ext}`;
  const finalPath = path.join(config.uploadDir, uniqueName);
  const partPaths = Array.from({ length: total }, (_, i) => partPathFor(i));

  try {
    await new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(finalPath);
      writeStream.on('error', reject);
      writeStream.on('finish', resolve);

      const writeNext = (i) => {
        if (i >= total) { writeStream.end(); return; }
        fs.readFile(partPaths[i], (readErr, data) => {
          if (readErr) { writeStream.destroy(); reject(readErr); return; }
          const ok = writeStream.write(data);
          if (ok) writeNext(i + 1);
          else writeStream.once('drain', () => writeNext(i + 1));
        });
      };
      writeNext(0);
    });

    // Hapus semua .part files setelah assembly berhasil
    for (const p of partPaths) {
      try { fs.unlinkSync(p); } catch (_) {}
    }

    const stats = fs.statSync(finalPath);
    return success(
      res,
      {
        filename: uniqueName,
        originalName,
        size: stats.size,
        mimetype: req.file.mimetype || 'application/pdf',
        uploadedAt: new Date().toISOString(),
        completed: true,
      },
      'File berhasil diupload lengkap',
      201
    );
  } catch (assemblyErr) {
    // Cleanup kalau assembly gagal — jangan tinggalkan file final yang corrupt
    try { fs.unlinkSync(finalPath); } catch (_) {}
    for (const p of partPaths) { try { fs.unlinkSync(p); } catch (_) {} }
    return error(res, 'Gagal merangkai chunks: ' + assemblyErr.message, 500);
  }
}

module.exports = { uploadFile, uploadChunk };
