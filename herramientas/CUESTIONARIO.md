# Formato del cuestionario

El estudio es un JSON en `herramientas/fuente/<id>.json`. `publicar.py` lo valida y lo cifra.

## Cabecera

```json
{
  "id": "bragado-2026-09",          // va en cada fila de CSV: no cambiarlo con el campo empezado
  "nombre": "Estudio de Opinión Pública · Bragado",
  "fecha": "Septiembre 2026",
  "universo": "Población de 16 años y más · Bragado y O'Brien",
  "meta": 400,                      // tiene que ser la suma de las metas de los PM
  "cuotas": {
    "tramos": [["16-29",16,29],["30-49",30,49],["50-64",50,64],["65+",65,99]],
    "dist": {"V": {"16-29": 0.115, ...}, "M": {...}},   // suma 1. Se usa para cuotas y ponderación
    "nota": "…"
  },
  "pms": [{"id": "PM01", "nombre": "Radio 1", "loc": "Bragado", "meta": 28}, ...],
  "preguntas": [ ... ],
  "envio": {"url": "", "token": ""}  // opcional, ver google/Code.gs
}
```

## Preguntas

Campos comunes: `id` (único; es el nombre de la variable), `sec` (sección), `s` (título corto para
el receptor), `type`, `q` (texto que se lee), `nota` (instrucción al encuestador), `tarjeta`
("Tarjeta 2": muestra el cartel MOSTRAR TARJETA), `si` (salto).

| type | Campos | En el CSV |
|---|---|---|
| `single` | `opts: [[código, "etiqueta"], ...]`, `otro` (código que pide especificar), `scale: true` (escala 1-6 que se agrupa en positiva/negativa), `rotateOpts: true` (rota el orden salvo el 99) | `ID` y, si hay `otro`, `ID_otro` |
| `multi` | `opts`, `max`, `otro` | `ID_1` … `ID_max` |
| `num` | `min`, `max` | `ID` |
| `text` | — (tiene botón Ns/Nc) | `ID` |
| `grid` | `rows: [["a","Javier Milei"], ...]`, `cols: [[1,"Muy mala"], ...]`, `rotate: true`, `scale: true` | `ID_a`, `ID_b` … y `orden_ID` si rota |
| `contact` | — | va al archivo de contactos, no al de encuestas |

**Saltos:** `"si": {"q": "C4", "noEn": [99]}` (se pregunta si C4 no es 99) o
`"si": {"q": "K1", "en": [1]}` (se pregunta si K1 es 1). La pregunta de referencia tiene que estar antes.

**Obligatorias:** `F0` (filtro: 1 sí / 2 no → termina), `P1` (sexo: 1 varón, 2 mujer) y `P2` (edad):
la app las usa para las cuotas.

**Códigos de convención:** 99 Ns/Nc, 98 No lo conoce, 77 No vota / No votó, 66 Otro, 0 Ninguno.
Se muestran en gris para no tocarlos por error.

El receptor tiene tarjetas fijas para E1, E2, E3, C2, C3, C4, C1 y D6. Si un estudio no las tiene,
esas tarjetas no aparecen, y todo sigue disponible en «Cualquier pregunta» y en «Cruces».
