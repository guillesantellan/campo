/* app.js — la app del encuestador.

   Flujo: el encuestador escribe su código una vez → la app baja y abre el estudio cifrado
   (cuestionario, su punto muestral, sus cuotas) → trabaja sin internet → al final del día
   toca «Enviar» y los CSV salen por WhatsApp a coordinación (o, si el estudio tiene
   configurado un receptor en Google, se mandan solos cuando hay señal).

   Todo lo que carga queda guardado en el teléfono (localStorage) hasta que se borre la app.
   Cada envío manda TODAS las encuestas del encuestador: el receptor descarta repetidas.
*/
"use strict";

// ───────────────────────────── estado ─────────────────────────────
const K_COD = "enc.codigo", K_EST = "enc.estudio";
let CODIGO = LS.get(K_COD, "");
let SES = LS.get(K_EST, null);          // {est, yo, sello, pmPrueba?}
let EST = SES && SES.est, YO = SES && SES.yo;
const P = k => "enc." + (EST ? EST.id : "_") + "." + (SES && SES.pmPrueba ? "prueba." : "") + k;   // claves por estudio
let cur = null, view = "entrar";
let online = navigator.onLine, syncing = false, syncErr = null;

function miPM() { return SES && (SES.pmPrueba || YO.pm); }
function miNombre() { return SES && SES.pmPrueba ? "Prueba de coordinación" : YO.nombre; }
function miEncId() { return YO.cid + (SES && SES.pmPrueba ? "-p" : ""); }
const pmById = id => (EST.pms.find(p => p.id === id) || { id, nombre: id, loc: "", meta: 0 });
const casos = () => LS.get(P("casos"), []);
const contactos = () => LS.get(P("contactos"), []);
function saveDraft() { if (cur) LS.set(P("borrador"), cur); else LS.del(P("borrador")); }

// ───────────────────────────── entrar con el código ─────────────────────────────
async function entrar(codigo) {
  const btn = $("#e-ok"); if (btn) { btn.disabled = true; btn.textContent = "Buscando tu encuesta…"; }
  try {
    const lista = await buscarEstudios(codigo);
    if (!lista.length) { toast("Ese código no abre ninguna encuesta. Revisalo."); if (btn) { btn.disabled = false; btn.textContent = "Entrar"; } return; }
    CODIGO = codigo; LS.set(K_COD, codigo);
    const elegido = lista.sort((a, b) => b.sello.localeCompare(a.sello))[0];
    SES = { est: elegido.est, yo: elegido.yo, sello: elegido.sello }; LS.set(K_EST, SES);
    EST = SES.est; YO = SES.yo;
    view = YO.rol === "coord" ? "coord" : "home";
    cur = LS.get(P("borrador"), null);
    render();
  } catch (e) {
    toast("No me pude conectar. La primera vez hace falta internet.");
    if (btn) { btn.disabled = false; btn.textContent = "Entrar"; }
  }
}
// Con internet, revisa si hay una versión nueva del estudio (sin molestar si no hay señal).
async function refrescarEstudio() {
  if (!CODIGO || !navigator.onLine) return;
  try {
    const lista = await buscarEstudios(CODIGO);
    const mismo = lista.find(x => x.est.id === EST.id) || lista[0];
    if (!mismo) return;
    if (mismo.sello !== SES.sello) { SES = { ...SES, est: mismo.est, yo: mismo.yo, sello: mismo.sello }; LS.set(K_EST, SES); EST = SES.est; YO = SES.yo; toast("Encuesta actualizada."); render(); }
  } catch (e) { }
}
function salir() {
  if (casosSinEnviar().length) { $("#salir-box").hidden = false; return; }
  LS.del(K_COD); LS.del(K_EST); CODIGO = ""; SES = null; EST = null; YO = null; view = "entrar"; render();
}

// ───────────────────────────── encuesta ─────────────────────────────
function newCase() {
  const orden = {};
  for (const q of EST.preguntas) {
    if (q.type === "grid" && q.rotate) orden[q.id] = shuffle(q.rows.map(r => r[0]));
    if (q.rotateOpts) orden[q.id] = shuffle(q.opts.filter(o => o[0] !== 99).map(o => o[0]));
  }
  const n = LS.get(P("seq"), 0) + 1; LS.set(P("seq"), n);
  cur = { id: miPM() + "-" + miEncId() + "-" + String(n).padStart(3, "0") + "-" + rid().slice(-4), n, pm: miPM(), enc: miNombre(), encId: miEncId(), inicio: Date.now(), a: {}, orden, i: 0, sobrecuota: false, quotaOk: false, review: false };
  saveDraft(); view = "survey"; wake(true); render(); scrollTo(0, 0);
}
function quotaCounts() {
  const counts = {}; for (const c of casos()) { const k = cellOf(EST, c); if (k) counts[k] = (counts[k] || 0) + 1; }
  return counts;
}
const MOTIVOS = [["noAtiende", "No atiende"], ["rechazo", "Rechaza la encuesta"], ["cuotaLlena", "Cuota llena"], ["filtro", "No vive en el partido / menor de 16"], ["suspendida", "Encuesta interrumpida"]];
function addTimbre(k) {
  const all = LS.get(P("timbres"), {}); const d = dayKey();
  all[d] = all[d] || {}; all[d][k] = (all[d][k] || 0) + 1; LS.set(P("timbres"), all);
}
function terminarSin(motivo) { addTimbre(motivo); cur = null; saveDraft(); wake(false); view = "home"; render(); }

function finishCase() {
  const steps = visibleSteps(EST, cur); const keep = new Set();
  for (const st of steps) { const k = stepKey(st); keep.add(k); keep.add(k + "_otro"); }
  const a = {}; for (const [k, v] of Object.entries(cur.a)) if (keep.has(k) && k !== "K2_ok") a[k] = v;
  const fin = Date.now();
  const rec = { id: cur.id, n: cur.n, pm: cur.pm, enc: cur.enc, encId: cur.encId, inicio: cur.inicio, fin, dur: Math.round((fin - cur.inicio) / 1000), sobrecuota: !!cur.sobrecuota, orden: cur.orden, a, v: APP_VERSION };
  const lista = casos(); lista.push(rec);
  if (!LS.set(P("casos"), lista)) { toast("¡El teléfono no tiene lugar! Enviá lo cargado y avisá a coordinación."); return; }
  if (cur.a.K1 === 1 && (cur.a.K2_nombre || cur.a.K2_tel)) {
    const ks = contactos(); ks.push({ id: cur.id, pm: cur.pm, enc: cur.enc, fecha: fin, nombre: cur.a.K2_nombre || "", tel: cur.a.K2_tel || "", dir: cur.a.K2_dir || "" }); LS.set(P("contactos"), ks);
  }
  cur = null; saveDraft(); view = "done"; wake(false); render(); enviarAuto();
}
let wakeLock = null;
async function wake(on) { try { if (on && navigator.wakeLock && !wakeLock) wakeLock = await navigator.wakeLock.request("screen"); else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; } } catch (e) { wakeLock = null; } }

// ───────────────────────────── envío ─────────────────────────────
const ultimoEnvio = () => LS.get(P("ultimoEnvio"), 0);
const sincronizados = () => new Set(LS.get(P("sync"), []));
function casosSinEnviar() {
  const t = ultimoEnvio(), s = sincronizados();
  return casos().filter(c => c.fin > t && !s.has(c.id));
}
function completasPorDia() { const o = {}; for (const c of casos()) { const d = dayKey(new Date(c.fin)); o[d] = (o[d] || 0) + 1; } return o; }
function archivos() {
  const base = `${EST.id} ${miPM()} ${miEncId()} ${dayKey()}`;
  const partes = [
    { tipo: "casos", nombre: `encuestas ${base}.csv`, csv: casosCSV(EST, casos()) },
    { tipo: "timbres", nombre: `timbres ${base}.csv`, csv: timbresCSV(EST, { pm: miPM(), nombre: miNombre() }, miEncId(), LS.get(P("timbres"), {}), completasPorDia()) },
  ];
  if (contactos().length) partes.push({ tipo: "contactos", nombre: `contactos ${base}.csv`, csv: contactosCSV(EST, contactos()) });
  return partes;
}
function marcarEnviado() { LS.set(P("ultimoEnvio"), Date.now()); render(); }
async function enviarArchivos() {
  const partes = archivos();
  const files = partes.map(p => new File(["﻿" + p.csv], p.nombre, { type: "text/csv" }));
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files, title: "Encuestas " + miPM() }); marcarEnviado(); toast("Enviado."); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  view = "texto"; render();
}
// Envío automático: solo si el estudio trae configurado un receptor en Google (ver google/Code.gs).
async function enviarAuto() {
  const cfg = EST.envio || {};
  if (!cfg.url || syncing || !navigator.onLine) { render(); return; }
  const s = sincronizados(); const pend = casos().filter(c => !s.has(c.id));
  syncing = true; syncErr = null; render();
  try {
    const partes = archivos();
    const body = JSON.stringify({ token: cfg.token, estudio: EST.id, pm: miPM(), enc: miNombre(), encId: miEncId(), ids: pend.map(c => c.id), partes: partes.map(p => ({ tipo: p.tipo, csv: p.csv })) });
    const r = await fetch(cfg.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "rechazado");
    LS.set(P("sync"), [...new Set([...s, ...pend.map(c => c.id)])]);
  } catch (e) { syncErr = String(e.message || e); }
  syncing = false; render();
}
addEventListener("online", () => { online = true; enviarAuto(); refrescarEstudio(); });
addEventListener("offline", () => { online = false; render(); });

// ───────────────────────────── pantallas ─────────────────────────────
function chipEstado() {
  const p = casosSinEnviar().length;
  if (!online) return `<span class="chip warn"><span class="dot"></span>Sin señal</span>`;
  if (syncing) return `<span class="chip warn"><span class="dot"></span>Enviando…</span>`;
  if (p) return `<span class="chip warn"><span class="dot"></span>${p} sin enviar</span>`;
  return `<span class="chip ok"><span class="dot"></span>Al día</span>`;
}
function topBar() {
  const who = EST && view !== "entrar" ? `<span class="small" style="opacity:.85">${esc(miNombre())} · <span class="mono">${esc(miPM() || "")}</span></span>` : "";
  return `<header class="top"><div class="brand">Opción <small>${EST ? "Encuesta · " + esc(EST.fecha) : "Encuesta de campo"}</small></div><div class="sp"></div>${who}${EST && view !== "entrar" && view !== "coord" ? chipEstado() : ""}</header>`;
}
function render() {
  let body;
  if (!SES || view === "entrar") body = vEntrar();
  else if (view === "coord") body = vCoord();
  else if (view === "survey" && cur) body = vStep();
  else if (view === "quota") body = vQuota();
  else if (view === "filtro") body = vFiltro();
  else if (view === "review" && cur) body = vReview();
  else if (view === "done") body = vDone();
  else if (view === "puerta") body = vPuerta();
  else if (view === "texto") body = vTexto();
  else body = vHome();
  $("#app").innerHTML = topBar() + body;
  bind();
}
function vEntrar() {
  return `<main class="wrap"><div id="inst">${htmlInstalar()}</div><section class="card">
    <h1 style="font-size:1.5rem">Encuesta de campo</h1>
    <p>App de uso interno del equipo de encuestadores de <b>Opción</b>, consultora de opinión pública.</p>
    <p class="muted">Escribí el código de acceso que te dio coordinación. Se hace una sola vez y necesita internet; después la app anda sin señal.</p>
    <label class="f" for="e-cod">Código de acceso<input class="in codigo" id="e-cod" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC-DEF" value="${esc(CODIGO)}"></label>
    <button class="btn primary big block" id="e-ok">Entrar</button>
    <p class="small muted">Los códigos no llevan 0, O, 1, I ni L. Da igual si lo escribís con guion o en minúscula.</p>
  </section>
  <p class="small muted" style="text-align:center">Esta app no pide contraseñas, datos bancarios ni cuentas de Google, WhatsApp u otros servicios. Solo usa el código de acceso que entrega el equipo de Opción.</p></main>`;
}
function vCoord() {
  const opts = EST.pms.map(p => `<option value="${esc(p.id)}">${esc(p.id)} · ${esc(p.nombre)}</option>`).join("");
  return `<main class="wrap"><section class="card">
    <h1 style="font-size:1.4rem">Código de coordinación</h1>
    <p class="muted">${esc(EST.nombre)}. Con este código se abre el receptor, donde se juntan los envíos de los encuestadores.</p>
    <a class="btn primary big block" href="receptor.html">Abrir el receptor</a>
    </section><section class="card"><h2 style="font-size:1.1rem">Probar como encuestador</h2>
    <p class="small muted">Para validar el cuestionario. Lo que cargues queda marcado como prueba.</p>
    <label class="f" for="c-pm">Punto muestral<select class="in" id="c-pm">${opts}</select></label>
    <button class="btn block" id="c-probar">Probar la encuesta</button></section>
    <button class="btn ghost sm" id="h-salir" style="align-self:flex-start">Salir de este código</button>
    <div id="salir-box" hidden></div></main>`;
}
function quotaBox() {
  const pm = pmById(miPM()); const tg = quotaTargets(EST, pm.meta || 0); const counts = quotaCounts();
  let h = `<div class="qgrid"><span></span>${TRAMOS(EST).map(t => `<span class="h">${t}</span>`).join("")}`;
  for (const [s, lab] of SEXOS) { h += `<span class="rh">${lab}</span>`; for (const t of TRAMOS(EST)) { const k = s + "|" + t, d = counts[k] || 0, g = tg[k]; h += `<span class="cell ${d > g ? "over" : d >= g ? "full" : ""}">${d}/${g}</span>`; } }
  return h + "</div>";
}
function vHome() {
  const cs = casos(), hoy = cs.filter(c => dayKey(new Date(c.fin)) === dayKey()).length;
  const tim = LS.get(P("timbres"), {})[dayKey()] || {}; const puertas = hoy + Object.values(tim).reduce((a, b) => a + b, 0);
  const pend = casosSinEnviar().length, pm = pmById(miPM());
  const step = cur ? visibleSteps(EST, cur)[Math.min(cur.i, visibleSteps(EST, cur).length - 1)] : null;
  return `<main class="wrap"><div id="inst">${htmlInstalar()}</div>
    ${SES.pmPrueba ? '<div class="nota">Modo prueba de coordinación. Estas encuestas se envían marcadas como prueba.</div>' : ""}
    ${cur ? `<button class="btn primary big block" id="h-resume">Seguir la encuesta pausada (${esc(step.q.s)})</button><button class="btn block" id="h-new">Descartarla y empezar otra</button>`
      : `<button class="btn primary big block" id="h-new">Nueva encuesta</button>`}
    <button class="btn block" id="h-door">Timbre sin encuesta</button>
    <section class="card">
      <div class="row" style="justify-content:space-between"><h2 style="font-size:1.2rem">Cuotas · ${esc(pm.id)} ${esc(pm.nombre)}</h2><div class="bigstat"><b class="tab">${cs.length}</b><span class="muted">de ${pm.meta}</span></div></div>
      ${quotaBox()}
      <p class="small muted">Verde: ya está completo ese perfil. Naranja: te pasaste (sobrecuota).</p>
    </section>
    <section class="card">
      <div class="row" style="justify-content:space-between"><h2 style="font-size:1.2rem">Enviar a coordinación</h2><span class="small muted">Último envío: ${ago(ultimoEnvio())}</span></div>
      <div class="row small"><span><b class="tab">${hoy}</b> encuestas hoy</span><span>·</span><span><b class="tab">${puertas}</b> timbres</span><span>·</span><span><b class="tab">${pend}</b> sin enviar</span></div>
      <button class="btn ${pend ? "primary" : ""} block" id="h-send">Enviar por WhatsApp</button>
      <p class="small muted">Manda todas tus encuestas (también las ya enviadas: el receptor descarta las repetidas). Mandalas a coordinación por privado, no al grupo.</p>
      ${EST.envio && EST.envio.url ? `<p class="small ${syncErr ? "neg" : "muted"}">${syncErr ? "El envío automático falló: " + esc(syncErr) + ". Usá WhatsApp." : "Envío automático activado: cuando hay señal se mandan solas."}</p>` : ""}
    </section>
    <details class="card"><summary>Cómo trabajar</summary>
      <ol class="small" style="margin:0;padding-left:1.2em;display:flex;flex-direction:column;gap:6px">
        <li>Timbreá siguiendo la ruta de tu radio. Si no atienden o rechazan, anotalo en «Timbre sin encuesta».</li>
        <li>La app pregunta sexo y edad primero y te avisa si ese perfil ya está completo.</li>
        <li>Cuando dice MOSTRAR TARJETA, mostrás la tarjeta impresa. Las espontáneas no se leen.</li>
        <li>Al final revisás todo y guardás. Se guarda en el teléfono aunque no haya señal.</li>
        <li>Al terminar el día (o cuando te lo pidan) tocás «Enviar por WhatsApp».</li>
      </ol>
      <button class="btn sm ghost" id="h-salir">Salir de este código</button>
      <div id="salir-box" hidden class="nota">Tenés encuestas sin enviar. Envialas antes de salir: si salís, quedan en el teléfono pero no las vas a ver hasta volver a entrar con tu código.</div>
    </details>
  </main>`;
}
function vPuerta() {
  return `<main class="wrap"><section class="card"><h1 style="font-size:1.4rem">Timbre sin encuesta</h1><p class="muted">¿Qué pasó en esta casa?</p>
  <div class="opts">${MOTIVOS.filter(m => m[0] !== "suspendida").map(([k, l]) => `<button class="opt" data-mot="${k}">${esc(l)}</button>`).join("")}</div>
  <button class="btn ghost block" id="p-back">Volver</button></section></main>`;
}
function vDone() {
  return `<main class="wrap"><section class="card" style="text-align:center;align-items:center">
    <h1 style="font-size:1.8rem">Encuesta guardada</h1><p class="muted">Quedó en el teléfono. Se manda con «Enviar por WhatsApp».</p>
    <button class="btn primary big block" id="d-new">Siguiente encuesta</button><button class="btn block" id="d-home">Ir al inicio</button></section></main>`;
}
function vTexto() {
  const t = bloqueTexto(archivos());
  return `<main class="wrap"><section class="card"><h1 style="font-size:1.4rem">Enviar como texto</h1>
    <p class="muted">Este teléfono no deja mandar archivos desde la app. Copiá el texto y pegalo en el WhatsApp de coordinación.</p>
    <textarea class="in mono" id="t-txt" readonly style="font-size:.7rem;min-height:200px">${esc(t)}</textarea>
    <button class="btn primary block" id="t-copy">Copiar</button><button class="btn ghost block" id="t-back">Volver</button></section></main>`;
}
function vQuota() {
  const k = cellOf(EST, cur); const [s, t] = k.split("|"); const tg = quotaTargets(EST, pmById(cur.pm).meta)[k]; const d = quotaCounts()[k] || 0;
  return `<main class="wrap"><section class="card"><span class="chip warn" style="align-self:flex-start"><span class="dot"></span>Cuota completa</span>
    <h1 style="font-size:1.5rem">Ya tenés ${d} de ${tg} ${s === "V" ? "varones" : "mujeres"} de ${t} años</h1>
    <p class="muted">Agradecé y seguí timbreando. En el inicio ves qué perfiles te faltan.</p>
    <button class="btn primary big block" id="q-stop">Agradecer y terminar</button>
    <button class="btn block" id="q-go">Seguir igual (queda como sobrecuota)</button>
    <button class="btn ghost block" id="q-fix">Corregir sexo o edad</button></section></main>`;
}
function vFiltro() {
  return `<main class="wrap"><section class="card"><h1 style="font-size:1.5rem">No corresponde encuestar</h1><p class="muted">La persona no vive en el partido. Agradecé y seguí con la próxima casa.</p>
  <button class="btn primary big block" id="f-stop">Anotar y volver</button><button class="btn ghost block" id="f-fix">Me equivoqué, volver</button></section></main>`;
}
function optBtn(code, label, sel, extra = "") {
  return `<button class="opt ${[99, 98, 77, 0].includes(code) ? "aux" : ""}" data-code="${code}" aria-pressed="${sel}" ${extra}><span class="code">${code}</span><span>${esc(label)}</span></button>`;
}
function vStep() {
  const steps = visibleSteps(EST, cur); if (cur.i >= steps.length) cur.i = steps.length - 1;
  const st = steps[cur.i], q = st.q, k = stepKey(st), a = cur.a, v = a[k];
  const secs = [...new Set(steps.map(s => s.q.sec))];
  let body = "", qtext = esc(q.q);
  if (q.type === "grid") {
    const row = q.rows.find(r => r[0] === st.row); const pos = (cur.orden[q.id] || q.rows.map(r => r[0])).indexOf(st.row) + 1;
    qtext = `${esc(q.q)}<span class="who">${esc(row[1])}</span><span class="small muted" style="font-weight:400">${pos} de ${q.rows.length}</span>`;
    body = `<div class="opts">${q.cols.map(([c, l]) => optBtn(c, l, v === c)).join("")}</div>`;
  } else if (q.type === "single") {
    let opts = q.opts;
    if (q.rotateOpts && cur.orden[q.id]) opts = [...cur.orden[q.id].map(c => q.opts.find(o => o[0] === c)), ...q.opts.filter(o => o[0] === 99)];
    body = `<div class="opts ${opts.length > 8 ? "two" : ""}">${opts.map(([c, l]) => optBtn(c, l, v === c)).join("")}</div>`;
    if (q.otro != null && v === q.otro) body += `<label class="f" for="in-otro">Especificar<input class="in" id="in-otro" value="${esc(a[k + "_otro"] || "")}" autocomplete="off"></label>`;
  } else if (q.type === "multi") {
    const arr = Array.isArray(v) ? v : [];
    body = `<div class="opts ${q.opts.length > 8 ? "two" : ""}">${q.opts.map(([c, l]) => optBtn(c, l, arr.includes(c), (!arr.includes(c) && (arr.length >= q.max || (arr.includes(99) && c !== 99))) ? "disabled" : "")).join("")}</div><p class="small muted">Elegidas: ${arr.length} de ${q.max} como máximo</p>`;
    if (q.otro != null && arr.includes(q.otro)) body += `<label class="f" for="in-otro">Especificar<input class="in" id="in-otro" value="${esc(a[k + "_otro"] || "")}" autocomplete="off"></label>`;
  } else if (q.type === "num") {
    body = `<input class="in tab" id="in-num" type="number" inputmode="numeric" pattern="[0-9]*" min="${q.min}" max="${q.max}" value="${v ?? ""}" style="font-size:2rem;max-width:8ch">
      <p class="small muted" id="num-msg">Entre ${q.min} y ${q.max}.</p>
      <button class="btn block" id="num-menor" ${typeof v === "number" && v < q.min ? "" : "hidden"}>Es menor: anotar y terminar</button>`;
  } else if (q.type === "text") {
    body = `<textarea class="in" id="in-text" placeholder="Respuesta textual">${esc(v === "Ns/Nc" ? "" : (v || ""))}</textarea><button class="opt aux" id="t-ns" aria-pressed="${v === "Ns/Nc"}"><span class="code">99</span><span>Ns/Nc</span></button>`;
  } else if (q.type === "contact") {
    body = `<label class="f" for="c-nom">Nombre<input class="in" id="c-nom" autocomplete="off" value="${esc(a.K2_nombre || "")}"></label>
      <label class="f" for="c-tel">Teléfono<input class="in tab" id="c-tel" type="tel" inputmode="tel" autocomplete="off" value="${esc(a.K2_tel || "")}"></label>
      <label class="f" for="c-dir">Dirección (calle y número)<input class="in" id="c-dir" autocomplete="off" value="${esc(a.K2_dir || "")}"></label>
      <p class="small muted">Se guardan y se envían aparte de las respuestas.</p>`;
  }
  const ok = isAnswered(st, a) || q.type === "contact";
  return `<main class="wrap">
    <div class="qhead"><div class="secname"><span class="lbl">${esc(q.sec)} · ${secs.indexOf(q.sec) + 1}/${secs.length}</span><span class="lbl mono">${esc(q.id)}${st.row ? "." + st.row : ""}</span></div>
      <div class="prog"><i style="width:${Math.round((cur.i / steps.length) * 100)}%"></i></div></div>
    <section class="card">
      ${q.tarjeta ? `<span class="tarjeta">Mostrar ${esc(q.tarjeta)}</span>` : ""}
      <h1 class="qtext">${qtext}</h1>
      ${q.nota ? `<div class="nota">${esc(q.nota)}</div>` : ""}
      ${body}
    </section>
    <button class="btn ghost sm" id="n-pause" style="align-self:flex-start">Pausar e ir al inicio</button>
    <button class="btn ghost sm danger" id="n-abort" style="align-self:flex-start">Interrumpir encuesta…</button>
    <div id="abort-box" hidden class="card"><p><b>¿Descartar esta encuesta?</b> Se anota como interrumpida y no se envía.</p><div class="row"><button class="btn danger" id="n-abort-ok">Sí, descartar</button><button class="btn" id="n-abort-no">No, seguir</button></div></div>
  </main>
  <nav class="navbar"><div class="in"><button class="btn" id="n-back" ${cur.i === 0 ? "disabled" : ""}>Atrás</button>
    <button class="btn primary" id="n-next" ${ok ? "" : "disabled"}>${cur.review ? "Volver a revisión" : "Siguiente"}</button></div></nav>`;
}
function vReview() {
  const steps = visibleSteps(EST, cur); let missing = 0;
  const items = steps.map((st, i) => {
    const lab = answerLabel(st, cur.a); const ok = isAnswered(st, cur.a) || st.q.type === "contact"; if (!ok) missing++;
    const title = st.row ? st.q.s + " · " + st.q.rows.find(r => r[0] === st.row)[1] : st.q.s;
    return `<button class="review-item" data-go="${i}"><span class="mono small muted">${esc(st.q.id)}${st.row ? "." + st.row : ""}</span><span><span class="small muted">${esc(title)}</span><br>${ok ? `<b>${esc(lab)}</b>` : '<span class="miss">Falta responder</span>'}</span></button>`;
  }).join("");
  return `<main class="wrap"><section class="card"><h1 style="font-size:1.5rem">Revisar antes de guardar</h1>
    <p class="muted small">Tocá una respuesta para corregirla. Duración: ${Math.round((Date.now() - cur.inicio) / 60000)} min.${cur.sobrecuota ? " Marcada como sobrecuota." : ""}</p>
    ${missing ? `<div class="nota" style="color:var(--bad);background:var(--bad-bg)">Faltan ${missing} respuesta${missing > 1 ? "s" : ""}.</div>` : ""}
    <div>${items}</div></section></main>
    <nav class="navbar"><div class="in"><button class="btn primary big" id="r-save" ${missing ? "disabled" : ""}>Guardar encuesta</button></div></nav>`;
}

// ───────────────────────────── navegación ─────────────────────────────
function goNext() {
  const steps = visibleSteps(EST, cur); const st = steps[cur.i];
  if (st.q.id === "F0" && cur.a.F0 === 2) { view = "filtro"; saveDraft(); render(); return; }
  if (st.q.id === "P2" && !cur.quotaOk) {
    const k = cellOf(EST, cur);
    if (k) { const tg = quotaTargets(EST, pmById(cur.pm).meta)[k]; if ((quotaCounts()[k] || 0) >= tg) { view = "quota"; saveDraft(); render(); return; } }
  }
  if (cur.review) {
    const ns = visibleSteps(EST, cur); const miss = ns.findIndex(s => !(isAnswered(s, cur.a) || s.q.type === "contact"));
    if (miss >= 0 && miss !== cur.i) cur.i = miss; else view = "review";
  } else { cur.i++; if (cur.i >= visibleSteps(EST, cur).length) { cur.review = true; view = "review"; } }
  saveDraft(); render(); scrollTo(0, 0);
}
let advT;
function bind() {
  const on = (id, fn) => { const el = $("#" + id); if (el) el.onclick = fn; };
  on("e-ok", () => { const c = $("#e-cod").value.trim(); if (normalCodigo(c).length < 6) { toast("El código tiene 6 letras o números."); return; } entrar(c); });
  const ec = $("#e-cod"); if (ec) ec.onkeydown = e => { if (e.key === "Enter") $("#e-ok").click(); };
  on("c-probar", () => { SES.pmPrueba = $("#c-pm").value; LS.set(K_EST, SES); cur = LS.get(P("borrador"), null); view = "home"; render(); });
  on("h-new", () => { if (cur) addTimbre("suspendida"); newCase(); });
  on("h-resume", () => { view = cur.review ? "review" : "survey"; wake(true); render(); });
  on("h-door", () => { view = "puerta"; render(); });
  on("h-send", enviarArchivos);
  on("h-salir", () => { if (SES.pmPrueba) { delete SES.pmPrueba; LS.set(K_EST, SES); view = "coord"; render(); return; } salir(); });
  $$("[data-mot]").forEach(b => b.onclick = () => { addTimbre(b.dataset.mot); toast("Anotado: " + b.textContent); view = "home"; render(); });
  on("p-back", () => { view = "home"; render(); });
  on("d-new", newCase); on("d-home", () => { view = "home"; render(); });
  on("t-copy", async () => { const t = $("#t-txt"); try { await navigator.clipboard.writeText(t.value); toast("Copiado. Pegalo en WhatsApp."); marcarEnviado(); view = "home"; render(); } catch (e) { t.focus(); t.select(); toast("Seleccioná todo y copialo a mano."); } });
  on("t-back", () => { view = "home"; render(); });
  on("q-stop", () => terminarSin("cuotaLlena"));
  on("q-go", () => { cur.sobrecuota = true; cur.quotaOk = true; view = "survey"; goNext(); });
  on("q-fix", () => { view = "survey"; cur.i = visibleSteps(EST, cur).findIndex(s => s.q.id === "P1"); saveDraft(); render(); });
  on("f-stop", () => terminarSin("filtro"));
  on("f-fix", () => { view = "survey"; render(); });
  $$("[data-go]").forEach(b => b.onclick = () => { cur.i = +b.dataset.go; cur.review = true; view = "survey"; saveDraft(); render(); scrollTo(0, 0); });
  on("r-save", finishCase);
  if (view !== "survey" || !cur) return;

  const st = visibleSteps(EST, cur)[cur.i], q = st.q, k = stepKey(st);
  const refreshNext = () => { const b = $("#n-next"); if (b) b.disabled = !(isAnswered(st, cur.a) || q.type === "contact"); };
  $$(".opt[data-code]").forEach(b => b.onclick = () => {
    const c = +b.dataset.code;
    if (q.type === "multi") {
      let arr = Array.isArray(cur.a[k]) ? [...cur.a[k]] : [];
      if (arr.includes(c)) arr = arr.filter(x => x !== c); else if (c === 99) arr = [99]; else if (arr.length < q.max) arr.push(c);
      cur.a[k] = arr; if (!arr.includes(q.otro)) delete cur.a[k + "_otro"]; saveDraft(); render(); return;
    }
    cur.a[k] = c; if (c !== q.otro) delete cur.a[k + "_otro"];
    if (q.id === "P1") cur.quotaOk = false;
    saveDraft();
    if (q.otro != null && c === q.otro) { render(); const i = $("#in-otro"); if (i) i.focus(); return; }
    $$(".opt[data-code]").forEach(x => x.setAttribute("aria-pressed", x === b));
    clearTimeout(advT); advT = setTimeout(goNext, 170);
  });
  const io = $("#in-otro"); if (io) io.oninput = () => { cur.a[k + "_otro"] = io.value; saveDraft(); refreshNext(); };
  const inum = $("#in-num");
  if (inum) {
    if (cur.a[k] == null) setTimeout(() => inum.focus(), 50);
    inum.oninput = () => {
      const n = parseInt(inum.value, 10); if (isNaN(n)) delete cur.a[k]; else cur.a[k] = n; cur.quotaOk = false; saveDraft(); refreshNext();
      const m = $("#num-msg"), bad = !isNaN(n) && (n < q.min || n > q.max);
      m.className = "small " + (bad ? "neg" : "muted"); m.textContent = !isNaN(n) && n < q.min ? "Menor de " + q.min + ": no se encuesta." : !isNaN(n) && n > q.max ? "Revisá el número." : "Entre " + q.min + " y " + q.max + ".";
      $("#num-menor").hidden = !(!isNaN(n) && n < q.min);
    };
    inum.onkeydown = e => { if (e.key === "Enter" && isAnswered(st, cur.a)) goNext(); };
  }
  on("num-menor", () => terminarSin("filtro"));
  const it = $("#in-text"); if (it) it.oninput = () => { cur.a[k] = it.value; const ns = $("#t-ns"); if (ns) ns.setAttribute("aria-pressed", "false"); saveDraft(); refreshNext(); };
  on("t-ns", () => { cur.a[k] = "Ns/Nc"; saveDraft(); goNext(); });
  ["c-nom", "c-tel", "c-dir"].forEach((id, j) => { const el = $("#" + id); if (el) el.oninput = () => { cur.a[["K2_nombre", "K2_tel", "K2_dir"][j]] = el.value.trim(); saveDraft(); }; });
  on("n-next", () => { if (q.type === "contact") cur.a.K2_ok = true; goNext(); });
  on("n-back", () => { cur.i = Math.max(0, cur.i - 1); saveDraft(); render(); scrollTo(0, 0); });
  on("n-pause", () => { view = "home"; wake(false); render(); });
  on("n-abort", () => { $("#abort-box").hidden = false; });
  on("n-abort-no", () => { $("#abort-box").hidden = true; });
  on("n-abort-ok", () => terminarSin("suspendida"));
}

// ───────────────────────────── instalarla en el teléfono ─────────────────────────────
// Igual que en la app de los sábados: casi todos abren el link desde WhatsApp, y ese
// navegador no deja instalar. Se les dice cómo, con los pasos de su teléfono.
let promptInstalar = null;
const instalada = () => { try { if (window.matchMedia && matchMedia("(display-mode: standalone)").matches) return true; } catch (e) { } return navigator.standalone === true; };
const esIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const adentro = /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|; wv\)/i.test(navigator.userAgent);
addEventListener("beforeinstallprompt", e => { e.preventDefault(); promptInstalar = e; pintarInstalar(); });
addEventListener("appinstalled", () => { promptInstalar = null; pintarInstalar(); });
function htmlInstalar() {
  if (instalada() || location.protocol === "file:") return "";
  if (promptInstalar) return `<div class="inst"><h2 style="font-size:1.1rem">Te falta instalarla</h2><p class="small">Así te queda el ícono y anda sin señal adentro de las casas.</p><button class="btn primary" id="i-go">Instalar la app</button></div>`;
  if (adentro) return `<div class="inst"><h2 style="font-size:1.1rem">Abrila en ${esIOS ? "Safari" : "Chrome"}</h2><p class="small">Estás adentro del WhatsApp y desde acá no se puede instalar.</p><ol class="small"><li>Tocá los <b>tres puntitos</b> ${esIOS ? "o el botón de compartir" : "arriba a la derecha"}.</li><li>Elegí <b>Abrir en ${esIOS ? "Safari" : "Chrome"}</b>.</li></ol></div>`;
  if (esIOS) return `<div class="inst"><h2 style="font-size:1.1rem">Te falta instalarla</h2><ol class="small"><li>Tocá <b>compartir</b> (el cuadradito con la flecha).</li><li>Elegí <b>Agregar a pantalla de inicio</b> y tocá <b>Agregar</b>.</li></ol></div>`;
  return `<div class="inst"><h2 style="font-size:1.1rem">Te falta instalarla</h2><ol class="small"><li>Tocá los <b>tres puntitos</b> del navegador.</li><li>Elegí <b>Instalar aplicación</b> o <b>Agregar a pantalla de inicio</b>.</li></ol></div>`;
}
function pintarInstalar() { try { const el = $("#inst"); if (el) { el.innerHTML = htmlInstalar(); const b = $("#i-go"); if (b) b.onclick = async () => { promptInstalar.prompt(); try { await promptInstalar.userChoice; } catch (e) { } promptInstalar = null; pintarInstalar(); }; } } catch (e) { } }

// ───────────────────────────── arranque ─────────────────────────────
if ("serviceWorker" in navigator && location.protocol !== "file:") addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => { }));
if (SES) { view = YO.rol === "coord" && !SES.pmPrueba ? "coord" : "home"; cur = LS.get(P("borrador"), null); refrescarEstudio(); }
render(); pintarInstalar();
