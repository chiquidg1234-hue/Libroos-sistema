/*
 * Libroos · armado del PDF con jsPDF.
 * Recibe las páginas una por una (canvas) para no tener todo el libro
 * en memoria como imágenes sin comprimir.
 */
(function (root) {
  'use strict';

  var SIZES = {
    photo: null,               // la hoja toma la proporción de la página fotografiada
    a4: [210, 297],
    letter: [215.9, 279.4]
  };
  var PHOTO_HEIGHT_MM = 240;   // altura fija: todas las hojas quedan del mismo alto

  function canvasToBytes(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) { reject(new Error('No se pudo comprimir la página')); return; }
        blob.arrayBuffer().then(function (buf) { resolve(new Uint8Array(buf)); }, reject);
      }, 'image/jpeg', quality);
    });
  }

  // Las fuentes estándar del PDF solo cubren Latin-1: se adaptan los demás signos.
  function pdfSafe(t) {
    return t.replace(/[\u2018\u2019\u201A]/g, "'").replace(/[\u201C\u201D\u201E]/g, '"')
      .replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...').replace(/[^\x20-\xFF]/g, '');
  }

  /*
   * Capa de texto invisible encima de la imagen: el PDF se ve igual pero
   * permite buscar, seleccionar y copiar. Cada palabra se estira al ancho
   * que ocupa en la foto para que la selección coincida con lo que se ve.
   */
  function addTextLayer(doc, words, x, y, scale) {
    doc.setFont('helvetica', 'normal');
    words.forEach(function (w) {
      var text = pdfSafe(w.text);
      if (!text) return;
      var hmm = (w.y1 - w.y0) * scale, wmm = (w.x1 - w.x0) * scale;
      if (hmm <= 0 || wmm <= 0) return;
      var size = hmm * 72 / 25.4;             // mm → puntos
      doc.setFontSize(size);
      var natural = doc.getTextWidth(text);
      doc.text(text, x + w.x0 * scale, y + w.y1 * scale - hmm * 0.2, {
        renderingMode: 'invisible',
        horizontalScale: natural > 0 ? wmm / natural : 1
      });
    });
  }

  /*
   * pages: función async (index) => canvas, para index en [0, count).
   * opts: { count, size: 'photo'|'a4'|'letter', jpegQuality, title,
   *         ocr: async (canvas, index) => { text, words } | null }
   * Devuelve { blob, text } (text: el texto reconocido de todas las páginas).
   */
  async function build(pages, opts, onProgress) {
    if (!root.jspdf || !root.jspdf.jsPDF) throw new Error('No se cargó el generador de PDF. Revisa la conexión y recarga la página.');
    var JsPDF = root.jspdf.jsPDF, doc = null, texts = [];
    for (var i = 0; i < opts.count; i++) {
      var canvas = await pages(i);
      var ocr = opts.ocr ? await opts.ocr(canvas, i) : null;
      var bytes = await canvasToBytes(canvas, opts.jpegQuality);
      var cw = canvas.width, ch = canvas.height;
      var pw, ph, x = 0, y = 0, iw, ih;
      var fixed = SIZES[opts.size];
      if (fixed) {
        pw = fixed[0]; ph = fixed[1];
        var s = Math.min(pw / cw, ph / ch);
        iw = cw * s; ih = ch * s; x = (pw - iw) / 2; y = (ph - ih) / 2;
      } else {
        ph = PHOTO_HEIGHT_MM; pw = ph * cw / ch; iw = pw; ih = ph;
      }
      var orient = pw > ph ? 'l' : 'p';
      if (!doc) doc = new JsPDF({ unit: 'mm', format: [pw, ph], orientation: orient, compress: true });
      else doc.addPage([pw, ph], orient);
      doc.addImage(bytes, 'JPEG', x, y, iw, ih, undefined, 'NONE');
      if (ocr) {
        addTextLayer(doc, ocr.words, x, y, iw / cw);
        texts.push('--- Página ' + (i + 1) + ' ---\n' + ocr.text);
      }
      canvas.width = canvas.height = 0; // libera memoria en Safari
      if (onProgress) onProgress(i + 1, opts.count);
      await new Promise(function (r) { setTimeout(r, 0); });
    }
    if (!doc) throw new Error('No hay páginas para el PDF');
    doc.setProperties({ title: opts.title || 'Libro', creator: 'Libroos' });
    return { blob: doc.output('blob'), text: texts.join('\n\n') };
  }

  root.LibroosPdf = { build: build };
})(this);
