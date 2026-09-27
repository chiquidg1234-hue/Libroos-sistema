/*
 * Libroos · almacenamiento
 * Guarda las fotos en IndexedDB para que no se pierdan si el navegador
 * recarga la página (pasa seguido en celulares al abrir la cámara).
 * Si IndexedDB no está disponible, trabaja solo en memoria.
 */
(function (root) {
  'use strict';
  var DB_NAME = 'libroos', STORE = 'spreads';
  var memory = new Map();
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      try {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return dbPromise;
  }

  function run(mode, fn) {
    return open().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode), out;
        try { out = fn(tx.objectStore(STORE)); } catch (e) { reject(e); return; }
        tx.oncomplete = function () { resolve(out && 'result' in out ? out.result : null); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error('Operación cancelada')); };
      });
    });
  }

  var Store = {
    persistent: function () { return open().then(function (db) { return !!db; }); },
    all: function () {
      return run('readonly', function (s) { return s.getAll(); }).then(function (rows) {
        if (rows) rows.forEach(function (r) { memory.set(r.id, r); });
        return Array.from(memory.values()).sort(function (a, b) { return a.order - b.order; });
      });
    },
    put: function (rec) {
      memory.set(rec.id, rec);
      return run('readwrite', function (s) { return s.put(rec); });
    },
    remove: function (id) {
      memory.delete(id);
      return run('readwrite', function (s) { return s.delete(id); });
    },
    clear: function () {
      memory.clear();
      return run('readwrite', function (s) { return s.clear(); });
    }
  };

  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
  } catch (e) { /* sin permiso: no importa */ }

  root.LibroosStore = Store;
})(this);
