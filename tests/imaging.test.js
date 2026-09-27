// Ejecutar con: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const Img = require('../js/imaging.js');

function syntheticSpread({ w = 400, h = 280, spineTop = 0.47, spineBottom = 0.49, book = [0.1, 0.12, 0.9, 0.9] } = {}) {
  // Mesa oscura, libro claro, surco del lomo oscuro y algo de "texto".
  const img = Img.makeImage(w, h);
  const [bx0, by0, bx1, by1] = book.map((v, i) => Math.round(v * (i % 2 ? h : w)));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 60;
      if (x >= bx0 && x <= bx1 && y >= by0 && y <= by1) {
        v = 235;
        const t = (y - by0) / (by1 - by0);
        const sx = (spineTop + (spineBottom - spineTop) * t) * w;
        const dd = Math.abs(x - sx);
        if (dd < 12) v -= (12 - dd) * 12;
        if (y % 9 < 2 && (x * 7) % 13 < 8 && dd > 20) v = 50;
      }
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  return img;
}

test('la homografía lleva cada esquina a su destino', () => {
  const from = [[0, 0], [100, 0], [100, 150], [0, 150]];
  const to = [[12, 8], [210, 20], [190, 300], [5, 280]];
  const hm = Img.homography(from, to);
  from.forEach((p, i) => {
    const [x, y] = Img.applyH(hm, p[0], p[1]);
    assert.ok(Math.abs(x - to[i][0]) < 1e-6 && Math.abs(y - to[i][1]) < 1e-6);
  });
});

test('detecta los bordes del libro y el lomo inclinado', () => {
  const img = syntheticSpread();
  const p = Img.autoDetect(img);
  assert.ok(Math.abs(p.tl[0] - 0.1) < 0.03, 'borde izquierdo ' + p.tl[0]);
  assert.ok(Math.abs(p.br[0] - 0.9) < 0.03, 'borde derecho ' + p.br[0]);
  assert.ok(Math.abs(p.tl[1] - 0.12) < 0.03, 'borde superior ' + p.tl[1]);
  assert.ok(Math.abs(p.br[1] - 0.9) < 0.03, 'borde inferior ' + p.br[1]);
  assert.ok(Math.abs(p.st[0] - 0.47) < 0.02, 'lomo arriba ' + p.st[0]);
  assert.ok(Math.abs(p.sb[0] - 0.49) < 0.02, 'lomo abajo ' + p.sb[0]);
});

test('una foto de solo página devuelve el cuadro completo', () => {
  const img = syntheticSpread({ book: [0, 0, 1, 1] });
  const p = Img.autoDetect(img);
  assert.ok(p.tl[0] < 0.03 && p.br[0] > 0.97);
});

test('divide en dos páginas y endereza', () => {
  const img = syntheticSpread();
  const pts = Img.autoDetect(img);
  const quads = Img.pageQuads('double', pts).map(q => q.map(([x, y]) => [x * (img.width - 1), y * (img.height - 1)]));
  assert.strictEqual(quads.length, 2);
  const size = Img.quadSize(quads[0]);
  const out = Img.warpQuad(img, quads[0], Math.round(size.w), Math.round(size.h));
  assert.strictEqual(out.width, Math.round(size.w));
  // El centro de la página izquierda es papel claro, no mesa.
  const c = ((out.height >> 1) * out.width + (out.width >> 1)) * 4;
  assert.ok(out.data[c] > 40);
  assert.strictEqual(Img.pageQuads('single', pts).length, 1);
});

test('el filtro mejorado blanquea el papel con sombra', () => {
  const w = 200, h = 200, img = Img.makeImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = 140 + Math.round(80 * x / w); // papel con sombra a la izquierda
    const i = (y * w + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = (y % 20 < 3 && x % 10 < 6) ? 30 : v;
    img.data[i + 3] = 255;
  }
  for (const mode of ['color', 'gray', 'bw']) {
    const out = Img.enhance(img, mode);
    const left = out.data[(10 * w + 15) * 4 + 0 + 4 * 0];
    const right = out.data[(10 * w + 185) * 4];
    assert.ok(left > 225 && right > 225, `${mode}: papel ${left}/${right}`);
    const ink = out.data[(1 * w + 2) * 4];
    assert.ok(ink < 90, `${mode}: tinta ${ink}`);
  }
});
