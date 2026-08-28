/* =====================================================================
   FDC — Checklist de ejecución en punto de venta
   Lógica de la app. Sin dependencias externas (debe cargar sin señal).

   Modelo: primero se elige una RUTINA (tipo de visita). Cada rutina
   tiene su propio flujo de pasos:
     - cartera      → Visita cliente cartera (canal On u Off)
     - activacion   → Activación On Trade
     - matinal      → Matinal / Vespertina (a codistribuidores)
     - prospeccion  → Prospección de clientes nuevos
   ===================================================================== */

(function () {
  "use strict";

  const CFG = window.APP_CONFIG || {};
  const PENDING_KEY = "fdc_pending_submit_v2";
  const DRAFT_KEY = "fdc_draft_v2";

  const RUTINA_LABELS = {
    cartera: "Visita cliente cartera",
    activacion: "Activación On Trade",
    matinal: "Matinal / Vespertina",
    prospeccion: "Prospección"
  };

  const PRICE_FIELDS = [
    { key: "fdc_4_750", label: "PVP FDC 4 750" },
    { key: "fdc_es_4_750", label: "PVP FDC ES 4 750" },
    { key: "fdc_12_750", label: "PVP FDC 12 750" },
    { key: "fdc_18_750", label: "PVP FDC 18 750" },
    { key: "jack_daniels", label: "PVP Jack Daniels/Sabores" },
    { key: "jw_red", label: "PVP JW Red" },
    { key: "jw_black", label: "PVP JW Black" },
    { key: "jw_gold", label: "PVP JW Gold" }
  ];

  function freshPrecios() {
    const o = {};
    PRICE_FIELDS.forEach(function (f) { o[f.key] = { value: "", na: false }; });
    return o;
  }

  function freshMateriales() {
    return { vasos_pavonados: "", hieleras: "", vasos_vidrio: "", barmats: "", luminoso: "", banner_promos: "" };
  }

  // ---------------------------------------------------------------
  // Estado
  // ---------------------------------------------------------------
  const state = {
    skus: (CFG.FALLBACK_SKUS || []).slice(),
    clientes: (CFG.FALLBACK_CLIENTES || []).slice(),
    ejecutivos: (CFG.FALLBACK_EJECUTIVOS || []).slice(),
    codistribuidores: (CFG.FALLBACK_CODISTRIBUIDORES || []).slice(),

    stepIndex: 0,
    submitting: false,
    submitError: "",
    _gpsRequested: false,

    ejecutivo: "",
    rutina: "",   // "cartera" | "activacion" | "matinal" | "prospeccion"

    // --- cartera / activación comparten el concepto de "cliente" ---
    canal: "",    // "On" | "Off" — solo cartera y prospección lo piden explícitamente
    cliente: "",

    // --- cartera ---
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

    // --- activación on trade ---
    fotoBengala: null,
    fotoSembrado: null,
    fotoConsumo: null,

    // --- matinal / vespertina ---
    codistribuidor: "",
    fotoMatinal: null,

    // --- prospección ---
    prospeccionCodigo: "",
    prospeccionRazonSocial: "",
    resultado: "",              // "Compra" | "Seguimiento" | "Rechazado"
    compraSkus: [],             // SKUs seleccionados en Compra
    compraCajas: {},            // sku -> cantidad de cajas
    fotoCheckout: null,

    gpsEnvio: null
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
      else if (k.indexOf("on") === 0 && typeof attrs[k] === "function") {
        node.addEventListener(k.slice(2), attrs[k]);
      } else if (attrs[k] !== null && attrs[k] !== undefined) {
        node.setAttribute(k, attrs[k]);
      }
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function fmtTimestamp(d) {
    return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear() +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }
  function fmtCoord(n) { return typeof n === "number" ? n.toFixed(6) : "—"; }

  function getPosition(timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (!("geolocation" in navigator)) {
        reject(new Error("Este navegador no soporta geolocalización."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, timestamp: new Date().toISOString() });
        },
        function (err) { reject(err); },
        { enableHighAccuracy: true, timeout: timeoutMs || 12000, maximumAge: 5000 }
      );
    });
  }

  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)); } catch (e) { /* sin almacenamiento: seguimos solo en memoria */ }
  }
  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      Object.keys(saved).forEach(function (k) {
        if (k === "stepIndex" || k === "submitting" || k === "submitError" || k === "_gpsRequested") return;
        state[k] = saved[k];
      });
    } catch (e) { /* borrador corrupto o inexistente: se ignora */ }
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }

  // ---------------------------------------------------------------
  // Configuración remota (Clientes / SKUs / Ejecutivos / Codistribuidores)
  // ---------------------------------------------------------------
  async function loadRemoteConfig() {
    if (!CFG.APPS_SCRIPT_URL || CFG.APPS_SCRIPT_URL.indexOf("PEGA_AQUI") === 0) return;
    try {
      const url = CFG.APPS_SCRIPT_URL + "?token=" + encodeURIComponent(CFG.SHARED_TOKEN);
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (data && data.ok) {
        if (Array.isArray(data.skus) && data.skus.length) state.skus = data.skus;
        if (Array.isArray(data.clientes)) state.clientes = data.clientes;
        if (Array.isArray(data.ejecutivos)) state.ejecutivos = data.ejecutivos;
        if (Array.isArray(data.codistribuidores)) state.codistribuidores = data.codistribuidores;
      }
    } catch (e) {
      console.warn("No se pudo cargar la configuración remota:", e.message);
    }
  }

  // =================================================================
  // CÁMARA — captura en vivo únicamente. "facing" puede ser "environment"
  // (trasera, por defecto) o "user" (frontal/selfie, para Matinal/Vespertina).
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
      hud.appendChild(cancelBtn);
      hud.appendChild(shutterBtn);
      overlay.appendChild(video);
      overlay.appendChild(badge);
      overlay.appendChild(hud);
      document.body.appendChild(overlay);
      if (facing === "user") video.style.transform = "scaleX(-1)"; // efecto espejo, solo visual

      let stream = null;
      let livePos = null;
      let cancelled = false;

      function cleanup() {
        if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }

      cancelBtn.addEventListener("click", function () { cancelled = true; cleanup(); reject(new Error("cancelled")); });

      getPosition(10000).then(function (pos) {
        livePos = pos;
        badge.textContent = "Ubicación lista · precisión ±" + Math.round(pos.acc) + " m";
      }).catch(function () {
        badge.textContent = "No se pudo obtener GPS. Revisa permisos de ubicación e inténtalo de nuevo.";
      });

      navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing } },
        audio: false
      }).then(function (s) {
        if (cancelled) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
        stream = s;
        video.srcObject = s;
        shutterBtn.disabled = false;
      }).catch(function (err) {
        cleanup();
        reject(new Error("No se pudo abrir la cámara: " + err.message));
      });

      shutterBtn.addEventListener("click", function () {
        if (!livePos) {
          badge.textContent = "Aún no hay GPS — espera un segundo e intenta de nuevo.";
          return;
        }
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
        if (facing === "user") {
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1); // la foto guardada también se espeja, como se ve en pantalla
        }
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
      steps.push("foto_bengala", "foto_sembrado", "foto_consumo");
    } else if (state.rutina === "matinal") {
      steps.push("foto_matinal");
    } else if (state.rutina === "prospeccion") {
      steps.push("resultado_prospeccion", "foto_checkout");
    }
    if (state.rutina) steps.push("revision");
    return steps;
  }

  function clientesForCanal(canal) {
    return state.clientes.filter(function (c) { return c.canal === canal; });
  }

  function setStep(idx) {
    state.stepIndex = idx;
    render();
    root.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function goNext() {
    const steps = buildSteps();
    const errs = validateStep(steps[state.stepIndex]);
    if (errs.length) { state.submitError = errs[0]; render(); return; }
    state.submitError = "";
    saveDraft();
    if (state.stepIndex < steps.length - 1) setStep(state.stepIndex + 1);
  }

  function goBack() {
    if (state.stepIndex > 0) { state.submitError = ""; setStep(state.stepIndex - 1); }
  }

  // ---------------- Validación por paso ----------------
  function validateStep(stepName) {
    const errs = [];
    switch (stepName) {
      case "identificacion":
        if (!state.ejecutivo) errs.push("Selecciona qué ejecutivo está haciendo la visita.");
        if (!state.rutina) errs.push("Selecciona qué tipo de rutina vas a registrar.");
        else if (state.rutina === "cartera") {
          if (!state.canal) errs.push("Selecciona el canal (On / Off).");
          if (!state.cliente) errs.push("Selecciona la razón social del cliente.");
        } else if (state.rutina === "activacion") {
          if (!state.cliente) errs.push("Selecciona la razón social del cliente.");
        } else if (state.rutina === "matinal") {
          if (!state.codistribuidor) errs.push("Selecciona el codistribuidor.");
        } else if (state.rutina === "prospeccion") {
          if (!state.prospeccionCodigo) errs.push("Ingresa el código de cliente.");
          if (!state.prospeccionRazonSocial) errs.push("Ingresa la razón social.");
          if (!state.canal) errs.push("Selecciona el canal (On / Off).");
        }
        break;
      case "portafolio":
        if (state.portafolio.length === 0) errs.push("Selecciona al menos un SKU disponible (o confirma que no hay ninguno antes de continuar).");
        break;
      case "visibilidad":
        break;
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
        PRICE_FIELDS.forEach(function (f) {
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
      case "foto_bengala":
        if (!state.fotoBengala) errs.push("Toma la foto de servicio FDC 12+ (bengala/glorificador).");
        break;
      case "foto_sembrado":
        if (!state.fotoSembrado) errs.push("Toma la foto de sembrado.");
        break;
      case "foto_consumo":
        if (!state.fotoConsumo) errs.push("Toma la foto de consumo.");
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

  // Lista vertical de tarjetas de una sola selección (para elegir la rutina)
  function optionCards(options, value, onPick) {
    const wrap = el("div", { style: "display:flex; flex-direction:column; gap:10px" }, []);
    options.forEach(function (opt) {
      const active = opt.value === value;
      wrap.appendChild(el("button", {
        type: "button",
        class: "chip" + (active ? " checked" : ""),
        style: "width:100%; justify-content:flex-start; text-align:left",
        onclick: function () { onPick(opt.value); render(); }
      }, [el("span", { class: "chip-text", style: "font-weight:700" }, [opt.label])]));
    });
    return wrap;
  }

  function chipMultiSelect(list, selected, onToggle, disabledPredicate) {
    const grid = el("div", { class: "chip-grid" }, []);
    list.forEach(function (item) {
      const checked = selected.indexOf(item) !== -1;
      const disabled = disabledPredicate ? disabledPredicate(item) : false;
      const cb = el("input", { type: "checkbox" });
      cb.checked = checked; cb.disabled = disabled;
      const chip = el("label", { class: "chip" + (checked ? " checked" : "") + (disabled ? " disabled" : "") }, [cb, el("span", { class: "chip-text" }, [item])]);
      cb.addEventListener("change", function () { onToggle(item); render(); });
      grid.appendChild(chip);
    });
    return grid;
  }

  // SKU + cantidad de cajas (para el resultado "Compra" de Prospección)
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
        const qty = el("input", {
          type: "number", min: "1", inputmode: "numeric", placeholder: "Cajas",
          style: "width:84px; min-height:40px; text-align:center",
          value: quantities[sku] || ""
        });
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
        el("div", { style: "padding:10px" }, [
          el("button", { class: "camera-btn", type: "button", onclick: function () { openCamera(label, facing).then(function (photo) { onCapture(photo); render(); }).catch(function () {}); } }, ["Repetir foto"])
        ])
      ]);
    }
    return el("div", { class: "photo-slot" }, [
      el("p", { class: "step-hint", style: "margin-top:0" }, ["Se abrirá la cámara en vivo" + (facing === "user" ? " frontal" : "") + ". No se puede adjuntar desde la galería."]),
      el("button", { class: "camera-btn", type: "button", onclick: function () { openCamera(label, facing).then(function (photo) { onCapture(photo); render(); }).catch(function () {}); } }, ["📷 Abrir cámara"])
    ]);
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
      filtered.forEach(function (name) {
        listBox.appendChild(el("button", { type: "button", onclick: function () { onPick(name); closeList(); render(); } }, [name]));
      });
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
      el("p", { class: "step-hint" }, ["Completa esto de pie, dentro del punto de venta."])
    ];

    nodes.push(fieldWrap("Ejecutivo", true,
      state.ejecutivos.length
        ? el("select", { onchange: function (e) { state.ejecutivo = e.target.value; render(); } },
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
        nodes.push(fieldWrap("Razón social", true,
          names.length ? searchableSelect(names, state.cliente, "Buscar cliente…", function (name) { state.cliente = name; })
            : el("input", { type: "text", placeholder: "Escribe la razón social", value: state.cliente, oninput: function (e) { state.cliente = e.target.value; } }),
          !names.length ? "No hay clientes cargados para este canal todavía; escribe el nombre manualmente." : null
        ));
      }
    } else if (state.rutina === "activacion") {
      const names = clientesForCanal("On").map(function (c) { return c.nombre; });
      nodes.push(fieldWrap("Razón social (canal On)", true,
        names.length ? searchableSelect(names, state.cliente, "Buscar cliente…", function (name) { state.cliente = name; })
          : el("input", { type: "text", placeholder: "Escribe la razón social", value: state.cliente, oninput: function (e) { state.cliente = e.target.value; } })
      ));
    } else if (state.rutina === "matinal") {
      nodes.push(fieldWrap("Codistribuidor", true,
        state.codistribuidores.length
          ? searchableSelect(state.codistribuidores, state.codistribuidor, "Buscar codistribuidor…", function (name) { state.codistribuidor = name; })
          : el("input", { type: "text", placeholder: "Escribe el codistribuidor", value: state.codistribuidor, oninput: function (e) { state.codistribuidor = e.target.value; } })
      ));
    } else if (state.rutina === "prospeccion") {
      nodes.push(fieldWrap("Código de cliente", true,
        el("input", { type: "text", placeholder: "Código", value: state.prospeccionCodigo, oninput: function (e) { state.prospeccionCodigo = e.target.value; } })
      ));
      nodes.push(fieldWrap("Razón social", true,
        el("input", { type: "text", placeholder: "Razón social", value: state.prospeccionRazonSocial, oninput: function (e) { state.prospeccionRazonSocial = e.target.value; } })
      ));
      nodes.push(fieldWrap("Canal", true, segControl(["On", "Off"], state.canal, function (v) { state.canal = v; })));
    }
    return nodes;
  }

  function viewPortafolio() {
    return [
      el("h2", { class: "step-title" }, ["Portafolio"]),
      el("p", { class: "step-hint" }, ["Selecciona qué SKUs de Flor de Caña están disponibles en este punto de venta."]),
      chipMultiSelect(state.skus, state.portafolio, function (sku) {
        const i = state.portafolio.indexOf(sku);
        if (i === -1) state.portafolio.push(sku);
        else {
          state.portafolio.splice(i, 1);
          const vi = state.visibilidad.indexOf(sku);
          if (vi !== -1) state.visibilidad.splice(vi, 1);
        }
      })
    ];
  }

  function viewVisibilidad() {
    return [
      el("h2", { class: "step-title" }, ["Visibilidad en contrabarra/góndola"]),
      el("p", { class: "step-hint" }, ["Selecciona qué SKUs, de los ya marcados como disponibles, están visibles al cliente."]),
      chipMultiSelect(state.skus, state.visibilidad, function (sku) {
        const i = state.visibilidad.indexOf(sku);
        if (i === -1) state.visibilidad.push(sku); else state.visibilidad.splice(i, 1);
      }, function (sku) { return state.portafolio.indexOf(sku) === -1; })
    ];
  }

  function viewFotoVisibilidad() {
    return [
      el("h2", { class: "step-title" }, ["Foto de contrabarra/góndola"]),
      el("p", { class: "step-hint" }, ["La hora, fecha y GPS quedan grabados en la imagen automáticamente."]),
      photoSlot(state.fotoVisibilidad, "Visibilidad", "environment", function (p) { state.fotoVisibilidad = p; })
    ];
  }

  function viewCarta() {
    const nodes = [el("h2", { class: "step-title" }, ["Carta"])];
    if (state.canal === "On") {
      nodes.push(fieldWrap("¿Hay cócteles FDC en carta?", true, segControl(["Si", "No"], state.cartaCocteles, function (v) { state.cartaCocteles = v; })));
      if (state.cartaCocteles === "Si") {
        nodes.push(fieldWrap("¿Cuántos?", true, el("input", { type: "number", min: "0", inputmode: "numeric", value: state.cartaCantidadCocteles, oninput: function (e) { state.cartaCantidadCocteles = e.target.value; } })));
      }
      nodes.push(fieldWrap("¿Hay botellas FDC en carta?", true, segControl(["Si", "No"], state.cartaBotellasSiNo, function (v) { state.cartaBotellasSiNo = v; })));
      if (state.cartaBotellasSiNo === "Si") {
        nodes.push(fieldWrap("¿Cuáles?", true, chipMultiSelect(state.skus, state.cartaListaBotellas, function (sku) {
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
    const input = el("input", {
      type: "number", min: "0", step: "0.01", inputmode: "decimal", placeholder: "0.00",
      value: p.value, disabled: p.na ? "true" : null,
      oninput: function (e) { p.value = e.target.value; }
    });
    const naCb = el("input", { type: "checkbox" });
    naCb.checked = p.na;
    naCb.addEventListener("change", function () { p.na = naCb.checked; if (p.na) p.value = ""; render(); });
    const naLabel = el("label", { style: "display:flex; align-items:center; gap:8px; margin-top:8px; font-size:13.5px; color:var(--paper-dim)" }, [naCb, "No aplica en este punto de venta"]);
    return el("div", { class: "field" }, [
      el("label", { class: "field-label field-required" }, [f.label]),
      input, naLabel
    ]);
  }

  function viewPrecios() {
    return [
      el("h2", { class: "step-title" }, ["Precio"]),
      el("p", { class: "step-hint" }, ["Ingresa el PVP vigente, o marca 'No aplica' si ese producto no se vende en este punto de venta."])
    ].concat(PRICE_FIELDS.map(priceField));
  }

  function materialField(key, label) {
    return fieldWrap(label, true, segControl(["Si", "No", "No aplica"], state.materiales[key], function (v) { state.materiales[key] = v; }));
  }

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

  function viewFotoBengala() {
    return [
      el("h2", { class: "step-title" }, ["Foto de servicio FDC 12+"]),
      el("p", { class: "step-hint" }, ["Bengala o glorificador."]),
      photoSlot(state.fotoBengala, "Servicio FDC 12+", "environment", function (p) { state.fotoBengala = p; })
    ];
  }
  function viewFotoSembrado() {
    return [el("h2", { class: "step-title" }, ["Foto de sembrado"]), photoSlot(state.fotoSembrado, "Sembrado", "environment", function (p) { state.fotoSembrado = p; })];
  }
  function viewFotoConsumo() {
    return [el("h2", { class: "step-title" }, ["Foto de consumo"]), photoSlot(state.fotoConsumo, "Consumo", "environment", function (p) { state.fotoConsumo = p; })];
  }

  function viewFotoMatinal() {
    return [
      el("h2", { class: "step-title" }, ["Foto Matinal/Vespertina"]),
      el("p", { class: "step-hint" }, ["Esta foto usa la cámara frontal."]),
      photoSlot(state.fotoMatinal, "Matinal/Vespertina", "user", function (p) { state.fotoMatinal = p; })
    ];
  }

  function viewResultadoProspeccion() {
    const nodes = [
      el("h2", { class: "step-title" }, ["Resultado de la visita"]),
      fieldWrap("Resultado", true, segControl(["Compra", "Seguimiento", "Rechazado"], state.resultado, function (v) { state.resultado = v; }))
    ];
    if (state.resultado === "Compra") {
      nodes.push(fieldWrap("¿Qué compró y cuántas cajas?", true,
        skuQuantitySelector(state.skus, state.compraSkus, state.compraCajas, function (sku) {
          const i = state.compraSkus.indexOf(sku);
          if (i === -1) state.compraSkus.push(sku);
          else { state.compraSkus.splice(i, 1); delete state.compraCajas[sku]; }
        }, function (sku, val) { state.compraCajas[sku] = val; })
      ));
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
    if (state.rutina === "matinal") return state.codistribuidor;
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
    if (state.rutina === "cartera") rows.splice(2, 0, ["Canal", state.canal]);
    const nodes = [
      el("h2", { class: "step-title" }, ["Revisión y envío"]),
      el("p", { class: "step-hint" }, ["Verifica los datos antes de enviar."])
    ];
    rows.forEach(function (r) { nodes.push(el("div", { class: "summary-row" }, [el("span", { class: "k" }, [r[0]]), el("span", { class: "v" }, [String(r[1])])])); });
    if (!state.gpsEnvio) {
      nodes.push(el("button", { class: "camera-btn", type: "button", style: "margin-top:14px", onclick: function () { requestFinalGps(); } }, ["Reintentar ubicación"]));
    }
    return nodes;
  }

  const VIEW_BY_STEP = {
    identificacion: viewIdentificacion,
    portafolio: viewPortafolio, visibilidad: viewVisibilidad, foto_visibilidad: viewFotoVisibilidad,
    carta: viewCarta, foto_carta: viewFotoCarta, precios: viewPrecios,
    materiales: viewMateriales, foto_materiales: viewFotoMateriales, capacitacion: viewCapacitacion,
    foto_bengala: viewFotoBengala, foto_sembrado: viewFotoSembrado, foto_consumo: viewFotoConsumo,
    foto_matinal: viewFotoMatinal,
    resultado_prospeccion: viewResultadoProspeccion, foto_checkout: viewFotoCheckout,
    revision: viewRevision
  };

  const STEP_LABELS = {
    identificacion: "Identificación", portafolio: "Portafolio", visibilidad: "Visibilidad",
    foto_visibilidad: "Foto visibilidad", carta: "Carta", foto_carta: "Foto carta",
    precios: "Precios", materiales: "Materiales", foto_materiales: "Foto materiales", capacitacion: "Capacitación",
    foto_bengala: "Foto servicio", foto_sembrado: "Foto sembrado", foto_consumo: "Foto consumo",
    foto_matinal: "Foto matinal", resultado_prospeccion: "Resultado", foto_checkout: "Foto check out",
    revision: "Revisión"
  };

  // ---------------------------------------------------------------
  // Envío
  // ---------------------------------------------------------------
  function buildPayload() {
    const base = {
      token: CFG.SHARED_TOKEN,
      ejecutivo: state.ejecutivo,
      rutina: state.rutina,
      gps_envio: state.gpsEnvio,
      submitted_at_local: new Date().toISOString(),
      app_version: "2.0"
    };
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
      return Object.assign(base, {
        cliente: state.cliente,
        foto_bengala: state.fotoBengala, foto_sembrado: state.fotoSembrado, foto_consumo: state.fotoConsumo
      });
    }
    if (state.rutina === "matinal") {
      return Object.assign(base, { codistribuidor: state.codistribuidor, foto_matinal: state.fotoMatinal });
    }
    if (state.rutina === "prospeccion") {
      return Object.assign(base, {
        prospeccion_codigo: state.prospeccionCodigo,
        prospeccion_razon_social: state.prospeccionRazonSocial,
        canal: state.canal,
        resultado: state.resultado,
        compra_detalle: state.resultado === "Compra" ? state.compraSkus.map(function (sku) { return { sku: sku, cajas: state.compraCajas[sku] }; }) : [],
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
      // Sin encabezados personalizados a propósito: evita el preflight CORS
      // que Google Apps Script no responde bien.
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
      el("div", { class: "done-check" }, ["✓"]),
      el("h2", { class: "step-title" }, ["Visita registrada"]),
      el("p", { class: "step-hint" }, ["Se guardó en Google Sheets y las fotos en Drive."]),
      el("button", { class: "btn btn-primary", style: "margin-top:18px; padding:0 24px", onclick: function () { resetForNext(); } }, ["Registrar otra visita"])
    ]));
  }

  function resetForNext() {
    const keepEjecutivo = state.ejecutivo;
    Object.assign(state, {
      stepIndex: 0, submitting: false, submitError: "", _gpsRequested: false,
      ejecutivo: keepEjecutivo, rutina: "", canal: "", cliente: "",
      portafolio: [], visibilidad: [], fotoVisibilidad: null,
      cartaCocteles: "", cartaCantidadCocteles: "", cartaBotellasSiNo: "",
      cartaListaBotellas: [], cartaActivacionMenu: "", cartaCombosOff: "", fotoCarta: null,
      precios: freshPrecios(), materiales: freshMateriales(), fotoMateriales: null, capacitacion: "",
      fotoBengala: null, fotoSembrado: null, fotoConsumo: null,
      codistribuidor: "", fotoMatinal: null,
      prospeccionCodigo: "", prospeccionRazonSocial: "", resultado: "", compraSkus: [], compraCajas: {}, fotoCheckout: null,
      gpsEnvio: null
    });
    render();
  }

  // ---------------------------------------------------------------
  // Render principal
  // ---------------------------------------------------------------
  function render() {
    const steps = buildSteps();
    if (state.stepIndex >= steps.length) state.stepIndex = steps.length - 1;
    const stepName = steps[state.stepIndex];

    root.innerHTML = "";

    const header = el("div", { class: "app-header" }, [
      el("div", { class: "brand" }, [el("span", { class: "brand-mark" }, ["FLOR DE CAÑA"]), el("span", { class: "brand-sub" }, ["Ejecución PDV"])]),
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
