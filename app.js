/* =====================================================================
   FDC — Checklist de ejecución en punto de venta
   Lógica de la app. Sin dependencias externas (debe cargar sin señal).
   ===================================================================== */

(function () {
  "use strict";

  const CFG = window.APP_CONFIG || {};
  const PENDING_KEY = "fdc_pending_submit_v4";
  const DRAFT_KEY = "fdc_draft_v4";

  const RUTINA_LABELS = {
    cartera: "Visita cliente cartera",
    activacion: "Activación On Trade",
    matinal: "Matinal / Vespertina",
    prospeccion: "Prospección"
  };

  const PRICE_FIELDS = [
    { key: "fdc_4_750", label: "PVP FDC 4 750", channels: ["On", "Off"] },
    { key: "fdc_es_4_750", label: "PVP FDC ES 4 750", channels: ["On", "Off"] },
    { key: "fdc_5_750", label: "PVP FDC 5 750", channels: ["Off"] },
    { key: "fdc_7_750", label: "PVP FDC 7 750", channels: ["On", "Off"] },
    { key: "fdc_12_750", label: "PVP FDC 12 750", channels: ["On", "Off"] },
    { key: "fdc_18_750", label: "PVP FDC 18 750", channels: ["On"] },
    { key: "jack_daniels", label: "PVP Jack Daniels/Sabores", channels: ["On", "Off"] },
    { key: "bacardi_oro", label: "PVP Bacardi Oro", channels: ["On", "Off"] },
    { key: "diplomatico_mantuano", label: "PVP Diplomático Mantuano", channels: ["On", "Off"] },
    { key: "garrafa_blanco_bacardi", label: "PVP Garrafa Blanco Bacardi", channels: ["On", "Off"] },
    { key: "jw_red", label: "PVP JW Red", channels: ["On", "Off"] },
    { key: "jw_black", label: "PVP JW Black", channels: ["On", "Off"] },
    { key: "jw_gold", label: "PVP JW Gold", channels: ["On", "Off"] }
  ];

  function freshPrecios() {
    const o = {};
    PRICE_FIELDS.forEach(function (f) { o[f.key] = { value: "", na: false }; });
    return o;
  }
  function freshMateriales() {
    return { vasos_pavonados: "", hieleras: "", vasos_vidrio: "", barmats: "", luminoso: "", banner_promos: "" };
  }
  function normalizeSkus(list) {
    return (list || []).map(function (s) { return typeof s === "string" ? { sku: s, starOn: false, starOff: false } : s; });
  }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function todayDateStr() {
    const d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function currentMonthStr() {
    const d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1);
  }

  // ---------------------------------------------------------------
  // Estado
  // ---------------------------------------------------------------
  const state = {
    skus: normalizeSkus(CFG.FALLBACK_SKUS),
    clientes: (CFG.FALLBACK_CLIENTES || []).slice(),
    ejecutivos: (CFG.FALLBACK_EJECUTIVOS || []).slice(),
    codistribuidores: (CFG.FALLBACK_CODISTRIBUIDORES || []).slice(),

    view: "form", // "form" | "resumen"

    stepIndex: 0,
    submitting: false,
    submitError: "",
    _gpsRequested: false,

    ejecutivo: "",
    rutina: "",
    canal: "",
    cliente: "",

    portafolio: [],
    visibilidad: [],
    fotoVisibilidad: null,
    cartaCocteles: "", cartaCantidadCocteles: "",
    cartaBotellasSiNo: "", cartaListaBotellas: [],
    cartaActivacionMenu: "", cartaCombosOff: "",
    fotoCarta: null,
    precios: freshPrecios(),
    materiales: freshMateriales(),
    fotoMateriales: null,
    capacitacion: "",

    fotosRitual: [],
    fotosConsumo: [],

    matinalRegion: "", matinalCodistribuidor: "", matinalLocalidad: "",
    fotoMatinal: null,

    esClienteNuevo: false,
    prospeccionCodigo: "", prospeccionRazonSocial: "",
    resultado: "", compraSkus: [], compraCajas: {},
    seguimientoCajas: "", seguimientoMarca: "",
    fotoCheckout: null,

    gpsEnvio: null,

    // --- resumen ---
    resumenTab: "dia", // "dia" | "mes"
    resumenDay: todayDateStr(),
    resumenMonth: currentMonthStr(),
    resumenData: null,
    resumenLoading: false,
    resumenError: "",

    // --- mapa ---
    mapaUserPos: null,
    mapaError: ""
  };

  // ---------------------------------------------------------------
  // Utilidades genéricas
  // ---------------------------------------------------------------
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === "class") node.className = attrs[k];
      else if (k === "html") node.innerHTML = attrs[k];
      else if (k.indexOf("on") === 0 && typeof attrs[k] === "function") node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }
  function fmtTimestamp(d) {
    return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }
  function fmtCoord(n) { return typeof n === "number" ? n.toFixed(6) : "—"; }

  function getPosition(timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (!("geolocation" in navigator)) { reject(new Error("Este navegador no soporta geolocalización.")); return; }
      navigator.geolocation.getCurrentPosition(
        function (pos) { resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, timestamp: new Date().toISOString() }); },
        function (err) { reject(err); },
        { enableHighAccuracy: true, timeout: timeoutMs || 12000, maximumAge: 5000 }
      );
    });
  }

  function saveDraft() { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)); } catch (e) {} }
  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      Object.keys(saved).forEach(function (k) {
        if (["stepIndex", "submitting", "submitError", "_gpsRequested", "view", "resumenData", "resumenLoading", "resumenError", "mapaUserPos", "mapaError"].indexOf(k) !== -1) return;
        state[k] = saved[k];
      });
    } catch (e) {}
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }

  // ---------------------------------------------------------------
  // Configuración remota
  // ---------------------------------------------------------------
  async function loadRemoteConfig() {
    if (!CFG.APPS_SCRIPT_URL || CFG.APPS_SCRIPT_URL.indexOf("PEGA_AQUI") === 0) return;
    try {
      const url = CFG.APPS_SCRIPT_URL + "?token=" + encodeURIComponent(CFG.SHARED_TOKEN);
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (data && data.ok) {
        if (Array.isArray(data.skus) && data.skus.length) state.skus = normalizeSkus(data.skus);
        if (Array.isArray(data.clientes)) state.clientes = data.clientes;
        if (Array.isArray(data.ejecutivos)) state.ejecutivos = data.ejecutivos;
        if (Array.isArray(data.codistribuidores)) state.codistribuidores = data.codistribuidores;
      }
    } catch (e) { console.warn("No se pudo cargar la configuración remota:", e.message); }
  }

  async function fetchResumen() {
    if (!CFG.APPS_SCRIPT_URL || CFG.APPS_SCRIPT_URL.indexOf("PEGA_AQUI") === 0) {
      state.resumenError = "El backend aún no está configurado (config.js).";
      render();
      return;
    }
    state.resumenLoading = true; state.resumenError = ""; render();
    try {
      const url = CFG.APPS_SCRIPT_URL + "?token=" + encodeURIComponent(CFG.SHARED_TOKEN) +
        "&action=resumen&day=" + encodeURIComponent(state.resumenDay) + "&month=" + encodeURIComponent(state.resumenMonth);
      const res = await fetch(url, { method: "GET" });
      const data = await res.json();
      if (!data || !data.ok) throw new Error((data && data.error) || "Error desconocido");
      state.resumenData = data;
    } catch (e) {
      state.resumenError = "No se pudo cargar el resumen (" + e.message + ").";
    }
    state.resumenLoading = false;
    render();
  }

  function skuNames() { return state.skus.map(function (s) { return s.sku; }); }
  function isStarred(sku, canal) {
    const s = state.skus.find(function (x) { return x.sku === sku; });
    if (!s) return false;
    return canal === "Off" ? !!s.starOff : !!s.starOn;
  }
  function regiones() {
    const seen = [];
    state.codistribuidores.forEach(function (c) { if (seen.indexOf(c.region) === -1) seen.push(c.region); });
    return seen;
  }
  function codistribuidoresEnRegion(region) {
    const seen = [];
    state.codistribuidores.forEach(function (c) { if (c.region === region && seen.indexOf(c.codistribuidor) === -1) seen.push(c.codistribuidor); });
    return seen;
  }
  function localidadesDe(region, codistribuidor) {
    const rec = state.codistribuidores.find(function (c) { return c.region === region && c.codistribuidor === codistribuidor; });
    return rec ? rec.localidades : [];
  }

  // =================================================================
  // CÁMARA
  // =================================================================
  function openCamera(label, facing) {
    facing = facing || "environment";
    return new Promise(function (resolve, reject) {
      const overlay = el("div", { class: "camera-overlay" }, []);
      const badge = el("div", { class: "camera-badge" }, ["Obteniendo ubicación GPS…"]);
      const video = el("video", { autoplay: "true", playsinline: "true", muted: "true" }, []);
      const hud = el("div", { class: "camera-hud" }, []);
      const shutterBtn = el("button", { class: "shutter", disabled: "true" }, ["Capturar"]);
      const cancelBtn = el("button", { class: "cam-cancel" }, ["Cancelar"]);
      hud.appendChild(cancelBtn); hud.appendChild(shutterBtn);
      overlay.appendChild(video); overlay.appendChild(badge); overlay.appendChild(hud);
      document.body.appendChild(overlay);
      if (facing === "user") video.style.transform = "scaleX(-1)";

      let stream = null, livePos = null, cancelled = false;
      function cleanup() {
        if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }
      cancelBtn.addEventListener("click", function () { cancelled = true; cleanup(); reject(new Error("cancelled")); });
      getPosition(10000).then(function (pos) {
        livePos = pos;
        badge.textContent = "Ubicación lista · precisión ±" + Math.round(pos.acc) + " m";
      }).catch(function () { badge.textContent = "No se pudo obtener GPS. Revisa permisos de ubicación e inténtalo de nuevo."; });

      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } }, audio: false }).then(function (s) {
        if (cancelled) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
        stream = s; video.srcObject = s; shutterBtn.disabled = false;
      }).catch(function (err) { cleanup(); reject(new Error("No se pudo abrir la cámara: " + err.message)); });

      shutterBtn.addEventListener("click", function () {
        if (!livePos) { badge.textContent = "Aún no hay GPS — espera un segundo e intenta de nuevo."; return; }
        const track = stream.getVideoTracks()[0];
        const settings = track.getSettings ? track.getSettings() : {};
        const w = settings.width || video.videoWidth || 1280;
        const h = settings.height || video.videoHeight || 720;
        const maxW = 1280;
        const scale = w > maxW ? maxW / w : 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext("2d");
        if (facing === "user") { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        const now = new Date();
        const line1 = fmtTimestamp(now) + "  ·  " + label;
        const line2 = "GPS " + fmtCoord(livePos.lat) + ", " + fmtCoord(livePos.lng) + "  (±" + Math.round(livePos.acc) + " m)";
        const barH = Math.max(46, Math.round(canvas.height * 0.09));
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(0, canvas.height - barH, canvas.width, barH);
        ctx.fillStyle = "#FFFFFF";
        const fontSize = Math.max(13, Math.round(canvas.width / 42));
        ctx.font = "bold " + fontSize + "px sans-serif";
        ctx.fillText(line1, 12, canvas.height - barH + fontSize + 6);
        ctx.font = fontSize + "px sans-serif";
        ctx.fillText(line2, 12, canvas.height - barH + fontSize * 2 + 10);

        const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
        cleanup();
        resolve({ dataUrl: dataUrl, lat: livePos.lat, lng: livePos.lng, acc: livePos.acc, timestamp: now.toISOString(), label: label });
      });
    });
  }

  // =================================================================
  // RENDER — wizard
  // =================================================================
  const root = document.getElementById("app");

  function buildSteps() {
    const steps = ["identificacion"];
    if (state.rutina === "cartera") {
      steps.push("portafolio", "visibilidad", "foto_visibilidad", "carta", "foto_carta", "precios", "materiales", "foto_materiales");
      if (state.canal === "On") steps.push("capacitacion");
    } else if (state.rutina === "activacion") {
      steps.push("foto_ritual", "foto_consumo");
    } else if (state.rutina === "matinal") {
      steps.push("foto_matinal");
    } else if (state.rutina === "prospeccion") {
      steps.push("resultado_prospeccion", "foto_checkout");
    }
    if (state.rutina) steps.push("revision");
    return steps;
  }

  function clientesForCanal(canal) { return state.clientes.filter(function (c) { return c.canal === canal && c.ejecutivo === state.ejecutivo; }); }
  function setStep(idx) { state.stepIndex = idx; render(); root.scrollTop = 0; window.scrollTo(0, 0); }
  function goNext() {
    const steps = buildSteps();
    const errs = validateStep(steps[state.stepIndex]);
    if (errs.length) { state.submitError = errs[0]; render(); return; }
    state.submitError = ""; saveDraft();
    if (state.stepIndex < steps.length - 1) setStep(state.stepIndex + 1);
  }
  function goBack() { if (state.stepIndex > 0) { state.submitError = ""; setStep(state.stepIndex - 1); } }

  function validateStep(stepName) {
    const errs = [];
    switch (stepName) {
      case "identificacion":
        if (!state.ejecutivo) errs.push("Selecciona qué ejecutivo está haciendo la visita.");
        if (!state.rutina) errs.push("Selecciona qué tipo de rutina vas a registrar.");
        else if (state.rutina === "cartera") {
          if (!state.canal) errs.push("Selecciona el canal (On / Off).");
          if (!state.cliente) errs.push("Selecciona la razón comercial del cliente.");
        } else if (state.rutina === "activacion") {
          if (!state.cliente) errs.push("Selecciona la razón comercial del cliente.");
        } else if (state.rutina === "matinal") {
          if (!state.matinalRegion) errs.push("Selecciona la región.");
          if (!state.matinalCodistribuidor) errs.push("Selecciona el codistribuidor.");
          if (!state.matinalLocalidad) errs.push("Selecciona la localidad.");
        } else if (state.rutina === "prospeccion") {
          if (!state.esClienteNuevo && !state.prospeccionCodigo) errs.push("Ingresa el código de cliente, o marca 'Es cliente nuevo'.");
          if (!state.prospeccionRazonSocial) errs.push("Ingresa la razón comercial.");
          if (!state.canal) errs.push("Selecciona el canal (On / Off).");
        }
        break;
      case "portafolio":
        if (state.portafolio.length === 0) errs.push("Selecciona al menos un SKU disponible (o confirma que no hay ninguno antes de continuar).");
        break;
      case "visibilidad": break;
      case "foto_visibilidad":
        if (!state.fotoVisibilidad) errs.push("Toma la foto de contrabarra/góndola.");
        break;
      case "carta":
        if (state.canal === "On") {
          if (!state.cartaCocteles) errs.push("Indica si hay cócteles FDC (Sí/No).");
          if (state.cartaCocteles === "Si" && !state.cartaCantidadCocteles) errs.push("Indica cuántos cócteles FDC hay.");
          if (!state.cartaBotellasSiNo) errs.push("Indica si hay botellas FDC (Sí/No).");
          if (state.cartaBotellasSiNo === "Si" && state.cartaListaBotellas.length === 0) errs.push("Selecciona qué botellas FDC hay en carta.");
          if (!state.cartaActivacionMenu) errs.push("Indica si hay activación en el menú.");
        } else if (state.canal === "Off") {
          if (!state.cartaCombosOff) errs.push("Indica si hay comunicación de combos FDC.");
        }
        break;
      case "foto_carta":
        if (!state.fotoCarta) errs.push("Toma la foto de la carta.");
        break;
      case "precios":
        PRICE_FIELDS.filter(function (f) { return f.channels.indexOf(state.canal) !== -1; }).forEach(function (f) {
          const p = state.precios[f.key];
          if (!p.na && (p.value === "" || p.value === null)) errs.push("Ingresa el " + f.label + " o márcalo como 'No aplica'.");
          else if (!p.na && (isNaN(Number(p.value)) || Number(p.value) < 0)) errs.push(f.label + " debe ser un número válido.");
        });
        break;
      case "materiales":
        if (state.canal === "On") {
          ["vasos_pavonados", "hieleras", "vasos_vidrio", "barmats", "luminoso"].forEach(function (k) {
            if (!state.materiales[k]) errs.push("Responde la pregunta de materiales pendiente.");
          });
        } else if (state.canal === "Off") {
          if (!state.materiales.banner_promos) errs.push("Indica si tiene banner/pizarra de promos.");
        }
        break;
      case "foto_materiales":
        if (!state.fotoMateriales) errs.push("Toma la foto de materiales.");
        break;
      case "capacitacion":
        if (state.canal === "On" && !state.capacitacion) errs.push("Indica si el barstaff necesita capacitación.");
        break;
      case "foto_ritual":
        if (state.fotosRitual.length < 1) errs.push("Toma al menos 1 foto del ritual servido 12+.");
        break;
      case "foto_consumo":
        if (state.fotosConsumo.length < 1) errs.push("Toma al menos 1 foto de consumo.");
        break;
      case "foto_matinal":
        if (!state.fotoMatinal) errs.push("Toma la foto (cámara frontal) de la Matinal/Vespertina.");
        break;
      case "resultado_prospeccion":
        if (!state.resultado) errs.push("Selecciona el resultado de la visita.");
        else if (state.resultado === "Compra") {
          if (state.compraSkus.length === 0) errs.push("Selecciona al menos un SKU comprado.");
          state.compraSkus.forEach(function (sku) {
            const c = state.compraCajas[sku];
            if (!c || Number(c) <= 0) errs.push("Indica cuántas cajas de " + sku + " se compraron.");
          });
        } else if (state.resultado === "Seguimiento") {
          if (!state.seguimientoCajas || Number(state.seguimientoCajas) < 0) errs.push("Indica el volumen estimado de cajas de ron mensuales.");
          if (!state.seguimientoMarca) errs.push("Indica qué marca consume actualmente.");
        }
        break;
      case "foto_checkout":
        if (!state.fotoCheckout) errs.push("Toma la foto de check out.");
        break;
      case "revision":
        if (!state.gpsEnvio) errs.push("Aún no se ha registrado la ubicación de envío. Espera unos segundos o toca «Reintentar ubicación».");
        break;
    }
    return errs;
  }
  function validateAll() {
    let errs = [];
    buildSteps().forEach(function (s) { errs = errs.concat(validateStep(s)); });
    return errs;
  }

  // ---------------------------------------------------------------
  // Componentes reutilizables
  // ---------------------------------------------------------------
  function fieldWrap(labelText, required, node, hintText) {
    const label = el("label", { class: "field-label" + (required ? " field-required" : "") }, [labelText]);
    const wrap = el("div", { class: "field" }, [label, node]);
    if (hintText) wrap.appendChild(el("div", { class: "step-hint", style: "margin-top:6px" }, [hintText]));
    return wrap;
  }
  function segControl(options, value, onChange) {
    const seg = el("div", { class: "seg" }, []);
    options.forEach(function (opt) {
      seg.appendChild(el("button", { type: "button", class: opt === value ? "active" : "", onclick: function () { onChange(opt); render(); } }, [opt]));
    });
    return seg;
  }
  function optionCards(options, value, onPick) {
    const wrap = el("div", { style: "display:flex; flex-direction:column; gap:10px" }, []);
    options.forEach(function (opt) {
      const active = opt.value === value;
      wrap.appendChild(el("button", { type: "button", class: "chip" + (active ? " checked" : ""), style: "width:100%; justify-content:flex-start; text-align:left", onclick: function () { onPick(opt.value); render(); } },
        [el("span", { class: "chip-text", style: "font-weight:700" }, [opt.label])]));
    });
    return wrap;
  }
  function chipMultiSelect(list, selected, onToggle, disabledPredicate, canalForStar) {
    const grid = el("div", { class: "chip-grid" }, []);
    list.forEach(function (item) {
      const checked = selected.indexOf(item) !== -1;
      const disabled = disabledPredicate ? disabledPredicate(item) : false;
      const cb = el("input", { type: "checkbox" });
      cb.checked = checked; cb.disabled = disabled;
      const label = (canalForStar && isStarred(item, canalForStar) ? "⭐ " : "") + item;
      const chip = el("label", { class: "chip" + (checked ? " checked" : "") + (disabled ? " disabled" : "") }, [cb, el("span", { class: "chip-text" }, [label])]);
      cb.addEventListener("change", function () { onToggle(item); render(); });
      grid.appendChild(chip);
    });
    return grid;
  }
  function skuQuantitySelector(list, selected, quantities, onToggle, onQtyChange) {
    const wrap = el("div", { style: "display:flex; flex-direction:column; gap:10px" }, []);
    list.forEach(function (sku) {
      const checked = selected.indexOf(sku) !== -1;
      const row = el("div", { class: "chip" + (checked ? " checked" : ""), style: "justify-content:space-between" }, []);
      const cb = el("input", { type: "checkbox" });
      cb.checked = checked;
      cb.addEventListener("change", function () { onToggle(sku); render(); });
      const left = el("label", { style: "display:flex; align-items:center; gap:10px; flex:1" }, [cb, el("span", { class: "chip-text" }, [sku])]);
      row.appendChild(left);
      if (checked) {
        const qty = el("input", { type: "number", min: "1", inputmode: "numeric", placeholder: "Cajas", style: "width:84px; min-height:40px; text-align:center", value: quantities[sku] || "" });
        qty.addEventListener("input", function (e) { onQtyChange(sku, e.target.value); });
        row.appendChild(qty);
      }
      wrap.appendChild(row);
    });
    return wrap;
  }
  function photoSlot(current, label, facing, onCapture) {
    if (current) {
      return el("div", { class: "photo-slot filled" }, [
        el("img", { src: current.dataUrl, alt: label }),
        el("div", { class: "photo-meta" }, ["Capturada " + fmtTimestamp(new Date(current.timestamp)) + " · GPS " + fmtCoord(current.lat) + ", " + fmtCoord(current.lng)]),
        el("div", { style: "padding:10px" }, [el("button", { class: "camera-btn", type: "button", onclick: function () { openCamera(label, facing).then(function (photo) { onCapture(photo); render(); }).catch(function () {}); } }, ["Repetir foto"])])
      ]);
    }
    return el("div", { class: "photo-slot" }, [
      el("p", { class: "step-hint", style: "margin-top:0" }, ["Se abrirá la cámara en vivo" + (facing === "user" ? " frontal" : "") + ". No se puede adjuntar desde la galería."]),
      el("button", { class: "camera-btn", type: "button", onclick: function () { openCamera(label, facing).then(function (photo) { onCapture(photo); render(); }).catch(function () {}); } }, ["📷 Abrir cámara"])
    ]);
  }
  function photoMultiSlot(photos, label, facing, minCount, onAdd, onRemove) {
    const wrap = el("div", {}, []);
    if (photos.length) {
      const grid = el("div", { class: "chip-grid" }, []);
      photos.forEach(function (p, i) {
        grid.appendChild(el("div", { class: "photo-slot filled" }, [
          el("img", { src: p.dataUrl, alt: label + " " + (i + 1) }),
          el("div", { class: "photo-meta" }, [fmtTimestamp(new Date(p.timestamp))]),
          el("div", { style: "padding:8px" }, [el("button", { class: "camera-btn", type: "button", style: "background:transparent; color:var(--white); border:1.5px solid var(--tint-30)", onclick: function () { onRemove(i); render(); } }, ["Quitar"])])
        ]));
      });
      wrap.appendChild(grid);
      wrap.appendChild(el("p", { class: "step-hint", style: "margin-top:12px" }, [photos.length + " foto(s) · mínimo " + minCount + "."]));
    } else {
      wrap.appendChild(el("p", { class: "step-hint", style: "margin-top:0" }, ["Se abrirá la cámara en vivo. Mínimo " + minCount + " foto(s), sin máximo."]));
    }
    wrap.appendChild(el("button", { class: "camera-btn", type: "button", style: "margin-top:10px", onclick: function () { openCamera(label, facing).then(function (photo) { onAdd(photo); render(); }).catch(function () {}); } }, [photos.length ? "📷 Agregar otra foto" : "📷 Abrir cámara"]));
    return wrap;
  }
  function searchableSelect(list, value, placeholder, onPick) {
    const wrap = el("div", { class: "searchbox" }, []);
    const input = el("input", { type: "search", placeholder: placeholder, value: value || "" });
    wrap.appendChild(input);
    let listBox = null;
    function closeList() { if (listBox && listBox.parentNode) listBox.parentNode.removeChild(listBox); listBox = null; }
    function openList(filter) {
      closeList();
      const filtered = list.filter(function (name) { return name.toLowerCase().indexOf((filter || "").toLowerCase()) !== -1; }).slice(0, 30);
      if (filtered.length === 0) return;
      listBox = el("div", { class: "searchbox-list" }, []);
      filtered.forEach(function (name) { listBox.appendChild(el("button", { type: "button", onclick: function () { onPick(name); closeList(); render(); } }, [name])); });
      wrap.appendChild(listBox);
    }
    input.addEventListener("focus", function () { openList(input.value); });
    input.addEventListener("input", function () { onPick(""); openList(input.value); });
    input.addEventListener("blur", function () { setTimeout(closeList, 150); });
    return wrap;
  }

  // ---------------------------------------------------------------
  // Vistas por paso
  // ---------------------------------------------------------------
  function viewIdentificacion() {
    const nodes = [
      el("h2", { class: "step-title" }, ["Datos de la visita"]),
      el("p", { class: "step-hint" }, ["Completa esto de pie, dentro del punto de venta."]),
      el("div", { style: "display:flex; gap:10px; margin-bottom:20px; flex-wrap:wrap" }, [
        el("button", { class: "camera-btn", type: "button", style: "background:transparent; color:var(--white); border:1.5px solid var(--tint-30)", onclick: function () { state.view = "resumen"; if (!state.resumenData) fetchResumen(); else render(); } }, ["📊 Ver resumen"]),
        el("button", {
          class: "camera-btn", type: "button",
          style: "background:transparent; color:var(--white); border:1.5px solid var(--tint-30)" + (state.ejecutivo ? "" : "; opacity:0.5"),
          disabled: state.ejecutivo ? null : "true",
          onclick: function () { state.view = "mapa"; render(); }
        }, ["🗺️ Ver mapa"])
      ])
    ];

    if (!state.ejecutivo) {
      nodes.push(el("p", { class: "step-hint", style: "margin-top:-14px" }, ["Elige tu nombre para poder ver el mapa de tus clientes."]));
    }

    nodes.push(fieldWrap("Ejecutivo", true,
      state.ejecutivos.length
        ? el("select", { onchange: function (e) { state.ejecutivo = e.target.value; state.cliente = ""; render(); } },
            [el("option", { value: "" }, ["Selecciona…"])].concat(state.ejecutivos.map(function (n) {
              const o = el("option", { value: n }, [n]);
              if (n === state.ejecutivo) o.setAttribute("selected", "true");
              return o;
            })))
        : el("input", { type: "text", placeholder: "Escribe tu nombre", value: state.ejecutivo, oninput: function (e) { state.ejecutivo = e.target.value; } })
    ));

    nodes.push(fieldWrap("Tipo de rutina", true, optionCards([
      { value: "cartera", label: RUTINA_LABELS.cartera },
      { value: "activacion", label: RUTINA_LABELS.activacion },
      { value: "matinal", label: RUTINA_LABELS.matinal },
      { value: "prospeccion", label: RUTINA_LABELS.prospeccion }
    ], state.rutina, function (v) {
      if (v !== state.rutina) { state.canal = ""; state.cliente = ""; }
      state.rutina = v;
    })));

    if (state.rutina === "cartera") {
      nodes.push(fieldWrap("Canal", true, segControl(["On", "Off"], state.canal, function (v) { if (v !== state.canal) state.cliente = ""; state.canal = v; })));
      if (state.canal) {
        const names = clientesForCanal(state.canal).map(function (c) { return c.nombre; });
        nodes.push(fieldWrap("Razón comercial", true,
          names.length ? searchableSelect(names, state.cliente, "Buscar cliente…", function (name) { state.cliente = name; })
            : el("input", { type: "text", placeholder: "Escribe la razón comercial", value: state.cliente, oninput: function (e) { state.cliente = e.target.value; } }),
          !names.length ? "No hay clientes cargados para este canal todavía; escribe el nombre manualmente." : null
        ));
      }
    } else if (state.rutina === "activacion") {
      const names = clientesForCanal("On").map(function (c) { return c.nombre; });
      nodes.push(fieldWrap("Razón comercial (canal On)", true,
        names.length ? searchableSelect(names, state.cliente, "Buscar cliente…", function (name) { state.cliente = name; })
          : el("input", { type: "text", placeholder: "Escribe la razón comercial", value: state.cliente, oninput: function (e) { state.cliente = e.target.value; } })
      ));
    } else if (state.rutina === "matinal") {
      const regs = regiones();
      nodes.push(fieldWrap("Región", true,
        regs.length
          ? el("select", { onchange: function (e) { state.matinalRegion = e.target.value; state.matinalCodistribuidor = ""; state.matinalLocalidad = ""; render(); } },
              [el("option", { value: "" }, ["Selecciona…"])].concat(regs.map(function (r) {
                const o = el("option", { value: r }, [r]);
                if (r === state.matinalRegion) o.setAttribute("selected", "true");
                return o;
              })))
          : el("input", { type: "text", placeholder: "Escribe la región", value: state.matinalRegion, oninput: function (e) { state.matinalRegion = e.target.value; } })
      ));
      if (state.matinalRegion) {
        const codis = codistribuidoresEnRegion(state.matinalRegion);
        nodes.push(fieldWrap("Codistribuidor", true, searchableSelect(codis, state.matinalCodistribuidor, "Buscar codistribuidor…", function (name) { state.matinalCodistribuidor = name; state.matinalLocalidad = ""; })));
      }
      if (state.matinalRegion && state.matinalCodistribuidor) {
        const locs = localidadesDe(state.matinalRegion, state.matinalCodistribuidor);
        nodes.push(fieldWrap("Localidad", true,
          locs.length
            ? el("select", { onchange: function (e) { state.matinalLocalidad = e.target.value; render(); } },
                [el("option", { value: "" }, ["Selecciona…"])].concat(locs.map(function (l) {
                  const o = el("option", { value: l }, [l]);
                  if (l === state.matinalLocalidad) o.setAttribute("selected", "true");
                  return o;
                })))
            : el("input", { type: "text", placeholder: "Escribe la localidad", value: state.matinalLocalidad, oninput: function (e) { state.matinalLocalidad = e.target.value; } })
        ));
      }
    } else if (state.rutina === "prospeccion") {
      const nuevoCb = el("input", { type: "checkbox" });
      nuevoCb.checked = state.esClienteNuevo;
      nuevoCb.addEventListener("change", function () { state.esClienteNuevo = nuevoCb.checked; if (state.esClienteNuevo) state.prospeccionCodigo = ""; render(); });
      nodes.push(el("div", { class: "field" }, [el("label", { class: "chip" + (state.esClienteNuevo ? " checked" : ""), style: "width:100%" }, [nuevoCb, el("span", { class: "chip-text" }, ["Es cliente nuevo (sin código en el sistema)"])])]));
      if (!state.esClienteNuevo) {
        nodes.push(fieldWrap("Código de cliente", true, el("input", { type: "text", placeholder: "Código", value: state.prospeccionCodigo, oninput: function (e) { state.prospeccionCodigo = e.target.value; } })));
      }
      nodes.push(fieldWrap("Razón comercial", true, el("input", { type: "text", placeholder: "Razón comercial", value: state.prospeccionRazonSocial, oninput: function (e) { state.prospeccionRazonSocial = e.target.value; } })));
      nodes.push(fieldWrap("Canal", true, segControl(["On", "Off"], state.canal, function (v) { state.canal = v; })));
    }
    return nodes;
  }

  function viewPortafolio() {
    return [
      el("h2", { class: "step-title" }, ["Portafolio"]),
      el("p", { class: "step-hint" }, ["Selecciona qué SKUs de Flor de Caña están disponibles en este punto de venta. ⭐ = producto foco en este canal."]),
      chipMultiSelect(skuNames(), state.portafolio, function (sku) {
        const i = state.portafolio.indexOf(sku);
        if (i === -1) state.portafolio.push(sku);
        else { state.portafolio.splice(i, 1); const vi = state.visibilidad.indexOf(sku); if (vi !== -1) state.visibilidad.splice(vi, 1); }
      }, null, state.canal)
    ];
  }
  function viewVisibilidad() {
    return [
      el("h2", { class: "step-title" }, ["Visibilidad en contrabarra/góndola"]),
      el("p", { class: "step-hint" }, ["Selecciona qué SKUs, de los ya marcados como disponibles, están visibles al cliente."]),
      chipMultiSelect(skuNames(), state.visibilidad, function (sku) {
        const i = state.visibilidad.indexOf(sku);
        if (i === -1) state.visibilidad.push(sku); else state.visibilidad.splice(i, 1);
      }, function (sku) { return state.portafolio.indexOf(sku) === -1; }, state.canal)
    ];
  }
  function viewFotoVisibilidad() {
    return [el("h2", { class: "step-title" }, ["Foto de contrabarra/góndola"]), photoSlot(state.fotoVisibilidad, "Visibilidad", "environment", function (p) { state.fotoVisibilidad = p; })];
  }
  function viewCarta() {
    const nodes = [el("h2", { class: "step-title" }, ["Carta"])];
    if (state.canal === "On") {
      nodes.push(fieldWrap("¿Hay cócteles FDC en carta?", true, segControl(["Si", "No"], state.cartaCocteles, function (v) { state.cartaCocteles = v; })));
      if (state.cartaCocteles === "Si") nodes.push(fieldWrap("¿Cuántos?", true, el("input", { type: "number", min: "0", inputmode: "numeric", value: state.cartaCantidadCocteles, oninput: function (e) { state.cartaCantidadCocteles = e.target.value; } })));
      nodes.push(fieldWrap("¿Hay botellas FDC en carta?", true, segControl(["Si", "No"], state.cartaBotellasSiNo, function (v) { state.cartaBotellasSiNo = v; })));
      if (state.cartaBotellasSiNo === "Si") {
        nodes.push(fieldWrap("¿Cuáles?", true, chipMultiSelect(skuNames(), state.cartaListaBotellas, function (sku) {
          const i = state.cartaListaBotellas.indexOf(sku);
          if (i === -1) state.cartaListaBotellas.push(sku); else state.cartaListaBotellas.splice(i, 1);
        })));
      }
      nodes.push(fieldWrap("¿Activación en menú? (Logo, una botella o Flor Ginger)", true, segControl(["Si", "No"], state.cartaActivacionMenu, function (v) { state.cartaActivacionMenu = v; })));
    } else if (state.canal === "Off") {
      nodes.push(fieldWrap("¿Hay comunicación de combos FDC?", true, segControl(["Si", "No"], state.cartaCombosOff, function (v) { state.cartaCombosOff = v; })));
    }
    return nodes;
  }
  function viewFotoCarta() {
    return [el("h2", { class: "step-title" }, ["Foto de carta"]), photoSlot(state.fotoCarta, "Carta", "environment", function (p) { state.fotoCarta = p; })];
  }
  function priceField(f) {
    const p = state.precios[f.key];
    const input = el("input", { type: "number", min: "0", step: "0.01", inputmode: "decimal", placeholder: "0.00", value: p.value, disabled: p.na ? "true" : null, oninput: function (e) { p.value = e.target.value; } });
    const naCb = el("input", { type: "checkbox" });
    naCb.checked = p.na;
    naCb.addEventListener("change", function () { p.na = naCb.checked; if (p.na) p.value = ""; render(); });
    const naLabel = el("label", { style: "display:flex; align-items:center; gap:8px; margin-top:8px; font-size:13.5px; color:var(--tint-75)" }, [naCb, "No aplica en este punto de venta"]);
    return el("div", { class: "field" }, [el("label", { class: "field-label field-required" }, [f.label]), input, naLabel]);
  }
  function viewPrecios() {
    const applicable = PRICE_FIELDS.filter(function (f) { return f.channels.indexOf(state.canal) !== -1; });
    return [el("h2", { class: "step-title" }, ["Precio"]), el("p", { class: "step-hint" }, ["Ingresa el PVP vigente, o marca 'No aplica' si ese producto no se vende en este punto de venta."])].concat(applicable.map(priceField));
  }
  function materialField(key, label) { return fieldWrap(label, true, segControl(["Si", "No", "No aplica"], state.materiales[key], function (v) { state.materiales[key] = v; })); }
  function viewMateriales() {
    const nodes = [el("h2", { class: "step-title" }, ["Materiales"])];
    if (state.canal === "On") {
      nodes.push(materialField("vasos_pavonados", "¿Tiene vasos pavonados?"));
      nodes.push(materialField("hieleras", "¿Tiene hieleras?"));
      nodes.push(materialField("vasos_vidrio", "¿Tiene vasos vidrio?"));
      nodes.push(materialField("barmats", "¿Tiene barmats?"));
      nodes.push(materialField("luminoso", "¿Tiene Luminoso FDC?"));
    } else if (state.canal === "Off") {
      nodes.push(materialField("banner_promos", "¿Tiene banner/pizarra de promos?"));
    }
    return nodes;
  }
  function viewFotoMateriales() {
    return [el("h2", { class: "step-title" }, ["Foto de materiales"]), photoSlot(state.fotoMateriales, "Materiales", "environment", function (p) { state.fotoMateriales = p; })];
  }
  function viewCapacitacion() {
    return [el("h2", { class: "step-title" }, ["Capacitación"]), fieldWrap("¿El barstaff necesita capacitación?", true, segControl(["Si", "No"], state.capacitacion, function (v) { state.capacitacion = v; }))];
  }
  function viewFotoRitual() {
    return [
      el("h2", { class: "step-title" }, ["Foto ritual servido 12+"]),
      photoMultiSlot(state.fotosRitual, "Ritual servido 12+", "environment", 1, function (p) { state.fotosRitual.push(p); }, function (i) { state.fotosRitual.splice(i, 1); })
    ];
  }
  function viewFotoConsumo() {
    return [
      el("h2", { class: "step-title" }, ["Foto de consumo"]),
      photoMultiSlot(state.fotosConsumo, "Consumo", "environment", 1, function (p) { state.fotosConsumo.push(p); }, function (i) { state.fotosConsumo.splice(i, 1); })
    ];
  }
  function viewFotoMatinal() {
    return [el("h2", { class: "step-title" }, ["Foto Matinal/Vespertina"]), el("p", { class: "step-hint" }, ["Esta foto usa la cámara frontal."]), photoSlot(state.fotoMatinal, "Matinal/Vespertina", "user", function (p) { state.fotoMatinal = p; })];
  }
  function viewResultadoProspeccion() {
    const nodes = [el("h2", { class: "step-title" }, ["Resultado de la visita"]), fieldWrap("Resultado", true, segControl(["Compra", "Seguimiento"], state.resultado, function (v) { state.resultado = v; }))];
    if (state.resultado === "Compra") {
      nodes.push(fieldWrap("¿Qué compró y cuántas cajas?", true, skuQuantitySelector(skuNames(), state.compraSkus, state.compraCajas, function (sku) {
        const i = state.compraSkus.indexOf(sku);
        if (i === -1) state.compraSkus.push(sku); else { state.compraSkus.splice(i, 1); delete state.compraCajas[sku]; }
      }, function (sku, val) { state.compraCajas[sku] = val; })));
    } else if (state.resultado === "Seguimiento") {
      nodes.push(fieldWrap("Volumen estimado de cajas de ron mensuales", true, el("input", { type: "number", min: "0", inputmode: "numeric", value: state.seguimientoCajas, oninput: function (e) { state.seguimientoCajas = e.target.value; } })));
      nodes.push(fieldWrap("¿Qué marca consume actualmente?", true, el("input", { type: "text", placeholder: "Marca", value: state.seguimientoMarca, oninput: function (e) { state.seguimientoMarca = e.target.value; } })));
    }
    return nodes;
  }
  function viewFotoCheckout() {
    return [el("h2", { class: "step-title" }, ["Foto de check out"]), photoSlot(state.fotoCheckout, "Check out", "environment", function (p) { state.fotoCheckout = p; })];
  }

  function requestFinalGps() {
    getPosition(12000).then(function (pos) { state.gpsEnvio = pos; render(); })
      .catch(function () { state.gpsEnvio = null; state.submitError = "No se pudo obtener la ubicación. Activa el GPS y vuelve a intentar."; render(); });
  }
  function entidadVisitada() {
    if (state.rutina === "cartera" || state.rutina === "activacion") return state.cliente;
    if (state.rutina === "matinal") return state.matinalCodistribuidor + " (" + state.matinalLocalidad + ")";
    if (state.rutina === "prospeccion") return state.prospeccionRazonSocial;
    return "";
  }
  function viewRevision() {
    if (!state.gpsEnvio && !state._gpsRequested) { state._gpsRequested = true; requestFinalGps(); }
    const rows = [
      ["Ejecutivo", state.ejecutivo],
      ["Rutina", RUTINA_LABELS[state.rutina] || state.rutina],
      ["Entidad visitada", entidadVisitada()],
      ["Ubicación de envío", state.gpsEnvio ? (fmtCoord(state.gpsEnvio.lat) + ", " + fmtCoord(state.gpsEnvio.lng) + " (±" + Math.round(state.gpsEnvio.acc) + " m)") : "Obteniendo…"]
    ];
    if (state.rutina === "cartera" || state.rutina === "prospeccion") rows.splice(2, 0, ["Canal", state.canal]);
    const nodes = [el("h2", { class: "step-title" }, ["Revisión y envío"]), el("p", { class: "step-hint" }, ["Verifica los datos antes de enviar."])];
    rows.forEach(function (r) { nodes.push(el("div", { class: "summary-row" }, [el("span", { class: "k" }, [r[0]]), el("span", { class: "v" }, [String(r[1])])])); });
    if (!state.gpsEnvio) nodes.push(el("button", { class: "camera-btn", type: "button", style: "margin-top:14px", onclick: function () { requestFinalGps(); } }, ["Reintentar ubicación"]));
    return nodes;
  }

  const VIEW_BY_STEP = {
    identificacion: viewIdentificacion,
    portafolio: viewPortafolio, visibilidad: viewVisibilidad, foto_visibilidad: viewFotoVisibilidad,
    carta: viewCarta, foto_carta: viewFotoCarta, precios: viewPrecios,
    materiales: viewMateriales, foto_materiales: viewFotoMateriales, capacitacion: viewCapacitacion,
    foto_ritual: viewFotoRitual, foto_consumo: viewFotoConsumo,
    foto_matinal: viewFotoMatinal,
    resultado_prospeccion: viewResultadoProspeccion, foto_checkout: viewFotoCheckout,
    revision: viewRevision
  };
  const STEP_LABELS = {
    identificacion: "Identificación", portafolio: "Portafolio", visibilidad: "Visibilidad",
    foto_visibilidad: "Foto visibilidad", carta: "Carta", foto_carta: "Foto carta",
    precios: "Precios", materiales: "Materiales", foto_materiales: "Foto materiales", capacitacion: "Capacitación",
    foto_ritual: "Foto ritual", foto_consumo: "Foto consumo",
    foto_matinal: "Foto matinal", resultado_prospeccion: "Resultado", foto_checkout: "Foto check out",
    revision: "Revisión"
  };

  // ---------------------------------------------------------------
  // Envío
  // ---------------------------------------------------------------
  function buildPayload() {
    const base = { token: CFG.SHARED_TOKEN, ejecutivo: state.ejecutivo, rutina: state.rutina, gps_envio: state.gpsEnvio, submitted_at_local: new Date().toISOString(), app_version: "4.0" };
    if (state.rutina === "cartera") {
      return Object.assign(base, {
        canal: state.canal, cliente: state.cliente,
        portafolio: state.portafolio, visibilidad: state.visibilidad,
        foto_visibilidad: state.fotoVisibilidad,
        carta: {
          cocteles_si_no: state.canal === "On" ? state.cartaCocteles : "No aplica",
          cantidad_cocteles: state.canal === "On" && state.cartaCocteles === "Si" ? state.cartaCantidadCocteles : "",
          botellas_si_no: state.canal === "On" ? state.cartaBotellasSiNo : "No aplica",
          lista_botellas: state.canal === "On" ? state.cartaListaBotellas : [],
          activacion_menu: state.canal === "On" ? state.cartaActivacionMenu : "No aplica",
          combos_off: state.canal === "Off" ? state.cartaCombosOff : "No aplica"
        },
        foto_carta: state.fotoCarta,
        precios: state.precios,
        materiales: {
          vasos_pavonados: state.canal === "On" ? state.materiales.vasos_pavonados : "No aplica",
          hieleras: state.canal === "On" ? state.materiales.hieleras : "No aplica",
          vasos_vidrio: state.canal === "On" ? state.materiales.vasos_vidrio : "No aplica",
          barmats: state.canal === "On" ? state.materiales.barmats : "No aplica",
          luminoso: state.canal === "On" ? state.materiales.luminoso : "No aplica",
          banner_promos: state.canal === "Off" ? state.materiales.banner_promos : "No aplica"
        },
        foto_materiales: state.fotoMateriales,
        capacitacion: state.canal === "On" ? state.capacitacion : "No aplica"
      });
    }
    if (state.rutina === "activacion") {
      return Object.assign(base, { cliente: state.cliente, fotos_ritual: state.fotosRitual, fotos_consumo: state.fotosConsumo });
    }
    if (state.rutina === "matinal") {
      return Object.assign(base, { region: state.matinalRegion, codistribuidor: state.matinalCodistribuidor, localidad: state.matinalLocalidad, foto_matinal: state.fotoMatinal });
    }
    if (state.rutina === "prospeccion") {
      return Object.assign(base, {
        es_cliente_nuevo: state.esClienteNuevo,
        prospeccion_codigo: state.esClienteNuevo ? "" : state.prospeccionCodigo,
        prospeccion_razon_social: state.prospeccionRazonSocial,
        canal: state.canal,
        resultado: state.resultado,
        compra_detalle: state.resultado === "Compra" ? state.compraSkus.map(function (sku) { return { sku: sku, cajas: state.compraCajas[sku] }; }) : [],
        seguimiento_cajas: state.resultado === "Seguimiento" ? state.seguimientoCajas : "",
        seguimiento_marca: state.resultado === "Seguimiento" ? state.seguimientoMarca : "",
        foto_checkout: state.fotoCheckout
      });
    }
    return base;
  }

  async function submit() {
    const errs = validateAll();
    if (errs.length) { state.submitError = errs[0]; render(); return; }
    if (!CFG.APPS_SCRIPT_URL || CFG.APPS_SCRIPT_URL.indexOf("PEGA_AQUI") === 0) {
      state.submitError = "La app aún no tiene configurada la URL del backend (config.js). Revisa GUIA_INSTALACION.md.";
      render();
      return;
    }
    const payload = buildPayload();
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(payload)); } catch (e) {}
    state.submitting = true; state.submitError = ""; render();
    try {
      const res = await fetch(CFG.APPS_SCRIPT_URL, { method: "POST", body: JSON.stringify(payload) });
      const data = await res.json();
      if (!data || !data.ok) throw new Error((data && data.error) || "El backend respondió con un error.");
      try { localStorage.removeItem(PENDING_KEY); } catch (e) {}
      clearDraft();
      state.submitting = false;
      renderDone();
    } catch (e) {
      state.submitting = false;
      state.submitError = "No se pudo enviar (" + e.message + "). Tus datos quedaron guardados en este teléfono — vuelve a intentar cuando tengas señal.";
      render();
    }
  }

  function renderDone() {
    root.innerHTML = "";
    root.appendChild(el("div", { class: "done-screen" }, [
      el("img", { src: "assets/logo-white.png", alt: "Flor de Caña", class: "done-logo" }),
      el("div", { class: "done-check" }, ["✓"]),
      el("h2", { class: "step-title" }, ["Visita registrada"]),
      el("p", { class: "step-hint" }, ["Se guardó en Google Sheets y las fotos en Drive."]),
      el("button", { class: "btn btn-primary", style: "margin-top:18px; padding:0 24px", onclick: function () { resetForNext(); } }, ["Registrar otra visita"])
    ]));
  }

  function resetForNext() {
    const keepEjecutivo = state.ejecutivo;
    Object.assign(state, {
      view: "form",
      stepIndex: 0, submitting: false, submitError: "", _gpsRequested: false,
      ejecutivo: keepEjecutivo, rutina: "", canal: "", cliente: "",
      portafolio: [], visibilidad: [], fotoVisibilidad: null,
      cartaCocteles: "", cartaCantidadCocteles: "", cartaBotellasSiNo: "",
      cartaListaBotellas: [], cartaActivacionMenu: "", cartaCombosOff: "", fotoCarta: null,
      precios: freshPrecios(), materiales: freshMateriales(), fotoMateriales: null, capacitacion: "",
      fotosRitual: [], fotosConsumo: [],
      matinalRegion: "", matinalCodistribuidor: "", matinalLocalidad: "", fotoMatinal: null,
      esClienteNuevo: false, prospeccionCodigo: "", prospeccionRazonSocial: "", resultado: "",
      compraSkus: [], compraCajas: {}, seguimientoCajas: "", seguimientoMarca: "", fotoCheckout: null,
      gpsEnvio: null
    });
    render();
  }

  // ---------------------------------------------------------------
  // Resumen — render (tabla compacta + gráfico de tendencia por ejecutivo)
  // ---------------------------------------------------------------
  const CHART_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
  let chartInstance = null;
  let chartJsLoadPromise = null;
  function loadChartJs() {
    if (window.Chart) return Promise.resolve();
    if (chartJsLoadPromise) return chartJsLoadPromise;
    chartJsLoadPromise = new Promise(function (resolve, reject) {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js";
      script.onload = function () { resolve(); };
      script.onerror = function () { chartJsLoadPromise = null; reject(new Error("No se pudo cargar el gráfico (revisa tu conexión).")); };
      document.head.appendChild(script);
    });
    return chartJsLoadPromise;
  }

  function resumenTable(entries, bucketKey) {
    const table = el("table", { class: "resumen-table" }, [
      el("thead", {}, [el("tr", {}, [
        el("th", {}, ["Ejecutivo"]), el("th", {}, ["Cart"]), el("th", {}, ["Act"]), el("th", {}, ["Mat"]), el("th", {}, ["Pros"]), el("th", { class: "num" }, ["Total"])
      ])]),
      el("tbody", {}, entries.map(function (entry) {
        const b = entry[bucketKey];
        return el("tr", {}, [
          el("td", {}, [entry.ejecutivo]),
          el("td", { class: "num" }, [String(b.cartera)]),
          el("td", { class: "num" }, [String(b.activacion)]),
          el("td", { class: "num" }, [String(b.matinal)]),
          el("td", { class: "num" }, [String(b.prospeccion)]),
          el("td", { class: "num total" }, [String(b.total)])
        ]);
      }))
    ]);
    return el("div", { style: "overflow-x:auto" }, [table]);
  }

  function renderTrendChart(container, serieMensual) {
    if (!serieMensual || !serieMensual.ejecutivos.length) return;
    const legend = el("div", { style: "display:flex; flex-wrap:wrap; gap:10px; margin:10px 0; font-size:11px; color:var(--tint-75)" }, []);
    serieMensual.ejecutivos.forEach(function (s, i) {
      const color = CHART_COLORS[i % CHART_COLORS.length];
      legend.appendChild(el("span", { style: "display:flex; align-items:center; gap:4px" }, [
        el("span", { style: "width:8px; height:8px; border-radius:2px; background:" + color + "; display:inline-block" }, []),
        s.ejecutivo
      ]));
    });
    const wrap = el("div", { style: "position:relative; width:100%; height:220px" }, []);
    const canvas = el("canvas", { role: "img", "aria-label": "Cuestionarios por día en el mes, una línea por ejecutivo" }, []);
    wrap.appendChild(canvas);
    container.appendChild(legend);
    container.appendChild(wrap);

    loadChartJs().then(function () {
      if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
      chartInstance = new window.Chart(canvas, {
        type: "line",
        data: {
          labels: serieMensual.dias,
          datasets: serieMensual.ejecutivos.map(function (s, i) {
            const color = CHART_COLORS[i % CHART_COLORS.length];
            return { label: s.ejecutivo, data: s.valores, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.25 };
          })
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { mode: "index", intersect: false } },
          interaction: { mode: "index", intersect: false },
          scales: {
            x: { ticks: { autoSkip: true, maxTicksLimit: 8, color: "#BFCFD3" }, grid: { display: false }, title: { display: true, text: "Día del mes", color: "#BFCFD3", font: { size: 11 } } },
            y: { beginAtZero: true, ticks: { color: "#BFCFD3", precision: 0 }, grid: { color: "#295C69" }, title: { display: true, text: "Cuestionarios", color: "#BFCFD3", font: { size: 11 } } }
          }
        }
      });
    }).catch(function (err) {
      container.appendChild(el("p", { class: "step-hint" }, [err.message]));
    });
  }

  // ---------------------------------------------------------------
  // Mapa de clientes — Leaflet + OpenStreetMap (gratis, sin API key)
  // ---------------------------------------------------------------
  let mapInstance = null;
  let leafletLoadPromise = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (leafletLoadPromise) return leafletLoadPromise;
    leafletLoadPromise = new Promise(function (resolve, reject) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css";
      document.head.appendChild(link);
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js";
      script.onload = function () { resolve(); };
      script.onerror = function () { leafletLoadPromise = null; reject(new Error("No se pudo cargar el mapa (revisa tu conexión).")); };
      document.head.appendChild(script);
    });
    return leafletLoadPromise;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function clientesDelEjecutivo() {
    return state.clientes.filter(function (c) { return c.ejecutivo === state.ejecutivo && c.lat != null && c.lng != null; });
  }

  function initMap(container, clientes, userPos) {
    if (mapInstance) { mapInstance.remove(); mapInstance = null; }
    const map = window.L.map(container);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap"
    }).addTo(map);

    const bounds = [];
    clientes.forEach(function (c) {
      bounds.push([c.lat, c.lng]);
      const dirUrl = "https://www.google.com/maps/dir/?api=1&destination=" + c.lat + "," + c.lng;
      const popupHtml = "<strong>" + escapeHtml(c.nombre) + "</strong>" +
        (c.direccion ? "<br>" + escapeHtml(c.direccion) : "") +
        (c.localidad ? "<br>" + escapeHtml(c.localidad) : "") +
        (c.vendedor ? "<br>Vendedor: " + escapeHtml(c.vendedor) : "") +
        (c.volumenPromedio ? "<br>Volumen prom.: " + escapeHtml(c.volumenPromedio) : "") +
        '<br><a href="' + dirUrl + '" target="_blank" rel="noopener">Cómo llegar →</a>';
      window.L.marker([c.lat, c.lng]).addTo(map).bindPopup(popupHtml);
    });

    if (userPos) {
      bounds.push([userPos.lat, userPos.lng]);
      window.L.circleMarker([userPos.lat, userPos.lng], { radius: 9, color: "#FFFFFF", weight: 2, fillColor: "#2a78d6", fillOpacity: 1 })
        .addTo(map).bindPopup("Tú estás aquí");
    }

    if (bounds.length) map.fitBounds(bounds, { padding: [30, 30] });
    else map.setView([-9.19, -75.0152], 5); // centro de Perú, respaldo si no hay ningún punto

    setTimeout(function () { map.invalidateSize(); }, 100);
    return map;
  }

  function renderMapa() {
    root.innerHTML = "";
    const header = el("div", { class: "app-header" }, [
      el("div", { class: "brand" }, [el("img", { src: "assets/logo-white.png", alt: "Flor de Caña", class: "brand-logo" }), el("span", { class: "brand-sub" }, ["Mapa de clientes"])])
    ]);
    const body = el("div", { class: "app-body", style: "padding-left:0; padding-right:0" }, []);

    const clientes = clientesDelEjecutivo();
    const sinCoords = state.clientes.filter(function (c) { return c.ejecutivo === state.ejecutivo && (c.lat == null || c.lng == null); }).length;

    const toolbar = el("div", { style: "padding:0 20px 12px" }, [
      el("button", { class: "camera-btn", type: "button", onclick: function () { refreshMapaUbicacion(); } }, ["📍 Actualizar mi ubicación"])
    ]);
    body.appendChild(toolbar);

    if (state.mapaError) body.appendChild(el("div", { class: "error-banner", style: "margin:0 20px 12px" }, [state.mapaError]));
    if (clientes.length === 0) {
      body.appendChild(el("p", { class: "step-hint", style: "margin:0 20px" }, ["Aún no hay clientes con coordenadas cargadas para este ejecutivo."]));
    }
    if (sinCoords > 0) {
      body.appendChild(el("p", { class: "step-hint", style: "margin:0 20px 12px" }, [sinCoords + " cliente(s) tuyo(s) sin coordenadas cargadas — no aparecen en el mapa."]));
    }

    const mapDiv = el("div", { style: "height:60vh; width:100%" }, []);
    body.appendChild(mapDiv);

    const footer = el("div", { class: "app-footer" }, [
      el("button", { class: "btn btn-primary", type: "button", onclick: function () { state.view = "form"; render(); } }, ["Volver al cuestionario"])
    ]);

    root.appendChild(header);
    root.appendChild(body);
    root.appendChild(footer);

    loadLeaflet().then(function () {
      mapInstance = initMap(mapDiv, clientes, state.mapaUserPos);
    }).catch(function (err) {
      state.mapaError = err.message;
      render();
    });
  }

  function refreshMapaUbicacion() {
    getPosition(10000).then(function (pos) {
      state.mapaUserPos = pos;
      render();
    }).catch(function () {
      state.mapaError = "No se pudo obtener tu ubicación. Revisa el permiso de GPS.";
      render();
    });
  }

  function renderResumen() {
    root.innerHTML = "";
    const header = el("div", { class: "app-header" }, [
      el("div", { class: "brand" }, [el("img", { src: "assets/logo-white.png", alt: "Flor de Caña", class: "brand-logo" }), el("span", { class: "brand-sub" }, ["Resumen"])])
    ]);
    const body = el("div", { class: "app-body" }, []);

    body.appendChild(segControl(["Día", "Mes"], state.resumenTab === "dia" ? "Día" : "Mes", function (v) { state.resumenTab = v === "Día" ? "dia" : "mes"; }));

    if (state.resumenTab === "dia") {
      const dayInput = el("input", { type: "date", value: state.resumenDay, style: "margin-top:14px" });
      dayInput.addEventListener("change", function (e) { state.resumenDay = e.target.value; fetchResumen(); });
      body.appendChild(dayInput);
    } else {
      const monthInput = el("input", { type: "month", value: state.resumenMonth, style: "margin-top:14px" });
      monthInput.addEventListener("change", function (e) { state.resumenMonth = e.target.value; fetchResumen(); });
      body.appendChild(monthInput);
    }

    if (state.resumenError) body.appendChild(el("div", { class: "error-banner", style: "margin-top:16px" }, [state.resumenError]));

    let trendContainer = null;
    if (state.resumenLoading) {
      body.appendChild(el("p", { class: "step-hint", style: "margin-top:16px" }, [el("span", { class: "spinner" }, []), " Cargando…"]));
    } else if (state.resumenData) {
      const bucketKey = state.resumenTab === "dia" ? "day" : "month";
      const totalGeneral = state.resumenData.ejecutivos.reduce(function (sum, e) { return sum + e[bucketKey].total; }, 0);
      body.appendChild(el("div", { class: "summary-row", style: "margin-top:16px; font-size:16px" }, [
        el("span", { class: "k" }, ["Total " + (state.resumenTab === "dia" ? state.resumenData.day : state.resumenData.month)]),
        el("span", { class: "v" }, [String(totalGeneral)])
      ]));
      body.appendChild(el("div", { style: "margin-top:14px" }, [resumenTable(state.resumenData.ejecutivos, bucketKey)]));
      body.appendChild(el("p", { class: "step-hint", style: "margin:20px 0 0" }, ["Tendencia del mes (" + state.resumenMonth + ") — cuestionarios por día, por ejecutivo"]));
      trendContainer = el("div", {}, []);
      body.appendChild(trendContainer);
    }

    const footer = el("div", { class: "app-footer" }, [
      el("button", { class: "btn btn-primary", type: "button", onclick: function () { state.view = "form"; render(); } }, ["Volver al cuestionario"])
    ]);

    root.appendChild(header);
    root.appendChild(body);
    root.appendChild(footer);
    if (trendContainer) renderTrendChart(trendContainer, state.resumenData.serieMensual);
  }

  // ---------------------------------------------------------------
  // Render principal
  // ---------------------------------------------------------------
  function render() {
    if (state.view === "resumen") { renderResumen(); return; }
    if (state.view === "mapa") { renderMapa(); return; }

    const steps = buildSteps();
    if (state.stepIndex >= steps.length) state.stepIndex = steps.length - 1;
    const stepName = steps[state.stepIndex];
    root.innerHTML = "";

    const header = el("div", { class: "app-header" }, [
      el("div", { class: "brand" }, [el("img", { src: "assets/logo-white.png", alt: "Flor de Caña", class: "brand-logo" }), el("span", { class: "brand-sub" }, ["Ejecución PDV"])]),
      el("div", { class: "progress-track" }, [el("div", { class: "progress-fill", style: "width:" + Math.round(((state.stepIndex + 1) / steps.length) * 100) + "%" })]),
      el("div", { class: "progress-label" }, ["Paso " + (state.stepIndex + 1) + " de " + steps.length + " · " + STEP_LABELS[stepName]])
    ]);

    const body = el("div", { class: "app-body" }, []);
    if (state.submitError) body.appendChild(el("div", { class: "error-banner" }, [state.submitError]));
    (VIEW_BY_STEP[stepName]() || []).forEach(function (n) { body.appendChild(n); });

    const footer = el("div", { class: "app-footer" }, []);
    if (state.stepIndex > 0) footer.appendChild(el("button", { class: "btn btn-secondary", type: "button", onclick: goBack }, ["Atrás"]));
    if (stepName === "revision") {
      footer.appendChild(el("button", { class: "btn btn-primary", type: "button", disabled: state.submitting ? "true" : null, onclick: submit }, [state.submitting ? "Enviando…" : "Enviar visita"]));
    } else {
      footer.appendChild(el("button", { class: "btn btn-primary", type: "button", onclick: goNext }, ["Siguiente"]));
    }

    root.appendChild(header);
    root.appendChild(body);
    root.appendChild(footer);
  }

  // ---------------------------------------------------------------
  // Arranque
  // ---------------------------------------------------------------
  async function boot() {
    loadDraft();
    render();
    await loadRemoteConfig();
    render();
    try {
      const pendingRaw = localStorage.getItem(PENDING_KEY);
      if (pendingRaw) {
        state.submitError = "Detectamos una visita que no se pudo enviar la última vez. Tus respuestas siguen cargadas abajo: revísalas y toca «Enviar visita» de nuevo en el paso de Revisión.";
        render();
      }
    } catch (e) {}
  }

  boot();
})();
