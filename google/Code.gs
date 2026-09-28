/**
 * Receptor en Google (OPCIONAL). Permite que la app mande las encuestas sola cuando hay
 * señal, sin WhatsApp. Si no se configura, todo sigue andando por WhatsApp.
 *
 * Cómo se instala (una vez, con la cuenta de Google de coordinación):
 *  1. Crear una planilla nueva en Google Sheets. Extensiones → Apps Script.
 *  2. Pegar este archivo entero en Code.gs. Cambiar TOKEN por una clave larga inventada.
 *  3. Implementar → Nueva implementación → Tipo: Aplicación web.
 *     Ejecutar como: Yo. Quién tiene acceso: Cualquier persona. → Implementar.
 *  4. Copiar la URL que termina en /exec.
 *  5. En herramientas/fuente/<estudio>.json poner:  "envio": {"url": "<la URL>", "token": "<TOKEN>"}
 *     y volver a correr publicar.py. La URL y el token viajan cifrados dentro del estudio.
 *
 * Qué guarda: una fila por encuestador y tipo de archivo (casos, timbres, contactos) con el
 * último envío completo. Como cada envío trae todo, no hace falta más. El receptor de la
 * compu lo trae con «Traer del receptor de Google».
 *
 * Ojo: la planilla queda con datos personales (contactos). Compartirla solo con coordinación.
 */
const TOKEN = 'CAMBIAR-POR-UNA-CLAVE-LARGA';
const HOJA = 'envios';
const TROZO = 45000;   // una celda de Sheets aguanta 50.000 caracteres: se parte en columnas

function hoja_() {
  const ss = SpreadsheetApp.getActive();
  let h = ss.getSheetByName(HOJA);
  if (!h) { h = ss.insertSheet(HOJA); h.appendRow(['clave', 'recibido', 'estudio', 'pm', 'encuestador', 'enc_id', 'tipo', 'csv...']); }
  return h;
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doPost(e) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.token !== TOKEN) return json_({ ok: false, error: 'token inválido' });
    const h = hoja_(); const datos = h.getDataRange().getValues();
    for (const p of d.partes || []) {
      const clave = [d.estudio, d.encId, p.tipo].join('|');
      const trozos = []; for (let i = 0; i < p.csv.length; i += TROZO) trozos.push(p.csv.slice(i, i + TROZO));
      const fila = [clave, new Date(), d.estudio, d.pm, d.enc, d.encId, p.tipo, ...trozos];
      const i = datos.findIndex(r => r[0] === clave);
      if (i > 0) { h.getRange(i + 1, 1, 1, h.getLastColumn()).clearContent(); h.getRange(i + 1, 1, 1, fila.length).setValues([fila]); }
      else h.appendRow(fila);
    }
    return json_({ ok: true, recibidos: (d.ids || []).length });
  } catch (err) { return json_({ ok: false, error: String(err) }); }
  finally { lock.releaseLock(); }
}

function doGet(e) {
  if ((e.parameter.token || '') !== TOKEN) return json_({ ok: false, error: 'token inválido' });
  const est = e.parameter.estudio || '';
  const filas = hoja_().getDataRange().getValues().slice(1).filter(r => r[2] === est);
  return json_({ ok: true, partes: filas.map(r => ({ tipo: r[6], enc: r[4], csv: r.slice(7).join('') })) });
}
