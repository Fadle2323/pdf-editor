const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const config = require('../config');

/**
 * Menghapus file di sebuah direktori yang usianya (berdasarkan mtime)
 * sudah melebihi maxAgeMinutes.
 */
function cleanupDirectory(dirPath, maxAgeMinutes) {
  if (!fs.existsSync(dirPath)) return { checked: 0, deleted: 0 };

  const now = Date.now();
  const maxAgeMs = maxAgeMinutes * 60 * 1000;
  const files = fs.readdirSync(dirPath);
  let deleted = 0;

  files.forEach((file) => {
    const filePath = path.join(dirPath, file);
    try {
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) return;
      const age = now - stats.mtimeMs;
      if (age > maxAgeMs) {
        fs.unlinkSync(filePath);
        deleted += 1;
      }
    } catch (err) {
      console.error(`[CLEANUP] Gagal memproses ${filePath}:`, err.message);
    }
  });

  return { checked: files.length, deleted };
}

function runCleanup() {
  const uploadsResult = cleanupDirectory(config.uploadDir, config.fileMaxAgeMinutes);
  const convertedResult = cleanupDirectory(config.convertedDir, config.fileMaxAgeMinutes);
  console.log(
    `[CLEANUP] ${new Date().toISOString()} - uploads: dihapus ${uploadsResult.deleted}/${uploadsResult.checked}, `
    + `converted: dihapus ${convertedResult.deleted}/${convertedResult.checked}`
  );
}

/**
 * Menjadwalkan cleanup otomatis setiap `cleanupIntervalMinutes` menit
 * menggunakan node-cron.
 */
function scheduleAutoCleanup() {
  const intervalMinutes = config.cleanupIntervalMinutes;
  // node-cron expression untuk "setiap N menit"
  const cronExpression = `*/${intervalMinutes} * * * *`;

  cron.schedule(cronExpression, () => {
    runCleanup();
  });

  console.log(`[CLEANUP] Auto-cleanup dijadwalkan setiap ${intervalMinutes} menit `
    + `(file > ${config.fileMaxAgeMinutes} menit akan dihapus).`);
}

module.exports = { scheduleAutoCleanup, runCleanup, cleanupDirectory };
