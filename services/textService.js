const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

/**
 * Mengekstrak teks lengkap + metadata (jumlah halaman, jumlah kata) dari file.
 * Mendukung PDF (via pdf-parse) dan TXT (baca langsung).
 */
async function extractTextFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.pdf') {
    const buffer = fs.readFileSync(filePath);
    const parsed = await pdfParse(buffer);
    const text = parsed.text || '';
    const wordCount = countWords(text);
    return {
      text,
      pageCount: parsed.numpages || 0,
      wordCount,
    };
  }

  if (ext === '.txt') {
    const text = fs.readFileSync(filePath, 'utf-8');
    return {
      text,
      pageCount: 1,
      wordCount: countWords(text),
    };
  }

  throw new Error('Format file tidak didukung untuk ekstraksi teks');
}

function countWords(text) {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Memecah teks menjadi array kata dengan index dan posisi karakter (start/end)
 * di dalam string asli. Whitespace/pemisah tidak dianggap kata.
 */
function detectWords(text) {
  if (typeof text !== 'string') {
    throw new Error('Teks input tidak valid');
  }

  const words = [];
  const regex = /\S+/g;
  let match;
  let index = 0;

  while ((match = regex.exec(text)) !== null) {
    words.push({
      text: match[0],
      index,
      position: {
        start: match.index,
        end: match.index + match[0].length,
      },
    });
    index += 1;
  }

  return words;
}

/**
 * Menghapus kata-kata berdasarkan daftar index yang dipilih.
 * Mengembalikan teks baru tanpa kata-kata tersebut.
 */
function deleteWordsByIndex(text, indexesToDelete) {
  const words = detectWords(text);
  const deleteSet = new Set(indexesToDelete.map(Number));

  const remaining = words
    .filter((w) => !deleteSet.has(w.index))
    .map((w) => w.text);

  return remaining.join(' ');
}

/**
 * Menandai kata-kata tertentu sebagai blur, mengganti teksnya menjadi [BLURRED].
 * Mengembalikan teks yang sudah diproses (bukan menghapus, hanya menyamarkan).
 */
function blurWordsByIndex(text, indexesToBlur) {
  const words = detectWords(text);
  const blurSet = new Set(indexesToBlur.map(Number));

  const processed = words.map((w) => (blurSet.has(w.index) ? '[BLURRED]' : w.text));

  return processed.join(' ');
}

/**
 * Mencari dan mengganti teks (find & replace) dengan opsi case-sensitive.
 */
function replaceText(text, searchValue, replaceValue, caseSensitive = false) {
  if (!searchValue) {
    throw new Error('Parameter "search" wajib diisi');
  }

  const escaped = searchValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const flags = caseSensitive ? 'g' : 'gi';
  const regex = new RegExp(escaped, flags);

  const occurrences = (text.match(regex) || []).length;
  const newText = text.replace(regex, replaceValue);

  return { newText, occurrences };
}

module.exports = {
  extractTextFromFile,
  detectWords,
  deleteWordsByIndex,
  blurWordsByIndex,
  replaceText,
  countWords,
};
