const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
} = require('docx');
const ExcelJS = require('exceljs');
const config = require('../config');
const { extractTextFromFile } = require('./textService');

// Feature 4: Coba load pdfjs-dist (untuk ekstraksi terstruktur dgn info font).
// Jika tidak ada, fallback ke pdf-parse (tetap bisa konversi, tapi tanpa
// deteksi bold/italic/heading). Jalankan `npm install pdfjs-dist` untuk
// mengaktifkan fitur format lengkap.
let pdfjsLib = null;
try {
  pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
} catch (_) {
  // pdfjs-dist tidak terinstall - konversi Word tetap berfungsi lewat
  // pdf-parse, tapi tanpa deteksi heading/bold/italic.
}

function ensureConvertedDir() {
  if (!fs.existsSync(config.convertedDir)) {
    fs.mkdirSync(config.convertedDir, { recursive: true });
  }
}

function assertHasExtractableText(text) {
  if (!text || !text.trim()) {
    throw new Error(
      'Tidak ada teks yang bisa diekstrak dari PDF ini. Kemungkinan PDF berupa '
      + 'hasil scan/gambar tanpa lapisan teks (butuh OCR, belum didukung), atau '
      + 'PDF-nya terenkripsi/rusak.'
    );
  }
}

// ================== FEATURE 4: Ekstraksi Terstruktur via pdfjs-dist ==================

/**
 * Kelompokkan teks items per-halaman menjadi baris berdasarkan posisi Y.
 */
function groupItemsIntoLines(items, tolerance = 3) {
  const sorted = [...items].sort((a, b) => a.transform[5] - b.transform[5] || a.transform[4] - b.transform[4]);
  const lines = [];
  sorted.forEach((item) => {
    const y = item.transform[5];
    const height = Math.abs(item.height) || 10;
    let line = lines.find((l) => Math.abs(l.y - y) <= tolerance);
    if (!line) { line = { y, height, items: [] }; lines.push(line); }
    line.items.push(item);
    line.height = Math.max(line.height, height);
  });
  // Balik urutan: PDF y bertambah ke atas, kita ingin atas-ke-bawah
  return lines.reverse();
}

function average(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/**
 * Ekstrak konten terstruktur dari PDF menggunakan pdfjs-dist.
 * Mengembalikan array block: { type, newParagraph, runs: [{text, bold, italic, sizePt}] }
 */
async function extractStructuredContent(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const blocks = [];

  // Pass 1: hitung rata-rata ukuran font di seluruh dokumen
  const allFontSizes = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p); // eslint-disable-line no-await-in-loop
    const content = await page.getTextContent(); // eslint-disable-line no-await-in-loop
    content.items.forEach((it) => {
      if (it.height > 0) allFontSizes.push(Math.abs(it.height));
    });
  }
  const docAvgFontSize = average(allFontSizes) || 12;

  // Pass 2: ekstrak struktur per halaman
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p); // eslint-disable-line no-await-in-loop
    const content = await page.getTextContent(); // eslint-disable-line no-await-in-loop
    const lines = groupItemsIntoLines(content.items);

    lines.forEach((line, i) => {
      if (!line.items.length) return;
      const prevLine = lines[i - 1];
      const gapAbove = prevLine ? Math.abs(line.y - prevLine.y) - prevLine.height : 0;
      const avgFontSize = average(line.items.map((it) => Math.abs(it.height) || docAvgFontSize));

      // Heading: font > 1.3x rata-rata dokumen ATAU semua huruf besar & font lebih besar dari rata-rata
      const lineText = line.items.map((it) => it.str).join('');
      const isHeading = avgFontSize > docAvgFontSize * 1.3
        || (lineText === lineText.toUpperCase() && lineText.trim().length > 2 && avgFontSize >= docAvgFontSize * 1.1);
      // Paragraph break: jarak vertikal antar baris > 0.6x tinggi baris
      const isNewParagraph = gapAbove > avgFontSize * 0.6;

      const runs = line.items
        .filter((it) => it.str && it.str.trim())
        .map((it) => ({
          text: it.str,
          bold: it.fontName ? /bold/i.test(it.fontName) : false,
          italic: it.fontName ? /italic|oblique/i.test(it.fontName) : false,
          sizePt: Math.round((Math.abs(it.height) || docAvgFontSize) / 1.333),
        }));

      if (runs.length) {
        blocks.push({ type: isHeading ? 'heading' : 'paragraph', newParagraph: isNewParagraph, runs });
      }
    });

    // Halaman baru → paragraph break
    if (p < doc.numPages) blocks.push({ type: 'pagebreak', newParagraph: true, runs: [] });
  }
  return blocks;
}

/**
 * Konversi block terstruktur menjadi paragraf docx dengan formatting.
 */
function blocksToDocxParagraphs(blocks) {
  const paragraphs = [];
  blocks.forEach((block) => {
    if (block.type === 'pagebreak') {
      paragraphs.push(new Paragraph({ pageBreakBefore: true, children: [] }));
      return;
    }
    const children = block.runs.map((r) => new TextRun({
      text: r.text,
      bold: r.bold,
      italics: r.italic,
      size: r.sizePt > 0 ? r.sizePt * 2 : undefined, // docx half-points
    }));
    if (!children.length) return;
    const para = new Paragraph({
      heading: block.type === 'heading' ? HeadingLevel.HEADING_1 : undefined,
      spacing: block.newParagraph ? { before: 120 } : undefined,
      children,
    });
    paragraphs.push(para);
  });
  return paragraphs;
}

// ================== PUBLIC API ==================

async function convertToTxt(filePath) {
  const { text } = await extractTextFromFile(filePath);
  assertHasExtractableText(text);

  ensureConvertedDir();
  const outputName = `converted-${uuidv4()}.txt`;
  const outputPath = path.join(config.convertedDir, outputName);
  fs.writeFileSync(outputPath, text, 'utf-8');
  return outputName;
}

/**
 * Konversi PDF -> Word (.docx).
 * Feature 4: jika pdfjs-dist tersedia, gunakan ekstraksi terstruktur dengan
 * deteksi heading, bold/italic, dan paragraph break. Jika tidak, fallback ke
 * pdf-parse (polos, tapi tidak error).
 */
async function convertToWord(filePath) {
  let paragraphs;

  if (pdfjsLib) {
    // Jalur utama: pdfjs-dist dengan formatting
    try {
      const blocks = await extractStructuredContent(filePath);
      paragraphs = blocksToDocxParagraphs(blocks);
    } catch (err) {
      console.warn('[convertToWord] pdfjs-dist gagal, fallback ke pdf-parse:', err.message);
      pdfjsLib = null; // nonaktifkan untuk request berikutnya jika terus gagal
    }
  }

  if (!paragraphs) {
    // Fallback: pdf-parse (teks polos, satu Paragraph per baris)
    const { text } = await extractTextFromFile(filePath);
    assertHasExtractableText(text);
    paragraphs = text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => new Paragraph({ children: [new TextRun(line)] }));
  }

  const doc = new Document({
    sections: [{
      properties: {},
      children: paragraphs.length ? paragraphs : [new Paragraph('')],
    }],
  });

  ensureConvertedDir();
  const outputName = `converted-${uuidv4()}.docx`;
  const outputPath = path.join(config.convertedDir, outputName);
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  return outputName;
}

async function convertToExcel(filePath) {
  const { text } = await extractTextFromFile(filePath);
  assertHasExtractableText(text);

  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Extracted Text');
  sheet.columns = [{ header: 'Content', key: 'content', width: 100 }];
  lines.forEach((line) => sheet.addRow({ content: line }));

  ensureConvertedDir();
  const outputName = `converted-${uuidv4()}.xlsx`;
  const outputPath = path.join(config.convertedDir, outputName);
  await workbook.xlsx.writeFile(outputPath);
  return outputName;
}

module.exports = { convertToTxt, convertToWord, convertToExcel };
