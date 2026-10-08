# Libroos

Fotografía un libro abierto **con las dos páginas en una sola foto**. Libroos las separa por el lomo, las endereza, deja el papel blanco y arma un **PDF descargable**.

Es una app web: funciona en el navegador del celular o la computadora, **sin servidor y sin subir tus fotos a ningún lado**. Todo el procesamiento ocurre en tu teléfono.

## Qué hace

| Paso | Detalle |
| --- | --- |
| 1. Capturar | **Cámara continua** (varias fotos seguidas, con línea guía para el lomo y linterna), **cámara del teléfono** (máxima calidad) o **subir fotos** de la galería, muchas a la vez. |
| 2. Separar | Detecta automáticamente los bordes del libro y el lomo (aunque esté un poco inclinado) y divide cada foto en página izquierda y derecha. Para tapas o páginas sueltas se elige "1 página". |
| 3. Ajustar | Tocando una foto se abre el editor: se arrastran las 4 esquinas y los 2 puntos del lomo (con lupa para precisión). Botones para girar, volver a detectar o usar la foto entera. |
| 4. Enderezar | Corrige la perspectiva de cada página (si la foto se tomó en ángulo, queda rectangular). |
| 5. Acabado | **Escáner** (papel blanco, sin sombra del lomo, conserva colores), **Grises**, **B/N** (texto nítido, archivo liviano) u **Original**. Se elige para todo el libro y se puede cambiar por foto. |
| 6. Ordenar | Numeración de páginas automática, mover fotos antes/después, eliminar con "Deshacer". |
| 7. OCR | Opción **Texto buscable**: reconoce el texto en español (Tesseract, dentro del teléfono) y lo agrega como capa invisible. En el PDF puedes buscar palabras, seleccionar y copiar. También se puede bajar todo el texto como `.txt`. |
| 8. Elegir páginas | En "Crear PDF", **Elegir páginas** acepta rangos (`1-10`) y páginas sueltas (`1, 10, 20, 35`). Cada línea del cuadro de texto se exporta como un **PDF aparte**: escribe `1-10` en una línea y `11-30` en la siguiente para dividir el libro en dos PDF de una sola vez. También se puede tocar **Seleccionar fotos** en la lista, marcar algunas y tocar **Crear PDF con estas**, que llena el rango automáticamente. |
| 9. PDF | Nombre del archivo, tamaño de hoja (como el libro, A4 o Carta) y calidad (Alta / Media / Liviana). Botón **Descargar PDF** y, en el celular, **Compartir** (WhatsApp, Drive, correo…). Si se generó más de un PDF, un botón **Descargar todos** los baja en fila. |

Las fotos quedan guardadas en el navegador (IndexedDB): si el teléfono recarga la página al abrir la cámara, no se pierde nada. Una vez abierta, la app funciona sin conexión y se puede instalar en la pantalla de inicio.

## Usarla

### Opción A: GitHub Pages (recomendada)

1. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Une esta rama a `main`. El flujo `.github/workflows/pages.yml` corre las pruebas y publica.
3. Abre `https://<tu-usuario>.github.io/<repositorio>/` en el celular. Menú del navegador → **Agregar a pantalla de inicio**.

> GitHub Pages en repositorios privados requiere un plan pago. Si el repo es privado y no tienes ese plan, usa la opción B o hazlo público.

La cámara en vivo necesita HTTPS (GitHub Pages ya lo tiene).

### Opción B: en tu computadora

```bash
npm start          # sirve la carpeta en http://localhost:8080
```

O cualquier servidor estático (`python3 -m http.server`). También se puede alojar gratis arrastrando la carpeta a Netlify Drop o Cloudflare Pages.

## Consejos para mejores resultados

- Luz pareja; sin flash (hace brillos).
- Libro sobre una superficie **oscura**: así se detectan los bordes solos.
- Celular horizontal y paralelo al libro, lomo sobre la línea guía.
- Aplana las páginas sujetándolas por los márgenes.
- Para libros de muchas páginas, "Calidad Media" + acabado "Escáner" o "B/N" da archivos manejables.

## Estructura

```
index.html            interfaz
css/styles.css        estilos (tema claro y oscuro)
js/imaging.js         detección de bordes y lomo, perspectiva, filtros (funciones puras)
js/store.js           guardado en IndexedDB
js/pdf.js             armado del PDF (jsPDF) con capa de texto invisible
js/ocr.js             reconocimiento de texto (Tesseract.js, español)
js/sample.js          foto de ejemplo generada
js/app.js             captura, lista, editor, exportación
vendor/jspdf.umd.min.js  jsPDF 2.5.2 (MIT), incluido para funcionar sin conexión
vendor/tesseract/     Tesseract.js 5.1.1 (Apache-2.0) + datos de español (se carga solo al usar OCR)
sw.js, manifest.webmanifest  app instalable y sin conexión
tests/                pruebas del procesamiento de imagen (`npm test`)
```

## Pruebas

```bash
npm test
```

Prueban la homografía, la detección de bordes y del lomo inclinado, la división en páginas y el blanqueo del papel sobre imágenes sintéticas.
