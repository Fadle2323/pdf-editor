const path = require('path');

/**
 * Mengambil basename dari nama file dan membuang karakter berbahaya
 * untuk mencegah path traversal (../, /, \, null byte, dll).
 */
function sanitizeFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Nama file tidak valid');
  }
  const base = path.basename(filename).replace(/\0/g, '');
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new Error('Nama file tidak valid');
  }
  return cleaned;
}

/**
 * Memastikan path akhir tetap berada di dalam directory yang diizinkan.
 */
function safeJoin(baseDir, filename) {
  const safeName = sanitizeFilename(filename);
  const finalPath = path.join(baseDir, safeName);
  const resolvedBase = path.resolve(baseDir);
  const resolvedFinal = path.resolve(finalPath);
  if (!resolvedFinal.startsWith(resolvedBase)) {
    throw new Error('Path tidak diizinkan (terdeteksi path traversal)');
  }
  return resolvedFinal;
}

module.exports = { sanitizeFilename, safeJoin };
