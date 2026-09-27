/*
 * Libroos · procesamiento de imagen
 *
 * Funciones puras que trabajan sobre objetos tipo ImageData
 * ({ data: Uint8ClampedArray RGBA, width, height }), así se pueden
 * probar en Node sin navegador.
 *
 *  - detectBounds / detectSpine / autoDetect: encuentran el libro y el lomo.
 *  - pageQuads: convierte los puntos del usuario en 1 o 2 cuadriláteros.
 *  - warpQuad: corrige la perspectiva de un cuadrilátero a un rectángulo.
 *  - enhance: blanquea el papel y quita sombras (modo escáner).
 */
(function (root) {
  'use strict';

  function makeImage(width, height) {
    return { data: new Uint8ClampedArray(width * height * 4), width: width, height: height };
  }

  function toGray(img) {
    var d = img.data, n = img.width * img.height, g = new Uint8Array(n);
    for (var i = 0, j = 0; j < n; i += 4, j++) {
      g[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    }
    return g;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function smooth(arr, radius) {
    var n = arr.length, out = new Float64Array(n), acc = 0, count = 0;
    var r = Math.max(1, radius | 0);
    for (var i = -r; i < n + r; i++) {
      if (i + r < n) { acc += arr[i + r]; count++; }
      if (i - r - 1 >= 0) { acc -= arr[i - r - 1]; count--; }
      if (i >= 0 && i < n) out[i] = acc / count;
    }
    return out;
  }

  // Umbral de Otsu sobre un array de grises.
  function otsu(gray) {
    var hist = new Float64Array(256), n = gray.length, i;
    for (i = 0; i < n; i++) hist[gray[i]]++;
    var sum = 0;
    for (i = 0; i < 256; i++) sum += i * hist[i];
    var sumB = 0, wB = 0, best = 0, thr = 127;
    for (i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      var wF = n - wB;
      if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sum - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = i; }
    }
    return { threshold: thr, separation: best / (n * n) };
  }

  /*
   * Busca el rectángulo claro (las páginas) que rodea al centro de la foto.
   * Camina desde el centro hacia afuera y se detiene cuando varias columnas
   * o filas seguidas dejan de ser "papel". Tolera el surco oscuro del lomo.
   */
  function detectBounds(gray, w, h) {
    var o = otsu(gray);
    var full = { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
    // Poco contraste entre fondo y papel: la foto ya es casi todo página.
    if (o.separation < 150) return full;
    var thr = o.threshold;
    var col = new Float64Array(w), row = new Float64Array(h), x, y;
    var ry0 = Math.floor(h * 0.2), ry1 = Math.ceil(h * 0.8);
    var rx0 = Math.floor(w * 0.2), rx1 = Math.ceil(w * 0.8);
    for (y = 0; y < h; y++) {
      var base = y * w;
      for (x = 0; x < w; x++) {
        if (gray[base + x] > thr) {
          if (y >= ry0 && y < ry1) col[x]++;
          if (x >= rx0 && x < rx1) row[y]++;
        }
      }
    }
    for (x = 0; x < w; x++) col[x] /= (ry1 - ry0);
    for (y = 0; y < h; y++) row[y] /= (rx1 - rx0);

    function walk(profile, start, step, limit, gap) {
      var last = start, miss = 0;
      for (var i = start; i >= 0 && i < limit; i += step) {
        if (profile[i] > 0.35) { last = i; miss = 0; } else if (++miss > gap) break;
      }
      return last;
    }
    var gapX = Math.max(2, Math.round(w * 0.05)), gapY = Math.max(2, Math.round(h * 0.03));
    var cx = w >> 1, cy = h >> 1;
    var b = {
      x0: walk(col, cx, -1, w, gapX),
      x1: walk(col, cx, 1, w, gapX),
      y0: walk(row, cy, -1, h, gapY),
      y1: walk(row, cy, 1, h, gapY)
    };
    var area = (b.x1 - b.x0) * (b.y1 - b.y0);
    if (area < w * h * 0.25) return full;
    // Un pelo hacia adentro para no arrastrar el borde de la tapa.
    var ix = Math.round(w * 0.004), iy = Math.round(h * 0.004);
    if (b.x0 > 0) b.x0 += ix;
    if (b.x1 < w - 1) b.x1 -= ix;
    if (b.y0 > 0) b.y0 += iy;
    if (b.y1 < h - 1) b.y1 -= iy;
    return b;
  }

  /*
   * El lomo suele ser un valle oscuro horizontal cerca del centro.
   * Se mide por separado en la mitad izquierda y derecha para seguir
   * un lomo algo inclinado. Devuelve y en el borde izquierdo y derecho.
   */
  function detectSpine(gray, w, h, b) {
    b = b || { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
    var bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    var mid = (b.y0 + b.y1) / 2;
    function valleyAt(xA, xB) {
      var prof = new Float64Array(h), x, y;
      for (x = xA; x < xB; x++) {
        for (y = 0; y < h; y++) prof[y] += gray[y * w + x];
      }
      var cols = Math.max(1, xB - xA);
      for (y = 0; y < h; y++) prof[y] /= cols;
      prof = smooth(prof, Math.max(1, Math.round(bh * 0.006)));
      var d1 = Math.max(3, Math.round(bh * 0.06)), d2 = Math.max(1, Math.round(bh * 0.015));
      var lo = Math.round(b.y0 + bh * 0.32), hi = Math.round(b.y0 + bh * 0.68);
      var best = -Infinity, bestY = mid;
      for (y = Math.max(lo, d1); y <= Math.min(hi, h - 1 - d1); y++) {
        var side = 0, k;
        for (k = d2; k <= d1; k++) side += prof[y - k] + prof[y + k];
        side /= 2 * (d1 - d2 + 1);
        var depth = side - prof[y];
        var score = depth - 40 * Math.abs(y - mid) / bh;
        if (score > best) { best = score; bestY = y; }
      }
      return best > 2 ? bestY : mid;
    }
    var xLeftA = Math.round(b.x0 + bw * 0.1), xLeftB = Math.round(b.x0 + bw * 0.5);
    var xRightA = xLeftB, xRightB = Math.round(b.x0 + bw * 0.9);
    var ya = valleyAt(xLeftA, xLeftB), yb = valleyAt(xRightA, xRightB);
    // Mediciones incoherentes: usar un lomo horizontal.
    if (Math.abs(ya - yb) > bh * 0.08) { ya = yb = (ya + yb) / 2; }
    var xa = (xLeftA + xLeftB) / 2, xb = (xRightA + xRightB) / 2;
    var slope = (yb - ya) / (xb - xa);
    return {
      yLeft: clamp(ya + slope * (b.x0 - xa), 0, h - 1),
      yRight: clamp(ya + slope * (b.x1 - xa), 0, h - 1)
    };
  }

  /* Puntos normalizados (0..1) para una foto: esquinas + extremos del lomo. */
  function autoDetect(img) {
    var w = img.width, h = img.height, gray = toGray(img);
    var b = detectBounds(gray, w, h);
    var s = detectSpine(gray, w, h, b);
    var W = w - 1, H = h - 1;
    return {
      tl: [b.x0 / W, b.y0 / H], tr: [b.x1 / W, b.y0 / H],
      br: [b.x1 / W, b.y1 / H], bl: [b.x0 / W, b.y1 / H],
      sl: [b.x0 / W, s.yLeft / H], sr: [b.x1 / W, s.yRight / H]
    };
  }

  function fullFramePoints() {
    return { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1], sl: [0, 0.5], sr: [1, 0.5] };
  }

  /* Cuadriláteros de página en orden de lectura (TL, TR, BR, BL): arriba y abajo. */
  function pageQuads(mode, p) {
    if (mode === 'single') return [[p.tl, p.tr, p.br, p.bl]];
    return [[p.tl, p.tr, p.sr, p.sl], [p.sl, p.sr, p.br, p.bl]];
  }

  function dist(a, b) { var dx = a[0] - b[0], dy = a[1] - b[1]; return Math.sqrt(dx * dx + dy * dy); }

  function quadSize(q) {
    return {
      w: (dist(q[0], q[1]) + dist(q[3], q[2])) / 2,
      h: (dist(q[0], q[3]) + dist(q[1], q[2])) / 2
    };
  }

  /* Homografía que lleva 4 puntos `from` a 4 puntos `to` (h[8] = 1). */
  function homography(from, to) {
    var A = [], i, j, k;
    for (i = 0; i < 4; i++) {
      var x = from[i][0], y = from[i][1], X = to[i][0], Y = to[i][1];
      A.push([x, y, 1, 0, 0, 0, -X * x, -X * y, X]);
      A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y, Y]);
    }
    for (i = 0; i < 8; i++) {
      var piv = i;
      for (j = i + 1; j < 8; j++) if (Math.abs(A[j][i]) > Math.abs(A[piv][i])) piv = j;
      var tmp = A[i]; A[i] = A[piv]; A[piv] = tmp;
      var p = A[i][i];
      if (Math.abs(p) < 1e-12) throw new Error('Puntos degenerados');
      for (k = i; k < 9; k++) A[i][k] /= p;
      for (j = 0; j < 8; j++) {
        if (j === i) continue;
        var f = A[j][i];
        if (f) for (k = i; k < 9; k++) A[j][k] -= f * A[i][k];
      }
    }
    var hm = [];
    for (i = 0; i < 8; i++) hm.push(A[i][8]);
    hm.push(1);
    return hm;
  }

  function applyH(hm, x, y) {
    var d = hm[6] * x + hm[7] * y + hm[8];
    return [(hm[0] * x + hm[1] * y + hm[2]) / d, (hm[3] * x + hm[4] * y + hm[5]) / d];
  }

  /*
   * Endereza el cuadrilátero `quad` (en píxeles de `src`) a un rectángulo
   * outW × outH con interpolación bilineal. Si el rectángulo destino es
   * mucho más chico que el origen, promedia 2×2 muestras para evitar dientes.
   */
  function warpQuad(src, quad, outW, outH) {
    var out = makeImage(outW, outH);
    var hm = homography([[0, 0], [outW, 0], [outW, outH], [0, outH]], quad);
    var sd = src.data, sw = src.width, sh = src.height, od = out.data;
    var size = quadSize(quad);
    var ss = (size.w / outW > 1.6 || size.h / outH > 1.6) ? 2 : 1;
    var inv = 1 / (ss * ss);
    var o = 0;
    for (var y = 0; y < outH; y++) {
      for (var x = 0; x < outW; x++) {
        var r = 0, g = 0, b = 0;
        for (var sy = 0; sy < ss; sy++) {
          for (var sx = 0; sx < ss; sx++) {
            var u = x + (sx + 0.5) / ss, v = y + (sy + 0.5) / ss;
            var den = hm[6] * u + hm[7] * v + 1;
            var fx = (hm[0] * u + hm[1] * v + hm[2]) / den - 0.5;
            var fy = (hm[3] * u + hm[4] * v + hm[5]) / den - 0.5;
            if (fx < 0) fx = 0; else if (fx > sw - 1.001) fx = sw - 1.001;
            if (fy < 0) fy = 0; else if (fy > sh - 1.001) fy = sh - 1.001;
            var ix = fx | 0, iy = fy | 0, ax = fx - ix, ay = fy - iy;
            var i00 = (iy * sw + ix) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
            var w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
            r += sd[i00] * w00 + sd[i10] * w10 + sd[i01] * w01 + sd[i11] * w11;
            g += sd[i00 + 1] * w00 + sd[i10 + 1] * w10 + sd[i01 + 1] * w01 + sd[i11 + 1] * w11;
            b += sd[i00 + 2] * w00 + sd[i10 + 2] * w10 + sd[i01 + 2] * w01 + sd[i11 + 2] * w11;
          }
        }
        od[o] = r * inv; od[o + 1] = g * inv; od[o + 2] = b * inv; od[o + 3] = 255;
        o += 4;
      }
    }
    return out;
  }

  /*
   * Estima la iluminación del papel en una grilla gruesa: en cada bloque
   * toma el percentil 90 (ignora el texto), filtra con mediana y suaviza.
   */
  function backgroundGrid(gray, w, h) {
    var B = Math.max(8, Math.round(Math.max(w, h) / 64));
    var gw = Math.ceil(w / B), gh = Math.ceil(h / B);
    var grid = new Float64Array(gw * gh), hist = new Uint32Array(256);
    for (var by = 0; by < gh; by++) {
      for (var bx = 0; bx < gw; bx++) {
        hist.fill(0);
        var n = 0, x0 = bx * B, y0 = by * B, x1 = Math.min(w, x0 + B), y1 = Math.min(h, y0 + B);
        for (var y = y0; y < y1; y += 2) {
          for (var x = x0; x < x1; x += 2) { hist[gray[y * w + x]]++; n++; }
        }
        var target = n * 0.9, acc = 0, v = 255;
        for (var i = 0; i < 256; i++) { acc += hist[i]; if (acc >= target) { v = i; break; } }
        grid[by * gw + bx] = v;
      }
    }
    // Nivel típico del papel en toda la página.
    var sorted = Array.prototype.slice.call(grid).sort(function (a, b) { return a - b; });
    var paper = sorted[Math.floor(sorted.length * 0.85)] || 255;
    var floor = Math.max(40, paper * 0.45);
    // Mediana 5×5: las fotos o ilustraciones no deben contar como papel sucio.
    var med = new Float64Array(gw * gh), win = [];
    for (var gy = 0; gy < gh; gy++) {
      for (var gx = 0; gx < gw; gx++) {
        win.length = 0;
        for (var dy = -2; dy <= 2; dy++) {
          for (var dx = -2; dx <= 2; dx++) {
            var yy = clamp(gy + dy, 0, gh - 1), xx = clamp(gx + dx, 0, gw - 1);
            win.push(grid[yy * gw + xx]);
          }
        }
        win.sort(function (a, b) { return a - b; });
        med[gy * gw + gx] = Math.max(floor, win[12]);
      }
    }
    // Suavizado 3×3 dos veces.
    for (var pass = 0; pass < 2; pass++) {
      var sm = new Float64Array(gw * gh);
      for (gy = 0; gy < gh; gy++) {
        for (gx = 0; gx < gw; gx++) {
          var s = 0, c = 0;
          for (dy = -1; dy <= 1; dy++) {
            for (dx = -1; dx <= 1; dx++) {
              yy = gy + dy; xx = gx + dx;
              if (yy >= 0 && yy < gh && xx >= 0 && xx < gw) { s += med[yy * gw + xx]; c++; }
            }
          }
          sm[gy * gw + gx] = s / c;
        }
      }
      med = sm;
    }
    return { grid: med, gw: gw, gh: gh, B: B };
  }

  var FILTERS = ['color', 'original', 'gray', 'bw'];

  /*
   * Filtros:
   *  original  sin cambios
   *  color     papel blanco, sin sombras, colores conservados (recomendado)
   *  gray      igual que color pero en escala de grises
   *  bw        blanco y negro nítido, ideal para texto (archivos livianos)
   */
  function enhance(img, mode) {
    if (!mode || mode === 'original') return img;
    var w = img.width, h = img.height, d = img.data;
    var gray = toGray(img);
    var bg = backgroundGrid(gray, w, h);
    var grid = bg.grid, gw = bg.gw, gh = bg.gh, B = bg.B;
    var out = makeImage(w, h), od = out.data;
    var black = 28, white = 232, span = 255 / (white - black);
    for (var y = 0; y < h; y++) {
      var gyf = clamp((y + 0.5) / B - 0.5, 0, gh - 1), gy0 = gyf | 0, gy1 = Math.min(gh - 1, gy0 + 1), ay = gyf - gy0;
      for (var x = 0; x < w; x++) {
        var gxf = clamp((x + 0.5) / B - 0.5, 0, gw - 1), gx0 = gxf | 0, gx1 = Math.min(gw - 1, gx0 + 1), ax = gxf - gx0;
        var bgv = (grid[gy0 * gw + gx0] * (1 - ax) + grid[gy0 * gw + gx1] * ax) * (1 - ay) +
                  (grid[gy1 * gw + gx0] * (1 - ax) + grid[gy1 * gw + gx1] * ax) * ay;
        var scale = 255 / bgv;
        var i = (y * w + x) * 4;
        if (mode === 'color') {
          od[i] = (d[i] * scale - black) * span;
          od[i + 1] = (d[i + 1] * scale - black) * span;
          od[i + 2] = (d[i + 2] * scale - black) * span;
        } else {
          var gv = gray[y * w + x] * scale;
          if (mode === 'bw') {
            // Rampa corta en vez de corte seco: bordes de letras suaves.
            var t = (gv - 150) / 45;
            gv = t <= 0 ? 0 : t >= 1 ? 255 : t * 255;
          } else {
            gv = (gv - black) * span;
          }
          od[i] = od[i + 1] = od[i + 2] = gv;
        }
        od[i + 3] = 255;
      }
    }
    return out;
  }

  var api = {
    makeImage: makeImage,
    toGray: toGray,
    otsu: otsu,
    detectBounds: detectBounds,
    detectSpine: detectSpine,
    autoDetect: autoDetect,
    fullFramePoints: fullFramePoints,
    pageQuads: pageQuads,
    quadSize: quadSize,
    homography: homography,
    applyH: applyH,
    warpQuad: warpQuad,
    enhance: enhance,
    FILTERS: FILTERS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LibroosImaging = api;
})(this);
