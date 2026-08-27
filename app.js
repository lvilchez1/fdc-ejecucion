/* =====================================================================
   FDC — Checklist de ejecución en punto de venta
   Lógica de la app. Sin dependencias externas (debe cargar sin señal).
   ===================================================================== */

(function () {
  "use strict";

  const CFG = window.APP_CONFIG || {};
  const PENDING_KEY = "fdc_pending_submit_v1";
  const DRAFT_KEY = "fdc_draft_v1";

  // ---------------------------------------------------------------
  // Estado
  // ---------------------------------------------------------------
  const state = {
    remoteConfigLoaded: false,
    skus: (CFG.FALLBACK_SKUS || []).slice(),
    clientes: (CFG.FALLBACK_CLIENTES || []).slice(),
    ejecutivos: (CFG.FALLBACK_EJECUTIVOS || []).slice(),

    stepIndex: 0,
    submitting: false,
    submitError: "",

    ejecutivo: "",
    canal: "",       // "On" | "Off"
    cliente: "",

    portafolio: [],
    visibilidad: [],
    fotoVisibilidad: null,

    cartaCocteles: "",       // Si/No (On)
    cartaCantidadCocteles: "",
    cartaBotellasSiNo: "",   // Si/No (On)
    cartaListaBotellas: [],
    cartaActivacionMenu: "", // Si/No (On)
    cartaCombosOff: "",      // Si/No (Off)
    fotoCarta: null,

    precios: {
      fdc_4_750: "",
      fdc_es_4_750: "",
      fdc_12_750: "",
      jack_daniels: "",
      jw_red: "",
      jw_black: ""
    },

    materiales: {
      vasos_pavonados: "",
      hieleras: "",
      vasos_vidrio: "",
      barmats: "",
      luminoso: "",
      banner_promos: ""
    },
    fotoMateriales: null,

    capacitacion: "",

    gpsEnvio: null
  };

  // ---------------------------------------------------------------
  // Utilidades
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
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            acc: pos.coords.accuracy,
            timestamp: new Date().toISOString()
          });
        },
        function (err) {
          reject(err);
        },
        { enableHighAccuracy: true, timeout: timeoutMs || 12000, maximumAge: 5000 }
      );
    });
  }

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
    } catch (e) { /* almacenamiento no disponible: seguimos solo en memoria */ }
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      Object.keys(saved).forEach(function (k) {
        if (k === "stepIndex" || k === "submitting" || k === "submitError") return;
        state[k] = saved[k];
      });
    } catch (e) { /* borrador corrupto o inexistente: se ignora */ }
  }

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
  }

  // ---------------------------------------------------------------
  // Carga de configuración remota (Clientes / SKUs / Ejecutivos)
  // ---------------------------------------------------------------
  async function loadRemoteConfig() {
    if (!CFG.APPS_SCRIPT_URL || CFG.APPS_SCRIPT_URL.indexOf("PEGA_AQUI") === 0) {
      return; // aún no configurado: se usan los valores FALLBACK
    }
    try {
      const url = CFG.APPS_SCRIPT_URL + "?token=" + encodeURIComponent(CFG.SHARED_TOKEN);
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (data && data.ok) {
        if (Array.isArray(data.skus) && data.skus.length) state.skus = data.skus;
        if (Array.isArray(data.clientes)) state.clientes = data.clientes;
        if (Array.isArray(data.ejecutivos)) state.ejecutivos = data.ejecutivos;
        state.remoteConfigLoaded = true;
      }
    } catch (e) {
      // Sin señal o backend no configurado todavía: seguimos con FALLBACK
      console.warn("No se pudo cargar la configuración remota:", e.message);
    }
  }

  // =================================================================
  // CÁMARA — captura en vivo únicamente (nunca abre la galería),
  // con fecha/hora y GPS incrustados en la imagen.
  // =================================================================
  function openCamera(label) {
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

      let stream = null;
      let livePos = null;
      let cancelled = false;

      function cleanup() {
        if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }

      cancelBtn.addEventListener("click", function () {
        cancelled = true;
        cleanup();
        reject(new Error("cancelled"));
      });

      getPosition(10000).then(function (pos) {
        livePos = pos;
        badge.textContent = "Ubicación lista · precisión ±" + Math.round(pos.acc) + " m";
      }).catch(function () {
        badge.textContent = "No se pudo obtener GPS. Revisa permisos de ubicación e inténtalo de nuevo.";
      });

      navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
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
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Incrustar sello de fecha/hora + GPS (evidencia aunque se pierdan metadatos EXIF)
        const now = new Date();
        const line1 = fmtTimestamp(now) + "  ·  " + label;
        const line2 = "GPS " + fmtCoord(livePos.lat) + ", " + fmtCoord(livePos.lng) +
          "  (±" + Math.round(livePos.acc) + " m)";
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
        resolve({
          dataUrl: dataUrl,
          lat: livePos.lat,
          lng: livePos.lng,
          acc: livePos.acc,
          timestamp: now.toISOString(),
          label: label
        });
      });
    });
  }

  // =================================================================
  // RENDER — wizard
  // =================================================================
  const root = document.getElementById("app");

  function buildSteps() {
    // Los pasos visibles dependen del canal. El paso 0 siempre existe.
    const steps = ["identificacion"];
    if (state.canal) {
      steps.push(
        "portafolio", "visibilidad", "foto_visibilidad",
        "carta", "foto_carta",
        "precios",
        "materiales", "foto_materiales"
      );
      if (state.canal === "On") steps.push("capacitacion");
      steps.push("revision");
    }
    return steps;
  }

  function clientesForCanal() {
    if (!state.canal) return [];
    return state.clientes.filter(function (c) { return c.canal === state.canal; });
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
    if (errs.length) {
      state.submitError = errs[0];
      render();
      return;
    }
    state.submitError = "";
    saveDraft();
    if (state.stepIndex < steps.length - 1) setStep(state.stepIndex + 1);
  }

  function goBack() {
    if (state.stepIndex > 0) {
      state.submitError = "";
      setStep(state.stepIndex - 1);
    }
  }

  // ---------------- Validación por paso (sin atajos: cada regla del
  // cuestionario original se comprueba explícitamente) ----------------
  function validateStep(stepName) {
    const errs = [];
    switch (stepName) {
      case "identificacion":
        if (!state.ejecutivo) errs.push("Selecciona qué ejecutivo está haciendo la visita.");
        if (!state.canal) errs.push("Selecciona el tipo de cliente (On / Off).");
        if (!state.cliente) errs.push("Selecciona la razón social del cliente.");
        break;
      case "portafolio":
        if (state.portafolio.length === 0) errs.push("Selecciona al menos un SKU disponible (o confirma que no hay ninguno antes de continuar).");
        break;
      case "visibilidad":
        // La visibilidad solo puede marcarse sobre SKUs ya declarados como disponibles.
        break;
      case "foto_visibilidad":
        if (!state.fotoVisibilidad) errs.push("Toma la foto de visibilidad en contrabarra/góndola.");
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
      case "precios": {
        const labels = {
          fdc_4_750: "PVP FDC 4 750", fdc_es_4_750: "PVP FDC ES 4 750", fdc_12_750: "PVP FDC 12 750",
          jack_daniels: "PVP Jack Daniels 7/Sabores", jw_red: "PVP JW Red", jw_black: "PVP JW Black"
        };
        Object.keys(labels).forEach(function (k) {
          const v = state.precios[k];
          if (v === "" || v === null || v === undefined) errs.push("Ingresa el " + labels[k] + ".");
          else if (isNaN(Number(v)) || Number(v) < 0) errs.push(labels[k] + " debe ser un número válido.");
        });
        break;
      }
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
  // Componentes de campo reutilizables
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
      const btn = el("button", {
        type: "button",
        class: opt === value ? "active" : "",
        onclick: function () { onChange(opt); render(); }
      }, [opt]);
      seg.appendChild(btn);
    });
    return seg;
  }

  function chipMultiSelect(list, selected, onToggle, disabledPredicate) {
    const grid = el("div", { class: "chip-grid" }, []);
    list.forEach(function (item) {
      const checked = selected.indexOf(item) !== -1;
      const disabled = disabledPredicate ? disabledPredicate(item) : false;
      const cb = el("input", { type: "checkbox" });
      cb.checked = checked;
      cb.disabled = disabled;
      const chip = el("label", { class: "chip" + (checked ? " checked" : "") + (disabled ? " disabled" : "") }, [
        cb, el("span", { class: "chip-text" }, [item])
      ]);
      cb.addEventListener("change", function () { onToggle(item); render(); });
      grid.appendChild(chip);
    });
    return grid;
  }

  function photoSlot(current, label, onCapture) {
    if (current) {
      return el("div", { class: "photo-slot filled" }, [
        el("img", { src: current.dataUrl, alt: label }),
        el("div", { class: "photo-meta" }, [
          "Capturada " + fmtTimestamp(new Date(current.timestamp)) +
          " · GPS " + fmtCoord(current.lat) + ", " + fmtCoord(current.lng)
        ]),
        el("div", { style: "padding:10px" }, [
          el("button", {
            class: "camera-btn", type: "button",
            onclick: function () {
              openCamera(label).then(function (photo) { onCapture(photo); render(); }).catch(function () {});
            }
          }, ["Repetir foto"])
        ])
      ]);
    }
    return el("div", { class: "photo-slot" }, [
      el("p", { class: "step-hint", style: "margin-top:0" }, ["Se abrirá la cámara en vivo. No se puede adjuntar desde la galería."]),
      el("button", {
        class: "camera-btn", type: "button",
        onclick: function () {
          openCamera(label).then(function (photo) { onCapture(photo); render(); }).catch(function () {});
        }
      }, ["📷 Abrir cámara"])
    ]);
  }

  function searchableSelect(list, value, placeholder, onPick) {
    const wrap = el("div", { class: "searchbox" }, []);
    const input = el("input", { type: "search", placeholder: placeholder, value: value || "" });
    wrap.appendChild(input);
    let listBox = null;

    function closeList() {
      if (listBox && listBox.parentNode) listBox.parentNode.removeChild(listBox);
      listBox = null;
    }

    function openList(filter) {
      closeList();
      const filtered = list.filter(function (name) {
        return name.toLowerCase().indexOf((filter || "").toLowerCase()) !== -1;
      }).slice(0, 30);
      if (filtered.length === 0) return;
      listBox = el("div", { class: "searchbox-list" }, []);
      filtered.forEach(function (name) {
        listBox.appendChild(el("button", {
          type: "button",
          onclick: function () { onPick(name); closeList(); render(); }
        }, [name]));
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
    const nodes = [];
    nodes.push(el("h2", { class: "step-title" }, ["Datos de la visita"]));
    nodes.push(el("p", { class: "step-hint" }, ["Completa esto de pie, dentro del punto de venta."]));

    nodes.push(fieldWrap("Ejecutivo", true,
      state.ejecutivos.length
        ? el("select", {
            onchange: function (e) { state.ejecutivo = e.target.value; render(); }
          }, [el("option", { value: "" }, ["Selecciona…"])].concat(
              state.ejecutivos.map(function (n) {
                const o = el("option", { value: n }, [n]);
                if (n === state.ejecutivo) o.setAttribute("selected", "true");
                return o;
              })
            ))
        : el("input", {
            type: "text", placeholder: "Escribe tu nombre",
            value: state.ejecutivo,
            oninput: function (e) { state.ejecutivo = e.target.value; }
          })
    ));

    nodes.push(fieldWrap("Tipo de cliente", true,
      segControl(["On", "Off"], state.canal, function (v) {
        if (v !== state.canal) { state.cliente = ""; }
        state.canal = v;
      })
    ));

    if (state.canal) {
      const names = clientesForCanal().map(function (c) { return c.nombre; });
      nodes.push(fieldWrap("Razón social", true,
        names.length
          ? searchableSelect(names, state.cliente, "Buscar cliente…", function (name) { state.cliente = name; })
          : el("input", {
              type: "text", placeholder: "Escribe la razón social",
              value: state.cliente,
              oninput: function (e) { state.cliente = e.target.value; }
            }),
        !names.length ? "No hay clientes cargados para este canal todavía; escribe el nombre manualmente." : null
      ));
    }
    return nodes;
  }

  function viewPortafolio() {
    return [
      el("h2", { class: "step-title" }, ["3.1 Portafolio"]),
      el("p", { class: "step-hint" }, ["Selecciona qué SKUs de Flor de Caña están disponibles en este punto de venta."]),
      chipMultiSelect(state.skus, state.portafolio, function (sku) {
        const i = state.portafolio.indexOf(sku);
        if (i === -1) state.portafolio.push(sku);
        else {
          state.portafolio.splice(i, 1);
          const vi = state.visibilidad.indexOf(sku);
          if (vi !== -1) state.visibilidad.splice(vi, 1); // ya no puede estar "visible" si dejó de estar disponible
        }
      })
    ];
  }

  function viewVisibilidad() {
    return [
      el("h2", { class: "step-title" }, ["3.2 Visibilidad en contrabarra/góndola"]),
      el("p", { class: "step-hint" }, ["Selecciona qué SKUs, de los ya marcados como disponibles, están visibles al cliente. Los que no marcaste en Portafolio aparecen bloqueados."]),
      chipMultiSelect(state.skus, state.visibilidad, function (sku) {
        const i = state.visibilidad.indexOf(sku);
        if (i === -1) state.visibilidad.push(sku); else state.visibilidad.splice(i, 1);
      }, function (sku) { return state.portafolio.indexOf(sku) === -1; })
    ];
  }

  function viewFotoVisibilidad() {
    return [
      el("h2", { class: "step-title" }, ["3.3 Foto de visibilidad"]),
      el("p", { class: "step-hint" }, ["Fotografía la contrabarra o góndola. La hora, fecha y GPS quedan grabados en la imagen automáticamente."]),
      photoSlot(state.fotoVisibilidad, "Visibilidad", function (p) { state.fotoVisibilidad = p; })
    ];
  }

  function viewCarta() {
    const nodes = [el("h2", { class: "step-title" }, ["3.4 Carta"])];
    if (state.canal === "On") {
      nodes.push(fieldWrap("3.4.1 ¿Hay cócteles FDC?", true,
        segControl(["Si", "No"], state.cartaCocteles, function (v) { state.cartaCocteles = v; })
      ));
      if (state.cartaCocteles === "Si") {
        nodes.push(fieldWrap("¿Cuántos?", true,
          el("input", {
            type: "number", min: "0", inputmode: "numeric",
            value: state.cartaCantidadCocteles,
            oninput: function (e) { state.cartaCantidadCocteles = e.target.value; }
          })
        ));
      }
      nodes.push(fieldWrap("3.4.2 ¿Hay botellas FDC?", true,
        segControl(["Si", "No"], state.cartaBotellasSiNo, function (v) { state.cartaBotellasSiNo = v; })
      ));
      if (state.cartaBotellasSiNo === "Si") {
        nodes.push(fieldWrap("¿Cuáles?", true, chipMultiSelect(state.skus, state.cartaListaBotellas, function (sku) {
          const i = state.cartaListaBotellas.indexOf(sku);
          if (i === -1) state.cartaListaBotellas.push(sku); else state.cartaListaBotellas.splice(i, 1);
        })));
      }
      nodes.push(fieldWrap("3.4.3 ¿Activación en menú? (Logo, una botella o Flor Ginger)", true,
        segControl(["Si", "No"], state.cartaActivacionMenu, function (v) { state.cartaActivacionMenu = v; })
      ));
    } else if (state.canal === "Off") {
      nodes.push(fieldWrap("3.4.4 ¿Hay comunicación de combos FDC?", true,
        segControl(["Si", "No"], state.cartaCombosOff, function (v) { state.cartaCombosOff = v; })
      ));
    }
    return nodes;
  }

  function viewFotoCarta() {
    return [
      el("h2", { class: "step-title" }, ["3.4.5 Foto de carta"]),
      el("p", { class: "step-hint" }, ["Fotografía la carta o el menú."]),
      photoSlot(state.fotoCarta, "Carta", function (p) { state.fotoCarta = p; })
    ];
  }

  function priceField(key, label) {
    return fieldWrap(label, true, el("input", {
      type: "number", min: "0", step: "0.01", inputmode: "decimal",
      placeholder: "0.00",
      value: state.precios[key],
      oninput: function (e) { state.precios[key] = e.target.value; }
    }));
  }

  function viewPrecios() {
    return [
      el("h2", { class: "step-title" }, ["4. Precio"]),
      el("p", { class: "step-hint" }, ["Ingresa el PVP (precio de venta al público) vigente en el punto de venta."]),
      priceField("fdc_4_750", "4.1 PVP FDC 4 750"),
      priceField("fdc_es_4_750", "4.2 PVP FDC ES 4 750"),
      priceField("fdc_12_750", "4.3 PVP FDC 12 750"),
      priceField("jack_daniels", "4.4 PVP Jack Daniels 7/Sabores"),
      priceField("jw_red", "4.5 PVP JW Red"),
      priceField("jw_black", "4.6 PVP JW Black")
    ];
  }

  function materialField(key, label) {
    return fieldWrap(label, true, segControl(["Si", "No", "No aplica"], state.materiales[key], function (v) { state.materiales[key] = v; }));
  }

  function viewMateriales() {
    const nodes = [el("h2", { class: "step-title" }, ["5. Materiales"])];
    if (state.canal === "On") {
      nodes.push(materialField("vasos_pavonados", "5.1 ¿Tiene vasos pavonados?"));
      nodes.push(materialField("hieleras", "5.2 ¿Tiene hieleras?"));
      nodes.push(materialField("vasos_vidrio", "5.3 ¿Tiene vasos vidrio?"));
      nodes.push(materialField("barmats", "5.4 ¿Tiene barmats?"));
      nodes.push(materialField("luminoso", "5.5 ¿Tiene Luminoso FDC?"));
    } else if (state.canal === "Off") {
      nodes.push(materialField("banner_promos", "5.6 ¿Tiene banner/pizarra de promos?"));
    }
    return nodes;
  }

  function viewFotoMateriales() {
    return [
      el("h2", { class: "step-title" }, ["5.7 Foto de materiales"]),
      el("p", { class: "step-hint" }, ["Fotografía los materiales de punto de venta disponibles."]),
      photoSlot(state.fotoMateriales, "Materiales", function (p) { state.fotoMateriales = p; })
    ];
  }

  function viewCapacitacion() {
    return [
      el("h2", { class: "step-title" }, ["6. Capacitación"]),
      fieldWrap("¿El barstaff necesita capacitación?", true,
        segControl(["Si", "No"], state.capacitacion, function (v) { state.capacitacion = v; })
      )
    ];
  }

  function requestFinalGps() {
    getPosition(12000).then(function (pos) { state.gpsEnvio = pos; render(); })
      .catch(function () { state.gpsEnvio = null; state.submitError = "No se pudo obtener la ubicación. Activa el GPS y vuelve a intentar."; render(); });
  }

  function viewRevision() {
    if (!state.gpsEnvio && !state._gpsRequested) {
      state._gpsRequested = true;
      requestFinalGps();
    }
    const rows = [
      ["Ejecutivo", state.ejecutivo],
      ["Canal", state.canal],
      ["Cliente", state.cliente],
      ["SKUs disponibles", state.portafolio.length + " seleccionados"],
      ["SKUs visibles", state.visibilidad.length + " seleccionados"],
      ["Ubicación de envío", state.gpsEnvio ? (fmtCoord(state.gpsEnvio.lat) + ", " + fmtCoord(state.gpsEnvio.lng) + " (±" + Math.round(state.gpsEnvio.acc) + " m)") : "Obteniendo…"]
    ];
    const nodes = [
      el("h2", { class: "step-title" }, ["Revisión y envío"]),
      el("p", { class: "step-hint" }, ["Verifica los datos antes de enviar. Se enviará a Google Sheets y las 3 fotos a la carpeta de Drive."])
    ];
    rows.forEach(function (r) {
      nodes.push(el("div", { class: "summary-row" }, [el("span", { class: "k" }, [r[0]]), el("span", { class: "v" }, [String(r[1])])]));
    });
    if (!state.gpsEnvio) {
      nodes.push(el("button", {
        class: "camera-btn", type: "button", style: "margin-top:14px",
        onclick: function () { requestFinalGps(); }
      }, ["Reintentar ubicación"]));
    }
    return nodes;
  }

  const VIEW_BY_STEP = {
    identificacion: viewIdentificacion,
    portafolio: viewPortafolio,
    visibilidad: viewVisibilidad,
    foto_visibilidad: viewFotoVisibilidad,
    carta: viewCarta,
    foto_carta: viewFotoCarta,
    precios: viewPrecios,
    materiales: viewMateriales,
    foto_materiales: viewFotoMateriales,
    capacitacion: viewCapacitacion,
    revision: viewRevision
  };

  const STEP_LABELS = {
    identificacion: "Identificación", portafolio: "Portafolio", visibilidad: "Visibilidad",
    foto_visibilidad: "Foto visibilidad", carta: "Carta", foto_carta: "Foto carta",
    precios: "Precios", materiales: "Materiales", foto_materiales: "Foto materiales",
    capacitacion: "Capacitación", revision: "Revisión"
  };

  // ---------------------------------------------------------------
  // Envío
  // ---------------------------------------------------------------
  function buildPayload() {
    return {
      token: CFG.SHARED_TOKEN,
      ejecutivo: state.ejecutivo,
      canal: state.canal,
      cliente: state.cliente,
      gps_envio: state.gpsEnvio,
      portafolio: state.portafolio,
      visibilidad: state.visibilidad,
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
      capacitacion: state.canal === "On" ? state.capacitacion : "No aplica",
      submitted_at_local: new Date().toISOString(),
      app_version: "1.0"
    };
  }

  async function submit() {
    const errs = validateAll();
    if (errs.length) {
      state.submitError = errs[0];
      render();
      return;
    }
    if (!CFG.APPS_SCRIPT_URL || CFG.APPS_SCRIPT_URL.indexOf("PEGA_AQUI") === 0) {
      state.submitError = "La app aún no tiene configurada la URL del backend (config.js). Revisa GUIA_INSTALACION.md.";
      render();
      return;
    }
    const payload = buildPayload();
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(payload)); } catch (e) {}

    state.submitting = true;
    state.submitError = "";
    render();

    try {
      // Sin encabezados personalizados a propósito: evita el preflight
      // CORS que Google Apps Script no responde bien. No "corregir" esto
      // agregando Content-Type: application/json.
      const res = await fetch(CFG.APPS_SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify(payload)
      });
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
      el("button", {
        class: "btn btn-primary", style: "margin-top:18px; padding:0 24px",
        onclick: function () { resetForNext(); }
      }, ["Registrar otra visita"])
    ]));
  }

  function resetForNext() {
    const keepEjecutivo = state.ejecutivo;
    Object.assign(state, {
      stepIndex: 0, submitting: false, submitError: "",
      ejecutivo: keepEjecutivo, canal: "", cliente: "",
      portafolio: [], visibilidad: [], fotoVisibilidad: null,
      cartaCocteles: "", cartaCantidadCocteles: "", cartaBotellasSiNo: "",
      cartaListaBotellas: [], cartaActivacionMenu: "", cartaCombosOff: "", fotoCarta: null,
      precios: { fdc_4_750: "", fdc_es_4_750: "", fdc_12_750: "", jack_daniels: "", jw_red: "", jw_black: "" },
      materiales: { vasos_pavonados: "", hieleras: "", vasos_vidrio: "", barmats: "", luminoso: "", banner_promos: "" },
      fotoMateriales: null, capacitacion: "", gpsEnvio: null
    });
    state._gpsRequested = false;
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
      el("div", { class: "brand" }, [
        el("span", { class: "brand-mark" }, ["FLOR DE CAÑA"]),
        el("span", { class: "brand-sub" }, ["Ejecución PDV"])
      ]),
      el("div", { class: "progress-track" }, [
        el("div", { class: "progress-fill", style: "width:" + Math.round(((state.stepIndex + 1) / steps.length) * 100) + "%" })
      ]),
      el("div", { class: "progress-label" }, [
        "Paso " + (state.stepIndex + 1) + " de " + steps.length + " · " + STEP_LABELS[stepName]
      ])
    ]);

    const body = el("div", { class: "app-body" }, []);
    if (state.submitError) body.appendChild(el("div", { class: "error-banner" }, [state.submitError]));
    (VIEW_BY_STEP[stepName]() || []).forEach(function (n) { body.appendChild(n); });

    const footer = el("div", { class: "app-footer" }, []);
    if (state.stepIndex > 0) {
      footer.appendChild(el("button", { class: "btn btn-secondary", type: "button", onclick: goBack }, ["Atrás"]));
    }
    if (stepName === "revision") {
      footer.appendChild(el("button", {
        class: "btn btn-primary", type: "button",
        disabled: state.submitting ? "true" : null,
        onclick: submit
      }, [state.submitting ? "Enviando…" : "Enviar visita"]));
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
