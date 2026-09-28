/* comun.js — lo que comparten la app del encuestador (app.js) y el receptor (receptor.js):
   utilidades, apertura del estudio cifrado, lógica del cuestionario y formato de los CSV.

   El formato de los CSV es el contrato entre las dos puntas: si se cambia acá, cambia
   para las dos. Tres archivos por envío:
     - casos      (primera columna "estudio", segunda "caso_id"): una fila por encuesta
     - timbres    (columna "dia"): un resumen por día de las puertas sin encuesta
     - contactos  (columna "contacto_caso_id"): nombre y teléfono para supervisar, aparte
*/
"use strict";
const APP_VERSION = "1.0.0";

// ───────────────────────────── utilidades ─────────────────────────────
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { } },
};
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const dayKey = (d = new Date()) => d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
const pct = (x, d = 0) => (x * 100).toFixed(d).replace(".", ",") + "%";
function ago(ts) {
  if (!ts) return "—";
  const s = (Date.now() - ts) / 1000;
  if (s < 90) return "recién";
  if (s < 3600) return "hace " + Math.round(s / 60) + " min";
  if (s < 86400) return "hace " + Math.round(s / 3600) + " h";
  return new Date(ts).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
let _toastT;
function toast(msg) { const t = $("#toast"); if (!t) return; t.textContent = msg; t.hidden = false; clearTimeout(_toastT); _toastT = setTimeout(() => t.hidden = true, 3000); }

// ───────────────────────────── estudio cifrado ─────────────────────────────
// Mismo esquema que la app de los sábados: PBKDF2-SHA256 + AES-GCM con WebCrypto.
// El archivo publicado tiene "sobres" (uno por código) con la clave del estudio adentro.
const normalCodigo = c => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const b64a = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function sha256hex(txt) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function abrirArchivoEstudio(codigo, arch) {
  const id = (await sha256hex("sobre:" + normalCodigo(codigo))).slice(0, 16);
  const sobre = arch.sobres && arch.sobres[id];
  if (!sobre) return null;
  const mat = await crypto.subtle.importKey("raw", new TextEncoder().encode(normalCodigo(codigo)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: b64a(sobre.s), iterations: arch.iter, hash: "SHA-256" }, mat, 256);
  const kSobre = await crypto.subtle.importKey("raw", bits, "AES-GCM", false, ["decrypt"]);
  const yo = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64a(sobre.iv) }, kSobre, b64a(sobre.ct))));
  const K = await crypto.subtle.importKey("raw", b64a(yo.k), "AES-GCM", false, ["decrypt"]);
  const est = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64a(arch.cuerpo.iv) }, K, b64a(arch.cuerpo.ct))));
  delete yo.k;
  return { est, yo, sello: arch.sello };
}
// Busca en estudios/indice.json todos los estudios que abre este código.
async function buscarEstudios(codigo, base = "estudios/") {
  const r = await fetch(base + "indice.json", { cache: "no-cache" });
  if (!r.ok) throw new Error("No encuentro estudios/indice.json");
  const ind = await r.json(); const out = [];
  for (const e of ind.estudios || []) {
    try {
      const a = await (await fetch(base + e.archivo, { cache: "no-cache" })).json();
      const abierto = await abrirArchivoEstudio(codigo, a);
      if (abierto) out.push(abierto);
    } catch (err) { console.warn("No pude abrir", e.archivo, err); }
  }
  return out;
}

// ───────────────────────────── cuestionario ─────────────────────────────
function tramoDe(est, edad) { for (const [lab, a, b] of est.cuotas.tramos) if (edad >= a && edad <= b) return lab; return null; }
const TRAMOS = est => est.cuotas.tramos.map(t => t[0]);
const SEXOS = [["V", "Varón"], ["M", "Mujer"]];
const sexKey = c => c === 1 ? "V" : c === 2 ? "M" : null;
function cellOf(est, c) { const s = sexKey(c.a && c.a.P1), e = c.a && c.a.P2; const t = e != null ? tramoDe(est, e) : null; return s && t ? s + "|" + t : null; }
// Reparte la meta de un PM en las 8 celdas sexo × edad (mayor resto, suma exacta).
function quotaTargets(est, meta) {
  const cells = []; for (const [s] of SEXOS) for (const t of TRAMOS(est)) { const v = meta * est.cuotas.dist[s][t]; cells.push({ k: s + "|" + t, n: Math.floor(v), r: v - Math.floor(v) }); }
  let left = meta - cells.reduce((a, c) => a + c.n, 0);
  [...cells].sort((a, b) => b.r - a.r).forEach(c => { if (left > 0) { c.n++; left--; } });
  return Object.fromEntries(cells.map(c => [c.k, c.n]));
}
function cumpleSi(si, a) {
  if (!si) return true;
  const v = a[si.q]; if (v == null) return false;
  const vals = Array.isArray(v) ? v : [v];
  if (si.en) return vals.some(x => si.en.includes(x));
  if (si.noEn) return vals.every(x => !si.noEn.includes(x));
  return true;
}
function visibleSteps(est, c) {
  const out = [];
  for (const q of est.preguntas) {
    if (!cumpleSi(q.si, c.a)) continue;
    if (q.type === "grid") { const ord = c.orden[q.id] || q.rows.map(r => r[0]); for (const k of ord) out.push({ q, row: k }); }
    else out.push({ q });
  }
  return out;
}
const stepKey = st => st.row ? st.q.id + "_" + st.row : st.q.id;
function isAnswered(st, a) {
  const q = st.q, k = stepKey(st), v = a[k];
  if (q.type === "contact") return !!a.K2_ok;
  if (q.type === "text") return typeof v === "string" && v.trim() !== "";
  if (q.type === "multi") return Array.isArray(v) && v.length > 0 && (!v.includes(q.otro) || (a[k + "_otro"] || "").trim() !== "");
  if (q.type === "num") return typeof v === "number" && v >= q.min && v <= q.max;
  if (v == null) return false;
  if (q.otro != null && v === q.otro) return (a[k + "_otro"] || "").trim() !== "";
  return true;
}
function answerLabel(st, a) {
  const q = st.q, k = stepKey(st), v = a[k];
  if (q.type === "contact") return a.K2_nombre || a.K2_tel ? [a.K2_nombre, a.K2_tel].filter(Boolean).join(" · ") : "(sin datos)";
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return null;
  if (q.type === "num" || q.type === "text") return String(v);
  const opts = q.type === "grid" ? q.cols : q.opts;
  const lab = c => { const o = opts.find(x => x[0] === c); return (o ? o[1] : c) + (c === q.otro && a[k + "_otro"] ? ": " + a[k + "_otro"] : ""); };
  return Array.isArray(v) ? v.map(lab).join(" + ") : lab(v);
}

// ───────────────────────────── CSV ─────────────────────────────
const META_COLS = ["estudio", "caso_id", "n", "pm", "encuestador", "enc_id", "fecha", "inicio", "fin", "dur_seg", "sobrecuota", "version_app"];
// Columnas de variables en el orden del cuestionario. Cada una sabe escribir y leer su valor.
function columnasVariables(est) {
  const cols = [];
  const num = x => x === "" || x == null ? undefined : (isNaN(+x) ? x : +x);
  for (const q of est.preguntas) {
    if (q.type === "contact") continue;
    if (q.type === "grid") {
      for (const [k] of q.rows) cols.push({ name: q.id + "_" + k, put: c => c.a[q.id + "_" + k], take: (c, x) => { const v = num(x); if (v !== undefined) c.a[q.id + "_" + k] = v; } });
      if (q.rotate) cols.push({ name: "orden_" + q.id, put: c => (c.orden[q.id] || []).join("|"), take: (c, x) => { if (x) c.orden[q.id] = x.split("|"); } });
      continue;
    }
    if (q.type === "multi") {
      for (let i = 0; i < q.max; i++) cols.push({ name: q.id + "_" + (i + 1), put: c => (c.a[q.id] || [])[i], take: (c, x) => { const v = num(x); if (v !== undefined) (c.a[q.id] = c.a[q.id] || []).push(v); } });
    } else if (q.type === "text") {
      cols.push({ name: q.id, put: c => c.a[q.id], take: (c, x) => { if (x !== "" && x != null) c.a[q.id] = x; } });
    } else {
      cols.push({ name: q.id, put: c => c.a[q.id], take: (c, x) => { const v = num(x); if (v !== undefined) c.a[q.id] = v; } });
    }
    if (q.otro != null) cols.push({ name: q.id + "_otro", put: c => c.a[q.id + "_otro"], take: (c, x) => { if (x) c.a[q.id + "_otro"] = x; } });
    if (q.rotateOpts) cols.push({ name: "orden_" + q.id, put: c => (c.orden[q.id] || []).join("|"), take: (c, x) => { if (x) c.orden[q.id] = x.split("|").map(Number); } });
  }
  return cols;
}
const csvCell = x => '"' + String(x == null ? "" : x).replace(/"/g, '""').replace(/\r?\n/g, " ") + '"';
const csvText = rows => rows.map(r => r.map(csvCell).join(";")).join("\n");
function fechaHora(ts) { const d = new Date(ts); return { f: d.toLocaleDateString("es-AR"), h: d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false }) }; }
function casosCSV(est, casos) {
  const vars = columnasVariables(est);
  const head = [...META_COLS, ...vars.map(v => v.name)];
  const rows = casos.map(c => [est.id, c.id, c.n, c.pm, c.enc, c.encId, fechaHora(c.fin).f, new Date(c.inicio).toISOString(), new Date(c.fin).toISOString(), c.dur, c.sobrecuota ? 1 : 0, c.v || APP_VERSION, ...vars.map(v => v.put(c))]);
  return csvText([head, ...rows]);
}
const TIMBRE_COLS = [["noAtiende", "no_atiende"], ["rechazo", "rechazo"], ["cuotaLlena", "cuota_llena"], ["filtro", "no_cumple_filtro"], ["suspendida", "interrumpida"]];
function timbresCSV(est, yo, encId, porDia, completasPorDia) {
  const head = ["estudio", "pm", "encuestador", "enc_id", "dia", ...TIMBRE_COLS.map(t => t[1]), "completas"];
  const dias = [...new Set([...Object.keys(porDia), ...Object.keys(completasPorDia)])].sort();
  return csvText([head, ...dias.map(d => [est.id, yo.pm, yo.nombre, encId, d, ...TIMBRE_COLS.map(t => (porDia[d] || {})[t[0]] || 0), completasPorDia[d] || 0])]);
}
function contactosCSV(est, contactos) {
  return csvText([["estudio", "contacto_caso_id", "pm", "encuestador", "fecha", "nombre", "telefono", "direccion"],
    ...contactos.map(k => [est.id, k.id, k.pm, k.enc, typeof k.fecha === "number" ? fechaHora(k.fecha).f : k.fecha, k.nombre, k.tel, k.dir])]);
}
// Lector de CSV: comillas, ; o , como separador, BOM, saltos de línea dentro de comillas.
function parseCSV(txt) {
  txt = txt.replace(/^﻿/, "");
  const first = txt.split("\n")[0]; const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ";" : ",";
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (q) { if (ch === '"') { if (txt[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  return rows.filter(r => r.some(x => x !== ""));
}
// Reconoce qué es cada bloque y lo devuelve como objetos.
function leerCSV(est, txt) {
  const rows = parseCSV(txt); if (!rows.length) return { tipo: null };
  const h = rows[0].map(x => x.trim()); const idx = n => h.indexOf(n);
  if (h[1] === "caso_id") {
    const vars = columnasVariables(est); const casos = [];
    for (const r of rows.slice(1)) {
      const g = n => r[idx(n)];
      if (g("estudio") !== est.id) continue;
      const c = { id: g("caso_id"), n: +g("n"), pm: g("pm"), enc: g("encuestador"), encId: g("enc_id"), inicio: Date.parse(g("inicio")), fin: Date.parse(g("fin")), dur: +g("dur_seg"), sobrecuota: g("sobrecuota") === "1", v: g("version_app"), a: {}, orden: {} };
      for (const v of vars) { const i = idx(v.name); if (i >= 0) v.take(c, r[i]); }
      casos.push(c);
    }
    return { tipo: "casos", casos, otros: rows.length - 1 - casos.length };
  }
  if (h.includes("dia") && h.includes("no_atiende")) {
    const timbres = rows.slice(1).filter(r => r[idx("estudio")] === est.id).map(r => { const o = { pm: r[idx("pm")], enc: r[idx("encuestador")], encId: r[idx("enc_id")], dia: r[idx("dia")], completas: +r[idx("completas")] || 0 }; TIMBRE_COLS.forEach(([k, n]) => o[k] = +r[idx(n)] || 0); return o; });
    return { tipo: "timbres", timbres };
  }
  if (h.includes("contacto_caso_id")) {
    const contactos = rows.slice(1).filter(r => r[idx("estudio")] === est.id).map(r => ({ id: r[idx("contacto_caso_id")], pm: r[idx("pm")], enc: r[idx("encuestador")], fecha: r[idx("fecha")], nombre: r[idx("nombre")], tel: r[idx("telefono")], dir: r[idx("direccion")] }));
    return { tipo: "contactos", contactos };
  }
  return { tipo: null };
}
// El texto que se pega en WhatsApp cuando no se pueden mandar archivos: los tres bloques juntos.
const MARCA_TXT = "ENCUESTA-CAMPO";
function bloqueTexto(partes) { return partes.filter(p => p.csv).map(p => `#${MARCA_TXT} ${p.tipo}\n${p.csv}`).join("\n"); }
function separarBloques(txt) {
  if (!txt.includes("#" + MARCA_TXT)) return [txt];
  return txt.split(new RegExp("^#" + MARCA_TXT + " \\w+\\s*$", "m")).map(s => s.trim()).filter(Boolean);
}
