# Publicar Libroos en Google Play

Libroos es una app web (PWA). Para la Play Store se empaqueta como **Trusted Web Activity (TWA)** con [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap): la app abre la versión publicada en GitHub Pages a pantalla completa, sin barra del navegador.

## 1. Requisitos

- La app publicada con HTTPS: `https://chiquidg1234-hue.github.io/Libroos-sistema/`
- Cuenta de desarrollador de Google Play (pago único de US$25).
- Node.js 18+ y Java 17 en la computadora donde armas el paquete.

## 2. Crear el paquete Android

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://chiquidg1234-hue.github.io/Libroos-sistema/manifest.webmanifest
```

Respuestas recomendadas:

| Pregunta | Valor |
| --- | --- |
| Application ID | `io.github.chiquidg1234.libroos` (no se puede cambiar después) |
| Display mode | `standalone` |
| Orientation | `default` |
| Status bar color | `#1b4a3e` |
| Play Billing | **Sí** (para las donaciones) |
| Signing key | Crea una nueva y **guárdala en un lugar seguro**: sin ella no puedes publicar actualizaciones |

Luego:

```bash
bubblewrap build
```

Esto genera `app-release-bundle.aab` (lo que se sube a Play) y `assetlinks.json`.

## 3. Verificar el dominio (Digital Asset Links)

Sin esto la app muestra la barra del navegador arriba.

1. Copia la huella SHA-256 de tu clave de firma (Play Console → Configuración → Integridad de la app → Firma de apps).
2. Crea el archivo `.well-known/assetlinks.json` en la **raíz del dominio**. Con GitHub Pages de usuario eso significa un repo llamado `chiquidg1234-hue.github.io`, porque la ruta `/Libroos-sistema/.well-known/` no sirve. Alternativa: un dominio propio para Libroos.

## 4. Donaciones (productos integrados)

En Play Console → **Monetizar → Productos → Productos integrados** crea tres productos **consumibles**:

| ID del producto | Nombre sugerido |
| --- | --- |
| `apoyo_cafe` | Un café |
| `apoyo_almuerzo` | Un almuerzo |
| `apoyo_libro` | Un libro |

Los IDs deben ser exactamente esos (están en `js/donate.js`). El precio lo pones tú en Play Console y la app lo muestra solo, en la moneda de cada país.

Para recibir pagos necesitas completar el **perfil de pagos** de Google (datos fiscales y cuenta bancaria).

## 5. Ficha de la tienda

- Ícono 512×512 (`icons/icon-512.png`) y gráfico de funciones 1024×500.
- Al menos 2 capturas de teléfono (puedes usar el lienzo de diseño como guía).
- Descripción corta (80 caracteres) y larga.
- **Política de privacidad** con URL pública (obligatoria porque la app usa la cámara).
- Formulario **Seguridad de los datos**: Libroos no recopila ni comparte datos; las fotos quedan en el teléfono.
- Clasificación de contenido y público objetivo.

## 6. Pruebas antes de producción

Las cuentas personales nuevas deben hacer una **prueba cerrada con al menos 12 personas durante 14 días** antes de poder publicar en producción.
