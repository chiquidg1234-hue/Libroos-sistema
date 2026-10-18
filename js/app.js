/*
 * Libroos · interfaz
 * Captura (cámara continua, cámara nativa, galería) → lista de fotos →
 * editor de puntos (esquinas + lomo) → PDF descargable. Más la pantalla
 * para apoyar el proyecto con Google Play.
 */
(function () {
  'use strict';

  var Img = window.LibroosImaging, Store = window.LibroosStore, Pdf = window.LibroosPdf;

  var WORK_MAX = 3600;      // lado mayor de la foto guardada
  var PREVIEW_MAX = 1400;   // lado mayor de la vista previa (editor y miniaturas)
  var THUMB_MAX = 420;      // lado mayor de cada miniatura de página
  var QUALITY = {
    high: { max: 2600, q: 0.9, perPage: 0.55, note: 'Alta: para imprimir o hacer zoom en letra chica.' },
    medium: { max: 1800, q: 0.82, perPage: 0.28, note: 'Media: lectura cómoda en celular o computadora.' },
    low: { max: 1200, q: 0.7, perPage: 0.12, note: 'Liviana: para mandar por WhatsApp o correo.' }
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

  /* ---------- Capas y botón "atrás" de Android ----------
   * Cada pantalla que se abre encima (editor, cámara, selección, hojas)
   * agrega una entrada al historial; el botón atrás del teléfono la cierra
   * en vez de salir de la app. */
  var layers = [];
  var historyOk = true;
  function pushLayer(name, close) {
    layers.push({ name: name, close: close });
    try { history.pushState({ libroos: name }, ''); } catch (e) { historyOk = false; }
    syncLock();
  }
  function topLayer() { return layers[layers.length - 1]; }
  // Cierra la capa de arriba si es `name`. Devuelve false si no estaba abierta.
  function popLayer(name) {
    var top = topLayer();
    if (!top || top.name !== name) return false;
    if (historyOk) { history.back(); return true; } // popstate hace el cierre
    layers.pop(); top.close(); syncLock();
    return true;
  }
  // Cambia la capa de arriba por otra sin tocar el historial (para pasar
  // directo de una pantalla a otra sin que el "atrás" pendiente cierre la nueva).
  function swapLayer(name, newName, newClose) {
    var top = topLayer();
    if (!top || top.name !== name) return false;
    top.close();
    layers[layers.length - 1] = { name: newName, close: newClose };
    syncLock();
    return true;
  }
  window.addEventListener('popstate', function () {
    var top = layers.pop();
    // Una capa que no se puede cerrar ahora (PDF en proceso) devuelve false.
    if (top && top.close() === false) {
      layers.push(top);
      try { history.pushState({ libroos: top.name }, ''); } catch (e) { /* nada */ }
    }
    syncLock();
  });
  function syncLock() {
    var open = !$('editor').hidden || !$('live').hidden || !$('sheet').hidden || !$('support').hidden;
    document.body.classList.toggle('locked', open);
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
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('No se pudo abrir una imagen. Prueba con una foto JPG o PNG.')); };
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

  /* Fotos guardadas antes del lomo horizontal traen st/sb en vez de sl/sr. */
  function migratePoints(rec) {
    var p = rec.pts;
    if (!p || !p.tl || !p.tr || !p.br || !p.bl) { rec.pts = Img.fullFramePoints(); return true; }
    if (p.sl && p.sr) return false;
    p.sl = [(p.tl[0] + p.bl[0]) / 2, (p.tl[1] + p.bl[1]) / 2];
    p.sr = [(p.tr[0] + p.br[0]) / 2, (p.tr[1] + p.br[1]) / 2];
    delete p.st; delete p.sb;
    return true;
  }

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
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  /* ---------- Estado ---------- */
  var spreads = [];
  var chain = Promise.resolve();
  function enqueue(fn) {
    chain = chain.then(fn).catch(function (e) { console.error(e); toast(e.message || 'Algo salió mal con una foto.'); });
    return chain;
  }

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
    if (!files.length) { if (fileList && fileList.length) toast('Esos archivos no son fotos. Elige imágenes JPG o PNG.'); return; }
    removeSamples();
    var done = 0, failed = 0, line = $('import-progress');
    line.hidden = false;
    line.textContent = 'Procesando 0 de ' + files.length + '…';
    files.forEach(function (f) {
      chain = chain.then(function () {
        return importImage(f, {}).catch(function (e) { console.error(e); failed++; });
      }).then(function () {
        done++;
        line.textContent = 'Procesando ' + done + ' de ' + files.length + '…';
        if (done < files.length) return;
        line.hidden = true;
        var ok = files.length - failed;
        if (!failed) toast(ok === 1 ? 'Foto agregada.' : ok + ' fotos agregadas.');
        else toast(ok + ' de ' + files.length + ' fotos agregadas. ' + plural(failed, 'no se pudo abrir', 'no se pudieron abrir') + '.');
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
    var btn = document.querySelector('.spread[data-id="' + rec.id + '"] .spread-open');
    var urls = thumbCache.get(thumbKey(rec));
    if (!btn || !urls) return;
    btn.textContent = '';
    urls.forEach(function (u, i) {
      var im = document.createElement('img');
      im.src = u; im.alt = '';
      btn.appendChild(im);
    });
  }

  /* ---------- Lista ---------- */
  var ICON = {
    up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  function totals() {
    return spreads.reduce(function (n, r) { return n + pagesOf(r); }, 0);
  }
  function firstPageOf(rec) {
    var page = 1;
    for (var i = 0; i < spreads.length && spreads[i] !== rec; i++) page += pagesOf(spreads[i]);
    return page;
  }
  function pageLabel(first, n) { return n === 1 ? 'pág. ' + first : 'págs. ' + first + '–' + (first + 1); }

  /* ---------- Selección de fotos ---------- */
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
    $('select-count').textContent = n === 1 ? '1 foto' : n + ' fotos';
    $('select-pages').textContent = n ? 'págs. ' + compactRanges(pageNumbersForSelection()) : 'Toca las fotos';
    $('sel-delete').disabled = !n;
    $('sel-pdf').disabled = !n;
    $('sel-up').disabled = !n || selected.has(spreads[0] && spreads[0].id);
    $('sel-down').disabled = !n || selected.has(spreads[spreads.length - 1] && spreads[spreads.length - 1].id);
    var all = n > 0 && n === spreads.length;
    $('sel-all').textContent = all ? 'Ninguna' : 'Todas';
  }

  function toggleSelect(id) {
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    updateSelectionUI();
  }

  function applySelectMode(on) {
    selectMode = on;
    if (!on) selected.clear();
    $('btn-select').textContent = on ? 'Listo' : 'Seleccionar';
    $('btn-select').setAttribute('aria-pressed', String(on));
    $('select-bar').hidden = !on;
    $('main-bar').hidden = on;
    document.querySelector('.app').classList.toggle('selecting', on);
    renderList();
  }
  function enterSelectMode() {
    if (selectMode) return;
    applySelectMode(true);
    pushLayer('select', function () { applySelectMode(false); });
  }
  function exitSelectMode() {
    if (!selectMode) return;
    if (!popLayer('select')) applySelectMode(false);
  }

  function renderList() {
    if (!spreads.length && selectMode) exitSelectMode();
    var ol = $('spreads');
    ol.textContent = '';
    ol.classList.toggle('selecting', selectMode);
    var page = 1;
    spreads.forEach(function (rec, idx) {
      var n = pagesOf(rec);
      var li = document.createElement('li');
      li.className = 'spread' + (selected.has(rec.id) ? ' selected' : '');
      li.dataset.id = rec.id;
      var label = pageLabel(page, n);
      li.innerHTML =
        '<button type="button" class="spread-open" aria-label="' + (selectMode ? 'Seleccionar' : 'Ajustar') + ' foto ' + (idx + 1) + ', ' + label + '"></button>' +
        (selectMode ? '<label class="spread-check"><input type="checkbox"' + (selected.has(rec.id) ? ' checked' : '') + '><span class="sr-only">Seleccionar foto ' + (idx + 1) + '</span>' + ICON.check + '</label>' : '') +
        '<div class="spread-meta"><span class="pg">' + label + '</span>' +
        (rec.sample ? '<span class="chip chip-warn">Ejemplo</span>' : '') +
        (rec.filter ? '<span class="chip">' + filterName(rec.filter) + '</span>' : '') +
        '<div class="spread-actions">' +
        '<button type="button" class="icon-btn" data-act="up" aria-label="Mover foto ' + (idx + 1) + ' antes"' + (idx === 0 ? ' disabled' : '') + '>' + ICON.up + '</button>' +
        '<button type="button" class="icon-btn" data-act="down" aria-label="Mover foto ' + (idx + 1) + ' después"' + (idx === spreads.length - 1 ? ' disabled' : '') + '>' + ICON.down + '</button>' +
        '<button type="button" class="icon-btn" data-act="del" aria-label="Eliminar foto ' + (idx + 1) + '">' + ICON.trash + '</button>' +
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
    $('stat-photos').textContent = plural(spreads.length, 'foto', 'fotos');
    $('bar-pages').textContent = pages;
    $('bar-photos').textContent = pages === 1 ? 'página lista' : 'páginas listas';
    $('btn-export').disabled = !pages;
    $('empty').hidden = spreads.length > 0;
    $('book-foot').hidden = spreads.length === 0 || selectMode;
    $('btn-select').hidden = spreads.length === 0;
    if (selectMode) updateSelectionUI();
  }

  function filterName(f) { return { color: 'Escáner', gray: 'Grises', bw: 'B/N', original: 'Original' }[f] || f; }

  function renumber() {
    spreads.forEach(function (r, i) {
      if (r.order !== i + 1) { r.order = i + 1; persist(r); }
    });
  }

  function move(id, delta) {
    var i = spreads.findIndex(function (r) { return r.id === id; }), j = i + delta;
    if (i < 0 || j < 0 || j >= spreads.length) return;
    var a = spreads[i];
    spreads[i] = spreads[j]; spreads[j] = a;
    renumber();
    renderList();
    var btn = document.querySelector('.spread[data-id="' + id + '"] [data-act="' + (delta < 0 ? 'up' : 'down') + '"]');
    if (btn && !btn.disabled) btn.focus();
    else { var other = document.querySelector('.spread[data-id="' + id + '"] [data-act="' + (delta < 0 ? 'down' : 'up') + '"]'); if (other) other.focus(); }
  }

  // Mueve juntas todas las fotos seleccionadas un lugar, manteniendo su orden.
  function moveSelected(delta) {
    if (!selected.size) return;
    var arr = spreads.slice();
    if (delta < 0) {
      for (var i = 1; i < arr.length; i++) {
        if (selected.has(arr[i].id) && !selected.has(arr[i - 1].id)) { var t = arr[i - 1]; arr[i - 1] = arr[i]; arr[i] = t; }
      }
    } else {
      for (var k = arr.length - 2; k >= 0; k--) {
        if (selected.has(arr[k].id) && !selected.has(arr[k + 1].id)) { var t2 = arr[k + 1]; arr[k + 1] = arr[k]; arr[k] = t2; }
      }
    }
    spreads = arr;
    renumber();
    renderList();
  }

  function removeSpreads(ids) {
    var removed = spreads.filter(function (r) { return ids.indexOf(r.id) >= 0; });
    if (!removed.length) return;
    spreads = spreads.filter(function (r) { return ids.indexOf(r.id) < 0; });
    removed.forEach(function (r) { Store.remove(r.id); selected.delete(r.id); });
    renderList();
    toast(removed.length === 1 ? 'Foto eliminada.' : removed.length + ' fotos eliminadas.', 'Deshacer', function () {
      removed.forEach(function (r) { if (spreads.indexOf(r) < 0) { spreads.push(r); persist(r); } });
      spreads.sort(function (a, b) { return a.order - b.order; });
      renderList();
    });
  }

  $('spreads').addEventListener('click', function (e) {
    var li = e.target.closest('.spread');
    if (!li) return;
    if (selectMode) {
      if (e.target.closest('.spread-check')) return; // el checkbox maneja su propio cambio
      toggleSelect(li.dataset.id);
      return;
    }
    var act = e.target.closest('[data-act]');
    if (act) {
      if (act.dataset.act === 'up') move(li.dataset.id, -1);
      else if (act.dataset.act === 'down') move(li.dataset.id, 1);
      else removeSpreads([li.dataset.id]);
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

  $('btn-select').addEventListener('click', function () { if (selectMode) exitSelectMode(); else enterSelectMode(); });
  $('sel-all').addEventListener('click', function () {
    if (selected.size === spreads.length) selected.clear();
    else spreads.forEach(function (r) { selected.add(r.id); });
    updateSelectionUI();
  });
  $('sel-up').addEventListener('click', function () { moveSelected(-1); });
  $('sel-down').addEventListener('click', function () { moveSelected(1); });
  $('sel-delete').addEventListener('click', function () {
    if (!selected.size) return;
    var ids = Array.from(selected);
    exitSelectMode();
    removeSpreads(ids);
  });
  $('sel-pdf').addEventListener('click', function () {
    if (!selected.size) return;
    var spec = compactRanges(pageNumbersForSelection());
    // Pasa de la selección a la hoja reusando la misma entrada del historial.
    if (swapLayer('select', 'sheet', hideSheet)) showSheet(spec);
    else { applySelectMode(false); openSheet(spec); }
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
    function set(v) {
      buttons.forEach(function (b) {
        var on = b.dataset.value === v;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      });
    }
    set(value);
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      set(b.dataset.value);
      onChange(b.dataset.value);
    });
    // Flechas para moverse entre opciones, como un grupo de radios.
    el.addEventListener('keydown', function (e) {
      var d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      var i = buttons.indexOf(document.activeElement);
      var next = buttons[(i + d + buttons.length) % buttons.length];
      next.focus(); next.click();
    });
    return { set: set };
  }

  var captureSeg = seg($('capture-mode'), settings.captureMode, function (v) {
    settings.captureMode = v; saveSettings(); liveSeg.set(v); $('live').classList.toggle('single', v === 'single');
  });
  seg($('global-filter'), settings.filter, function (v) {
    settings.filter = v; saveSettings(); renderList();
  });

  /* ---------- Nombre del libro ---------- */
  function bookName() { return settings.pdfName || ''; }
  $('book-name').value = bookName();
  $('book-name').addEventListener('input', function () {
    settings.pdfName = this.value.trim(); saveSettings();
  });
  $('book-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') this.blur(); });

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
    updateEditorTitle();
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

  function updateEditorTitle() {
    if (!ed) return;
    var idx = spreads.indexOf(ed.rec);
    $('ed-title').textContent = 'Foto ' + (idx + 1) + ' de ' + spreads.length;
    $('ed-sub').textContent = pageLabel(firstPageOf(ed.rec), pagesOf(ed.rec));
  }

  async function openEditor(id) {
    var rec = spreads.find(function (r) { return r.id === id; });
    if (!rec || ed) return;
    ed = { rec: rec, src: null, drag: null, opener: document.activeElement };
    updateEditorTitle();
    edModeSeg.set(rec.mode);
    $('ed-filter').value = rec.filter || '';
    $('ed-preview').textContent = '';
    $('editor').hidden = false;
    pushLayer('editor', hideEditor);
    try {
      await loadEditorSource();
      renderEditorPreview();
    } catch (e) {
      console.error(e);
      toast('No se pudo abrir esta foto.');
    }
    $('ed-done').focus();
  }

  function hideEditor() {
    if (!ed) return;
    var opener = ed.opener;
    ed = null;
    loupe.hidden = true;
    $('editor').hidden = true;
    syncLock();
    renderList();
    if (opener && opener.focus && document.contains(opener)) opener.focus();
  }
  function closeEditor() { if (!popLayer('editor')) hideEditor(); }

  function layoutEditor() {
    if (!ed || !ed.src) return;
    var sw = stage.clientWidth - 24, sh = stage.clientHeight - 24;
    if (sw <= 0 || sh <= 0) return;
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
    var html = '';
    Img.pageQuads(ed.rec.mode, p).forEach(function (q) {
      html += '<polygon class="quad" points="' + q.map(function (v) { return (v[0] * W).toFixed(1) + ',' + (v[1] * H).toFixed(1); }).join(' ') + '"/>';
    });
    var keys = ed.rec.mode === 'single' ? HANDLE_KEYS.slice(0, 4) : HANDLE_KEYS;
    if (ed.rec.mode !== 'single') {
      html += '<line class="spine" x1="' + p.sl[0] * W + '" y1="' + p.sl[1] * H + '" x2="' + p.sr[0] * W + '" y2="' + p.sr[1] * H + '"/>';
    }
    var names = { tl: 'esquina superior izquierda', tr: 'esquina superior derecha', br: 'esquina inferior derecha', bl: 'esquina inferior izquierda', sl: 'lomo, lado izquierdo', sr: 'lomo, lado derecho' };
    keys.forEach(function (key) {
      var x = p[key][0] * W, y = p[key][1] * H;
      var spine = key === 'sl' || key === 'sr';
      html += '<circle class="handle' + (spine ? ' handle-spine' : '') + '" cx="' + x + '" cy="' + y + '" r="' + (10 * k) + '"/>';
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
    $('ed-hint').hidden = true;
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
    ctx.strokeStyle = '#e3b341'; ctx.lineWidth = 2;
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
    var first = firstPageOf(ed.rec);
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
    removeSpreads([id]);
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
    if (live.stream) return;
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
    live.track = live.stream.getVideoTracks()[0];
    live.count = 0;
    $('live-count').textContent = '0';
    $('live-thumb').hidden = true;
    $('live').classList.toggle('single', settings.captureMode === 'single');
    $('live').hidden = false;
    pushLayer('live', hideLive);
    var video = $('live-video');
    video.srcObject = live.stream;
    try { await video.play(); } catch (e) { /* autoplay silencioso: ya está en marcha */ }
    try { live.capture = window.ImageCapture ? new ImageCapture(live.track) : null; } catch (e) { live.capture = null; }
    var caps = live.track && live.track.getCapabilities ? live.track.getCapabilities() : {};
    $('live-torch').hidden = !caps.torch;
    $('live-torch').setAttribute('aria-pressed', 'false');
    try { if (navigator.wakeLock) live.lock = await navigator.wakeLock.request('screen'); } catch (e) { live.lock = null; }
    $('live-shutter').focus();
  }

  function hideLive() {
    if (live.stream) live.stream.getTracks().forEach(function (t) { t.stop(); });
    live.stream = live.track = live.capture = null;
    if (live.lock) { live.lock.release().catch(function () {}); live.lock = null; }
    if (live.lastUrl) { URL.revokeObjectURL(live.lastUrl); live.lastUrl = null; }
    $('live-video').srcObject = null;
    $('live').hidden = true;
    syncLock();
    if (live.count) toast(live.count === 1 ? '1 foto agregada.' : live.count + ' fotos agregadas.');
    if (!$('btn-live').hidden) $('btn-live').focus();
  }
  function closeLive() { if (!popLayer('live')) hideLive(); }

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
      if (!live.count) removeSamples();
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
    spec.split(/[,;]/).forEach(function (raw) {
      var p = raw.trim();
      if (!p) return;
      var m = p.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
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
        throw new Error('No entiendo "' + p.slice(0, 20) + '". Usa números y rangos, como 1-10 o 20.');
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
    if (lines.length > 50) return { error: 'Son demasiados PDF a la vez. Prueba con 50 o menos.' };
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
  var buildingPdf = false;
  var sizeSeg = seg($('pdf-size'), settings.pdfSize, function (v) { settings.pdfSize = v; saveSettings(); });
  var qualSeg = seg($('pdf-quality'), settings.pdfQuality, function (v) { settings.pdfQuality = v; saveSettings(); refreshPagesUI(); });
  var scopeSeg = seg($('pdf-scope'), pdfScope, function (v) {
    pdfScope = v;
    $('pages-picker').hidden = v !== 'custom';
    if (v === 'custom' && !$('pdf-pages').value.trim()) $('pdf-pages').value = '1-' + totals();
    refreshPagesUI();
    if (v === 'custom') $('pdf-pages').focus();
  });
  $('pdf-pages').addEventListener('input', refreshPagesUI);

  function defaultName() {
    var d = new Date();
    return 'Libro ' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function safeName(name) {
    return (name || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 80) || defaultName();
  }
  function estimate(pages) {
    var secs = pages * (settings.ocr ? 5 : 0.6);
    return secs < 60 ? 'menos de 1 minuto' : 'unos ' + Math.round(secs / 60) + ' min';
  }
  function updateQualityNote() {
    var q = QUALITY[settings.pdfQuality], r = readPageGroups();
    var pages = r.groups ? r.groups.reduce(function (s, g) { return s + g.pages.length; }, 0) : totals();
    var mb = pages * q.perPage * (settings.filter === 'bw' ? 0.6 : 1);
    $('quality-note').textContent = q.note + ' Unos ' + (mb < 1 ? mb.toFixed(1) : Math.round(mb)) + ' MB en total.';
  }
  function refreshPagesUI() {
    var r = readPageGroups();
    var summary = $('pages-summary'), chips = $('group-chips');
    chips.textContent = '';
    if (r.error) {
      summary.textContent = r.error;
      summary.classList.add('field-note-error');
      pagesValid = false;
      $('build-summary').textContent = '';
      $('pdf-build').textContent = 'Crear PDF';
    } else {
      summary.classList.remove('field-note-error');
      summary.textContent = '';
      pagesValid = true;
      var n = r.groups.length;
      var pages = r.groups.reduce(function (s, g) { return s + g.pages.length; }, 0);
      if (pdfScope === 'custom') {
        r.groups.forEach(function (g, i) {
          var chip = document.createElement('span');
          chip.className = 'group-chip';
          chip.textContent = (n > 1 ? 'PDF ' + (i + 1) + ' · ' : '') + plural(g.pages.length, 'pág.', 'págs.');
          chips.appendChild(chip);
        });
      }
      $('build-summary').textContent = (n > 1 ? n + ' PDF · ' : '') + plural(pages, 'página', 'páginas') + ' · ' + estimate(pages);
      $('pdf-build').textContent = n > 1 ? 'Crear ' + n + ' PDF' : 'Crear PDF';
    }
    updateQualityNote();
    $('pdf-build').disabled = buildingPdf || !pagesValid;
  }
  function showOptions(on) {
    $('sheet-options').hidden = !on;
    $('build-row').hidden = !on;
    $('pdf-result').hidden = on;
  }
  function resetResult() { pdfResults = []; $('pdf-result-list').textContent = ''; showOptions(true); }

  function showSheet(prefillPages) {
    $('pdf-name').value = bookName() || defaultName();
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
    syncLock();
    $('pdf-build').focus();
  }
  function hideSheet() {
    if (buildingPdf) { toast('Espera a que termine el PDF.'); return false; }
    $('sheet').hidden = true;
    syncLock();
    var b = $('btn-export'); if (b && !b.disabled && !$('main-bar').hidden) b.focus();
  }
  function openSheet(prefillPages) {
    if (!$('sheet').hidden) return;
    showSheet(prefillPages);
    pushLayer('sheet', hideSheet);
  }
  function closeSheet() { if (buildingPdf) return; if (!popLayer('sheet')) hideSheet(); }

  $('btn-export').addEventListener('click', function () { openSheet(); });
  $('sheet-close').addEventListener('click', closeSheet);
  $('sheet').addEventListener('click', function (e) { if (e.target === this) closeSheet(); });
  $('pdf-ocr').addEventListener('change', function () { settings.ocr = this.checked; saveSettings(); refreshPagesUI(); });
  $('pdf-name').addEventListener('input', function () {
    settings.pdfName = this.value.trim(); saveSettings();
    $('book-name').value = settings.pdfName;
  });

  function isFullBookRange(pages, total) { return pages.length === total; }

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
    $('sheet-options').hidden = true;
    $('build-row').hidden = true;
    $('pdf-progress').hidden = false;
    $('pdf-result').hidden = true;
    $('pdf-meter').style.width = '0';
    $('pdf-progress-text').textContent = 'Preparando…';
    var baseName = safeName($('pdf-name').value.trim());
    var results = [];
    var useOcr = settings.ocr && window.LibroosOcr;
    var wakeLock = null;
    try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (err) { wakeLock = null; }
    try {
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
        var prefix = groups.length > 1 ? 'PDF ' + (gi + 1) + ' de ' + groups.length + ' · ' : '';
        var result = await Pdf.build(async function (k) {
          var job = jobs[k];
          if (cache.id !== job.rec.id) {
            var src = await decodeBlob(job.rec.blob);
            var full = drawRotated(src, job.rec.rotation, WORK_MAX);
            releaseSrc(src);
            cache = { id: job.rec.id, pages: renderPages(full, job.rec, q.max, filterOf(job.rec)) };
            full.width = full.height = 0;
          }
          // Copia: el PDF libera el canvas al terminar y la misma página
          // puede volver a usarse en otro PDF de este lote.
          var srcC = cache.pages[job.i], copy = document.createElement('canvas');
          copy.width = srcC.width; copy.height = srcC.height;
          copy.getContext('2d').drawImage(srcC, 0, 0);
          return copy;
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
      pdfResults = results;
      renderResults();
      showOptions(false);
      var firstBtn = $('pdf-result-list').querySelector('button');
      if (firstBtn) firstBtn.focus();
    } catch (err) {
      console.error(err);
      showOptions(true);
      toast(err.message || 'No se pudo crear el PDF.');
    } finally {
      if (useOcr && window.LibroosOcr) window.LibroosOcr.terminate();
      if (wakeLock) wakeLock.release().catch(function () {});
      buildingPdf = false;
      $('pdf-build').disabled = !pagesValid;
      $('pdf-progress').hidden = true;
    }
  });

  var SVG = {
    download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m-4-4l4 4 4-4M5 20h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="2.4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="6" r="2.4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="18" r="2.4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.2 10.9l7.6-3.8M8.2 13.1l7.6 3.8" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    text: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M5 10h14M5 14h10M5 18h7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function iconButton(cls, act, i, label, svg) {
    var b = el('button', cls);
    b.type = 'button'; b.dataset.act = act; if (i != null) b.dataset.i = i;
    b.setAttribute('aria-label', label);
    b.innerHTML = svg;
    return b;
  }
  function canShareFile(file) {
    try { return !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { return false; }
  }

  function renderResults() {
    var box = $('pdf-result-list');
    box.textContent = '';
    var n = pdfResults.length;
    var withText = pdfResults.some(function (r) { return r.text; });

    var hero = el('div', 'result-hero');
    var check = el('span', 'result-check'); check.innerHTML = SVG.check;
    hero.appendChild(check);
    hero.appendChild(el('h3', null, n > 1 ? n + ' PDF listos' : 'PDF listo'));
    hero.appendChild(el('p', null, (withText ? 'Con texto buscable. ' : '') + 'Se crearon en tu teléfono; nada se subió a internet.'));
    box.appendChild(hero);

    var all = el('button', 'btn btn-primary btn-block btn-big-cta');
    all.type = 'button'; all.dataset.act = n > 1 ? 'dl-all' : 'dl'; all.dataset.i = 0;
    all.innerHTML = SVG.download;
    all.appendChild(document.createTextNode(n > 1 ? 'Descargar los ' + n : 'Descargar PDF'));
    box.appendChild(all);

    var list = el('div', 'result-list');
    pdfResults.forEach(function (r, i) {
      var mb = r.blob.size / 1048576;
      var row = el('div', 'result-row');
      var icon = el('span', 'result-file'); icon.appendChild(el('span', null, 'PDF'));
      var info = el('span', 'result-info');
      info.appendChild(el('b', null, r.file));
      info.appendChild(el('span', null, plural(r.pages, 'pág.', 'págs.') + ' · ' + (mb < 1 ? mb.toFixed(2) : mb.toFixed(1)).replace('.', ',') + ' MB'));
      row.appendChild(icon); row.appendChild(info);
      if (r.text) row.appendChild(iconButton('row-btn', 'txt', i, 'Descargar el texto de ' + r.file, SVG.text));
      if (canShareFile(new File([r.blob], r.file, { type: 'application/pdf' }))) row.appendChild(iconButton('row-btn', 'share', i, 'Compartir ' + r.file, SVG.share));
      row.appendChild(iconButton('row-btn fill', 'dl', i, 'Descargar ' + r.file, SVG.download));
      list.appendChild(row);
    });
    box.appendChild(list);

    var again = el('button', 'btn btn-quiet btn-block', 'Hacer otro PDF');
    again.type = 'button'; again.dataset.act = 'again';
    box.appendChild(again);

    var promo = el('button', 'promo');
    promo.type = 'button'; promo.dataset.act = 'support';
    promo.innerHTML = SVG.heart;
    var pt = el('span'); pt.innerHTML = '¿Te ahorró tiempo? <b>Apoya a Libroos</b> para que siga gratis y sin anuncios.';
    promo.appendChild(pt);
    box.appendChild(promo);
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
    var act = btn.dataset.act;
    if (act === 'again') { resetResult(); refreshPagesUI(); $('pdf-build').focus(); return; }
    if (act === 'support') { openSupport(); return; }
    if (act === 'dl-all') {
      for (var i = 0; i < pdfResults.length; i++) {
        await saveFile(pdfResults[i].blob, pdfResults[i].file);
        await new Promise(function (r) { setTimeout(r, 400); });
      }
      toast('Descargando ' + pdfResults.length + ' archivos.');
      return;
    }
    var r = pdfResults[+btn.dataset.i];
    if (!r) return;
    if (act === 'dl') {
      var ok = await saveFile(r.blob, r.file);
      if (ok) toast('Descargando ' + r.file);
    } else if (act === 'txt') {
      var fname = r.file.replace(/\.pdf$/, '.txt');
      var ok2 = await saveFile(new Blob([r.text], { type: 'text/plain;charset=utf-8' }), fname);
      if (ok2) toast('Descargando ' + fname);
    } else if (act === 'share') {
      var file = new File([r.blob], r.file, { type: 'application/pdf' });
      navigator.share({ files: [file], title: r.file }).catch(function () { /* cancelado */ });
    }
  });

  /* ---------- Apoyar (Google Play) ---------- */
  var TIER_ICONS = [
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3M11 3v3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3 4v6a2 2 0 0 0 2 2M3 4v16M21 4c-1.5 0-2 2-2 5s.5 4 2 4v7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6c3-1.5 6-1.5 9 1v13c-3-2.5-6-2.5-9-1zM21 6c-3-1.5-6-1.5-9 1v13c3-2.5 6-2.5 9-1z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>'
  ];
  var support = { tiers: [], available: false, pick: 1, busy: false };

  function renderTiers() {
    var box = $('tiers');
    box.textContent = '';
    support.tiers.forEach(function (t, i) {
      var b = el('button', 'tier');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(i === support.pick));
      b.tabIndex = i === support.pick ? 0 : -1;
      b.dataset.i = i;
      var mark = el('span', 'tier-mark'); mark.innerHTML = TIER_ICONS[i % TIER_ICONS.length];
      var text = el('span', 'tier-text');
      text.appendChild(el('b', null, t.name));
      text.appendChild(el('span', null, t.desc));
      b.appendChild(mark); b.appendChild(text);
      if (t.price) b.appendChild(el('span', 'tier-price', t.price));
      box.appendChild(b);
    });
    var t = support.tiers[support.pick];
    $('support-buy').textContent = t ? 'Apoyar con ' + t.name.toLowerCase() + (t.price ? ' · ' + t.price : '') : 'Apoyar';
    $('support-buy').disabled = !support.available || support.busy;
  }
  function supportStatus(msg, ok) {
    var s = $('support-status');
    s.hidden = !msg;
    s.textContent = msg || '';
    s.classList.toggle('ok', !!ok);
  }

  $('tiers').addEventListener('click', function (e) {
    var b = e.target.closest('.tier');
    if (!b) return;
    support.pick = +b.dataset.i;
    renderTiers();
    var again = $('tiers').querySelector('[data-i="' + support.pick + '"]'); if (again) again.focus();
  });
  $('tiers').addEventListener('keydown', function (e) {
    var d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!d || !support.tiers.length) return;
    e.preventDefault();
    support.pick = (support.pick + d + support.tiers.length) % support.tiers.length;
    renderTiers();
    var b = $('tiers').querySelector('[data-i="' + support.pick + '"]'); if (b) b.focus();
  });

  async function loadSupport() {
    var D = window.LibroosDonate;
    support.tiers = D ? D.tiers.map(function (t) { return Object.assign({ price: '' }, t); }) : [];
    support.available = false;
    renderTiers();
    supportStatus('');
    if (!D) return;
    var res = await D.load();
    support.tiers = res.tiers;
    support.available = res.available;
    if (support.pick >= support.tiers.length) support.pick = 0;
    renderTiers();
    if (!res.available) supportStatus('Las donaciones funcionan en la app de Libroos instalada desde Google Play. Aquí puedes ver las opciones.');
  }

  function showSupport() { $('support').hidden = false; syncLock(); loadSupport(); $('support-close').focus(); }
  function hideSupport() { $('support').hidden = true; syncLock(); }
  function openSupport() { if (!$('support').hidden) return; showSupport(); pushLayer('support', hideSupport); }
  function closeSupport() { if (!popLayer('support')) hideSupport(); }

  $('btn-support').addEventListener('click', openSupport);
  $('support-close').addEventListener('click', closeSupport);
  $('support').addEventListener('click', function (e) { if (e.target === this) closeSupport(); });
  $('support-buy').addEventListener('click', async function () {
    var t = support.tiers[support.pick];
    if (!t || support.busy || !support.available) return;
    support.busy = true; renderTiers();
    supportStatus('');
    try {
      var res = await window.LibroosDonate.buy(t.sku);
      if (res === 'ok') {
        supportStatus('¡Gracias! Tu aporte llegó y ayuda a que Libroos siga gratis.', true);
        toast('¡Gracias por apoyar a Libroos!');
      }
    } catch (err) {
      supportStatus(err.message || 'No se pudo completar el pago.');
    } finally {
      support.busy = false; renderTiers();
    }
  });

  /* ---------- Aviso ---------- */
  var toastTimer = null;
  function toast(msg, actionLabel, action) {
    var t = $('toast'), btn = $('toast-action');
    $('toast-text').textContent = msg;
    btn.hidden = !actionLabel;
    btn.textContent = actionLabel || '';
    btn.onclick = action ? function () { t.hidden = true; action(); } : null;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, Math.max(actionLabel ? 6000 : 3500, msg.length * 70));
  }

  /* ---------- Teclado ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var top = topLayer();
    if (!top) return;
    if (top.name === 'live') closeLive();
    else if (top.name === 'editor') { if (ed && ed.drag) return; closeEditor(); }
    else if (top.name === 'sheet') closeSheet();
    else if (top.name === 'support') closeSupport();
    else if (top.name === 'select') exitSelectMode();
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
    rows.forEach(function (r) { if (migratePoints(r)) { r.v = (r.v || 1) + 1; persist(r); } });
    spreads = rows;
    renderList();
    if (!rows.length && !settings.sampleShown) {
      settings.sampleShown = true;
      saveSettings();
      loadSample();
    }
  }).catch(function (e) {
    console.error(e);
    renderList();
    toast('No se pudieron leer las fotos guardadas.');
  });

  if ('serviceWorker' in navigator && /^https:|^http:\/\/localhost/.test(location.href)) {
    try { navigator.serviceWorker.register('sw.js').catch(function () {}); } catch (e) { /* no disponible */ }
  }
})();
