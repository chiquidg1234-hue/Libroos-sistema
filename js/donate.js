/*
 * Libroos · donaciones con Google Play Billing
 *
 * Funciona cuando Libroos se instala desde la Play Store como app
 * (Trusted Web Activity con Play Billing activado). Ahí el navegador expone
 * la Digital Goods API y el pago se hace con PaymentRequest.
 * En el navegador normal no hay cobro posible: la pantalla lo explica.
 *
 * Los productos se crean en Play Console → Monetizar → Productos integrados,
 * como productos "consumibles" con estos IDs (se puede donar varias veces).
 */
(function (root) {
  'use strict';

  var BILLING = 'https://play.google.com/billing';
  var TIERS = [
    { sku: 'apoyo_cafe', name: 'Un café', desc: 'Gracias por escanear con Libroos' },
    { sku: 'apoyo_almuerzo', name: 'Un almuerzo', desc: 'Ayuda a pagar el desarrollo' },
    { sku: 'apoyo_libro', name: 'Un libro', desc: 'Para nuevas funciones' }
  ];

  var servicePromise = null;

  function getService() {
    if (servicePromise) return servicePromise;
    servicePromise = Promise.resolve().then(function () {
      if (!('getDigitalGoodsService' in root) || !root.PaymentRequest) return null;
      return root.getDigitalGoodsService(BILLING).catch(function () { return null; });
    });
    return servicePromise;
  }

  function formatPrice(price) {
    if (!price) return '';
    try {
      return new Intl.NumberFormat(navigator.language || 'es', { style: 'currency', currency: price.currency }).format(Number(price.value));
    } catch (e) {
      return price.value + ' ' + price.currency;
    }
  }

  /* Devuelve { available, tiers: [{ sku, name, desc, price }] } */
  async function load() {
    var tiers = TIERS.map(function (t) { return Object.assign({ price: '' }, t); });
    var service = await getService();
    if (!service) return { available: false, tiers: tiers };
    try {
      var details = await service.getDetails(TIERS.map(function (t) { return t.sku; }));
      var bySku = {};
      details.forEach(function (d) { bySku[d.itemId] = d; });
      tiers = tiers.filter(function (t) { return bySku[t.sku]; }).map(function (t) {
        return Object.assign(t, { price: formatPrice(bySku[t.sku].price) });
      });
      return { available: tiers.length > 0, tiers: tiers };
    } catch (e) {
      return { available: false, tiers: tiers };
    }
  }

  /*
   * Abre el pago de Google Play. Resuelve 'ok' si se pagó, 'cancel' si la
   * persona cerró el pago; lanza un Error con un mensaje para mostrar.
   */
  async function buy(sku) {
    var service = await getService();
    if (!service) throw new Error('Las donaciones funcionan en la app de Libroos instalada desde Google Play.');
    var request = new PaymentRequest(
      [{ supportedMethods: BILLING, data: { sku: sku } }],
      { total: { label: 'Total', amount: { currency: 'USD', value: '0' } } }
    );
    var response;
    try {
      response = await request.show();
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancel';
      throw new Error('No se pudo abrir el pago de Google Play. Intenta de nuevo.');
    }
    try {
      var token = response.details && response.details.purchaseToken;
      // Consumir confirma la compra ante Google (si no, se reembolsa a los 3 días)
      // y permite volver a donar el mismo producto.
      if (token && service.consume) await service.consume(token);
      await response.complete('success');
      return 'ok';
    } catch (e) {
      try { await response.complete('fail'); } catch (e2) { /* nada */ }
      throw new Error('Google Play no confirmó el pago. Si se cobró, se reembolsa solo.');
    }
  }

  root.LibroosDonate = { load: load, buy: buy, tiers: TIERS };
})(this);
