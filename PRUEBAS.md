# Guía de prueba y validación

Para Gervasio, Juan y Sebastián. La idea es romperla antes de que la usen 14 encuestadores.
Anoten cada problema con: qué teléfono, qué hicieron, qué esperaban y qué pasó (captura si pueden).

Cada uno tiene un **código de coordinación** (va por privado). Con ese código:
- en la app (`/`) pueden **probar como encuestador** eligiendo cualquier punto muestral;
  lo que carguen queda marcado como prueba y el receptor lo separa;
- en el receptor (`/receptor.html`) ven lo que se recibe.

Para probar como encuestador real, usen los códigos de PM (lista en privado).

## 1. Instalación (cada uno en su teléfono; al menos un Android y un iPhone)
- [ ] Abrir el link desde WhatsApp: aparece el cartel que dice que hay que abrirla en Chrome/Safari.
- [ ] En Chrome/Safari: se puede instalar y queda el ícono.
- [ ] Entrar con el código (probar con minúsculas y sin guion).
- [ ] Un código inventado dice que no abre ninguna encuesta.

## 2. Sin señal
- [ ] Con la app instalada, poner el teléfono en modo avión y abrirla: entra directo.
- [ ] Hacer 2 encuestas completas en modo avión.
- [ ] Cerrar la app a mitad de una encuesta y volver: ofrece seguirla donde quedó.

## 3. Cuestionario (validación de contenido)
- [ ] Leer cada pregunta en voz alta como en una puerta: ¿se entiende? ¿las opciones están completas?
- [ ] Lista de dirigentes locales (D6): ¿están todos y son los que corresponde medir hoy?
- [ ] Tramos de ingreso (G3): ¿tienen sentido con la canasta básica actual?
- [ ] Opciones de voto 2027 (E1, E2): ¿los espacios y referentes son los correctos?
- [ ] Duración: una encuesta real, sin apuro, ¿cuánto tarda? (objetivo: menos de 15 minutos).

## 4. Controles
- [ ] Edad 15 → no deja seguir y ofrece terminar como "menor".
- [ ] Filtro "No vive en el partido" → termina y lo anota.
- [ ] "Otro ¿cuál?" no deja avanzar sin escribir.
- [ ] Prioridades (D4) no deja marcar más de 2.
- [ ] C4.1 no aparece si C4 es Ns/Nc. El contacto no aparece si K1 es No.
- [ ] La revisión final muestra todo y deja corregir tocando una respuesta.
- [ ] Cuotas: cargar perfiles repetidos hasta llenar una celda → avisa "cuota completa".

## 5. Envío y receptor
- [ ] «Enviar por WhatsApp» manda los archivos (encuestas, timbres, contactos) a un chat privado.
- [ ] En la compu: abrir el receptor con el código de coordinación y soltar los archivos.
- [ ] Mandar dos veces lo mismo: el receptor no duplica.
- [ ] Revisar Avance, Resultados, Cruces y Calidad con datos de prueba (tildar «Incluir de prueba»).
- [ ] Exportar la base CSV y abrirla en Excel: una fila por encuesta, columnas con códigos.
- [ ] Copia de seguridad → abrir el receptor en otra compu → soltar la copia → aparece todo.

## 6. Para decidir
- ¿Alcanza con WhatsApp o activamos el envío automático a Google Sheets (`google/Code.gs`)?
- ¿Quién publica los cambios del cuestionario y quién tiene los códigos?
- Nombres reales de los encuestadores y rutas de cada radio censal.
