const fs = require('fs');
const path = require('path');
const {
  PDFDocument, rgb, StandardFonts, PDFRawStream, PDFName, PDFArray, PDFNumber,
} = require('pdf-lib');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

// 14 font standar PDF -- selalu tersedia tanpa perlu embed font file,
// jadi aman & ringan dipakai lintas platform.
const FONT_FAMILIES = {
  Helvetica: {
    regular: StandardFonts.Helvetica,
    bold: StandardFonts.HelveticaBold,
    italic: StandardFonts.HelveticaOblique,
    boldItalic: StandardFonts.HelveticaBoldOblique,
  },
  TimesRoman: {
    regular: StandardFonts.TimesRoman,
    bold: StandardFonts.TimesRomanBold,
    italic: StandardFonts.TimesRomanItalic,
    boldItalic: StandardFonts.TimesRomanBoldItalic,
  },
  Courier: {
    regular: StandardFonts.Courier,
    bold: StandardFonts.CourierBold,
    italic: StandardFonts.CourierOblique,
    boldItalic: StandardFonts.CourierBoldOblique,
  },
  Symbol: { regular: StandardFonts.Symbol, bold: StandardFonts.Symbol, italic: StandardFonts.Symbol, boldItalic: StandardFonts.Symbol },
  ZapfDingbats: { regular: StandardFonts.ZapfDingbats, bold: StandardFonts.ZapfDingbats, italic: StandardFonts.ZapfDingbats, boldItalic: StandardFonts.ZapfDingbats },
};

function resolveStandardFont(fontFamily, bold, italic) {
  const family = FONT_FAMILIES[fontFamily] || FONT_FAMILIES.Helvetica;
  if (bold && italic) return family.boldItalic;
  if (bold) return family.bold;
  if (italic) return family.italic;
  return family.regular;
}

function ensureConvertedDir() {
  if (!fs.existsSync(config.convertedDir)) {
    fs.mkdirSync(config.convertedDir, { recursive: true });
  }
}

function hexToRgb(hex) {
  if (!hex) return rgb(0, 0, 0);
  const clean = hex.replace('#', '');
  const bigint = parseInt(clean, 16);
  const r = ((bigint >> 16) & 255) / 255;
  const g = ((bigint >> 8) & 255) / 255;
  const b = (bigint & 255) / 255;
  return rgb(r, g, b);
}

/**
 * Menambahkan teks baru ke PDF pada halaman & koordinat tertentu.
 * Mendukung banyak pilihan font, bold, italic, dan underline (digambar manual
 * sebagai garis di bawah tiap baris, krn pdf-lib tidak punya underline bawaan).
 * Teks multi-baris (dipisah '\n') didukung -- dipakai juga utk numbering/list.
 */
async function addTextToPdf(filePath, options) {
  const {
    page = 0,
    x = 50,
    y = 50,
    text = '',
    fontSize = 12,
    fontFamily = 'Helvetica',
    bold = false,
    italic = false,
    underline = false,
    color = '#000000',
  } = options;

  const bytes = fs.readFileSync(filePath);
  const pdfDoc = await PDFDocument.load(bytes);
  const pages = pdfDoc.getPages();

  if (page < 0 || page >= pages.length) {
    throw new Error(`Halaman ${page} tidak ditemukan. Dokumen memiliki ${pages.length} halaman.`);
  }

  const standardFont = resolveStandardFont(fontFamily, bold, italic);
  const font = await pdfDoc.embedFont(standardFont);
  const targetPage = pages[page];
  const rgbColor = hexToRgb(color);
  const lineHeight = fontSize * 1.3;

  const lines = String(text).split('\n');
  lines.forEach((line, i) => {
    const lineY = y - i * lineHeight;
    targetPage.drawText(line, { x, y: lineY, size: fontSize, font, color: rgbColor });

    if (underline && line.trim().length > 0) {
      const textWidth = font.widthOfTextAtSize(line, fontSize);
      const underlineY = lineY - fontSize * 0.12;
      targetPage.drawLine({
        start: { x, y: underlineY },
        end: { x: x + textWidth, y: underlineY },
        thickness: Math.max(0.75, fontSize * 0.05),
        color: rgbColor,
      });
    }
  });

  ensureConvertedDir();
  const outputName = `add-text-${uuidv4()}.pdf`;
  const outputPath = path.join(config.convertedDir, outputName);
  const outputBytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, outputBytes);

  return outputName;
}

/**
 * Menggambar kotak solid (rectangle) di atas area tertentu pada halaman PDF.
 * Dipakai untuk dua kebutuhan: "blur" (warna abu-abu default) dan
 * "delete visual" / redaksi (warna putih agar terlihat seperti area kosong).
 */
async function blurAreaInPdf(filePath, areas) {
  const bytes = fs.readFileSync(filePath);
  const pdfDoc = await PDFDocument.load(bytes);
  const pages = pdfDoc.getPages();

  areas.forEach(({ page = 0, x, y, width, height, color }) => {
    if (page < 0 || page >= pages.length) {
      throw new Error(`Halaman ${page} tidak ditemukan.`);
    }
    pages[page].drawRectangle({
      x,
      y,
      width,
      height,
      color: color ? hexToRgb(color) : rgb(0.75, 0.75, 0.75),
      opacity: 1,
    });
  });

  ensureConvertedDir();
  const outputName = `blur-${uuidv4()}.pdf`;
  const outputPath = path.join(config.convertedDir, outputName);
  const outputBytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, outputBytes);

  return outputName;
}

/**
 * Menggabungkan beberapa file PDF menjadi satu dokumen.
 * Setiap file dibaca satu per satu dengan error message spesifik (menyebutkan
 * file mana yang bermasalah) supaya kegagalan mudah didiagnosis, bukan cuma
 * "gagal" tanpa keterangan.
 */
async function mergePdfs(filePaths, originalNames = []) {
  if (!Array.isArray(filePaths) || filePaths.length < 2) {
    throw new Error('Minimal 2 file PDF valid dibutuhkan untuk merge.');
  }

  const mergedPdf = await PDFDocument.create();

  for (let i = 0; i < filePaths.length; i += 1) {
    const filePath = filePaths[i];
    const label = originalNames[i] || path.basename(filePath);
    let pdf;
    try {
      const bytes = fs.readFileSync(filePath);
      // eslint-disable-next-line no-await-in-loop
      pdf = await PDFDocument.load(bytes);
    } catch (err) {
      throw new Error(`Gagal membaca file "${label}" (mungkin rusak, terenkripsi, atau bukan PDF valid): ${err.message}`);
    }

    if (pdf.getPageCount() === 0) {
      throw new Error(`File "${label}" tidak memiliki halaman.`);
    }

    // eslint-disable-next-line no-await-in-loop
    const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    copiedPages.forEach((p) => mergedPdf.addPage(p));
  }

  if (mergedPdf.getPageCount() === 0) {
    throw new Error('Hasil merge tidak memiliki halaman sama sekali -- proses dibatalkan.');
  }

  ensureConvertedDir();
  const outputName = `merged-${uuidv4()}.pdf`;
  const outputPath = path.join(config.convertedDir, outputName);
  const outputBytes = await mergedPdf.save();
  fs.writeFileSync(outputPath, outputBytes);

  return outputName;
}

/**
 * Memisahkan halaman tertentu (1-indexed di request, dikonversi ke 0-indexed)
 * dari PDF menjadi file PDF baru yang terpisah.
 */
async function splitPdf(filePath, pageRanges) {
  const bytes = fs.readFileSync(filePath);
  const sourcePdf = await PDFDocument.load(bytes);
  const totalPages = sourcePdf.getPageCount();

  ensureConvertedDir();
  const results = [];

  for (const range of pageRanges) {
    const { start, end } = range;
    if (start < 1 || end > totalPages || start > end) {
      throw new Error(`Range halaman tidak valid: ${start}-${end} (dokumen punya ${totalPages} halaman)`);
    }

    const newPdf = await PDFDocument.create();
    const indices = [];
    for (let i = start - 1; i <= end - 1; i += 1) indices.push(i);

    // eslint-disable-next-line no-await-in-loop
    const copiedPages = await newPdf.copyPages(sourcePdf, indices);
    copiedPages.forEach((p) => newPdf.addPage(p));

    const outputName = `split-${start}-${end}-${uuidv4()}.pdf`;
    const outputPath = path.join(config.convertedDir, outputName);
    // eslint-disable-next-line no-await-in-loop
    const outputBytes = await newPdf.save();
    fs.writeFileSync(outputPath, outputBytes);

    results.push({ range: `${start}-${end}`, filename: outputName });
  }

  return results;
}

function dictHasImageSubtype(dict) {
  const subtype = dict.get(PDFName.of('Subtype'));
  return !!subtype && subtype.toString() === '/Image';
}

function dictHasDCTDecodeFilter(dict) {
  const filter = dict.get(PDFName.of('Filter'));
  if (!filter) return false;
  if (filter instanceof PDFArray) {
    return filter.asArray().some((f) => f.toString() === '/DCTDecode');
  }
  return filter.toString() === '/DCTDecode';
}

/**
 * Mengompres PDF dengan DUA lapis optimasi:
 * 1. Struktural: `useObjectStreams` (menghilangkan objek redundan, dari pdf-lib).
 * 2. Gambar: setiap gambar JPEG (filter DCTDecode) di dalam PDF di-decode lalu
 *    di-recompress ulang pakai `sharp` pada kualitas & lebar maksimum yang
 *    lebih rendah -- ini yang memberikan pengurangan ukuran nyata untuk PDF
 *    berisi foto/scan, bukan cuma PDF berbasis teks murni (yang memang dari
 *    awal sudah kecil dan sulit dikompres lebih jauh).
 */
async function compressPdf(filePath, options = {}) {
  const { imageQuality = 60, maxImageWidth = 1600 } = options;

  const bytes = fs.readFileSync(filePath);
  const pdfDoc = await PDFDocument.load(bytes);
  const originalSize = bytes.length;

  let imagesProcessed = 0;
  let imagesSkipped = 0;

  const indirectObjects = pdfDoc.context.enumerateIndirectObjects();
  for (const [, obj] of indirectObjects) {
    if (!(obj instanceof PDFRawStream)) continue;
    const { dict } = obj;
    if (!dictHasImageSubtype(dict)) continue;
    if (!dictHasDCTDecodeFilter(dict)) { imagesSkipped += 1; continue; }

    try {
      const rawBytes = Buffer.from(obj.contents);
      const sharpImg = sharp(rawBytes);
      const meta = await sharpImg.metadata(); // eslint-disable-line no-await-in-loop

      let pipeline = sharpImg;
      if (meta.width && meta.width > maxImageWidth) {
        pipeline = pipeline.resize({ width: maxImageWidth });
      }
      const newBuffer = await pipeline.jpeg({ quality: imageQuality, mozjpeg: true }).toBuffer(); // eslint-disable-line no-await-in-loop

      if (newBuffer.length < rawBytes.length) {
        obj.contents = newBuffer;
        dict.set(PDFName.of('Length'), PDFNumber.of(newBuffer.length));
        dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));

        if (meta.width && meta.width > maxImageWidth) {
          const newMeta = await sharp(newBuffer).metadata(); // eslint-disable-line no-await-in-loop
          if (newMeta.width) dict.set(PDFName.of('Width'), PDFNumber.of(newMeta.width));
          if (newMeta.height) dict.set(PDFName.of('Height'), PDFNumber.of(newMeta.height));
        }
        imagesProcessed += 1;
      } else {
        imagesSkipped += 1;
      }
    } catch (imgErr) {
      // Satu gambar gagal diproses tidak boleh menggagalkan seluruh kompresi --
      // lewati gambar itu saja, lanjut ke gambar berikutnya.
      console.warn('[compressPdf] Gagal mengompres satu gambar, dilewati:', imgErr.message);
      imagesSkipped += 1;
    }
  }

  ensureConvertedDir();
  const outputName = `compressed-${uuidv4()}.pdf`;
  const outputPath = path.join(config.convertedDir, outputName);

  const outputBytes = await pdfDoc.save({ useObjectStreams: true, addDefaultPage: false });
  fs.writeFileSync(outputPath, outputBytes);

  const compressedSize = outputBytes.length;
  const reductionPercent = originalSize > 0
    ? (((originalSize - compressedSize) / originalSize) * 100).toFixed(2)
    : 0;

  return {
    outputName, originalSize, compressedSize, reductionPercent, imagesProcessed, imagesSkipped,
  };
}

/**
 * Membuat ulang PDF dari teks polos (dipakai internal, misal untuk
 * merepresentasikan hasil delete/blur teks kembali menjadi PDF sederhana).
 */
async function createPdfFromText(text, title = 'Document') {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSize = 11;
  const margin = 50;
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const maxWidth = pageWidth - margin * 2;
  const lineHeight = fontSize * 1.4;

  const words = text.split(/\s+/);
  const lines = [];
  let currentLine = '';

  words.forEach((word) => {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const width = font.widthOfTextAtSize(testLine, fontSize);
    if (width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  });
  if (currentLine) lines.push(currentLine);

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  lines.forEach((line) => {
    if (y < margin) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0, 0, 0) });
    y -= lineHeight;
  });

  ensureConvertedDir();
  const outputName = `${title}-${uuidv4()}.pdf`;
  const outputPath = path.join(config.convertedDir, outputName);
  const outputBytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, outputBytes);

  return outputName;
}

/**
 * Menempelkan potongan gambar (PNG base64) ke posisi tertentu pada PDF.
 * Dipakai untuk gaya blur yang butuh pemrosesan piksel (blur/pixelate)
 * yang sudah dilakukan di sisi browser (canvas) — backend hanya menempelkan
 * hasilnya secara presisi di atas konten asli, tanpa perlu render-engine
 * PDF tambahan di server. Juga dipakai untuk menempel tanda tangan (e-sign).
 *
 * patches: Array<{ page, x, y, width, height, imageBase64 }>
 */
async function applyImagePatches(filePath, patches) {
  const bytes = fs.readFileSync(filePath);
  const pdfDoc = await PDFDocument.load(bytes);
  const pages = pdfDoc.getPages();

  for (const patch of patches) {
    const { page = 0, x, y, width, height, imageBase64 } = patch;
    if (page < 0 || page >= pages.length) {
      throw new Error(`Halaman ${page} tidak ditemukan.`);
    }
    if (!imageBase64) {
      throw new Error('Setiap patch wajib menyertakan imageBase64');
    }

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const imageBytes = Buffer.from(base64Data, 'base64');
    // eslint-disable-next-line no-await-in-loop
    const pngImage = await pdfDoc.embedPng(imageBytes);
    pages[page].drawImage(pngImage, { x, y, width, height });
  }

  ensureConvertedDir();
  const outputName = `patch-${uuidv4()}.pdf`;
  const outputPath = path.join(config.convertedDir, outputName);
  const outputBytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, outputBytes);

  return outputName;
}

module.exports = {
  addTextToPdf,
  blurAreaInPdf,
  mergePdfs,
  splitPdf,
  compressPdf,
  createPdfFromText,
  applyImagePatches,
  FONT_FAMILIES,
};
