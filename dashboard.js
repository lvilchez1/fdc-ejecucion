/* =====================================================================
   FDC — Dashboard de escritorio
   ===================================================================== */

(function () {
  "use strict";

  const CFG = window.APP_CONFIG || {};
  const root = document.getElementById("dash");

  const state = {
    loading: true,
    error: "",
    fecha: "",
    ranking: [],
    cartera: [], prospeccion: [], matinal: [], activacion: [],
    clientes: [],
    visitadosCarteraSet: null, // Set de "ejecutivo|cliente"
    filtroEjecutivo: "Todos",
    filtroCanal: "Todos",
    filtroLocalidad: "Todas",
    capturando: false,
    exportando: false,
    captureStatus: ""
  };

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

  function pillPct(pct) {
    if (pct === null || pct === undefined) return el("span", { style: "color:var(--tint-55)" }, ["—"]);
    let cls = "";
    if (pct < 70) cls = "background:var(--red); color:var(--red-fg);";
    else if (pct < 100) cls = "background:var(--amber); color:var(--amber-fg);";
    else cls = "background:var(--green); color:var(--green-fg);";
    return el("span", { class: "pill", style: cls }, [pct + "%"]);
  }

  function checkOrX(ok) {
    if (ok === null || ok === undefined) return el("span", { class: "chk-na" }, ["—"]);
    return ok ? el("span", { class: "chk-ok" }, ["✓"]) : el("span", { class: "chk-bad" }, ["✗"]);
  }

  function metaAvanceCell(meta, avance, aplica, ok) {
    if (aplica === false) return el("td", {}, [el("span", { class: "chk-na" }, ["—"])]);
    return el("td", {}, [meta + "/" + avance + " ", checkOrX(ok)]);
  }

  // ---------------------------------------------------------------
  // Carga de datos
  // ---------------------------------------------------------------
  async function cargarTodo() {
    if (!CFG.APPS_SCRIPT_URL || CFG.APPS_SCRIPT_URL.indexOf("PEGA_AQUI") === 0) {
      state.error = "El backend aún no está configurado (config.js).";
      state.loading = false;
      render();
      return;
    }
    try {
      const base = CFG.APPS_SCRIPT_URL + "?token=" + encodeURIComponent(CFG.SHARED_TOKEN);
      const [resDash, resConfig] = await Promise.all([
        fetch(base + "&action=dashboard"),
        fetch(base)
      ]);
      const dataDash = await resDash.json();
      const dataConfig = await resConfig.json();
      if (!dataDash || !dataDash.ok) throw new Error((dataDash && dataDash.error) || "Error cargando el dashboard.");
      if (!dataConfig || !dataConfig.ok) throw new Error((dataConfig && dataConfig.error) || "Error cargando clientes.");

      state.fecha = dataDash.fecha;
      state.ranking = dataDash.ranking;
      state.cartera = dataDash.cartera;
      state.prospeccion = dataDash.prospeccion;
      state.matinal = dataDash.matinal;
      state.activacion = dataDash.activacion;
      state.clientes = dataConfig.clientes || [];

      const visitados = new Set();
      (dataDash.visitadosCarteraMes || []).forEach(function (v) { visitados.add(v.ejecutivo + "|" + v.cliente); });
      state.visitadosCarteraSet = visitados;
    } catch (e) {
      state.error = "No se pudo cargar el dashboard (" + e.message + ").";
    }
    state.loading = false;
    render();
  }

  // ---------------------------------------------------------------
  // Secciones
  // ---------------------------------------------------------------
  function renderRanking() {
    const table = el("table", { class: "dash-table" }, [
      el("thead", {}, [el("tr", {}, [
        el("th", {}, ["Ejecutivo"]), el("th", {}, ["Cart"]), el("th", {}, ["Pros"]), el("th", {}, ["Mat"]), el("th", {}, ["Act"]), el("th", {}, ["Promedio"])
      ])]),
      el("tbody", {}, state.ranking.map(function (r) {
        return el("tr", {}, [
          el("td", {}, [r.medalla ? el("span", { class: "medal" }, [r.medalla]) : null, r.ejecutivo]),
          el("td", {}, [pillPct(r.cartera)]),
          el("td", {}, [pillPct(r.prospeccion)]),
          el("td", {}, [pillPct(r.matinal)]),
          el("td", {}, [pillPct(r.activacion)]),
          el("td", { style: "font-weight:800" }, [r.promedio === null ? "—" : r.promedio + "%"])
        ]);
      }))
    ]);
    return el("div", { class: "dash-section" }, [
      el("div", { class: "dash-section-title" }, ["Ranking de cumplimiento", el("span", { class: "dash-section-note" }, ["(promedio solo de las rutinas con cuota asignada)"])]),
      table
    ]);
  }

  function renderPacingDiario(titulo, filas) {
    const table = el("table", { class: "dash-table" }, [
      el("thead", {}, [el("tr", {}, [
        el("th", {}, ["Ejecutivo"]), el("th", {}, ["Meta"]), el("th", {}, ["Avance"]), el("th", {}, ["%"]), el("th", {}, ["Ayer"]), el("th", {}, ["Hoy"])
      ])]),
      el("tbody", {}, filas.map(function (f) {
        return el("tr", {}, [
          el("td", {}, [f.ejecutivo]),
          el("td", {}, [f.metaMes === null ? "—" : String(f.metaMes)]),
          el("td", {}, [String(f.avanceMes)]),
          el("td", {}, [pillPct(f.pct)]),
          metaAvanceCell(f.metaAyer, f.avanceAyer, f.ayerAplica, f.cumplioAyer),
          metaAvanceCell(f.metaHoy, f.avanceHoy, true, f.cumplioHoy)
        ]);
      }))
    ]);
    return el("div", { class: "dash-section" }, [el("div", { class: "dash-section-title" }, [titulo]), table]);
  }

  function renderPacingSemanal(titulo, filas) {
    const table = el("table", { class: "dash-table" }, [
      el("thead", {}, [el("tr", {}, [
        el("th", {}, ["Ejecutivo"]), el("th", {}, ["Meta"]), el("th", {}, ["Avance"]), el("th", {}, ["%"]), el("th", {}, ["Sem. pasada"]), el("th", {}, ["Esta semana"])
      ])]),
      el("tbody", {}, filas.map(function (f) {
        return el("tr", {}, [
          el("td", {}, [f.ejecutivo]),
          el("td", {}, [f.metaMes === null ? "—" : String(f.metaMes)]),
          el("td", {}, [String(f.avanceMes)]),
          el("td", {}, [pillPct(f.pct)]),
          metaAvanceCell(f.metaSemanaPasada, f.avanceSemanaPasada, f.semanaPasadaAplica, f.cumplioSemanaPasada),
          metaAvanceCell(f.metaEstaSemana, f.avanceEstaSemana, true, f.cumplioEstaSemana)
        ]);
      }))
    ]);
    return el("div", { class: "dash-section" }, [el("div", { class: "dash-section-title" }, [titulo, el("span", { class: "dash-section-note" }, ["(seguimiento semanal)"])]), table]);
  }

  function renderSoloMes(titulo, filas) {
    const table = el("table", { class: "dash-table" }, [
      el("thead", {}, [el("tr", {}, [el("th", {}, ["Ejecutivo"]), el("th", {}, ["Meta"]), el("th", {}, ["Avance"]), el("th", {}, ["%"])])]),
      el("tbody", {}, filas.map(function (f) {
        return el("tr", {}, [
          el("td", {}, [f.ejecutivo]),
          el("td", {}, [f.metaMes === null ? "—" : String(f.metaMes)]),
          el("td", {}, [String(f.avanceMes)]),
          el("td", {}, [pillPct(f.pct)])
        ]);
      }))
    ]);
    return el("div", { class: "dash-section" }, [el("div", { class: "dash-section-title" }, [titulo, el("span", { class: "dash-section-note" }, ["(solo meta mensual)"])]), table]);
  }

  // ---------------------------------------------------------------
  // Clientes sin visitar este mes
  // ---------------------------------------------------------------
  function clientesSinVisitar() {
    return state.clientes.filter(function (c) {
      if (state.filtroEjecutivo !== "Todos" && c.ejecutivo !== state.filtroEjecutivo) return false;
      if (state.filtroCanal !== "Todos" && c.canal !== state.filtroCanal) return false;
      if (state.filtroLocalidad !== "Todas" && c.localidad !== state.filtroLocalidad) return false;
      return !state.visitadosCarteraSet.has(c.ejecutivo + "|" + c.nombre);
    });
  }

  function renderCobertura() {
    const ejecutivosUnicos = Array.from(new Set(state.clientes.map(function (c) { return c.ejecutivo; }))).filter(Boolean).sort(function (a, b) { return a.localeCompare(b, "es"); });
    const localidadesUnicas = Array.from(new Set(state.clientes.map(function (c) { return c.localidad; }))).filter(Boolean).sort(function (a, b) { return a.localeCompare(b, "es"); });

    const selEjecutivo = el("select", { onchange: function (e) { state.filtroEjecutivo = e.target.value; render(); } },
      ["Todos"].concat(ejecutivosUnicos).map(function (n) {
        const o = el("option", { value: n }, [n]);
        if (n === state.filtroEjecutivo) o.setAttribute("selected", "true");
        return o;
      }));
    const selCanal = el("select", { onchange: function (e) { state.filtroCanal = e.target.value; render(); } },
      ["Todos", "On", "Off"].map(function (n) {
        const o = el("option", { value: n }, [n]);
        if (n === state.filtroCanal) o.setAttribute("selected", "true");
        return o;
      }));
    const selLocalidad = el("select", { onchange: function (e) { state.filtroLocalidad = e.target.value; render(); } },
      ["Todas"].concat(localidadesUnicas).map(function (n) {
        const o = el("option", { value: n }, [n]);
        if (n === state.filtroLocalidad) o.setAttribute("selected", "true");
        return o;
      }));

    const lista = clientesSinVisitar();
    const tableId = "tabla-sin-visitar";
    const table = lista.length
      ? el("table", { class: "dash-table", id: tableId }, [
          el("thead", {}, [el("tr", {}, [el("th", {}, ["Razón comercial"]), el("th", {}, ["Localidad"]), el("th", {}, ["Dirección"])])]),
          el("tbody", {}, lista.map(function (c) {
            return el("tr", {}, [el("td", {}, [c.nombre]), el("td", {}, [c.localidad || "—"]), el("td", {}, [c.direccion || "—"])]);
          }))
        ])
      : el("div", { class: "dash-empty" }, ["No hay clientes pendientes con estos filtros — cobertura completa."]);

    const captureBtn = el("button", { class: "btn-capture", type: "button", disabled: (lista.length === 0 || state.capturando || state.exportando) ? "true" : null }, [state.capturando ? "Generando…" : "📸 Tomar captura"]);
    captureBtn.addEventListener("click", function () { tomarCaptura(tableId, lista.length); });

    const exportBtn = el("button", { class: "btn-secondary-sm", type: "button", disabled: (lista.length === 0 || state.capturando || state.exportando) ? "true" : null }, [state.exportando ? "Generando…" : "📊 Exportar Excel"]);
    exportBtn.addEventListener("click", function () { exportarExcel(lista); });

    return el("div", { class: "dash-section" }, [
      el("div", { class: "dash-section-title-row" }, [
        el("div", { class: "dash-section-title" }, ["Clientes sin visitar este mes (Cartera)"]),
        el("div", { class: "title-actions" }, [captureBtn, exportBtn])
      ]),
      el("div", { class: "filters-row" }, [selEjecutivo, selCanal, selLocalidad]),
      table,
      state.captureStatus ? el("div", { class: "capture-status" }, [state.captureStatus]) : null
    ]);
  }

  // ---------------------------------------------------------------
  // Captura de pantalla (html2canvas) — copia al portapapeles si es 1
  // sola imagen; si hay que cortar en varias, se descargan numeradas.
  // ---------------------------------------------------------------
  let html2canvasPromise = null;
  function loadHtml2Canvas() {
    if (window.html2canvas) return Promise.resolve();
    if (html2canvasPromise) return html2canvasPromise;
    html2canvasPromise = new Promise(function (resolve, reject) {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
      script.onload = function () { resolve(); };
      script.onerror = function () { html2canvasPromise = null; reject(new Error("No se pudo cargar la librería de captura.")); };
      document.head.appendChild(script);
    });
    return html2canvasPromise;
  }

  function nombreArchivo(sufijo, ext) {
    const ejec = state.filtroEjecutivo === "Todos" ? "Todos" : state.filtroEjecutivo.replace(/[^a-zA-Z0-9_-]/g, "_");
    return ejec + "_" + state.fecha + (sufijo ? "_" + sufijo : "") + "." + (ext || "png");
  }

  function descargarBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  async function capturarElemento(elemento) {
    const canvas = await window.html2canvas(elemento, { backgroundColor: "#003D4D", scale: 2 });
    return new Promise(function (resolve) { canvas.toBlob(function (blob) { resolve(blob); }, "image/png"); });
  }

  async function tomarCaptura(tableId, totalFilas) {
    const FILAS_POR_CAPTURA = 25;
    state.capturando = true; state.captureStatus = ""; render();
    try {
      await loadHtml2Canvas();
      const tabla = document.getElementById(tableId);
      if (!tabla) throw new Error("No hay tabla para capturar.");

      if (totalFilas <= FILAS_POR_CAPTURA) {
        const blob = await capturarElemento(tabla);
        let copiado = false;
        try {
          if (navigator.clipboard && window.ClipboardItem) {
            await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]);
            copiado = true;
          }
        } catch (e) { /* el navegador puede negar el permiso: seguimos con la descarga igual */ }
        descargarBlob(blob, nombreArchivo(""));
        state.captureStatus = copiado ? "Captura copiada al portapapeles (Ctrl+V para pegar) y descargada." : "Captura descargada (tu navegador no permitió copiarla automáticamente al portapapeles).";
      } else {
        // Tabla larga: se corta en bloques de FILAS_POR_CAPTURA y se descarga cada una numerada.
        const filasOriginales = Array.from(tabla.querySelectorAll("tbody tr"));
        const headerHtml = tabla.querySelector("thead").outerHTML;
        const totalBloques = Math.ceil(filasOriginales.length / FILAS_POR_CAPTURA);
        for (let b = 0; b < totalBloques; b++) {
          const chunkRows = filasOriginales.slice(b * FILAS_POR_CAPTURA, (b + 1) * FILAS_POR_CAPTURA);
          const temp = document.createElement("table");
          temp.className = "dash-table";
          temp.style.position = "fixed";
          temp.style.left = "-9999px";
          temp.style.width = tabla.offsetWidth + "px";
          temp.innerHTML = headerHtml;
          const tbody = document.createElement("tbody");
          chunkRows.forEach(function (r) { tbody.appendChild(r.cloneNode(true)); });
          temp.appendChild(tbody);
          document.body.appendChild(temp);
          const blob = await capturarElemento(temp);
          document.body.removeChild(temp);
          descargarBlob(blob, nombreArchivo(String(b + 1)));
        }
        state.captureStatus = totalBloques + " capturas descargadas (numeradas) — el portapapeles solo admite una imagen a la vez, así que estas se adjuntan juntas desde el explorador de archivos.";
      }
    } catch (e) {
      state.captureStatus = "No se pudo generar la captura (" + e.message + ").";
    }
    state.capturando = false;
    render();
  }

  // ---------------------------------------------------------------
  // Exportar a Excel (SheetJS) — misma lista filtrada que se ve en pantalla
  // ---------------------------------------------------------------
  let xlsxPromise = null;
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve();
    if (xlsxPromise) return xlsxPromise;
    xlsxPromise = new Promise(function (resolve, reject) {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      script.onload = function () { resolve(); };
      script.onerror = function () { xlsxPromise = null; reject(new Error("No se pudo cargar la librería de Excel.")); };
      document.head.appendChild(script);
    });
    return xlsxPromise;
  }

  async function exportarExcel(lista) {
    state.exportando = true; state.captureStatus = ""; render();
    try {
      await loadXLSX();
      const datos = lista.map(function (c) {
        return { "Razón comercial": c.nombre, "Localidad": c.localidad || "", "Dirección": c.direccion || "" };
      });
      const ws = window.XLSX.utils.json_to_sheet(datos);
      ws["!cols"] = [{ wch: 32 }, { wch: 18 }, { wch: 32 }];
      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, "Sin visitar");
      window.XLSX.writeFile(wb, nombreArchivo("", "xlsx"));
      state.captureStatus = "Excel descargado (" + lista.length + " clientes).";
    } catch (e) {
      state.captureStatus = "No se pudo exportar el Excel (" + e.message + ").";
    }
    state.exportando = false;
    render();
  }

  // ---------------------------------------------------------------
  // Render principal
  // ---------------------------------------------------------------
  function render() {
    root.innerHTML = "";
    root.appendChild(el("div", { class: "dash-header" }, [
      el("img", { src: "assets/logo-white.png", alt: "Flor de Caña", class: "dash-logo" }),
      el("div", {}, [
        el("div", { class: "dash-title" }, ["Dashboard"]),
        el("div", { class: "dash-subtitle" }, [state.fecha ? "Metas y cobertura del equipo — " + state.fecha : "Metas y cobertura del equipo"])
      ])
    ]));

    if (state.error) root.appendChild(el("div", { class: "dash-error" }, [state.error]));
    if (state.loading) { root.appendChild(el("div", { class: "dash-loading" }, ["Cargando…"])); return; }
    if (state.error) return;

    root.appendChild(renderRanking());
    root.appendChild(renderPacingDiario("Cartera", state.cartera));
    root.appendChild(renderPacingDiario("Prospección", state.prospeccion));
    root.appendChild(renderSoloMes("Matinal / Vespertina", state.matinal));
    root.appendChild(renderPacingSemanal("Activación On Trade", state.activacion));
    root.appendChild(renderCobertura());
  }

  render();
  cargarTodo();
})();
