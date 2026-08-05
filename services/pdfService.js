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
 * yang sudah dilakukan di sisi browser (canvas) - backend hanya menempelkan
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

/**
 * Menghapus semua field metadata Info Dictionary dari PDF
 * (Author, Creator, Producer, CreationDate, ModDate, Subject, Keywords, Title, Trapped).
 * Berguna sebelum dokumen dibagikan agar identitas pembuat tidak bocor.
 */
async function stripMetadata(filePath) {
  const META_KEYS = ['Author', 'Creator', 'Producer', 'CreationDate', 'ModDate',
    'Subject', 'Keywords', 'Title', 'Trapped'];

  // Kunci: load dengan { updateMetadata: false } agar pdf-lib TIDAK menyuntikkan
  // Creator/Producer default-nya saat konstruktor dipanggil.
  // save() sendiri tidak memanggil updateInfoDict, jadi cukup satu pass.
  const bytes  = fs.readFileSync(filePath);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });

  const infoRef = pdfDoc.context.trailerInfo.Info;
  if (infoRef) {
    try {
      const infoDict = pdfDoc.context.lookup(infoRef);
      if (infoDict && typeof infoDict.delete === 'function') {
        META_KEYS.forEach((k) => { try { infoDict.delete(PDFName.of(k)); } catch (_) { /* skip */ } });
      }
    } catch (_) { /* infoDict tidak dapat diakses, skip */ }
  }

  const outBytes = await pdfDoc.save();

  ensureConvertedDir();
  const outName = `stripped-${uuidv4()}.pdf`;
  const outPath = path.join(config.convertedDir, outName);
  fs.writeFileSync(outPath, outBytes);
  return outName;
}

/**
 * Menambahkan teks watermark diagonal semi-transparan ke seluruh halaman PDF.
 * Mendukung pilihan teks, opacity, ukuran font, dan warna.
 */
async function addWatermark(filePath, { text, opacity, fontSize, color }) {
  const { degrees } = require('pdf-lib');
  const bytes = fs.readFileSync(filePath);
  const pdfDoc = await PDFDocument.load(bytes);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const rgbColor = hexToRgb(color || '#000000');

  for (const page of pdfDoc.getPages()) {
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const textHeight = font.heightAtSize(fontSize);
    page.drawText(text, {
      x: (width - textWidth) / 2,
      y: (height - textHeight) / 2,
      size: fontSize,
      font,
      color: rgbColor,
      opacity: parseFloat(opacity) || 0.3,
      rotate: degrees(45),
    });
  }

  ensureConvertedDir();
  const outName = `watermark-${uuidv4()}.pdf`;
  const outPath = path.join(config.convertedDir, outName);
  const outBytes = await pdfDoc.save();
  fs.writeFileSync(outPath, outBytes);
  return outName;
}

/**
 * Mengenkripsi PDF dengan password.
 * Strategi: 1) qpdf binary sistem (kalau tersedia -- tercepat)
 *           2) qpdf yang dikompilasi ke WASM (@neslinesli93/qpdf-wasm) --
 *              tidak butuh binary sistem apapun, jadi selalu bekerja di
 *              lingkungan hosting manapun (container minimal, serverless, dst).
 *
 * PENTING: strategi lama di sini adalah implementasi kriptografi buatan
 * sendiri ("RC4 approximation" via XOR chain) untuk PDF Standard Security
 * Handler R4. Setelah diverifikasi dengan pikepdf & pdftk secara independen,
 * terbukti implementasi itu SELALU menghasilkan PDF yang gagal dibuka --
 * bahkan dengan password yang benar sekalipun -- karena O/U key derivation-nya
 * tidak sesuai spesifikasi PDF. Setiap kali qpdf binary sistem tidak tersedia
 * (umum terjadi di banyak platform hosting Node.js), fallback ini yang jalan,
 * sehingga SEMUA export dengan password menghasilkan file yang tidak bisa
 * dibuka. Diganti total dengan qpdf asli (native, lewat WASM) yang terbukti
 * menghasilkan enkripsi valid dan bisa dibuka dengan password yang benar.
 */
async function setPassword(filePath, password) {
  const { spawnSync } = require('child_process');
  ensureConvertedDir();
  const outName = `secured-${uuidv4()}.pdf`;
  const outPath = path.join(config.convertedDir, outName);

  // ── 1. qpdf binary sistem ────────────────────────────────────────────
  const safeEnv = {
    ...process.env,
    PATH: ['/usr/local/sbin','/usr/local/bin','/usr/sbin','/usr/bin','/sbin','/bin',
      process.env.PATH||''].join(':'),
  };
  for (const c of ['/usr/bin/qpdf','/usr/local/bin/qpdf','/opt/homebrew/bin/qpdf','qpdf']) {
    const probe = spawnSync(c, ['--version'], { stdio:'pipe', env:safeEnv });
    if (!probe.error && probe.status === 0) {
      // --warning-exit-0: qpdf keluar dengan kode 3 kalau cuma ada WARNING
      // (bukan error) pada PDF sumber -- ini sangat umum untuk PDF hasil
      // export PPT/scanner/dsb yang punya struktur sedikit non-standar tapi
      // tetap valid. Tanpa flag ini, hasil yang sudah benar bisa dianggap
      // gagal padahal outPath sudah berisi PDF terenkripsi yang valid.
      const r = spawnSync(c, ['--warning-exit-0', '--encrypt', password, password, '256', '--', filePath, outPath],
        { stdio:'pipe', env:safeEnv });
      if (!r.error && r.status === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 0)
        return outName;
      break;
    }
  }

  // ── 2. qpdf via WASM (tidak butuh binary sistem) ────────────────────
  try {
    const outBytes = await encryptWithQpdfWasm(filePath, password);
    fs.writeFileSync(outPath, outBytes);
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 100) {
      throw new Error('Output PDF corrupt — enkripsi gagal');
    }
    return outName;
  } catch (wasmErr) {
    try { fs.unlinkSync(outPath); } catch (_) {}
    throw new Error(`Gagal mengenkripsi PDF dengan password: ${wasmErr.message}`);
  }
}

// Modul WASM diinisialisasi sekali (lazy) lalu dipakai ulang -- inisialisasi
// WASM punya overhead, tapi setiap panggilan enkripsi memakai path file
// virtual unik (berbasis uuid) supaya aman dipanggil untuk request bersamaan.
let qpdfWasmModulePromise = null;
function getQpdfWasmModule() {
  if (!qpdfWasmModulePromise) {
    const qpdfFactory = require('@neslinesli93/qpdf-wasm');
    const wasmPath = path.join(
      path.dirname(require.resolve('@neslinesli93/qpdf-wasm/package.json')),
      'dist', 'qpdf.wasm'
    );
    qpdfWasmModulePromise = qpdfFactory({ locateFile: () => wasmPath });
  }
  return qpdfWasmModulePromise;
}

async function encryptWithQpdfWasm(filePath, password) {
  const mod = await getQpdfWasmModule();
  const id = uuidv4();
  const inVPath = `/in-${id}.pdf`;
  const outVPath = `/out-${id}.pdf`;
  try {
    const inBytes = fs.readFileSync(filePath);
    mod.FS.writeFile(inVPath, inBytes);
    // --warning-exit-0: exit code 3 dari qpdf berarti WARNING, bukan error --
    // PDF sumber tetap berhasil diproses dan outVPath tetap berisi output
    // yang valid. Tanpa flag ini, PDF dengan struktur sedikit non-standar
    // (umum pada hasil export PPT) akan salah dianggap gagal dienkripsi.
    const ret = mod.callMain(['--warning-exit-0', '--encrypt', password, password, '256', '--', inVPath, outVPath]);
    let outBytes;
    try { outBytes = mod.FS.readFile(outVPath); } catch (_) { outBytes = null; }
    // Jaga-jaga tambahan: kalau output benar-benar ada isinya, anggap berhasil
    // walau exit code-nya bukan 0 (mis. kode lain yang tetap non-fatal).
    if ((!outBytes || outBytes.length === 0)) {
      throw new Error(`qpdf-wasm keluar dengan kode ${ret} dan tidak menghasilkan output`);
    }
    return Buffer.from(outBytes);
  } finally {
    try { mod.FS.unlink(inVPath); } catch (_) {}
    try { mod.FS.unlink(outVPath); } catch (_) {}
  }
}


/**
 * Menambahkan annotation (highlight, shape, sticky note) ke PDF.
 * annotations: Array<{ type, page, xPt, yPt, widthPt, heightPt, ...typeFields }>
 */
async function addAnnotationsToPdf(filePath, annotations) {
  const { degrees } = require('pdf-lib');
  const bytes = fs.readFileSync(filePath);
  const pdfDoc = await PDFDocument.load(bytes);
  const pages = pdfDoc.getPages();

  for (const ann of annotations) {
    const page = pages[ann.page];
    if (!page) continue;

    if (ann.type === 'highlight') {
      page.drawRectangle({
        x: ann.xPt,
        y: ann.yPt,
        width: ann.widthPt,
        height: ann.heightPt,
        color: hexToRgb(ann.color || '#FFEB3B'),
        opacity: ann.opacity != null ? parseFloat(ann.opacity) : 0.4,
      });
    } else if (ann.type === 'shape') {
      const strokeColor = hexToRgb(ann.strokeColor || '#000000');
      const hasFill = ann.fillColor && ann.fillColor !== 'transparent';
      const fillColor = hasFill ? hexToRgb(ann.fillColor) : undefined;
      const borderWidth = ann.strokeWidth || 2;

      if (ann.shape === 'ellipse') {
        page.drawEllipse({
          x: ann.xPt + ann.widthPt / 2,
          y: ann.yPt + ann.heightPt / 2,
          xScale: ann.widthPt / 2,
          yScale: ann.heightPt / 2,
          borderColor: strokeColor,
          borderWidth,
          ...(hasFill ? { color: fillColor } : { color: rgb(1, 1, 1), opacity: 0 }),
        });
      } else {
        page.drawRectangle({
          x: ann.xPt,
          y: ann.yPt,
          width: ann.widthPt,
          height: ann.heightPt,
          borderColor: strokeColor,
          borderWidth,
          ...(hasFill ? { color: fillColor } : { color: rgb(1, 1, 1), opacity: 0 }),
        });
      }
    } else if (ann.type === 'stickynote') {
      // Gambar background kuning sticky note
      const bgColor = hexToRgb(ann.color || '#FFF9C4');
      const noteW = ann.widthPt || 120;
      const noteH = ann.heightPt || 80;
      page.drawRectangle({
        x: ann.xPt,
        y: ann.yPt,
        width: noteW,
        height: noteH,
        color: bgColor,
        borderColor: hexToRgb('#E6D800'),
        borderWidth: 1,
        opacity: 0.9,
      });
      // Gambar teks catatan
      if (ann.text) {
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica); // eslint-disable-line no-await-in-loop
        const fontSize = 10;
        const lineHeight = fontSize * 1.3;
        const maxW = noteW - 8;
        const words = ann.text.split(/\s+/);
        const lines = [];
        let cur = '';
        words.forEach((w) => {
          const test = cur ? `${cur} ${w}` : w;
          if (font.widthOfTextAtSize(test, fontSize) > maxW && cur) {
            lines.push(cur); cur = w;
          } else { cur = test; }
        });
        if (cur) lines.push(cur);

        lines.forEach((line, i) => {
          const lineY = ann.yPt + noteH - 14 - i * lineHeight;
          if (lineY > ann.yPt + 2) {
            page.drawText(line, {
              x: ann.xPt + 4,
              y: lineY,
              size: fontSize,
              font,
              color: rgb(0.1, 0.1, 0.1),
            });
          }
        });
      }
    }
  }

  ensureConvertedDir();
  const outName = `annotated-${uuidv4()}.pdf`;
  const outPath = path.join(config.convertedDir, outName);
  const outBytes = await pdfDoc.save();
  fs.writeFileSync(outPath, outBytes);
  return outName;
}

module.exports = {
  addTextToPdf,
  blurAreaInPdf,
  mergePdfs,
  splitPdf,
  compressPdf,
  createPdfFromText,
  applyImagePatches,
  stripMetadata,
  addWatermark,
  setPassword,
  addAnnotationsToPdf,
  FONT_FAMILIES,
};
