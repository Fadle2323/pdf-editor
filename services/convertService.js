const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Document, Packer, Paragraph } = require('docx');
const ExcelJS = require('exceljs');
const config = require('../config');
const { extractTextFromFile } = require('./textService');

function ensureConvertedDir() {
  if (!fs.existsSync(config.convertedDir)) {
    fs.mkdirSync(config.convertedDir, { recursive: true });
  }
}

/**
 * Memastikan teks hasil ekstraksi tidak kosong sebelum dipakai utk konversi.
 * Tanpa pengecekan ini, PDF yang gagal diekstrak (mis. hasil scan/gambar
 * tanpa lapisan teks, atau PDF terenkripsi) akan menghasilkan file Word/
 * Excel/TXT yang "berhasil" dibuat tapi ISINYA KOSONG saat dibuka --
 * membingungkan karena tidak ada error yang jelas. Sekarang errornya
 * eksplisit sejak awal.
 */
function assertHasExtractableText(text) {
  if (!text || !text.trim()) {
    throw new Error(
      'Tidak ada teks yang bisa diekstrak dari PDF ini. Kemungkinan PDF berupa '
      + 'hasil scan/gambar tanpa lapisan teks (butuh OCR, belum didukung), atau '
      + 'PDF-nya terenkripsi/rusak.'
    );
  }
}

/**
 * Konversi PDF -> TXT. Mengekstrak teks lalu menyimpannya sebagai file .txt.
 */
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
 * Konversi PDF -> Word (.docx). Teks hasil ekstraksi dipecah per baris
 * dan ditulis ke dokumen Word menggunakan library docx.
 */
async function convertToWord(filePath) {
  const { text } = await extractTextFromFile(filePath);
  assertHasExtractableText(text);

  const paragraphs = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => new Paragraph(line));

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: paragraphs.length ? paragraphs : [new Paragraph('')],
      },
    ],
  });

  ensureConvertedDir();
  const outputName = `converted-${uuidv4()}.docx`;
  const outputPath = path.join(config.convertedDir, outputName);
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  return outputName;
}

/**
 * Konversi PDF -> Excel (.xlsx). Setiap baris teks non-kosong dimasukkan
 * sebagai satu baris di kolom A menggunakan ExcelJS.
 */
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
