/**
 * FDC — Ejecución PDV — Backend (Google Apps Script)
 * ----------------------------------------------------
 * Pega esto en Extensions > Apps Script DEL MISMO Google Sheet que usarás
 * como base de datos (así SpreadsheetApp.getActiveSpreadsheet() ya apunta
 * al lugar correcto sin que tengas que buscar un ID).
 *
 * Ver GUIA_INSTALACION.md para el paso a paso completo de despliegue.
 */

// ============ CONFIGURACIÓN — EDITAR ESTOS DOS VALORES ============
const TOKEN = "CAMBIA-ESTE-TOKEN-2026";           // debe ser IDÉNTICO al de config.js en el frontend
const DRIVE_FOLDER_ID = "PEGA_AQUI_EL_ID_DE_TU_CARPETA_DE_DRIVE";
// =====================================================================

const SHEET_RESPUESTAS = "Respuestas";
const SHEET_CLIENTES = "Clientes";
const SHEET_SKUS = "SKUS";
const SHEET_EJECUTIVOS = "Ejecutivos";

const HEADERS = [
  "Fecha/Hora envío (servidor)", "Ejecutivo", "Cliente", "Canal",
  "Latitud envío", "Longitud envío", "Precisión GPS envío (m)", "Mapa envío",
  "Portafolio (SKUs disponibles)", "Visibilidad (SKUs visibles)",
  "Foto visibilidad (Drive)", "Fecha/hora foto visibilidad",
  "Latitud foto visibilidad", "Longitud foto visibilidad", "Mapa foto visibilidad",
  "3.4.1 Cócteles FDC (On)", "3.4.1 Cantidad cócteles (On)",
  "3.4.2 Botellas FDC (On)", "3.4.2 Listado botellas (On)",
  "3.4.3 Activación menú (On)", "3.4.4 Comunicación combos (Off)",
  "Foto carta (Drive)", "Fecha/hora foto carta",
  "Latitud foto carta", "Longitud foto carta", "Mapa foto carta",
  "4.1 PVP FDC 4 750", "4.2 PVP FDC ES 4 750", "4.3 PVP FDC 12 750",
  "4.4 PVP Jack Daniels 7/Sabores", "4.5 PVP JW Red", "4.6 PVP JW Black",
  "5.1 Vasos pavonados (On)", "5.2 Hieleras (On)", "5.3 Vasos vidrio (On)",
  "5.4 Barmats (On)", "5.5 Luminoso FDC (On)", "5.6 Banner/pizarra promos (Off)",
  "Foto materiales (Drive)", "Fecha/hora foto materiales",
  "Latitud foto materiales", "Longitud foto materiales", "Mapa foto materiales",
  "6. Barstaff necesita capacitación (On)",
  "Fecha/hora envío (dispositivo)", "Versión app"
];

function doGet(e) {
  const token = e && e.parameter && e.parameter.token;
  if (token !== TOKEN) {
    return jsonOut({ ok: false, error: "Token inválido." });
  }
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    return jsonOut({
      ok: true,
      clientes: readClientes_(ss),
      skus: readSingleColumn_(ss, SHEET_SKUS),
      ejecutivos: readSingleColumn_(ss, SHEET_EJECUTIVOS)
    });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut({ ok: false, error: "Sin cuerpo en la solicitud." });
    }
    const payload = JSON.parse(e.postData.contents);
    if (payload.token !== TOKEN) {
      return jsonOut({ ok: false, error: "Token inválido." });
    }
    if (!payload.ejecutivo || !payload.canal || !payload.cliente) {
      return jsonOut({ ok: false, error: "Faltan datos obligatorios (ejecutivo, canal o cliente)." });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateSheet_(ss, SHEET_RESPUESTAS, HEADERS);
    const rootFolder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    const clientFolder = getOrCreateSubfolder_(rootFolder, sanitizeName_(payload.cliente));
    const dateFolder = getOrCreateSubfolder_(clientFolder, formatDateFolder_(new Date()));

    const fotoVis = savePhoto_(dateFolder, payload.foto_visibilidad, payload.ejecutivo, "visibilidad");
    const fotoCarta = savePhoto_(dateFolder, payload.foto_carta, payload.ejecutivo, "carta");
    const fotoMat = savePhoto_(dateFolder, payload.foto_materiales, payload.ejecutivo, "materiales");

    const gpsEnvio = payload.gps_envio || {};
    const carta = payload.carta || {};
    const precios = payload.precios || {};
    const materiales = payload.materiales || {};

    const row = [
      new Date(),
      payload.ejecutivo,
      payload.cliente,
      payload.canal,
      gpsEnvio.lat || "", gpsEnvio.lng || "", gpsEnvio.acc ? Math.round(gpsEnvio.acc) : "",
      gpsEnvio.lat ? ("https://www.google.com/maps?q=" + gpsEnvio.lat + "," + gpsEnvio.lng) : "",
      (payload.portafolio || []).join(", "),
      (payload.visibilidad || []).join(", "),
      fotoVis.url, fotoVis.timestamp, fotoVis.lat, fotoVis.lng, fotoVis.mapUrl,
      carta.cocteles_si_no || "", carta.cantidad_cocteles || "",
      carta.botellas_si_no || "", (carta.lista_botellas || []).join(", "),
      carta.activacion_menu || "", carta.combos_off || "",
      fotoCarta.url, fotoCarta.timestamp, fotoCarta.lat, fotoCarta.lng, fotoCarta.mapUrl,
      precios.fdc_4_750 || "", precios.fdc_es_4_750 || "", precios.fdc_12_750 || "",
      precios.jack_daniels || "", precios.jw_red || "", precios.jw_black || "",
      materiales.vasos_pavonados || "", materiales.hieleras || "", materiales.vasos_vidrio || "",
      materiales.barmats || "", materiales.luminoso || "", materiales.banner_promos || "",
      fotoMat.url, fotoMat.timestamp, fotoMat.lat, fotoMat.lng, fotoMat.mapUrl,
      payload.capacitacion || "",
      payload.submitted_at_local || "",
      payload.app_version || ""
    ];
    sheet.appendRow(row);

    return jsonOut({ ok: true });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readClientes_(ss) {
  const sheet = ss.getSheetByName(SHEET_CLIENTES);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  return values
    .filter(function (r) { return r[0] && r[1]; })
    .map(function (r) { return { nombre: String(r[0]).trim(), canal: String(r[1]).trim() }; });
}

function readSingleColumn_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  return values.map(function (r) { return String(r[0]).trim(); }).filter(function (v) { return v; });
}

function getOrCreateSubfolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}

function sanitizeName_(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, "-").trim() || "Cliente sin nombre";
}

function formatDateFolder_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone() || "America/Lima", "yyyy-MM-dd");
}

function savePhoto_(folder, photo, ejecutivo, tipo) {
  const empty = { url: "", timestamp: "", lat: "", lng: "", mapUrl: "" };
  if (!photo || !photo.dataUrl) return empty;
  const match = /^data:(image\/\w+);base64,(.*)$/.exec(photo.dataUrl);
  if (!match) return empty;
  const mime = match[1];
  const base64 = match[2];
  const bytes = Utilities.base64Decode(base64);
  const ext = mime.indexOf("png") !== -1 ? "png" : "jpg";
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "America/Lima", "yyyyMMdd_HHmmss");
  const filename = sanitizeName_(ejecutivo) + "_" + tipo + "_" + stamp + "." + ext;
  const blob = Utilities.newBlob(bytes, mime, filename);
  const file = folder.createFile(blob);
  const hasGps = typeof photo.lat === "number" && typeof photo.lng === "number";
  return {
    url: file.getUrl(),
    timestamp: photo.timestamp || "",
    lat: hasGps ? photo.lat : "",
    lng: hasGps ? photo.lng : "",
    mapUrl: hasGps ? ("https://www.google.com/maps?q=" + photo.lat + "," + photo.lng) : ""
  };
}
