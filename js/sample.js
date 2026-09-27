/*
 * Libroos · foto de ejemplo
 * Dibuja un libro abierto sobre una mesa, con luz despareja y sombra en el
 * lomo, para mostrar cómo funciona la separación y el filtro sin tener
 * que sacar una foto. El lomo queda horizontal: página de arriba y de
 * abajo. El texto es del Quijote (dominio público).
 */
(function (root) {
  'use strict';

  var TOP = 'En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero, adarga antigua, rocín flaco y galgo corredor. Una olla de algo más vaca que carnero, salpicón las más noches, duelos y quebrantos los sábados, lantejas los viernes, algún palomino de añadidura los domingos, consumían las tres partes de su hacienda. El resto della concluían sayo de velarte, calzas de velludo para las fiestas, con sus pantuflos de lo mesmo, y los días de entresemana se honraba con su vellorí de lo más fino.';
  var BOTTOM = 'Tenía en su casa una ama que pasaba de los cuarenta, y una sobrina que no llegaba a los veinte, y un mozo de campo y plaza, que así ensillaba el rocín como tomaba la podadera. Frisaba la edad de nuestro hidalgo con los cincuenta años; era de complexión recia, seco de carnes, enjuto de rostro, gran madrugador y amigo de la caza. Quieren decir que tenía el sobrenombre de Quijada, o Quesada, que en esto hay alguna diferencia en los autores que deste caso escriben; aunque por conjeturas verosímiles se deja entender que se llamaba Quijana. Pero esto importa poco a nuestro cuento.';

  function wrap(ctx, text, width) {
    var words = text.split(' '), lines = [], line = '';
    words.forEach(function (w) {
      var t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > width && line) { lines.push(line); line = w; } else line = t;
    });
    if (line) lines.push(line);
    return lines;
  }

  function drawPage(ctx, x, y, w, h, opts) {
    ctx.save();
    ctx.fillStyle = '#f3efe4';
    ctx.fillRect(x, y, w, h);
    // Sombra hacia el lomo (arriba: sombra pegada al borde inferior, y viceversa)
    var gy0 = opts.side === 'top' ? y + h : y, gy1 = opts.side === 'top' ? y + h - 160 : y + 160;
    var g = ctx.createLinearGradient(0, gy0, 0, gy1);
    g.addColorStop(0, 'rgba(40,30,20,.55)');
    g.addColorStop(0.35, 'rgba(40,30,20,.18)');
    g.addColorStop(1, 'rgba(40,30,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, Math.min(gy0, gy1), w, 160);
    // Texto
    var mx = 90, top = y + 110;
    ctx.fillStyle = '#2a2622';
    if (opts.heading) {
      ctx.font = '600 44px Georgia, serif';
      ctx.fillText(opts.heading, x + mx, top);
      top += 80;
    }
    ctx.font = '27px Georgia, serif';
    var lines = wrap(ctx, opts.text, w - mx * 2);
    lines.forEach(function (l, i) { ctx.fillText(l, x + mx, top + i * 42); });
    ctx.font = '24px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(opts.folio, x + w / 2, y + h - 60);
    ctx.restore();
  }

  function makeSampleCanvas() {
    var W = 1700, H = 2400;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    // Mesa
    var t = ctx.createLinearGradient(0, 0, W, H);
    t.addColorStop(0, '#3b2c22'); t.addColorStop(1, '#241a14');
    ctx.fillStyle = t; ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-0.018);
    var pw = 1320, ph = 900;
    // Tapa
    ctx.fillStyle = '#1d4a3d';
    ctx.fillRect(-pw / 2 - 22, -ph - 26, pw + 44, ph * 2 + 52);
    drawPage(ctx, -pw / 2, -ph, pw, ph, { side: 'top', heading: 'Capítulo primero', text: TOP, folio: '46' });
    drawPage(ctx, -pw / 2, 0, pw, ph, { side: 'bottom', text: BOTTOM, folio: '47' });
    ctx.restore();
    // Luz despareja: una lámpara arriba a la derecha
    var l = ctx.createRadialGradient(W * 0.8, H * 0.1, 50, W * 0.6, H * 0.5, W * 0.9);
    l.addColorStop(0, 'rgba(255,240,210,0)');
    l.addColorStop(1, 'rgba(20,15,10,.38)');
    ctx.fillStyle = l; ctx.fillRect(0, 0, W, H);
    return c;
  }

  root.LibroosSample = { makeCanvas: makeSampleCanvas };
})(this);
