/* receptor.js — el panel de coordinación.

   Recibe los CSV que mandan los encuestadores por WhatsApp (se arrastran a la pantalla,
   se eligen con el botón o se pega el texto) y los va cruzando a medida que llegan:
   avance por punto muestral y cuotas, resultados ponderados, cruces, alertas de calidad
   y contactos para supervisar. Exporta la base consolidada en CSV (Excel / SPSS).

   Nada sale de esta computadora: lo recibido se guarda en el navegador (localStorage).
   Para pasar la base a otra compu: «Copia de seguridad» y después «Recibir» ese archivo.
*/
"use strict";
const K_RCOD = "rec.codigo", K_REST = "rec.estudio";
let SES = LS.get(K_REST, null), EST = SES && SES.est;
let DATA = null;           // {casos:{}, timbres:{}, contactos:{}, log:[]}
let tab = LS.get("rec.tab", "recibir"), weighted = LS.get("rec.w", true), pruebas = false;
let selQ = "E2", crossRow = "E2", crossCol = "sexo", crossGroup = true;
const KD = () => "rec.datos." + EST.id;
function loadData() { DATA = LS.get(KD(), { casos: {}, timbres: {}, contactos: {}, log: [] }); }
function saveData() { if (!LS.set(KD(), DATA)) toast("El navegador se quedó sin lugar. Descargá la copia de seguridad."); }
const pmById = id => (EST.pms.find(p => p.id === id) || { id, nombre: id, loc: "", meta: 0 });
const esPrueba = c => String(c.encId || "").endsWith("-p");
const allCases = () => Object.values(DATA.casos).filter(c => pruebas || !esPrueba(c));

// ───────────────────────────── entrar ─────────────────────────────
async function entrar(codigo, archivoLocal) {
  try {
    let lista = [];
    if (archivoLocal) { const a = await abrirArchivoEstudio(codigo, archivoLocal); if (a) lista = [a]; }
    else lista = await buscarEstudios(codigo);
    const coord = lista.filter(x => x.yo.rol === "coord");
    if (!coord.length) { toast(lista.length ? "Ese es un código de encuestador. El receptor abre con un código de coordinación." : "Ese código no abre ningún estudio."); return; }
    const e = coord.sort((a, b) => b.sello.localeCompare(a.sello))[0];
    SES = { est: e.est, yo: e.yo, sello: e.sello }; EST = SES.est; LS.set(K_REST, SES); LS.set(K_RCOD, codigo);
    loadData(); render();
  } catch (err) {
    toast(location.protocol === "file:" ? "Abierto desde la compu: elegí también el archivo del estudio (carpeta estudios)." : "No pude leer los estudios. ¿Hay internet?");
    $("#e-file-row").hidden = false;
  }
}

// ───────────────────────────── recibir ─────────────────────────────
function ingerir(txt, nombre) {
  const partes = separarBloques(txt); let res = { casos: 0, nuevos: 0, timbres: 0, contactos: 0, ajenos: 0, desconocido: 0 };
  for (const p of partes) {
    if (p.trim().startsWith("{")) { try { const j = JSON.parse(p); if (j.tipo === "copia-receptor" && j.estudio === EST.id) { for (const [k, v] of Object.entries(j.datos.casos || {})) { if (!DATA.casos[k]) res.nuevos++; DATA.casos[k] = v; res.casos++; } Object.assign(DATA.timbres, j.datos.timbres || {}); Object.assign(DATA.contactos, j.datos.contactos || {}); continue; } } catch (e) { } }
    const r = leerCSV(EST, p);
    if (r.tipo === "casos") {
      res.ajenos += r.otros;
      for (const c of r.casos) { const prev = DATA.casos[c.id]; if (!prev) res.nuevos++; if (!prev || (c.fin || 0) >= (prev.fin || 0)) DATA.casos[c.id] = c; res.casos++; }
    } else if (r.tipo === "timbres") { for (const t of r.timbres) { DATA.timbres[t.encId + "_" + t.dia] = t; res.timbres++; } }
    else if (r.tipo === "contactos") { for (const k of r.contactos) { DATA.contactos[k.id] = k; res.contactos++; } }
    else res.desconocido++;
  }
  DATA.log.unshift({ t: Date.now(), nombre: nombre || "texto pegado", ...res }); DATA.log = DATA.log.slice(0, 200);
  saveData();
  const msg = res.casos ? `${nombre || "Texto"}: ${res.casos} encuestas (${res.nuevos} nuevas).` : res.timbres ? `${nombre}: timbres de ${res.timbres} día(s).` : res.contactos ? `${nombre}: ${res.contactos} contactos.` : `${nombre || "Texto"}: no reconozco el formato o es de otro estudio.`;
  toast(msg); render();
}
function leerArchivos(files) { [...files].forEach(f => { const r = new FileReader(); r.onload = () => ingerir(String(r.result), f.name); r.readAsText(f, "utf-8"); }); }
async function traerGoogle() {
  const cfg = EST.envio || {}; if (!cfg.url) return;
  try {
    const r = await fetch(cfg.url + "?token=" + encodeURIComponent(cfg.token) + "&estudio=" + encodeURIComponent(EST.id));
    const j = await r.json(); if (!j.ok) throw new Error(j.error || "rechazado");
    for (const p of j.partes || []) ingerir(p.csv, "Google · " + (p.enc || p.tipo));
    toast(`Traídos ${(j.partes || []).length} envíos del receptor de Google.`);
  } catch (e) { toast("No pude traer de Google: " + (e.message || e)); }
}
function descargar(nombre, contenido, tipo = "text/csv") {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo + ";charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ───────────────────────────── análisis ─────────────────────────────
function buildVars() {
  const V = {};
  V.sexo = { label: "Sexo", opts: [[1, "Varón"], [2, "Mujer"], [66, "Otro"]], val: c => c.a.P1 };
  V.tramo = { label: "Edad", opts: TRAMOS(EST).map(t => [t, t]), val: c => c.a.P2 != null ? tramoDe(EST, c.a.P2) : null };
  V.pm = { label: "Punto muestral", opts: EST.pms.map(p => [p.id, p.id]), val: c => c.pm };
  const locs = [...new Set(EST.pms.map(p => p.loc))];
  V.loc = { label: "Localidad", opts: locs.map(l => [l, l]), val: c => pmById(c.pm).loc };
  for (const q of EST.preguntas) {
    if (q.type === "single") V[q.id] = { label: q.id + " · " + q.s, opts: q.opts, val: c => c.a[q.id], scale: q.scale };
    if (q.type === "multi") V[q.id] = { label: q.id + " · " + q.s, opts: q.opts, val: c => c.a[q.id], multi: true };
    if (q.type === "grid") for (const [k, l] of q.rows) V[q.id + "_" + k] = { label: q.id + " · " + q.s + ": " + l, opts: q.cols, val: c => c.a[q.id + "_" + k], scale: q.scale };
  }
  return V;
}
let VARS = {};
function grouped(v) {
  if (!v.scale) return v;
  const hasNC = v.opts.some(o => o[0] === 98);
  return { ...v, opts: [["POS", "Positiva (4 a 6)"], ["NEG", "Negativa (1 a 3)"], ...(hasNC ? [[98, "No lo conoce"]] : []), [99, "Ns/Nc"]], val: c => { const x = v.val(c); if (x == null) return null; if (x >= 1 && x <= 3) return "NEG"; if (x >= 4 && x <= 6) return "POS"; return x; } };
}
// Ponderación por celdas sexo × edad contra la distribución objetivo del estudio.
function weightsOf(cs, forzar) {
  const cnt = {}; let tot = 0; for (const c of cs) { const k = cellOf(EST, c); if (k) { cnt[k] = (cnt[k] || 0) + 1; tot++; } }
  const w = {}; for (const c of cs) { const k = cellOf(EST, c); if (!k || !(weighted || forzar)) { w[c.id] = 1; continue; } const [s, t] = k.split("|"); w[c.id] = EST.cuotas.dist[s][t] / (cnt[k] / tot); }
  return w;
}
function dist(cs, v, W) {
  const tot = {}; let base = 0, nRaw = 0;
  for (const c of cs) { const x = v.val(c); if (x == null || (Array.isArray(x) && !x.length)) continue; const w = W[c.id] ?? 1; base += w; nRaw++; for (const y of (Array.isArray(x) ? x : [x])) tot[y] = (tot[y] || 0) + w; }
  return { rows: v.opts.map(([code, label]) => ({ code, label, p: base ? (tot[code] || 0) / base : 0 })), base, nRaw };
}
function barsHTML(d, opt = {}) {
  if (!d.nRaw) return '<div class="empty small">Sin casos todavía.</div>';
  const rows = opt.sort ? [...d.rows].sort((a, b) => b.p - a.p) : d.rows; const max = Math.max(...rows.map(r => r.p), 0.0001);
  return `<div class="bars">${rows.map(r => `<div class="bar ${[0, 77, 98, 99].includes(r.code) ? "aux" : ""}"><span>${esc(r.label)}</span><span class="pct">${pct(r.p)}</span><div class="track"><i style="width:${(r.p / max) * 100}%"></i></div></div>`).join("")}</div><p class="small muted">Base: ${d.nRaw} casos${weighted ? " · ponderado por sexo y edad" : ""}</p>`;
}
const moe = n => n ? (1.96 * Math.sqrt(0.25 / n) * 100).toFixed(1).replace(".", ",") : "—";
function imagenTable(cs, W, qid) {
  const q = EST.preguntas.find(x => x.id === qid); if (!q) return "";
  const rows = q.rows.map(([k, l]) => { const d = dist(cs, VARS[qid + "_" + k], W); const g = x => d.rows.filter(r => x.includes(r.code)).reduce((a, r) => a + r.p, 0); const pos = g([4, 5, 6]), neg = g([1, 2, 3]); return { l, pos, neg, nc: g([98]), ns: g([99]), dif: pos - neg, n: d.nRaw }; }).sort((a, b) => b.pos - a.pos);
  if (!rows[0] || !rows[0].n) return '<div class="empty small">Sin casos todavía.</div>';
  return `<div class="tbl-wrap"><table class="t"><thead><tr><th>Dirigente</th><th class="n">Conoce</th><th class="n">Positiva</th><th class="n">Negativa</th><th class="n">Dif.</th><th class="n">Ns/Nc</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.l)}</td><td class="n">${pct(1 - r.nc)}</td><td class="n pos">${pct(r.pos)}</td><td class="n neg">${pct(r.neg)}</td><td class="n ${r.dif >= 0 ? "pos" : "neg"}">${r.dif >= 0 ? "+" : ""}${(r.dif * 100).toFixed(0)}</td><td class="n">${pct(r.ns)}</td></tr>`).join("")}</tbody></table></div><p class="small muted">Positiva = regular buena + buena + muy buena. Negativa = muy mala + mala + regular mala.</p>`;
}
function qualityFlags(cs) {
  const flags = []; const singles = EST.preguntas.filter(q => q.type === "single");
  const grids = EST.preguntas.filter(q => q.type === "grid" && q.rotate);
  for (const c of cs) {
    const r = [];
    if (c.dur < 360) r.push("Duró " + Math.round(c.dur / 60) + " min");
    for (const g of grids) { const v = g.rows.map(([k]) => c.a[g.id + "_" + k]).filter(x => x != null && x !== 98 && x !== 99); if (v.length >= 6 && new Set(v).size === 1) r.push(g.s + ": todas iguales"); }
    const resp = singles.filter(q => c.a[q.id] != null); const nsr = resp.filter(q => c.a[q.id] === 99).length / (resp.length || 1);
    if (nsr > .35) r.push(Math.round(nsr * 100) + "% Ns/Nc");
    if (c.sobrecuota) r.push("Sobrecuota");
    if (r.length) flags.push({ c, r });
  }
  const byEnc = {}; cs.forEach(c => (byEnc[c.encId] = byEnc[c.encId] || []).push(c));
  Object.values(byEnc).forEach(l => { l.sort((a, b) => a.fin - b.fin); for (let i = 1; i < l.length; i++) if (l[i].fin - l[i - 1].fin < 240000) { const f = flags.find(x => x.c === l[i]); const m = "Menos de 4 min desde la anterior"; if (f) f.r.push(m); else flags.push({ c: l[i], r: [m] }); } });
  return flags;
}

// ───────────────────────────── pantallas ─────────────────────────────
function render() {
  const top = `<header class="top"><div class="brand">Opción <small>${EST ? "Receptor · " + esc(EST.nombre) : "Receptor de encuestas"}</small></div><div class="sp"></div>${EST ? `<button class="btn sm ghost" id="salir" style="color:inherit;border-color:rgba(255,255,255,.35);min-height:32px">Cambiar código</button>` : ""}</header>`;
  if (!SES) { $("#app").innerHTML = top + vEntrar(); bind(); return; }
  if (!DATA) loadData();
  VARS = buildVars();
  const cs = allCases();
  const tabs = [["recibir", "Recibir"], ["avance", "Avance"], ["resultados", "Resultados"], ["cruces", "Cruces"], ["calidad", "Calidad"], ["exportar", "Exportar"]];
  const body = { recibir: tRecibir, avance: tAvance, resultados: tResultados, cruces: tCruces, calidad: tCalidad, exportar: tExportar }[tab] || tRecibir;
  const nPru = Object.values(DATA.casos).filter(esPrueba).length;
  $("#app").innerHTML = top + `<main class="wrap wide">
    <div class="row" style="justify-content:space-between"><div><h1 style="font-size:1.6rem">${esc(EST.nombre)}</h1><p class="small muted">${esc(EST.universo)} · meta ${EST.meta} casos · ${EST.pms.length} puntos muestrales · ${esc(EST.fecha)}</p></div>
      <div class="row small" style="gap:14px"><label class="row" for="w-tog" style="gap:6px;font-weight:700"><input type="checkbox" id="w-tog" ${weighted ? "checked" : ""}> Ponderar por sexo y edad</label>
      ${nPru ? `<label class="row" for="p-tog" style="gap:6px;font-weight:700"><input type="checkbox" id="p-tog" ${pruebas ? "checked" : ""}> Incluir ${nPru} de prueba</label>` : ""}</div></div>
    <nav class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join("")}</nav>
    ${body(cs)}</main>`;
  bind();
}
function vEntrar() {
  return `<main class="wrap"><section class="card"><h1 style="font-size:1.5rem">Receptor de coordinación</h1>
    <p>Herramienta interna de <b>Opción</b>, consultora de opinión pública.</p>
    <p class="muted">Entrá con un código de coordinación. Lo que recibas queda guardado solo en este navegador.</p>
    <label class="f" for="e-cod">Código de coordinación<input class="in codigo" id="e-cod" autocomplete="off" spellcheck="false" value="${esc(LS.get(K_RCOD, ""))}"></label>
    <div class="row" id="e-file-row" ${location.protocol === "file:" ? "" : "hidden"}><label class="f" for="e-file" style="flex:1">Archivo del estudio (estudios/e-….json)<input class="in" type="file" id="e-file" accept=".json"></label></div>
    <button class="btn primary big block" id="e-ok">Entrar</button></section>
    <p class="small muted" style="text-align:center">Esta app no pide contraseñas, datos bancarios ni cuentas de Google, WhatsApp u otros servicios. Solo usa el código de acceso que entrega el equipo de Opción. La opera Opción y está alojada en el sitio de Guillermo Santellán (guillesantellan.github.io). Las respuestas se usan solo para el estudio y no se comparten con terceros.</p></main>`;
}
function tRecibir(cs) {
  const log = DATA.log.slice(0, 30).map(l => `<tr><td class="small">${new Date(l.t).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td><td>${esc(l.nombre)}</td><td class="n">${l.casos || ""}</td><td class="n">${l.nuevos || ""}</td><td class="small">${l.timbres ? l.timbres + " días de timbres" : ""}${l.contactos ? " " + l.contactos + " contactos" : ""}${l.desconocido ? ' <span class="neg">formato no reconocido</span>' : ""}${l.ajenos ? ` <span class="neg">${l.ajenos} de otro estudio</span>` : ""}</td></tr>`).join("");
  return `<div class="grid2"><section class="card"><h2>Recibir envíos</h2>
      <div class="drop" id="drop"><b>Soltá acá los archivos</b> que llegaron por WhatsApp<br><span class="small">encuestas…csv, timbres…csv, contactos…csv (podés soltar varios juntos)</span></div>
      <div class="row"><label class="btn sm" for="f-in" style="cursor:pointer">Elegir archivos<input type="file" id="f-in" multiple accept=".csv,.txt,.json" hidden></label>
      ${EST.envio && EST.envio.url ? '<button class="btn sm" id="g-pull">Traer del receptor de Google</button>' : ""}</div>
      <label class="f" for="paste">O pegá el texto que mandaron<textarea class="in mono" id="paste" style="font-size:.75rem" placeholder="#ENCUESTA-CAMPO casos …"></textarea></label>
      <button class="btn primary sm" id="paste-go" style="align-self:flex-start">Cargar texto</button>
      <p class="small muted">Las encuestas repetidas no se duplican: cada envío trae todo lo del encuestador y acá se queda una sola vez cada una.</p></section>
    <section class="card"><h2>Estado</h2>
      <div class="kpis"><div class="kpi"><span class="lbl">Encuestas</span><b>${cs.length}<span class="muted" style="font-size:1rem"> / ${EST.meta}</span></b></div>
      <div class="kpi"><span class="lbl">Encuestadores</span><b>${new Set(cs.map(c => c.encId)).size}</b></div>
      <div class="kpi"><span class="lbl">Contactos</span><b>${Object.keys(DATA.contactos).length}</b></div></div></section></div>
    <section class="card"><h2>Últimos envíos</h2>${log ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Cuándo</th><th>Archivo</th><th class="n">Encuestas</th><th class="n">Nuevas</th><th>Otros</th></tr></thead><tbody>${log}</tbody></table></div>` : '<div class="empty">Todavía no recibiste nada. Cuando un encuestador toca «Enviar por WhatsApp», te llegan los archivos: soltalos arriba.</div>'}</section>`;
}
function tAvance(cs) {
  const n = cs.length, hoy = cs.filter(c => dayKey(new Date(c.fin)) === dayKey()).length;
  const tim = Object.values(DATA.timbres).filter(t => pruebas || !String(t.encId).endsWith("-p"));
  const intTot = {}; tim.forEach(t => TIMBRE_COLS.forEach(([k]) => intTot[k] = (intTot[k] || 0) + (t[k] || 0)));
  const sinEnc = TIMBRE_COLS.reduce((a, [k]) => a + (intTot[k] || 0), 0);
  const acept = n + (intTot.rechazo || 0) ? n / (n + (intTot.rechazo || 0)) : null;
  const byPM = {}; cs.forEach(c => (byPM[c.pm] = byPM[c.pm] || []).push(c));
  const pmRows = EST.pms.map(p => {
    const l = byPM[p.id] || [], tg = quotaTargets(EST, p.meta), cnt = {}; l.forEach(c => { const k = cellOf(EST, c); if (k) cnt[k] = (cnt[k] || 0) + 1; });
    const cells = SEXOS.flatMap(([s]) => TRAMOS(EST).map(t => { const k = s + "|" + t, d = cnt[k] || 0; return `<i class="${d > tg[k] ? "o" : d >= tg[k] ? "f" : d ? "p" : ""}" title="${s} ${t}: ${d}/${tg[k]}"></i>`; })).join("");
    const r = p.meta ? l.length / p.meta : 0;
    return `<tr><td class="mono">${esc(p.id)}</td><td>${esc(p.nombre)}<br><span class="small muted">${esc(p.loc)}</span></td><td>${esc([...new Set(l.map(c => c.enc))].join(", ") || "—")}</td><td class="n">${l.length}/${p.meta}</td><td style="min-width:110px"><div class="meter"><i class="${r >= 1 ? "done" : ""}" style="width:${Math.min(100, r * 100)}%"></i></div></td><td><span class="mini">${cells}</span></td><td class="small">${ago(l.reduce((m, c) => Math.max(m, c.fin), 0))}</td></tr>`;
  }).join("");
  const tgG = quotaTargets(EST, EST.meta), cntG = {}; cs.forEach(c => { const k = cellOf(EST, c); if (k) cntG[k] = (cntG[k] || 0) + 1; });
  let qg = `<div class="qgrid"><span></span>${TRAMOS(EST).map(t => `<span class="h">${t}</span>`).join("")}`;
  for (const [s, l] of SEXOS) { qg += `<span class="rh">${l}</span>`; for (const t of TRAMOS(EST)) { const k = s + "|" + t, d = cntG[k] || 0; qg += `<span class="cell ${d > tgG[k] ? "over" : d >= tgG[k] ? "full" : ""}">${d}/${tgG[k]}</span>`; } }
  qg += "</div>";
  const alerts = qualityFlags(cs).length;
  return `<div class="kpis">
    <div class="kpi"><span class="lbl">Encuestas</span><b>${n}<span class="muted" style="font-size:1rem"> / ${EST.meta}</span></b><div class="meter"><i style="width:${Math.min(100, n / EST.meta * 100)}%"></i></div></div>
    <div class="kpi"><span class="lbl">Hoy</span><b>${hoy}</b><span class="small muted">encuestas</span></div>
    <div class="kpi"><span class="lbl">Margen de error</span><b>±${moe(n)}%</b><span class="small muted">95% de confianza</span></div>
    <div class="kpi"><span class="lbl">Alertas de calidad</span><b style="color:${alerts ? "var(--bad)" : "var(--ok)"}">${alerts}</b><span class="small muted">ver Calidad</span></div>
    <div class="kpi"><span class="lbl">Aceptación</span><b>${acept == null ? "—" : pct(acept)}</b><span class="small muted">${sinEnc} timbres sin encuesta</span></div></div>
  <section class="card"><div class="row" style="justify-content:space-between"><h2>Avance por punto muestral</h2><span class="small muted"><span class="mini"><i class="p"></i></span> en curso · <span class="mini"><i class="f"></i></span> completa · <span class="mini"><i class="o"></i></span> sobrecuota</span></div>
    <div class="tbl-wrap"><table class="t"><thead><tr><th>PM</th><th>Radio</th><th>Encuestador</th><th class="n">Casos</th><th>Avance</th><th>Cuotas V/M × edad</th><th>Último</th></tr></thead><tbody>${pmRows}</tbody></table></div></section>
  <div class="grid2"><section class="card"><h2>Cuotas totales (sexo × edad)</h2>${qg}<p class="small muted">${esc(EST.cuotas.nota || "")}</p></section>
  <section class="card"><h2>Timbres sin encuesta</h2><div class="bars">${TIMBRE_COLS.map(([k]) => `<div class="bar aux"><span>${esc({ noAtiende: "No atiende", rechazo: "Rechaza", cuotaLlena: "Cuota llena", filtro: "No cumple filtro", suspendida: "Interrumpida" }[k])}</span><span class="pct">${intTot[k] || 0}</span><div class="track"><i style="width:${sinEnc ? (intTot[k] || 0) / sinEnc * 100 : 0}%"></i></div></div>`).join("")}</div></section></div>`;
}
function tResultados(cs) {
  const W = weightsOf(cs); const has = id => VARS[id];
  const card = (id, t) => has(id) ? `<section class="card"><h3>${esc(t || VARS[id].label)}</h3>${barsHTML(dist(cs, VARS[id], W))}</section>` : "";
  const gcard = (id, t) => has(id) ? `<section class="card"><h3>${esc(t)}</h3>${barsHTML(dist(cs, grouped(VARS[id]), W))}</section>` : "";
  const opts = Object.entries(VARS).filter(([k]) => !["sexo", "tramo", "pm", "loc"].includes(k)).map(([k, v]) => `<option value="${k}" ${selQ === k ? "selected" : ""}>${esc(v.label)}</option>`).join("");
  const v = VARS[selQ] || Object.values(VARS)[4];
  return `<p class="small muted">n = ${cs.length} · margen de error ±${moe(cs.length)}%. Mientras no estén todos los puntos muestrales, los resultados pueden estar sesgados.</p>
  <div class="grid2">${card("E1", "Voto Gobernador 2027")}${card("E2", "Voto Intendente 2027")}${card("E3", "Continuidad o cambio")}</div>
  <div class="grid2">${gcard("C4", "Gestión del Intendente")}${gcard("C3", "Gestión del Gobernador")}${gcard("C2", "Gestión del Presidente")}</div>
  <section class="card"><h3>Imagen de dirigentes locales</h3>${imagenTable(cs, W, "D6")}</section>
  <section class="card"><h3>Imagen de dirigentes nacionales</h3>${imagenTable(cs, W, "C1")}</section>
  <section class="card"><div class="row" style="justify-content:space-between"><h3>Cualquier pregunta</h3><select class="in" id="r-sel" style="max-width:440px">${opts}</select></div>${barsHTML(dist(cs, v, W), { sort: !v.scale })}</section>`;
}
function tCruces(cs) {
  const W = weightsOf(cs);
  const rowOpts = Object.entries(VARS).map(([k, v]) => `<option value="${k}" ${crossRow === k ? "selected" : ""}>${esc(v.label)}</option>`).join("");
  const colKeys = ["sexo", "tramo", "loc", "pm", "E4", "E5", "G1", "C4", "B4", "G2b", "G4"].filter(k => VARS[k]);
  const colOpts = colKeys.map(k => `<option value="${k}" ${crossCol === k ? "selected" : ""}>${esc(VARS[k].label)}</option>`).join("");
  let rv = VARS[crossRow] || VARS.sexo, cv = VARS[crossCol] || VARS.sexo; if (crossGroup) { rv = grouped(rv); cv = grouped(cv); }
  const cols = cv.opts.map(([code, label]) => { const sub = cs.filter(c => { const x = cv.val(c); return Array.isArray(x) ? x.includes(code) : x === code; }); return { label, d: dist(sub, rv, W), n: sub.length }; }).filter(c => c.n);
  const tot = dist(cs, rv, W);
  const table = !cs.length ? '<div class="empty">Sin casos todavía.</div>' : `<div class="tbl-wrap"><table class="t"><thead><tr><th>${esc(rv.label)}</th><th class="n">Total</th>${cols.map(c => `<th class="n">${esc(c.label)}</th>`).join("")}</tr></thead><tbody>
    ${rv.opts.map(([, label], i) => `<tr><td>${esc(label)}</td><td class="n"><b>${pct(tot.rows[i].p)}</b></td>${cols.map(c => { const p = c.d.rows[i].p, dl = p - tot.rows[i].p; return `<td class="n" style="${Math.abs(dl) >= .08 && c.d.nRaw >= 20 ? (dl > 0 ? "color:var(--ok);font-weight:700" : "color:var(--bad);font-weight:700") : ""}">${pct(p)}</td>`; }).join("")}</tr>`).join("")}
    <tr><td class="small muted">Casos (n)</td><td class="n small muted">${tot.nRaw}</td>${cols.map(c => `<td class="n small ${c.d.nRaw < 30 ? "neg" : "muted"}">${c.d.nRaw}</td>`).join("")}</tr></tbody></table></div>
    <p class="small muted">Porcentajes por columna. En color: 8 puntos o más de diferencia contra el total (columnas con 20 casos o más). n en rojo: menos de 30 casos.</p>`;
  return `<section class="card"><div class="row">
    <label class="f" for="x-row" style="flex:2;min-width:220px">Pregunta (filas)<select class="in" id="x-row">${rowOpts}</select></label>
    <label class="f" for="x-col" style="flex:1;min-width:180px">Cruzar por (columnas)<select class="in" id="x-col">${colOpts}</select></label>
    <label class="row small" for="x-grp" style="gap:6px;font-weight:700;align-self:flex-end;padding-bottom:12px"><input type="checkbox" id="x-grp" ${crossGroup ? "checked" : ""}> Agrupar escalas</label></div>${table}</section>`;
}
function tCalidad(cs) {
  const flags = qualityFlags(cs); const byEnc = {}; cs.forEach(c => (byEnc[c.encId] = byEnc[c.encId] || []).push(c));
  const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const singles = EST.preguntas.filter(q => q.type === "single");
  const rows = Object.values(byEnc).map(l => {
    const f = flags.filter(x => x.c.encId === l[0].encId).length;
    const ns = l.reduce((a, c) => { const s = singles.filter(q => c.a[q.id] != null); return a + s.filter(q => c.a[q.id] === 99).length / (s.length || 1); }, 0) / l.length;
    return `<tr class="${f / l.length > .25 ? "flag" : ""}"><td>${esc(l[0].enc)}</td><td class="mono small">${esc([...new Set(l.map(c => c.pm))].join(", "))}</td><td class="n">${l.length}</td><td class="n">${(med(l.map(c => c.dur)) / 60).toFixed(1).replace(".", ",")} min</td><td class="n">${pct(ns)}</td><td class="n">${l.filter(c => c.sobrecuota).length}</td><td class="n">${f}</td><td class="small">${ago(l.reduce((a, c) => Math.max(a, c.fin), 0))}</td></tr>`;
  }).join("");
  const ks = Object.values(DATA.contactos);
  return `<section class="card"><h2>Por encuestador</h2>${cs.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Encuestador</th><th>PM</th><th class="n">Casos</th><th class="n">Duración mediana</th><th class="n">Ns/Nc prom.</th><th class="n">Sobrecuota</th><th class="n">Alertas</th><th>Último</th></tr></thead><tbody>${rows}</tbody></table></div><p class="small muted">Fila marcada: más de 1 de cada 4 casos con alerta. Conviene supervisar por teléfono.</p>` : '<div class="empty">Sin casos todavía.</div>'}</section>
  <section class="card"><h2>Casos con alerta (${flags.length})</h2>${flags.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Caso</th><th>Encuestador</th><th>Hora</th><th>Motivo</th><th>Contacto</th></tr></thead><tbody>${flags.sort((a, b) => b.c.fin - a.c.fin).map(f => { const k = DATA.contactos[f.c.id]; return `<tr><td class="mono small">${esc(f.c.id)}</td><td>${esc(f.c.enc)}</td><td class="small">${new Date(f.c.fin).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td><td>${esc(f.r.join(" · "))}</td><td class="small">${k ? esc(k.nombre + " · " + k.tel) : "—"}</td></tr>`; }).join("")}</tbody></table></div>` : '<div class="empty small">Sin alertas.</div>'}
    <p class="small muted">Criterios: menos de 6 minutos; menos de 4 minutos entre dos encuestas del mismo encuestador; la misma respuesta en toda una batería de imagen; más de 35% de Ns/Nc.</p></section>
  <section class="card"><h2>Contactos para supervisión (${ks.length})</h2><p class="small muted">Datos personales (Ley 25.326): no se comparten ni se suben. Recomendado: llamar al 10% de las encuestas de cada encuestador.</p>
    ${ks.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Caso</th><th>Encuestador</th><th>Nombre</th><th>Teléfono</th><th>Dirección</th></tr></thead><tbody>${ks.map(k => `<tr><td class="mono small">${esc(k.id)}</td><td>${esc(k.enc)}</td><td>${esc(k.nombre)}</td><td class="mono">${esc(k.tel)}</td><td>${esc(k.dir)}</td></tr>`).join("")}</tbody></table></div>` : ""}</section>`;
}
function tExportar(cs) {
  return `<div class="grid2"><section class="card"><h2>Base consolidada</h2><p class="small muted">${cs.length} encuestas. Una fila por encuesta, códigos numéricos, separador punto y coma, con la variable «pond» (ponderación sexo × edad). Abre en Excel y se importa en SPSS.</p>
    <button class="btn primary sm" id="x-csv" ${cs.length ? "" : "disabled"}>Descargar base (CSV)</button>
    <button class="btn sm" id="x-dic">Descargar libro de códigos (CSV)</button></section>
  <section class="card"><h2>Contactos</h2><p class="small muted">${Object.keys(DATA.contactos).length} contactos, en archivo aparte.</p><button class="btn sm" id="x-con" ${Object.keys(DATA.contactos).length ? "" : "disabled"}>Descargar contactos (CSV)</button></section>
  <section class="card"><h2>Copia de seguridad</h2><p class="small muted">Todo lo recibido en un archivo. Sirve para pasarlo a otra compu (se carga en «Recibir») o para no perderlo si se borra el navegador.</p>
    <button class="btn sm" id="x-bak">Descargar copia</button></section>
  <section class="card"><h2>Empezar de cero</h2><p class="small muted">Borra lo recibido de este estudio en este navegador. No toca los teléfonos.</p>
    <button class="btn sm danger" id="x-del">Borrar lo recibido…</button><div id="del-box" hidden class="row"><span class="small"><b>¿Seguro?</b> Descargá antes la copia.</span><button class="btn sm danger" id="x-del-ok">Sí, borrar</button><button class="btn sm" id="x-del-no">No</button></div></section></div>`;
}
function baseCSV(cs) {
  const W = weightsOf(cs, true); const vars = columnasVariables(EST);
  const head = ["caso_id", "pm", "localidad", "encuestador", "enc_id", "fecha", "hora_inicio", "duracion_min", "sobrecuota", "prueba", "pond", ...vars.map(v => v.name)];
  const rows = cs.sort((a, b) => a.fin - b.fin).map(c => [c.id, c.pm, pmById(c.pm).loc, c.enc, c.encId, fechaHora(c.fin).f, fechaHora(c.inicio).h, (c.dur / 60).toFixed(1).replace(".", ","), c.sobrecuota ? 1 : 0, esPrueba(c) ? 1 : 0, W[c.id].toFixed(4).replace(".", ","), ...vars.map(v => v.put(c))]);
  return "﻿" + csvText([head, ...rows]);
}
function libroCodigos() {
  const rows = [["variable", "pregunta", "tipo", "codigo", "etiqueta"]];
  for (const q of EST.preguntas) {
    if (q.type === "contact") continue;
    if (q.type === "grid") { for (const [k, l] of q.rows) for (const [c, lab] of q.cols) rows.push([q.id + "_" + k, q.q + " " + l, "escala", c, lab]); continue; }
    const name = q.type === "multi" ? q.id + "_1.." + q.max : q.id;
    if (q.opts) for (const [c, lab] of q.opts) rows.push([name, q.q, q.type, c, lab]); else rows.push([name, q.q, q.type, "", q.type === "num" ? `${q.min} a ${q.max}` : "texto"]);
  }
  return "﻿" + csvText(rows);
}
function bind() {
  const on = (id, fn) => { const el = $("#" + id); if (el) el.onclick = fn; };
  on("e-ok", async () => { const c = $("#e-cod").value.trim(); const f = $("#e-file") && $("#e-file").files[0]; if (f) { const txt = await f.text(); entrar(c, JSON.parse(txt)); } else entrar(c); });
  on("salir", () => { LS.del(K_REST); SES = null; EST = null; DATA = null; render(); });
  $$("[data-tab]").forEach(b => b.onclick = () => { tab = b.dataset.tab; LS.set("rec.tab", tab); render(); });
  const w = $("#w-tog"); if (w) w.onchange = () => { weighted = w.checked; LS.set("rec.w", weighted); render(); };
  const pt = $("#p-tog"); if (pt) pt.onchange = () => { pruebas = pt.checked; render(); };
  const rs = $("#r-sel"); if (rs) rs.onchange = () => { selQ = rs.value; render(); };
  const xr = $("#x-row"); if (xr) xr.onchange = () => { crossRow = xr.value; render(); };
  const xc = $("#x-col"); if (xc) xc.onchange = () => { crossCol = xc.value; render(); };
  const xg = $("#x-grp"); if (xg) xg.onchange = () => { crossGroup = xg.checked; render(); };
  const fi = $("#f-in"); if (fi) fi.onchange = () => leerArchivos(fi.files);
  on("paste-go", () => { const t = $("#paste").value; if (t.trim()) ingerir(t, "texto pegado"); });
  on("g-pull", traerGoogle);
  const d = $("#drop"); if (d) { ["dragenter", "dragover"].forEach(ev => d.addEventListener(ev, e => { e.preventDefault(); d.classList.add("hover"); })); ["dragleave", "drop"].forEach(ev => d.addEventListener(ev, e => { e.preventDefault(); d.classList.remove("hover"); })); d.addEventListener("drop", e => leerArchivos(e.dataTransfer.files)); }
  on("x-csv", () => descargar(`base ${EST.id} ${dayKey()}.csv`, baseCSV(allCases())));
  on("x-dic", () => descargar(`libro de codigos ${EST.id}.csv`, libroCodigos()));
  on("x-con", () => descargar(`contactos ${EST.id} ${dayKey()}.csv`, "﻿" + contactosCSV(EST, Object.values(DATA.contactos))));
  on("x-bak", () => descargar(`copia receptor ${EST.id} ${dayKey()}.json`, JSON.stringify({ tipo: "copia-receptor", estudio: EST.id, fecha: Date.now(), datos: DATA }), "application/json"));
  on("x-del", () => { $("#del-box").hidden = false; });
  on("x-del-no", () => { $("#del-box").hidden = true; });
  on("x-del-ok", () => { DATA = { casos: {}, timbres: {}, contactos: {}, log: [] }; saveData(); toast("Borrado."); render(); });
}
// soltar archivos en cualquier parte de la pantalla de Recibir
addEventListener("dragover", e => e.preventDefault());
addEventListener("drop", e => { e.preventDefault(); if (SES && e.target.id !== "drop" && !e.target.closest("#drop")) leerArchivos(e.dataTransfer.files); });
render();
