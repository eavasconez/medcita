# S10.5-05 — Capturas ANTES / DESPUÉS

Cada imagen compara la aplicación en `develop` (dec365a, ANTES) con la rama S10.5-05 (DESPUÉS), con los mismos datos de demostración y el mismo backend. Las de «móvil» son de 390 × 844 px; el resto, de 1280 × 800. Las de «desplazada» se toman con la sección ya bajada. Para provocarlos creé en una base desechable, con la API, un paciente con cuatro tomas (una anulada por error y una ligada a la visita de una nota cerrada), otro con valores de tres cifras con decimales (para el eje del gráfico, `100.75 kg`) y otro con una sola toma; «sin tomas» es un paciente del seed.

| Imagen | Qué muestra |
|---|---|
| `R1-ANTES-tarjetas.png` / `R1-DESPUES-tarjetas.png` | Las tarjetas: antes solo el último valor y su fecha; ahora además el cambio respecto a la toma anterior de esa medida, «Single reading — no trend yet» donde solo hay una y «Not recorded» donde no hay nada. La tarjeta elegida (peso) tiene el borde azul y reemplaza a las pestañas de medidas |
| `R2-ANTES-grafico-e-historial.png` / `R2-DESPUES-grafico-e-historial.png` | El gráfico y el historial: del historial en líneas de texto a la tabla, y del eje con decimales («82.5, 82, 81.5») al eje redondo |
| `R3-…-una-sola-toma.png` | Un paciente con una sola toma: «Single reading — no trend yet» en cada medida que tiene |
| `R4-ANTES-eje-del-grafico.png` / `R4-DESPUES-eje-del-grafico.png` | **Los números del eje:** antes `103.35` y `100.75` salen cortados por el borde izquierdo; ahora el eje es `100…104` y cabe |
| `R5-…-anular-con-motivo.png` | Anular una toma: el diálogo con el campo del motivo (ya existía desde S10.5-02; el ANTES es el mismo diálogo) |
| `R6-…-historial-con-anulada.png` | La toma anulada: tachada y atenuada, con quién la anuló y por qué, fuera de las tarjetas y del gráfico |
| `R7-…-estado-vacio.png` | Un paciente sin tomas: «Record the first vital signs» |
| `R8-…-movil-tarjetas.png` / `R9-…-movil-historial.png` | Móvil: las tarjetas en dos columnas y la tabla, que se desplaza dentro de su caja (la página no se desplaza a los lados) |
| `R10-…-nota-con-tomas.png` | La nota de consulta: las tomas de esa visita con una pastilla por valor y su unidad (antes, una línea de texto) |
| `R11-…-nota-sin-tomas.png` | La nota de una visita sin tomas: del texto gris al estado vacío con «Record the first measurements» |
| `R12-DESPUES-tarjeta-elige-el-grafico.png` | Solo en el nuevo: tocar la tarjeta de la presión arterial dibuja sus dos líneas |
