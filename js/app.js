/*
 * Libroos · interfaz
 * Captura (cámara continua, cámara nativa, galería) → lista de fotos →
 * editor de puntos (esquinas + lomo) → PDF descargable.
 */
(function () {
  'use strict';

  var Img = window.LibroosImaging, Store = window.LibroosStore, Pdf = window.LibroosPdf;

  var WORK_MAX = 3600;      // lado mayor de la foto guardada
  var PREVIEW_MAX = 1400;   // lado mayor de la vista previa (editor y miniaturas)
  var THUMB_MAX = 420;      // lado mayor de cada miniatura de página
  var QUALITY = {
    high: { max: 2600, q: 0.9, perPage: 0.55, note: 'Para imprimir o hacer zoom en letra chica.' },
    medium: { max: 1800, q: 0.82, perPage: 0.28, note: 'Lectura cómoda en celular o computadora.' },
    low: { max: 1200, q: 0.7, perPage: 0.12, note: 'Archivo chico para mandar por WhatsApp o correo.' }
  };

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- Preferencias ---------- */
  var settings = { captureMode: 'double', filter: 'color', pdfSize: 'photo', pdfQuality: 'medium', pdfName: '', sampleShown: false, ocr: true };
  try {
    var saved = JSON.parse(localStorage.getItem('libroos-settings') || '{}');
    Object.keys(settings).forEach(function (k) { if (k in saved) settings[k] = saved[k]; });
  } catch (e) { /* sin almacenamiento: valores por defecto */ }
  function saveSettings() {
    try { localStorage.setItem('libroos-settings', JSON.stringify(settings)); } catch (e) { /* nada */ }
  }

  /* ---------- Utilidades de imagen ---------- */
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function decodeBlob(blob) {
    if (window.createImageBitmap) {
      return createImageBitmap(blob, { imageOrientation: 'from-image' })
        .catch(function () { return createImageBitmap(blob); })
        .catch(function () { return decodeWithImg(blob); });
    }
    return decodeWithImg(blob);
  }
  function decodeWithImg(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('No se pudo abrir la imagen. Prueba con una foto JPG o PNG.')); };
      img.src = url;
    });
  }
  function dims(src) { return { w: src.naturalWidth || src.videoWidth || src.width, h: src.naturalHeight || src.videoHeight || src.height }; }

  function drawRotated(src, rotation, maxSide) {
    var d = dims(src);
    var s = Math.min(1, maxSide / Math.max(d.w, d.h));
    var w = Math.max(1, Math.round(d.w * s)), h = Math.max(1, Math.round(d.h * s));
    var turned = rotation % 180 !== 0;
    var c = document.createElement('canvas');
    c.width = turned ? h : w; c.height = turned ? w : h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.drawImage(src, -w / 2, -h / 2, w, h);
    return c;
  }
  function canvasBlob(canvas, type, q) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('No se pudo guardar la imagen')); }, type, q);
    });
  }
  function pixels(canvas) { return canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height); }
  function toCanvas(img) {
    var c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
    return c;
  }
  function releaseSrc(src) { if (src && src.close) src.close(); }

  /* Genera los canvas de página de una foto ya rotada. */
  function renderPages(source, rec, maxSide, filter) {
    var data = pixels(source);
    var W = source.width - 1, H = source.height - 1;
    return Img.pageQuads(rec.mode, rec.pts).map(function (q) {
      var quad = q.map(function (p) { return [p[0] * W, p[1] * H]; });
      var sz = Img.quadSize(quad);
      var s = Math.min(1, maxSide / Math.max(sz.w, sz.h, 1));
      var ow = Math.max(8, Math.round(sz.w * s)), oh = Math.max(8, Math.round(sz.h * s));
      return toCanvas(Img.enhance(Img.warpQuad(data, quad, ow, oh), filter));
    });
  }

  function detectOn(canvas) {
    var small = drawRotated(canvas, 0, 640);
    return Img.autoDetect(pixels(small));
  }

  function filterOf(rec) { return rec.filter || settings.filter; }
  function pagesOf(rec) { return rec.mode === 'single' ? 1 : 2; }

  /* ---------- Estado ---------- */
  var spreads = [];
  var chain = Promise.resolve();
  function enqueue(fn) { chain = chain.then(fn).catch(function (e) { console.error(e); toast(e.message || 'Algo salió mal con una foto.'); }); return chain; }

  function nextOrder() { return spreads.length ? spreads[spreads.length - 1].order + 1 : 1; }

  function persist(rec) {
    return Store.put(rec).catch(function (e) {
      console.error(e);
      toast('El teléfono no tiene espacio para guardar más fotos. Crea el PDF de lo que llevas.');
    });
  }

  async function importImage(blob, opts) {
    var src = await decodeBlob(blob);
    var full = drawRotated(src, 0, WORK_MAX);
    releaseSrc(src);
    var work = await canvasBlob(full, 'image/jpeg', 0.92);
    var prev = drawRotated(full, 0, PREVIEW_MAX);
    var preview = await canvasBlob(prev, 'image/jpeg', 0.85);
    var mode = opts.mode || settings.captureMode;
    var pts = detectOn(prev);
    full.width = full.height = 0;
    var rec = { id: uid(), order: nextOrder(), blob: work, preview: preview, mode: mode, rotation: 0, pts: pts, filter: '', sample: !!opts.sample, v: 1 };
    spreads.push(rec);
    await persist(rec);
    renderList();
    return rec;
  }

  function removeSamples() {
    var samples = spreads.filter(function (r) { return r.sample; });
    if (!samples.length) return;
    spreads = spreads.filter(function (r) { return !r.sample; });
    samples.forEach(function (r) { Store.remove(r.id); });
    renderList();
  }

  function handleFiles(fileList) {
    var files = Array.prototype.filter.call(fileList || [], function (f) { return /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name); });
    if (!files.length) return;
    removeSamples();
    var done = 0, line = $('import-progress');
    line.hidden = false;
    line.textContent = 'Procesando 0 de ' + files.length + '…';
    files.forEach(function (f) {
      enqueue(function () {
        return importImage(f, {}).then(function () {
          done++;
          line.textContent = done < files.length ? 'Procesando ' + done + ' de ' + files.length + '…' : '';
          if (done === files.length) { line.hidden = true; toast(files.length === 1 ? 'Foto agregada.' : files.length + ' fotos agregadas.'); }
        });
      });
    });
  }

  /* ---------- Miniaturas ---------- */
  var thumbCache = new Map();
  var thumbQueue = [], thumbBusy = false;
  function thumbKey(rec) { return rec.id + '|' + rec.v + '|' + rec.mode + '|' + filterOf(rec); }

  function requestThumbs(rec) {
    var key = thumbKey(rec);
    if (thumbCache.has(key) || thumbQueue.some(function (t) { return t.key === key; })) return;
    thumbQueue.push({ key: key, rec: rec });
    pumpThumbs();
  }
  async function pumpThumbs() {
    if (thumbBusy) return;
    thumbBusy = true;
    while (thumbQueue.length) {
      var job = thumbQueue.shift();
      if (thumbKey(job.rec) !== job.key || spreads.indexOf(job.rec) < 0) continue;
      try {
        var src = await decodeBlob(job.rec.preview);
        var c = drawRotated(src, job.rec.rotation, PREVIEW_MAX);
        releaseSrc(src);
        var pages = renderPages(c, job.rec, THUMB_MAX, filterOf(job.rec));
        var urls = [];
        for (var i = 0; i < pages.length; i++) urls.push(URL.createObjectURL(await canvasBlob(pages[i], 'image/jpeg', 0.8)));
        // Libera las versiones viejas de esta foto.
        thumbCache.forEach(function (u, k) {
          if (k.indexOf(job.rec.id + '|') === 0) { u.forEach(URL.revokeObjectURL); thumbCache.delete(k); }
        });
        thumbCache.set(job.key, urls);
        paintThumbs(job.rec);
      } catch (e) { console.error(e); }
      await new Promise(function (r) { setTimeout(r, 0); });
    }
    thumbBusy = false;
  }
  function paintThumbs(rec) {
    var li = document.querySelector('.spread[data-id="' + rec.id + '"] .spread-open');
    var urls = thumbCache.get(thumbKey(rec));
    if (!li || !urls) return;
    li.textContent = '';
    urls.forEach(function (u, i) {
      var im = document.createElement('img');
      im.src = u; im.alt = 'Página ' + (i + 1) + ' de la foto';
      li.appendChild(im);
    });
  }

  /* ---------- Lista ---------- */
  var ICON = {
    up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>'
  };

  function totals() {
    return spreads.reduce(function (n, r) { return n + pagesOf(r); }, 0);
  }

  /* ---------- Selección de fotos (para armar un PDF con algunas) ---------- */
  var selectMode = false;
  var selected = new Set();

  function pageNumbersForSelection() {
    var nums = [], page = 1;
    spreads.forEach(function (rec) {
      var n = pagesOf(rec);
      if (selected.has(rec.id)) { for (var i = 0; i < n; i++) nums.push(page + i); }
      page += n;
    });
    return nums;
  }

  function updateSelectionUI() {
    document.querySelectorAll('#spreads .spread').forEach(function (li) {
      var on = selected.has(li.dataset.id);
      li.classList.toggle('selected', on);
      var cb = li.querySelector('.spread-check input');
      if (cb) cb.checked = on;
    });
    var n = selected.size;
    $('select-count').textContent = n + (n === 1 ? ' seleccionada' : ' seleccionadas');
    $('sel-delete').disabled = !n;
    $('sel-pdf').disabled = !n;
  }

  function toggleSelect(id) {
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    updateSelectionUI();
  }

  function setSelectMode(on) {
    selectMode = on;
    if (!on) selected.clear();
    $('btn-select').textContent = on ? 'Cancelar selección' : 'Seleccionar fotos';
    $('btn-select').setAttribute('aria-pressed', String(on));
    $('select-bar').hidden = !on;
    renderList();
  }

  function renderList() {
    if (!spreads.length && selectMode) {
      selectMode = false;
      selected.clear();
      $('btn-select').textContent = 'Seleccionar fotos';
      $('btn-select').setAttribute('aria-pressed', 'false');
      $('select-bar').hidden = true;
    }
    var ol = $('spreads');
    ol.textContent = '';
    ol.classList.toggle('selecting', selectMode);
    var page = 1;
    spreads.forEach(function (rec, idx) {
      var n = pagesOf(rec);
      var li = document.createElement('li');
      li.className = 'spread' + (selected.has(rec.id) ? ' selected' : '');
      li.dataset.id = rec.id;
      var label = n === 1 ? 'pág. ' + page : 'págs. ' + page + '–' + (page + 1);
      li.innerHTML =
        '<button type="button" class="spread-open" aria-label="Ajustar foto ' + (idx + 1) + ' (' + label + ')"></button>' +
        (selectMode ? '<label class="spread-check"><input type="checkbox"' + (selected.has(rec.id) ? ' checked' : '') + '><span class="sr-only">Seleccionar foto ' + (idx + 1) + '</span></label>' : '') +
        '<div class="spread-meta"><span class="pg">' + label + '</span>' +
        (rec.sample ? '<span class="chip chip-warn">Ejemplo</span>' : '') +
        (rec.filter ? '<span class="chip">' + filterName(rec.filter) + '</span>' : '') +
        '<div class="spread-actions">' +
        '<button type="button" class="icon-btn" data-act="up" aria-label="Mover antes"' + (idx === 0 ? ' disabled' : '') + '>' + ICON.up + '</button>' +
        '<button type="button" class="icon-btn" data-act="down" aria-label="Mover después"' + (idx === spreads.length - 1 ? ' disabled' : '') + '>' + ICON.down + '</button>' +
        '<button type="button" class="icon-btn" data-act="del" aria-label="Eliminar foto">' + ICON.trash + '</button>' +
        '</div></div>';
      var open = li.firstChild;
      if (thumbCache.has(thumbKey(rec))) {
        ol.appendChild(li);
        paintThumbs(rec);
      } else {
        for (var i = 0; i < n; i++) { var ph = document.createElement('span'); ph.className = 'ph'; open.appendChild(ph); }
        ol.appendChild(li);
        requestThumbs(rec);
      }
      page += n;
    });
    var pages = totals();
    $('count').innerHTML = '<b>' + pages + '</b> págs.';
    $('bar-pages').textContent = pages;
    $('bar-photos').textContent = spreads.length === 1 ? '1 foto' : spreads.length + ' fotos';
    $('btn-export').disabled = !pages;
    $('empty').hidden = spreads.length > 0;
    $('book-foot').hidden = spreads.length === 0;
    $('select-row').hidden = spreads.length === 0;
  }

  function filterName(f) { return { color: 'Escáner', gray: 'Grises', bw: 'B/N', original: 'Original' }[f] || f; }

  function move(id, delta) {
    var i = spreads.findIndex(function (r) { return r.id === id; }), j = i + delta;
    if (i < 0 || j < 0 || j >= spreads.length) return;
    var a = spreads[i], b = spreads[j];
    var t = a.order; a.order = b.order; b.order = t;
    spreads[i] = b; spreads[j] = a;
    persist(a); persist(b);
    renderList();
    var btn = document.querySelector('.spread[data-id="' + id + '"] [data-act="' + (delta < 0 ? 'up' : 'down') + '"]');
    if (btn && !btn.disabled) btn.focus();
  }

  var lastDeleted = null;
  function removeSpread(id) {
    var i = spreads.findIndex(function (r) { return r.id === id; });
    if (i < 0) return;
    lastDeleted = spreads[i];
    spreads.splice(i, 1);
    Store.remove(id);
    renderList();
    toast('Foto eliminada.', 'Deshacer', function () {
      if (!lastDeleted) return;
      spreads.push(lastDeleted);
      spreads.sort(function (a, b) { return a.order - b.order; });
      persist(lastDeleted);
      lastDeleted = null;
      renderList();
    });
  }

  $('spreads').addEventListener('click', function (e) {
    var li = e.target.closest('.spread');
    if (!li) return;
    if (selectMode) {
      if (e.target.closest('.spread-check')) return; // el checkbox ya maneja su propio cambio
      toggleSelect(li.dataset.id);
      return;
    }
    var act = e.target.closest('[data-act]');
    if (act) {
      if (act.dataset.act === 'up') move(li.dataset.id, -1);
      else if (act.dataset.act === 'down') move(li.dataset.id, 1);
      else removeSpread(li.dataset.id);
      return;
    }
    if (e.target.closest('.spread-open')) openEditor(li.dataset.id);
  });
  $('spreads').addEventListener('change', function (e) {
    if (!e.target.matches('.spread-check input')) return;
    var li = e.target.closest('.spread');
    if (!li) return;
    if (e.target.checked) selected.add(li.dataset.id); else selected.delete(li.dataset.id);
    updateSelectionUI();
  });

  $('btn-select').addEventListener('click', function () { setSelectMode(!selectMode); });
  $('sel-all').addEventListener('click', function () { spreads.forEach(function (r) { selected.add(r.id); }); updateSelectionUI(); });
  $('sel-none').addEventListener('click', function () { selected.clear(); updateSelectionUI(); });
  $('sel-delete').addEventListener('click', function () {
    if (!selected.size) return;
    var removed = spreads.filter(function (r) { return selected.has(r.id); });
    spreads = spreads.filter(function (r) { return !selected.has(r.id); });
    removed.forEach(function (r) { Store.remove(r.id); });
    setSelectMode(false);
    toast(removed.length === 1 ? 'Foto eliminada.' : removed.length + ' fotos eliminadas.', 'Deshacer', function () {
      removed.forEach(function (r) { spreads.push(r); persist(r); });
      spreads.sort(function (a, b) { return a.order - b.order; });
      renderList();
    });
  });
  $('sel-pdf').addEventListener('click', function () {
    if (!selected.size) return;
    var spec = compactRanges(pageNumbersForSelection());
    setSelectMode(false);
    openSheet(spec);
  });

  var clearArmed = null;
  $('btn-clear').addEventListener('click', function () {
    var btn = this;
    if (!clearArmed) {
      btn.textContent = 'Toca otra vez para borrar ' + (spreads.length === 1 ? 'la foto' : 'las ' + spreads.length + ' fotos');
      btn.classList.add('btn-danger');
      clearArmed = setTimeout(function () { clearArmed = null; btn.textContent = 'Borrar todas las fotos'; btn.classList.remove('btn-danger'); }, 4000);
      return;
    }
    clearTimeout(clearArmed); clearArmed = null;
    btn.textContent = 'Borrar todas las fotos'; btn.classList.remove('btn-danger');
    spreads = [];
    Store.clear();
    thumbCache.forEach(function (u) { u.forEach(URL.revokeObjectURL); });
    thumbCache.clear();
    renderList();
    toast('Se borraron todas las fotos.');
  });

  /* ---------- Controles segmentados ---------- */
  function seg(el, value, onChange) {
    var buttons = Array.prototype.slice.call(el.querySelectorAll('button'));
    function set(v) { buttons.forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.value === v)); }); }
    set(value);
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      set(b.dataset.value);
      onChange(b.dataset.value);
    });
    return { set: set };
  }

  var captureSeg = seg($('capture-mode'), settings.captureMode, function (v) {
    settings.captureMode = v; saveSettings(); liveSeg.set(v); $('live').classList.toggle('single', v === 'single');
  });
  seg($('global-filter'), settings.filter, function (v) {
    settings.filter = v; saveSettings(); renderList();
  });

  /* ---------- Entradas de archivo ---------- */
  $('in-camera').addEventListener('change', function () { handleFiles(this.files); this.value = ''; });
  $('in-files').addEventListener('change', function () { handleFiles(this.files); this.value = ''; });

  // Arrastrar y soltar en computadora
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) { e.preventDefault(); if (e.dataTransfer) handleFiles(e.dataTransfer.files); });

  /* ---------- Editor ---------- */
  var ed = null; // { rec, src (canvas rotado), drag }
  var stage = $('ed-stage'), frame = $('ed-frame'), edCanvas = $('ed-canvas'), overlay = $('ed-overlay'), loupe = $('ed-loupe');
  var HANDLE_KEYS = ['tl', 'tr', 'br', 'bl', 'sl', 'sr'];
  var edModeSeg = seg($('ed-mode'), 'double', function (v) {
    if (!ed) return;
    ed.rec.mode = v;
    commitEdit();
    drawOverlay();
  });

  async function loadEditorSource() {
    var src = await decodeBlob(ed.rec.preview);
    ed.src = drawRotated(src, ed.rec.rotation, PREVIEW_MAX);
    releaseSrc(src);
    edCanvas.width = ed.src.width; edCanvas.height = ed.src.height;
    edCanvas.getContext('2d').drawImage(ed.src, 0, 0);
    layoutEditor();
  }

  async function openEditor(id) {
    var rec = spreads.find(function (r) { return r.id === id; });
    if (!rec) return;
    ed = { rec: rec, src: null, drag: null, opener: document.activeElement };
    var idx = spreads.indexOf(rec);
    $('ed-title').textContent = 'Foto ' + (idx + 1) + ' de ' + spreads.length;
    edModeSeg.set(rec.mode);
    $('ed-filter').value = rec.filter || '';
    $('ed-preview').textContent = '';
    $('editor').hidden = false;
    document.body.style.overflow = 'hidden';
    await loadEditorSource();
    renderEditorPreview();
    $('ed-done').focus();
  }

  function closeEditor() {
    if (!ed) return;
    var opener = ed.opener;
    ed = null;
    $('editor').hidden = true;
    document.body.style.overflow = '';
    renderList();
    if (opener && opener.focus && document.contains(opener)) opener.focus();
  }

  function layoutEditor() {
    if (!ed || !ed.src) return;
    var sw = stage.clientWidth - 24, sh = stage.clientHeight - 24;
    var s = Math.min(sw / ed.src.width, sh / ed.src.height);
    frame.style.width = Math.max(10, Math.floor(ed.src.width * s)) + 'px';
    frame.style.height = Math.max(10, Math.floor(ed.src.height * s)) + 'px';
    overlay.setAttribute('viewBox', '0 0 ' + ed.src.width + ' ' + ed.src.height);
    drawOverlay();
  }

  function drawOverlay() {
    if (!ed || !ed.src) return;
    var W = ed.src.width, H = ed.src.height, p = ed.rec.pts;
    var k = W / Math.max(1, frame.clientWidth); // unidades SVG por píxel CSS
    overlay.style.setProperty('--sw', (2.5 * k).toFixed(2));
    function pt(key) { return (p[key][0] * W).toFixed(1) + ',' + (p[key][1] * H).toFixed(1); }
    var html = '';
    Img.pageQuads(ed.rec.mode, p).forEach(function (q) {
      html += '<polygon class="quad" points="' + q.map(function (v) { return (v[0] * W).toFixed(1) + ',' + (v[1] * H).toFixed(1); }).join(' ') + '"/>';
    });
    var keys = ed.rec.mode === 'single' ? HANDLE_KEYS.slice(0, 4) : HANDLE_KEYS;
    if (ed.rec.mode !== 'single') {
      html += '<line class="spine" x1="' + p.sl[0] * W + '" y1="' + p.sl[1] * H + '" x2="' + p.sr[0] * W + '" y2="' + p.sr[1] * H + '"/>';
    }
    var names = { tl: 'esquina superior izquierda', tr: 'esquina superior derecha', br: 'esquina inferior derecha', bl: 'esquina inferior izquierda', sl: 'lomo izquierda', sr: 'lomo derecha' };
    keys.forEach(function (key) {
      var x = p[key][0] * W, y = p[key][1] * H;
      var spine = key === 'sl' || key === 'sr';
      html += '<circle class="handle' + (spine ? ' handle-spine' : '') + '" cx="' + x + '" cy="' + y + '" r="' + (9 * k) + '"/>';
      html += '<circle class="hit" data-key="' + key + '" cx="' + x + '" cy="' + y + '" r="' + (26 * k) + '" tabindex="0" role="slider" aria-label="' + names[key] + '. Flechas para mover" aria-valuetext="' + Math.round(p[key][0] * 100) + '%, ' + Math.round(p[key][1] * 100) + '%"/>';
    });
    overlay.innerHTML = html;
    if (ed.focusKey) {
      var f = overlay.querySelector('[data-key="' + ed.focusKey + '"]');
      if (f) f.focus();
    }
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  overlay.addEventListener('pointerdown', function (e) {
    var hit = e.target.closest('.hit');
    if (!hit || !ed) return;
    e.preventDefault();
    var key = hit.dataset.key, rect = frame.getBoundingClientRect();
    var p = ed.rec.pts[key];
    ed.drag = {
      key: key, id: e.pointerId,
      ox: p[0] * rect.width - (e.clientX - rect.left),
      oy: p[1] * rect.height - (e.clientY - rect.top)
    };
    overlay.setPointerCapture(e.pointerId);
    showLoupe();
  });
  overlay.addEventListener('pointermove', function (e) {
    if (!ed || !ed.drag || ed.drag.id !== e.pointerId) return;
    var rect = frame.getBoundingClientRect();
    var x = clamp01((e.clientX - rect.left + ed.drag.ox) / rect.width);
    var y = clamp01((e.clientY - rect.top + ed.drag.oy) / rect.height);
    ed.rec.pts[ed.drag.key] = [x, y];
    ed.focusKey = null;
    drawOverlay();
    showLoupe();
  });
  function endDrag(e) {
    if (!ed || !ed.drag || ed.drag.id !== e.pointerId) return;
    ed.drag = null;
    loupe.hidden = true;
    commitEdit();
  }
  overlay.addEventListener('pointerup', endDrag);
  overlay.addEventListener('pointercancel', endDrag);

  overlay.addEventListener('keydown', function (e) {
    var hit = e.target.closest('.hit');
    if (!hit || !ed) return;
    var step = e.shiftKey ? 0.02 : 0.004, d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    var p = ed.rec.pts[hit.dataset.key];
    ed.rec.pts[hit.dataset.key] = [clamp01(p[0] + d[0]), clamp01(p[1] + d[1])];
    ed.focusKey = hit.dataset.key;
    drawOverlay();
    commitEdit();
  });

  function showLoupe() {
    if (!ed || !ed.drag) return;
    var p = ed.rec.pts[ed.drag.key], W = ed.src.width, H = ed.src.height;
    var ctx = loupe.getContext('2d');
    var zoomSrc = 60 * W / frame.clientWidth; // ~60 px CSS alrededor del punto
    var cx = p[0] * W, cy = p[1] * H;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, loupe.width, loupe.height);
    ctx.drawImage(ed.src, cx - zoomSrc / 2, cy - zoomSrc / 2, zoomSrc, zoomSrc, 0, 0, loupe.width, loupe.height);
    ctx.strokeStyle = '#f5d547'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(loupe.width / 2, 40); ctx.lineTo(loupe.width / 2, loupe.height - 40);
    ctx.moveTo(40, loupe.height / 2); ctx.lineTo(loupe.width - 40, loupe.height / 2);
    ctx.stroke();
    loupe.classList.toggle('right', p[0] < 0.5 && p[1] < 0.5);
    loupe.hidden = false;
  }

  var previewTimer = null;
  function commitEdit() {
    if (!ed) return;
    ed.rec.v++;
    persist(ed.rec);
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderEditorPreview, 120);
  }

  function renderEditorPreview() {
    if (!ed || !ed.src) return;
    var box = $('ed-preview');
    var first = 1;
    for (var i = 0; i < spreads.indexOf(ed.rec); i++) first += pagesOf(spreads[i]);
    var pages = renderPages(ed.src, ed.rec, 300, filterOf(ed.rec));
    box.textContent = '';
    pages.forEach(function (c, i) {
      var fig = document.createElement('figure');
      var im = document.createElement('img');
      im.src = c.toDataURL('image/jpeg', 0.8);
      im.alt = 'Vista previa de la página ' + (first + i);
      var cap = document.createElement('figcaption');
      cap.textContent = 'pág. ' + (first + i);
      fig.appendChild(im); fig.appendChild(cap);
      box.appendChild(fig);
    });
  }

  $('ed-close').addEventListener('click', closeEditor);
  $('ed-done').addEventListener('click', closeEditor);
  $('ed-rotate').addEventListener('click', async function () {
    if (!ed) return;
    ed.rec.rotation = (ed.rec.rotation + 90) % 360;
    await loadEditorSource();
    ed.rec.pts = detectOn(ed.src);
    drawOverlay();
    commitEdit();
  });
  $('ed-auto').addEventListener('click', function () {
    if (!ed || !ed.src) return;
    ed.rec.pts = detectOn(ed.src);
    drawOverlay();
    commitEdit();
    toast('Puntos detectados de nuevo.');
  });
  $('ed-full').addEventListener('click', function () {
    if (!ed) return;
    ed.rec.pts = Img.fullFramePoints();
    drawOverlay();
    commitEdit();
  });
  $('ed-filter').addEventListener('change', function () {
    if (!ed) return;
    ed.rec.filter = this.value;
    commitEdit();
  });
  $('ed-delete').addEventListener('click', function () {
    if (!ed) return;
    var id = ed.rec.id;
    closeEditor();
    removeSpread(id);
  });
  if (window.ResizeObserver) new ResizeObserver(function () { layoutEditor(); }).observe(stage);
  else window.addEventListener('resize', layoutEditor);

  /* ---------- Cámara continua ---------- */
  var live = { stream: null, track: null, capture: null, lock: null, count: 0, busy: false, lastUrl: null };
  var liveSeg = seg($('live-mode'), settings.captureMode, function (v) {
    settings.captureMode = v; saveSettings(); captureSeg.set(v); $('live').classList.toggle('single', v === 'single');
  });

  // Dentro de claude.ai (u otro marco) el navegador bloquea la cámara:
  // se avisa y se ofrece el link a la versión publicada.
  var embedded = !!window.claude;
  try { embedded = embedded || window.self !== window.top; } catch (e) { embedded = true; }
  if (embedded) {
    $('embed-notice').hidden = false;
    $('lbl-native').hidden = true;
  } else if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    $('btn-live').hidden = false;
  }
  $('copy-link').addEventListener('click', function () {
    var link = $('site-link');
    var done = function () { toast('Link copiado. Pégalo en Chrome o Safari.'); };
    var fallback = function () {
      var r = document.createRange(); r.selectNodeContents(link);
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      toast('Link seleccionado: cópialo y ábrelo en el navegador.');
    };
    try { navigator.clipboard.writeText(link.href).then(done, fallback); } catch (e) { fallback(); }
  });

  function cameraError(e) {
    var name = e && e.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'No hay permiso para la cámara. Toca el candado junto a la dirección, permite la Cámara y vuelve a intentar.';
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No se encontró una cámara en este equipo.';
    if (name === 'NotReadableError') return 'Otra app está usando la cámara. Ciérrala y vuelve a intentar.';
    return 'No se pudo abrir la cámara en vivo. Usa "Cámara del teléfono".';
  }

  $('btn-live').addEventListener('click', openLive);

  async function openLive() {
    try {
      live.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } }
      });
    } catch (e) {
      console.error(e);
      toast(cameraError(e));
      return;
    }
    removeSamples();
    live.track = live.stream.getVideoTracks()[0];
    live.count = 0;
    $('live-count').textContent = '0';
    $('live-thumb').hidden = true;
    $('live').classList.toggle('single', settings.captureMode === 'single');
    $('live').hidden = false;
    document.body.style.overflow = 'hidden';
    var video = $('live-video');
    video.srcObject = live.stream;
    try { await video.play(); } catch (e) { /* autoplay silencioso: ya está en marcha */ }
    try { live.capture = window.ImageCapture ? new ImageCapture(live.track) : null; } catch (e) { live.capture = null; }
    var caps = live.track.getCapabilities ? live.track.getCapabilities() : {};
    $('live-torch').hidden = !caps.torch;
    $('live-torch').setAttribute('aria-pressed', 'false');
    try { if (navigator.wakeLock) live.lock = await navigator.wakeLock.request('screen'); } catch (e) { live.lock = null; }
    $('live-shutter').focus();
  }

  function closeLive() {
    if (live.stream) live.stream.getTracks().forEach(function (t) { t.stop(); });
    live.stream = live.track = live.capture = null;
    if (live.lock) { live.lock.release().catch(function () {}); live.lock = null; }
    $('live-video').srcObject = null;
    $('live').hidden = true;
    document.body.style.overflow = '';
    if (live.count) toast(live.count === 1 ? '1 foto agregada.' : live.count + ' fotos agregadas.');
    $('btn-live').focus();
  }

  function grabFrame() {
    var v = $('live-video');
    var c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    return canvasBlob(c, 'image/jpeg', 0.95);
  }

  async function takeShot() {
    var v = $('live-video');
    if (live.capture) {
      try {
        var photo = await live.capture.takePhoto();
        // Algunos equipos entregan la foto sin girar: si la orientación no
        // coincide con lo que se ve en pantalla, se usa el cuadro del video.
        var bmp = await decodeBlob(photo);
        var d = dims(bmp);
        releaseSrc(bmp);
        if ((d.w > d.h) === (v.videoWidth > v.videoHeight)) return photo;
      } catch (e) { /* sigue con el cuadro del video */ }
    }
    return grabFrame();
  }

  $('live-shutter').addEventListener('click', async function () {
    if (live.busy || !live.stream) return;
    live.busy = true;
    var btn = this;
    btn.disabled = true;
    var flash = $('live-flash');
    flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on');
    try {
      var blob = await takeShot();
      live.count++;
      $('live-count').textContent = live.count;
      if (live.lastUrl) URL.revokeObjectURL(live.lastUrl);
      live.lastUrl = URL.createObjectURL(blob);
      $('live-thumb').src = live.lastUrl;
      $('live-thumb').hidden = false;
      enqueue(function () { return importImage(blob, {}); });
    } catch (e) {
      toast('No se pudo tomar la foto. Intenta de nuevo.');
    }
    live.busy = false;
    btn.disabled = false;
  });
  $('live-close').addEventListener('click', closeLive);
  $('live-torch').addEventListener('click', async function () {
    if (!live.track) return;
    var on = this.getAttribute('aria-pressed') !== 'true';
    try {
      await live.track.applyConstraints({ advanced: [{ torch: on }] });
      this.setAttribute('aria-pressed', String(on));
    } catch (e) { toast('La linterna no responde en este teléfono.'); }
  });
  document.addEventListener('visibilitychange', async function () {
    if (document.visibilityState === 'visible' && live.stream && !live.lock && navigator.wakeLock) {
      try { live.lock = await navigator.wakeLock.request('screen'); } catch (e) { /* nada */ }
    }
  });

  /* ---------- Páginas a incluir (una línea = un PDF) ---------- */
  // "1-10" rango, "20" página suelta, separados por comas; cada línea del
  // cuadro de texto es un grupo que se exporta como un PDF aparte.
  function parsePageList(spec, total) {
    var pages = [], seen = new Set();
    spec.split(',').forEach(function (raw) {
      var p = raw.trim();
      if (!p) return;
      var m = p.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        if (a > b) { var t = a; a = b; b = t; }
        if (a < 1 || b > total) throw new Error('La página ' + (a < 1 ? a : b) + ' no existe (el libro tiene ' + total + ').');
        for (var n = a; n <= b; n++) if (!seen.has(n)) { seen.add(n); pages.push(n); }
      } else if (/^\d+$/.test(p)) {
        var n2 = parseInt(p, 10);
        if (n2 < 1 || n2 > total) throw new Error('La página ' + n2 + ' no existe (el libro tiene ' + total + ').');
        if (!seen.has(n2)) { seen.add(n2); pages.push(n2); }
      } else {
        throw new Error('No entiendo "' + p + '". Usa números y rangos, como 1-10 o 20.');
      }
    });
    if (!pages.length) throw new Error('Escribe al menos una página.');
    pages.sort(function (a, b) { return a - b; });
    return pages;
  }

  function compactRanges(nums) {
    if (!nums.length) return '';
    var out = [], start = nums[0], prev = nums[0];
    for (var i = 1; i <= nums.length; i++) {
      var n = nums[i];
      if (n === prev + 1) { prev = n; continue; }
      out.push(start === prev ? String(start) : start + '-' + prev);
      start = prev = n;
    }
    return out.join(', ');
  }

  function readPageGroups() {
    var total = totals();
    if (pdfScope !== 'custom') {
      var all = []; for (var i = 1; i <= total; i++) all.push(i);
      return { groups: [{ pages: all, label: null }] };
    }
    var lines = $('pdf-pages').value.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) return { error: 'Escribe al menos una línea con páginas.' };
    var groups = [];
    for (var li = 0; li < lines.length; li++) {
      try {
        var pages = parsePageList(lines[li], total);
        groups.push({ pages: pages, label: compactRanges(pages) });
      } catch (err) {
        return { error: (lines.length > 1 ? 'Línea ' + (li + 1) + ': ' : '') + err.message };
      }
    }
    return { groups: groups };
  }

  /* ---------- Exportar ---------- */
  var pdfResults = [];
  var pdfScope = 'all';
  var pagesValid = true;
  var sizeSeg = seg($('pdf-size'), settings.pdfSize, function (v) { settings.pdfSize = v; saveSettings(); resetResult(); });
  var qualSeg = seg($('pdf-quality'), settings.pdfQuality, function (v) { settings.pdfQuality = v; saveSettings(); refreshPagesUI(); resetResult(); });
  var scopeSeg = seg($('pdf-scope'), pdfScope, function (v) {
    pdfScope = v;
    $('pages-picker').hidden = v !== 'custom';
    if (v === 'custom' && !$('pdf-pages').value.trim()) $('pdf-pages').value = '1-' + totals();
    refreshPagesUI();
    resetResult();
  });
  $('pdf-pages').addEventListener('input', function () { refreshPagesUI(); resetResult(); });

  function defaultName() {
    var d = new Date();
    return 'Libro ' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function updateQualityNote() {
    var q = QUALITY[settings.pdfQuality], r = readPageGroups();
    var groups = r.groups || [{ pages: Array.from({ length: totals() }, function (_, i) { return i + 1; }) }];
    var pages = groups.reduce(function (s, g) { return s + g.pages.length; }, 0);
    var mb = pages * q.perPage * (settings.filter === 'bw' ? 0.6 : 1);
    var secs = pages * (settings.ocr ? 5 : 0.6);
    var time = secs < 60 ? 'menos de 1 minuto' : 'unos ' + Math.round(secs / 60) + ' min';
    var multi = groups.length > 1 ? ' en ' + groups.length + ' PDF' : '';
    $('quality-note').textContent = q.note + ' Unos ' + (mb < 1 ? mb.toFixed(1) : Math.round(mb)) + ' MB para ' + pages + (pages === 1 ? ' página' : ' páginas') + multi + ', ' + time + '.';
  }
  function refreshPagesUI() {
    var r = readPageGroups();
    var summary = $('pages-summary');
    if (r.error) {
      summary.textContent = r.error;
      summary.classList.add('field-note-error');
      pagesValid = false;
    } else {
      summary.classList.remove('field-note-error');
      pagesValid = true;
      if (pdfScope !== 'custom') summary.textContent = '';
      else if (r.groups.length === 1) summary.textContent = r.groups[0].pages.length + (r.groups[0].pages.length === 1 ? ' página seleccionada.' : ' páginas seleccionadas.');
      else summary.textContent = r.groups.length + ' PDF: ' + r.groups.map(function (g) { return g.pages.length + ' pág.'; }).join(' · ') + '.';
    }
    updateQualityNote();
    $('pdf-build').disabled = buildingPdf || !pagesValid;
  }
  function resetResult() { pdfResults = []; $('pdf-result').hidden = true; $('pdf-result-list').innerHTML = ''; $('pdf-build').hidden = false; }

  function openSheet(prefillPages) {
    $('pdf-name').value = settings.pdfName || defaultName();
    sizeSeg.set(settings.pdfSize);
    qualSeg.set(settings.pdfQuality);
    $('pdf-ocr').checked = !!settings.ocr;
    pdfScope = prefillPages ? 'custom' : 'all';
    scopeSeg.set(pdfScope);
    $('pages-picker').hidden = pdfScope !== 'custom';
    $('pdf-pages').value = prefillPages || '';
    resetResult();
    refreshPagesUI();
    $('pdf-progress').hidden = true;
    $('sheet').hidden = false;
    $('pdf-build').focus();
  }
  function closeSheet() { if (buildingPdf) return; $('sheet').hidden = true; $('btn-export').focus(); }

  $('btn-export').addEventListener('click', function () { openSheet(); });
  $('sheet-close').addEventListener('click', closeSheet);
  $('sheet').addEventListener('click', function (e) { if (e.target === this) closeSheet(); });
  $('pdf-ocr').addEventListener('change', function () { settings.ocr = this.checked; saveSettings(); refreshPagesUI(); resetResult(); });
  $('pdf-name').addEventListener('input', function () { settings.pdfName = this.value.trim(); saveSettings(); resetResult(); });

  function isFullBookRange(pages, total) { return pages.length === total; }

  var buildingPdf = false;
  $('export-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (buildingPdf || !spreads.length) return;
    var spec = readPageGroups();
    if (spec.error) { toast(spec.error); return; }
    var groups = spec.groups;
    buildingPdf = true;
    var q = QUALITY[settings.pdfQuality];
    var totalBookPages = totals();
    var allJobs = [];
    spreads.forEach(function (rec) { for (var i = 0; i < pagesOf(rec); i++) allJobs.push({ rec: rec, i: i }); });
    var cache = { id: null, pages: null };
    $('pdf-build').disabled = true;
    $('pdf-progress').hidden = false;
    $('pdf-result').hidden = true;
    $('pdf-result-list').innerHTML = '';
    $('pdf-meter').style.width = '0';
    var baseName = ($('pdf-name').value.trim() || defaultName()).replace(/[\\/:*?"<>|]+/g, '-');
    var results = [];
    try {
      var useOcr = settings.ocr && window.LibroosOcr;
      if (useOcr) {
        $('pdf-progress-text').textContent = 'Cargando el lector de texto…';
        try { await window.LibroosOcr.warmUp(); } catch (err) {
          useOcr = false;
          toast('No se pudo cargar el lector de texto; el PDF se crea sin OCR.');
        }
      }
      var totalGroupPages = groups.reduce(function (s, g) { return s + g.pages.length; }, 0);
      var doneSoFar = 0;
      for (var gi = 0; gi < groups.length; gi++) {
        var group = groups[gi];
        var jobs = group.pages.map(function (n) { return allJobs[n - 1]; });
        var needsSuffix = groups.length > 1 || (pdfScope === 'custom' && !isFullBookRange(group.pages, totalBookPages));
        var labelSrc = group.label || compactRanges(group.pages);
        var labelForName = labelSrc.length > 24 ? (group.pages.length + 'pag') : labelSrc.replace(/,\s*/g, '_');
        var gName = baseName + (needsSuffix ? ' (p' + labelForName + ')' : '');
        var prefix = groups.length > 1 ? 'PDF ' + (gi + 1) + ' de ' + groups.length + ' — ' : '';
        var result = await Pdf.build(async function (k) {
          var job = jobs[k];
          if (cache.id !== job.rec.id) {
            var src = await decodeBlob(job.rec.blob);
            var full = drawRotated(src, job.rec.rotation, WORK_MAX);
            releaseSrc(src);
            cache = { id: job.rec.id, pages: renderPages(full, job.rec, q.max, filterOf(job.rec)) };
            full.width = full.height = 0;
          }
          return cache.pages[job.i];
        }, {
          count: jobs.length, size: settings.pdfSize, jpegQuality: q.q, title: gName,
          ocr: useOcr ? function (canvas, k) {
            $('pdf-progress-text').textContent = prefix + 'Leyendo el texto de la página ' + (k + 1) + ' de ' + jobs.length + '…';
            return window.LibroosOcr.recognize(canvas).catch(function (err) { console.error(err); return null; });
          } : null
        }, function (done, total) {
          $('pdf-meter').style.width = ((doneSoFar + done) / totalGroupPages * 100) + '%';
          $('pdf-progress-text').textContent = prefix + (done < total ? 'Página ' + (done + 1) + ' de ' + total + '…' : 'Armando el archivo…');
        });
        doneSoFar += jobs.length;
        results.push({ blob: result.blob, text: result.text, file: gName + '.pdf', pages: jobs.length });
      }
      if (useOcr) window.LibroosOcr.terminate();
      pdfResults = results;
      renderResults();
      $('pdf-result').hidden = false;
      $('pdf-build').hidden = true;
      var firstBtn = $('pdf-result-list').querySelector('button');
      if (firstBtn) firstBtn.focus();
    } catch (err) {
      console.error(err);
      toast(err.message || 'No se pudo crear el PDF.');
    } finally {
      buildingPdf = false;
      $('pdf-build').disabled = !pagesValid;
      $('pdf-progress').hidden = true;
    }
  });

  function renderResults() {
    var box = $('pdf-result-list');
    box.innerHTML = '';
    if (pdfResults.length > 1) {
      var head = document.createElement('div');
      head.className = 'result-all';
      head.innerHTML = '<p>' + pdfResults.length + ' archivos PDF listos.</p><button type="button" class="btn btn-primary btn-block" data-act="dl-all">Descargar todos</button>';
      box.appendChild(head);
    }
    pdfResults.forEach(function (r, i) {
      var mb = r.blob.size / 1048576;
      var card = document.createElement('div');
      card.className = 'result-card';
      card.innerHTML =
        '<p>' + r.file + ' — ' + r.pages + (r.pages === 1 ? ' página, ' : ' páginas, ') + (mb < 1 ? mb.toFixed(2) : mb.toFixed(1)) + ' MB' + (r.text ? ', con texto buscable' : '') + '.</p>' +
        '<div class="sheet-actions">' +
        '<button type="button" class="btn btn-primary" data-act="dl" data-i="' + i + '">Descargar PDF</button>' +
        (r.text ? '<button type="button" class="btn" data-act="txt" data-i="' + i + '">Descargar texto</button>' : '') +
        '<button type="button" class="btn" data-act="share" data-i="' + i + '" hidden>Compartir</button>' +
        '</div>';
      box.appendChild(card);
      if (navigator.canShare) {
        var file = new File([r.blob], r.file, { type: 'application/pdf' });
        if (navigator.canShare({ files: [file] })) card.querySelector('[data-act="share"]').hidden = false;
      }
    });
  }

  async function saveFile(blob, filename) {
    // Dentro de claude.ai la descarga pasa por el permiso del visor.
    if (window.claude && window.claude.use) {
      var downloads = await window.claude.use('downloads').catch(function () { return null; });
      if (downloads) {
        try { await downloads.save({ filename: filename, data: blob }); return true; } catch (e) {
          if (e && e.code === 'declined') return false;
        }
      }
    }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 10000);
    return true;
  }

  $('pdf-result-list').addEventListener('click', async function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'dl-all') {
      for (var i = 0; i < pdfResults.length; i++) {
        await saveFile(pdfResults[i].blob, pdfResults[i].file);
        await new Promise(function (r) { setTimeout(r, 350); });
      }
      toast('Descargando ' + pdfResults.length + ' archivos.');
      return;
    }
    var r = pdfResults[+btn.dataset.i];
    if (!r) return;
    if (btn.dataset.act === 'dl') {
      var ok = await saveFile(r.blob, r.file);
      if (ok) toast('Descargando ' + r.file);
    } else if (btn.dataset.act === 'txt') {
      var fname = r.file.replace(/\.pdf$/, '.txt');
      var ok2 = await saveFile(new Blob([r.text], { type: 'text/plain;charset=utf-8' }), fname);
      if (ok2) toast('Descargando ' + fname);
    } else if (btn.dataset.act === 'share') {
      var file = new File([r.blob], r.file, { type: 'application/pdf' });
      navigator.share({ files: [file], title: r.file }).catch(function () { /* cancelado */ });
    }
  });

  /* ---------- Aviso ---------- */
  var toastTimer = null;
  function toast(msg, actionLabel, action) {
    var el = $('toast'), btn = $('toast-action');
    $('toast-text').textContent = msg;
    btn.hidden = !actionLabel;
    btn.textContent = actionLabel || '';
    btn.onclick = action ? function () { el.hidden = true; action(); } : null;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, Math.max(actionLabel ? 6000 : 3500, msg.length * 70));
  }

  /* ---------- Teclado ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('live').hidden) closeLive();
    else if (!$('editor').hidden) closeEditor();
    else if (!$('sheet').hidden) closeSheet();
  });

  /* ---------- Ejemplo ---------- */
  async function loadSample() {
    if (!window.LibroosSample) return;
    var c = window.LibroosSample.makeCanvas();
    var blob = await canvasBlob(c, 'image/jpeg', 0.9);
    await enqueue(function () { return importImage(blob, { mode: 'double', sample: true }); });
  }
  $('btn-sample').addEventListener('click', loadSample);

  /* ---------- Inicio ---------- */
  Store.all().then(function (rows) {
    spreads = rows;
    renderList();
    if (!rows.length && !settings.sampleShown) {
      settings.sampleShown = true;
      saveSettings();
      loadSample();
    }
  });

  if ('serviceWorker' in navigator && /^https:|^http:\/\/localhost/.test(location.href)) {
    try { navigator.serviceWorker.register('sw.js').catch(function () {}); } catch (e) { /* no disponible */ }
  }
})();
