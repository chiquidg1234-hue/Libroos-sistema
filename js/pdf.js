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

  /*
   * pages: función async (index) => canvas, para index en [0, count).
   * opts: { count, size: 'photo'|'a4'|'letter', jpegQuality, title }
   */
  async function build(pages, opts, onProgress) {
    if (!root.jspdf || !root.jspdf.jsPDF) throw new Error('No se cargó el generador de PDF. Revisa la conexión y recarga la página.');
    var JsPDF = root.jspdf.jsPDF, doc = null;
    for (var i = 0; i < opts.count; i++) {
      var canvas = await pages(i);
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
      canvas.width = canvas.height = 0; // libera memoria en Safari
      if (onProgress) onProgress(i + 1, opts.count);
      await new Promise(function (r) { setTimeout(r, 0); });
    }
    if (!doc) throw new Error('No hay páginas para el PDF');
    doc.setProperties({ title: opts.title || 'Libro', creator: 'Libroos' });
    return doc.output('blob');
  }

  root.LibroosPdf = { build: build };
})(this);
