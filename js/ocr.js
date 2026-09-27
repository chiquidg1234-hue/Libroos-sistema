/*
 * Libroos · reconocimiento de texto (OCR) con Tesseract.js
 * Todo viaja con la app (vendor/tesseract): motor, worker e idioma español,
 * así funciona sin conexión y sin mandar las páginas a ningún servidor.
 * Se carga recién cuando se pide un PDF con texto buscable.
 */
(function (root) {
  'use strict';

  var workerPromise = null;

  function base(path) { return new URL(path, document.baseURI).href; }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (root.Tesseract) { resolve(); return; }
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('No se pudo cargar el lector de texto.')); };
      document.head.appendChild(s);
    });
  }

  function getWorker() {
    if (workerPromise) return workerPromise;
    workerPromise = loadScript(base('vendor/tesseract/tesseract.min.js')).then(function () {
      return root.Tesseract.createWorker('spa', 1 /* OEM LSTM_ONLY */, {
        workerPath: base('vendor/tesseract/worker.min.js'),
        corePath: base('vendor/tesseract/'),
        langPath: base('vendor/tesseract/lang'),
        gzip: true,
        workerBlobURL: false,
        cacheMethod: 'none'
      });
    }).then(function (worker) {
      // Página de libro: bloques de texto, conservar espacios entre palabras.
      return worker.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1' }).then(function () { return worker; });
    });
    workerPromise.catch(function () { workerPromise = null; });
    return workerPromise;
  }

  /*
   * Devuelve { text, words: [{ text, x0, y0, x1, y1 }] } en píxeles del canvas.
   */
  async function recognize(canvas) {
    var worker = await getWorker();
    var res = await worker.recognize(canvas);
    var data = res.data || {};
    var words = (data.words || []).filter(function (w) {
      return w.text && w.text.trim() && w.confidence > 35;
    }).map(function (w) {
      return { text: w.text.trim(), x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 };
    });
    return { text: (data.text || '').trim(), words: words };
  }

  async function terminate() {
    if (!workerPromise) return;
    var p = workerPromise;
    workerPromise = null;
    try { (await p).terminate(); } catch (e) { /* ya estaba cerrado */ }
  }

  root.LibroosOcr = { recognize: recognize, terminate: terminate, warmUp: getWorker };
})(this);
