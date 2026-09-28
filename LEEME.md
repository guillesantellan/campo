# App de encuestas de campo

App para encuestadores presenciales (timbreo) que funciona **sin internet**, con un **receptor**
para coordinación que junta los envíos y los va cruzando. Misma arquitectura que la app de los
sábados (`guillesantellan/sabados`): página estática en GitHub Pages, instalable en el teléfono,
datos cifrados por código, envío de CSV por WhatsApp y receptor que se abre en la compu.

Primer estudio cargado: **Bragado, septiembre 2026** (400 casos, 14 puntos muestrales, O'Brien 40).

---

## Qué hay en el repo

| Archivo | Qué es |
|---|---|
| `index.html` + `app.js` | La app del encuestador (PWA). Entra con código, trabaja sin señal, envía por WhatsApp. |
| `receptor.html` + `receptor.js` | El receptor de coordinación. Entra con código de coordinación. Recibe los CSV, muestra avance, cuotas, resultados, cruces, calidad y exporta la base. |
| `comun.js` | Lo compartido: apertura del estudio cifrado, lógica del cuestionario y **formato de los CSV** (el contrato entre las dos puntas). |
| `estilos.css` | Estilos de las dos pantallas. Fuentes del sistema: tiene que andar sin internet. |
| `sw.js` | Service worker: deja la app en caché. `publicar.py` le cambia la versión en cada publicación. |
| `manifest.webmanifest`, `icono-*.png` | Para instalarla con ícono. |
| `estudios/` | Los estudios **cifrados** (`e-xxxx.json`) y el `indice.json`. Lo único con datos que se sube. |
| `herramientas/publicar.py` | Valida el cuestionario, genera códigos y cifra el estudio. |
| `google/Code.gs` | Opcional: receptor en Google Sheets para que la app mande sola cuando hay señal. |

**Lo que NO se sube** (está en `.gitignore`): `herramientas/fuente/` (el cuestionario en claro) y
`herramientas/privado/` (los códigos). Se pasan por fuera, en privado.

---

## Por qué va cifrado

Con cuenta gratuita, GitHub Pages solo publica repositorios **públicos**: cualquiera que conozca la
dirección puede bajar los archivos. Por eso el cuestionario, los puntos muestrales y los nombres de
los encuestadores viajan cifrados (AES-256-GCM). Cada código tiene su "sobre" con la clave del
estudio adentro (PBKDF2-SHA256, 150.000 iteraciones). Sin un código válido, `estudios/` no dice nada.

Las respuestas y los contactos **nunca** pasan por GitHub: quedan en el teléfono hasta que el
encuestador los manda por WhatsApp, y en el navegador de coordinación después.

---

## Publicarla en GitHub (la primera vez)

1. En GitHub, **New repository**. Nombre que no diga nada (`campo`, `enc-26`). **Público**, vacío.
2. Subir el contenido de esta carpeta a la raíz del repo **menos** `herramientas/fuente` y
   `herramientas/privado`. Con git:
   ```
   git init && git add . && git commit -m "App de encuestas" && git branch -M main
   git remote add origin https://github.com/<usuario>/<repo>.git && git push -u origin main
   ```
   (el `.gitignore` ya deja afuera lo privado). Por la web: las carpetas no se arrastran; crear
   primero `estudios/x.txt` con *Add file → Create new file* y después subir los JSON adentro.
3. **Settings → Pages** → *Deploy from a branch*, rama `main`, carpeta `/ (root)`.
4. A los 2 o 3 minutos queda en `https://<usuario>.github.io/<repo>/`.
   - Encuestadores: `https://<usuario>.github.io/<repo>/`
   - Coordinación: `https://<usuario>.github.io/<repo>/receptor.html`

## Cambiar el cuestionario o los puntos muestrales

1. Editar `herramientas/fuente/bragado-2026-09.json` (formato en `herramientas/CUESTIONARIO.md`).
2. `cd herramientas` y `python publicar.py --estudio bragado-2026-09` (necesita `pip install cryptography`).
   Valida todo antes de publicar: ids repetidos, saltos que apuntan a preguntas posteriores, metas
   que no suman 400, cuotas que no suman 1.
3. Subir `estudios/` y `sw.js`. Los teléfonos toman el cambio la próxima vez que abren con internet.

> **Ojo con cambiar códigos de opción o ids de preguntas con el campo empezado**: las encuestas ya
> hechas quedan con los códigos viejos. Agregar opciones o preguntas nuevas al final es seguro.

## Códigos

- `python publicar.py --estudio bragado-2026-09 --nuevo-codigo coord --nombre "Nombre"` → otro código de coordinación.
- `python publicar.py --estudio bragado-2026-09 --baja PM03` → nuevo código para PM03 (el viejo deja de abrir).
- Para ponerle el nombre real al encuestador, editar `herramientas/privado/codigos bragado-2026-09.json` y republicar.
- La lista para repartir queda en `herramientas/privado/codigos … - para repartir.csv`. **Cada código va por privado.**

---

## Cómo funciona en el campo

**Encuestador:** abre el link (en Chrome o Safari, no dentro de WhatsApp), escribe su código una vez,
la instala en la pantalla de inicio. Después anda sin señal. Cada encuesta: filtro → sexo → edad
(la app avisa si la cuota de ese perfil ya está llena) → cuestionario una pregunta por pantalla →
revisión → guardar. Las puertas sin encuesta se anotan con «Timbre sin encuesta». Al final del día:
«Enviar por WhatsApp» → le manda a coordinación, por privado, 2 o 3 CSV (encuestas, timbres y, si
hay, contactos). Si el teléfono no deja compartir archivos, sale un texto para copiar y pegar.

**Controles contra errores:** edad válida (16 a 99), respuesta obligatoria en cada pantalla, "Otro"
exige especificar, máximo de respuestas en las múltiples, saltos automáticos (C4.1, D5.1, contacto),
orden rotado en las baterías de imagen y en E3, revisión completa antes de guardar, borrador que se
guarda solo si se cierra la app a mitad de una encuesta.

**Coordinación:** abre `receptor.html` con su código y suelta ahí los archivos que llegan. Las
encuestas repetidas no se duplican (cada envío trae todo). Pestañas: Recibir, Avance (por PM y
cuotas), Resultados (ponderados por sexo × edad), Cruces, Calidad (duración, encuestas en ráfaga,
baterías con todas iguales, exceso de Ns/Nc, contactos para supervisar) y Exportar (base CSV con
ponderador, libro de códigos, contactos, copia de seguridad).

Lo recibido queda **solo en ese navegador**. Para pasarlo a otra compu: Exportar → Copia de
seguridad, y en la otra compu, Recibir → soltar ese archivo.

El receptor también se puede abrir sin internet desde la compu (doble clic en `receptor.html`):
en ese caso pide además el archivo del estudio (`estudios/e-….json`).

## Envío automático (opcional)

Si se configura `google/Code.gs` (instrucciones adentro) y se pone su URL en `"envio"` del estudio,
la app manda sola cada vez que guarda una encuesta con señal, y el receptor la trae con un botón.
WhatsApp sigue funcionando igual como respaldo.

---

Todo esto son datos personales alcanzados por la **Ley 25.326**; la opinión política es dato
sensible (art. 7). Los contactos viajan en archivo aparte y se mandan por privado.
