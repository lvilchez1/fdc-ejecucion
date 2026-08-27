# Guía de instalación — Checklist de ejecución PDV (Flor de Caña)

Esta guía asume cero configuración previa. Tiempo estimado: 30–45 minutos,
una sola vez. Después de esto, agregar/quitar clientes o SKUs es solo
editar una hoja de cálculo — no vuelves a tocar código.

## Qué construí y qué NO construí (para que no haya sorpresas)

**Sí incluido:**
- App web (funciona en Safari de iPhone y Chrome de Android) instalable en
  la pantalla de inicio, sin pasar por App Store / Play Store.
- Captura de fotos **solo con cámara en vivo** — no existe ningún botón que
  abra la galería del teléfono, así que no se puede "colar" una foto vieja
  o de otro lugar.
- Cada foto lleva **fecha, hora y coordenadas GPS incrustadas visualmente**
  en la propia imagen (no solo en metadatos, que se pierden fácil).
- Se registra también el GPS del **envío final** del formulario.
- Todo el cuestionario de tu Excel, con las ramas exactas On/Off.
- Guardado en **Google Sheets** (una fila por visita) + fotos en una
  **carpeta de Google Drive**, organizadas por cliente y fecha.
- Si no hay señal al enviar, la app **no pierde los datos**: los deja
  guardados en el teléfono hasta que se pueda reintentar.

**No incluido (quedó fuera a propósito, lo decidiste tú en la conversación):**
- **Geocerca dura que bloquee el envío** si el vendedor no está físicamente
  en la dirección del cliente. Lo que sí tienes es el registro de GPS para
  que puedas auditar después. Si más adelante quieres el bloqueo estricto,
  lo puedo agregar, pero necesito la latitud/longitud de cada cliente.
- **Autenticación real por usuario** (login con contraseña). Los 4
  ejecutivos se identifican eligiendo su nombre de una lista — no es
  imposible que alguien elija el nombre de otro. Si tus 4 ejecutivos tienen
  correo de Google Workspace de la empresa, hay una opción más segura (ver
  sección "Seguridad" al final).

---

## Parte 1 — Google Sheet (la base de datos)

1. Entra a [sheets.google.com](https://sheets.google.com) con la cuenta de
   Google donde quieres que viva toda la información.
2. Crea una hoja de cálculo en blanco. Nómbrala, por ejemplo,
   `FDC Ejecución PDV — Datos`.
3. Crea estas pestañas (clic derecho en la pestaña inferior → "Insertar
   hoja"), con estos encabezados **exactos** en la fila 1:

   **Pestaña `Clientes`**
   | A: Cliente | B: Canal |
   |---|---|
   | Amazonas | On |
   | Las Vegas | Off |

   (Agrega aquí toda tu cartera real. `Canal` debe ser exactamente `On` u
   `Off`, respetando mayúsculas.)

   **Pestaña `SKUS`**
   | A: SKU |
   |---|
   | FDC ES 4 750 |
   | FDC ES 4 1000 |
   | ... (los 16 de tu archivo original) |

   **Pestaña `Ejecutivos`**
   | A: Nombre |
   |---|
   | (nombre del ejecutivo 1) |
   | (nombre del ejecutivo 2) |
   | (nombre del ejecutivo 3) |
   | (nombre del ejecutivo 4) |

   No necesitas crear la pestaña `Respuestas` — el sistema la crea sola con
   los encabezados correctos la primera vez que alguien envía un formulario.

---

## Parte 2 — Carpeta de Google Drive (para las fotos)

**Ojo con esto**: no existe un botón que diga "Conectar Google Drive" en
ningún lado — esa idea de "conectar una cuenta" es de otras apps (como
conectar Instagram a Facebook). Aquí funciona distinto y es más simple de
lo que parece: **el Sheet, el Drive y el programa que escribimos viven
todos en tu misma cuenta de Google**, así que ya están "conectados" por el
simple hecho de pertenecerte a ti. Lo único que falta es decirle al
programa *cuál carpeta* usar, y darle permiso una sola vez para tocar tus
archivos (eso pasa en la Parte 3, paso 7 — ahí es el verdadero "momento de
conexión", y solo toma un clic).

Por ahora, solo necesitamos crear la carpeta y copiar su identificador:

1. Entra a [drive.google.com](https://drive.google.com), con la **misma
   cuenta** del paso anterior (tiene que ser la misma cuenta en ambos
   pasos, si no, el programa no va a encontrar ni el Sheet ni la carpeta).
2. Botón **"+ Nuevo" → "Carpeta"**. Nómbrala, por ejemplo,
   `FDC Ejecución PDV — Fotos`. Crear.
3. Haz doble clic para abrirla. Mira la barra de direcciones de tu
   navegador, vas a ver algo así:
   `https://drive.google.com/drive/folders/1A2b3C4d5E6f7G8h9I0jKlMnOpQrStU`
4. Copia solo la parte final, después de `/folders/` — eso es el **ID de
   la carpeta**. En el ejemplo de arriba sería
   `1A2b3C4d5E6f7G8h9I0jKlMnOpQrStU`. Pégalo en un bloc de notas por ahora,
   lo usas en el siguiente paso.

---

## Parte 3 — Backend (Google Apps Script) — aquí se hace la "conexión"

1. Abre tu Google Sheet del Paso 1 (el mismo donde creaste las pestañas
   `Clientes`, `SKUS`, `Ejecutivos`).
2. Ve al menú **Extensiones → Apps Script**. Se abre una pestaña nueva del
   navegador con un editor de código — esto es Google dándote un
   "programa en blanco" que ya vive dentro de tu cuenta y de este Sheet en
   particular.
3. Vas a ver un archivo de ejemplo con `function myFunction() {}`.
   Selecciona todo ese texto (Ctrl/Cmd+A) y bórralo.
4. Pega completo el contenido del archivo **`Code.gs`** que te entregué.
5. Edita, arriba del todo del código, estas dos líneas:
   ```js
   const TOKEN = "CAMBIA-ESTE-TOKEN-2026";           // invéntate una clave única
   const DRIVE_FOLDER_ID = "PEGA_AQUI_EL_ID_DE_TU_CARPETA_DE_DRIVE"; // el ID de la Parte 2
   ```
   El `TOKEN` puede ser cualquier texto que solo tú conozcas, por ejemplo
   `fdc-2026-x7k2m`. Anótalo, lo necesitas también en el frontend (Parte 4).
6. Guarda con el ícono de disquete arriba (o Ctrl/Cmd+S). Ponle nombre al
   proyecto si te lo pide, por ejemplo `FDC Backend`.
7. **Este es el paso que realmente "conecta" todo.** Arriba a la derecha,
   botón azul **Implementar → Nueva implementación**:
   - Haz clic en el ícono de engranaje ⚙️ junto a "Seleccionar tipo" y
     elige **Aplicación web**.
   - Descripción: escribe `v1`.
   - "Ejecutar como": deja **Yo (tu correo)** — esto es lo que le da al
     programa permiso para usar TU Drive y TU Sheet, como si tú misma lo
     estuvieras haciendo a mano.
   - "Quién tiene acceso": elige **Cualquier usuario** (así los 4
     ejecutivos pueden enviar datos desde la app sin necesitar ellos
     mismos una cuenta de Google).
   - Clic en **Implementar**.
8. Va a aparecer una ventana pidiendo **"Se requiere autorización"**. Este
   es el clic de conexión real:
   - Clic en **Revisar permisos**.
   - Elige tu cuenta de Google (la misma de siempre).
   - Es posible que veas una pantalla que dice *"Google no verificó esta
     app"* — es normal y esperado: significa que Google todavía no revisó
     manualmente tu script (porque es tuyo, personal, no público). Haz
     clic en **Avanzado** (abajo a la izquierda) y luego en
     **"Ir a FDC Backend (no seguro)"**.
   - Revisa los permisos que pide (ver y administrar tus hojas de cálculo
     y tus archivos de Drive) y clic en **Permitir**.
   - Con eso, listo — ya está conectado. No hay que repetir esto salvo que
     cambies de cuenta de Google.
9. De vuelta en la ventana de implementación, copia la **URL de la
   aplicación web**. Termina en `/exec`, algo así:
   `https://script.google.com/macros/s/AKfycb.../exec`
   Esa URL es la que pegas en `config.js` en la Parte 4.

**Si más adelante editas `Code.gs`:** tienes que volver a "Implementar →
Gestionar implementaciones → editar (lápiz) → Nueva versión → Implementar".
Solo guardar el archivo no actualiza la URL en producción.

---

## Parte 4 — Frontend (la app que abren los ejecutivos)

1. Abre el archivo **`config.js`** que te entregué y edita:
   ```js
   APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycb.../exec",
   SHARED_TOKEN: "fdc-2026-x7k2m",   // EXACTAMENTE el mismo TOKEN de Code.gs
   ```
2. Guarda el archivo.

### Publicarlo gratis con GitHub Pages (recomendado, cero costo)
1. Crea una cuenta gratis en [github.com](https://github.com) si no tienes.
2. Clic en **New repository**. Nombre, por ejemplo, `fdc-ejecucion`.
   Marca como **Public**. Crear.
3. Dentro del repo, botón **Add file → Upload files**. Arrastra todos los
   archivos de la carpeta que te entregué: `index.html`, `styles.css`,
   `app.js`, `config.js`, `manifest.json`, `sw.js`, `icon-192.png`,
   `icon-512.png`. Confirma el commit ("Commit changes").
4. Ve a **Settings → Pages** (menú lateral).
5. En "Build and deployment", fuente: **Deploy from a branch**, rama
   `main`, carpeta `/ (root)`. Guardar.
6. Espera 1–2 minutos. GitHub te da una URL como:
   `https://tu-usuario.github.io/fdc-ejecucion/`
7. Esa es la URL que comparten los 4 ejecutivos.

Cualquier vez que necesites cambiar `config.js` (por ejemplo, si vuelves a
desplegar el backend y la URL cambia), solo edita ese archivo directo en
GitHub (ícono de lápiz sobre el archivo) y confirma el cambio — no hace
falta volver a subir todo.

---

## Parte 5 — Instalar en el celular de cada ejecutivo

**iPhone (Safari):**
1. Abrir la URL en Safari (tiene que ser Safari, no Chrome, para que
   funcione "Agregar a inicio" como app).
2. Tocar el ícono de compartir (cuadro con flecha hacia arriba).
3. "Agregar a pantalla de inicio" → Agregar.

**Android (Chrome):**
1. Abrir la URL en Chrome.
2. Menú (⋮) → "Agregar a pantalla de inicio" / "Instalar app".

Desde ahí abre como cualquier otra app, en pantalla completa.

**La primera vez**, el teléfono pedirá permiso de **Cámara** y
**Ubicación** — hay que aceptar ambos, si no, no se puede completar el
checklist (es la regla de negocio, no un error).

---

## Parte 6 — Antes de salir a campo: probar

1. Abre la app instalada.
2. Llena una visita de prueba completa (elige un cliente de prueba si
   quieres) hasta el final y envía.
3. Revisa tu Google Sheet: debe aparecer una fila nueva en `Respuestas`,
   con columnas separadas de **Latitud** y **Longitud** para cada una de
   las 3 fotos (visibilidad, carta, materiales), además de la latitud y
   longitud del envío general del formulario.
4. Revisa tu carpeta de Drive: debe existir `Cliente de prueba/2026-08-27/`
   con 3 fotos, cada una con la franja de fecha/hora/GPS visible abajo.
5. Si algo falla, el mensaje de error en pantalla suele decir la causa
   (token incorrecto, backend no configurado, sin permiso de cámara, etc.).

---

## Mantenimiento (sin tocar código)

- **Agregar/quitar clientes:** editar la pestaña `Clientes` del Sheet.
- **Agregar/quitar SKUs:** editar la pestaña `SKUS`.
- **Agregar/quitar ejecutivos:** editar la pestaña `Ejecutivos`.
- La app lee estas listas frescas cada vez que se abre (necesita señal en
  ese momento; si no hay señal, usa la última lista que cargó).

---

## Seguridad — léelo antes de escalar esto a más gente

El `TOKEN` compartido es una protección razonable para 4 personas de
confianza, **no** es autenticación real: cualquiera que inspeccione el
código fuente de la página puede leerlo y, en teoría, escribir filas falsas
en tu Sheet. Para este tamaño de equipo es un riesgo aceptable, pero si
más adelante:
- creces a más ejecutivos, o
- tus 4 ejecutivos tienen correo corporativo de Google Workspace,

entonces en el Paso 3.6 puedes cambiar "Quién tiene acceso" a **"Cualquier
usuario de (tu dominio)"** en vez de "Cualquier usuario" — eso obliga a
iniciar sesión con Google antes de poder enviar datos, y ahí sí es
autenticación real, no un token que viaja en el código fuente. Avísame si
quieres que lo dejemos configurado así desde ya.
