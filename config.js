/**
 * CONFIGURACIÓN DE LA APP — EDITAR ESTO DESPUÉS DE DESPLEGAR EL BACKEND
 * ---------------------------------------------------------------------
 * 1) APPS_SCRIPT_URL: https://script.google.com/macros/s/AKfycbyIYSGf2JgRoPEi23CFNQ4nJX28o9BmZ9Kt7OpTub-njd9NUqmwMePYHSnzssCbb25U/exec
 * 2) SHARED_TOKEN:71421376
 *
 * No subas un token real a un repositorio público sin estar consciente
 * de que cualquiera que vea el código fuente de la página puede leerlo.
 * Para 4 ejecutivos internos esto es un nivel de protección razonable,
 * no es autenticación fuerte. Ver GUIA_INSTALACION.md, sección
 * "Seguridad" si más adelante quieren algo más robusto.
 */
window.APP_CONFIG = {
  APPS_SCRIPT_URL: https://script.google.com/macros/s/AKfycbyIYSGf2JgRoPEi23CFNQ4nJX28o9BmZ9Kt7OpTub-njd9NUqmwMePYHSnzssCbb25U/exec,
  SHARED_TOKEN: 71421376,

  // Se usan SOLO si el backend no responde (primera prueba sin desplegar aún,
  // o sin señal). En cuanto el backend esté configurado, la app siempre
  // prioriza los datos frescos de tu Google Sheet (pestañas Clientes,
  // SKUS, Ejecutivos), así que editar esas listas ahí no requiere tocar código.
  FALLBACK_SKUS: [
    "FDC ES 4 750", "FDC ES 4 1000", "FDC 4 750", "FDC 4 1000", "FDC 4 1750",
    "FDC 5 750", "FDC 5 1000", "FDC 5 1750", "FDC SPRESSO 750", "FDC 7 750",
    "FDC 7 1000", "FDC 12 750", "FDC ECO 750", "FDC 18 750", "FDC 130 750", "FDC 25 750"
  ],
  FALLBACK_CLIENTES: [],
  FALLBACK_EJECUTIVOS: []
};
