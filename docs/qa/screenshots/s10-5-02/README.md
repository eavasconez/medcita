# S10.5-02 — Capturas ANTES / DESPUÉS

Cada imagen compara la aplicación en `develop` (2aec6cb, ANTES) con la rama S10.5-02 (DESPUÉS), con los mismos datos de demostración y el mismo backend. Los diálogos del ANTES son los **nativos del navegador**: no se pueden fotografiar con un navegador sin ventana, así que las capturas del ANTES salen de una ventana real de Chrome (en un escritorio virtual) con el diálogo abierto, y por eso se ve su marco oscuro y el botón naranja «OK». Las del DESPUÉS salen de la aplicación en el navegador de siempre. Para provocar los casos creé en una base desechable un paciente sin citas («Carlos Prueba Eliminar», para poder borrarlo) y una visita abierta con su borrador de nota.

| Imagen | Qué muestra |
|---|---|
| `R1-ANTES-eliminar-paciente.png` / `R1-DESPUES-eliminar-paciente.png` | Borrar un paciente: del `confirm` del navegador al diálogo de MedCita (con «Delete» en rojo y el foco en «Cancel») |
| `R2-ANTES-cerrar-nota.png` / `R2-DESPUES-cerrar-nota.png` | Cerrar la nota de consulta: el mismo texto, ahora con título, explicación y el botón «Close note» (azul: cerrar no destruye nada) |
| `R3-ANTES-anular-toma.png` / `R3-DESPUES-anular-toma.png` | Anular una toma de signos vitales: del `prompt` de una línea a un diálogo con el campo «Reason (optional)» |
| `R4-ANTES-cancelar-cita.png` / `R4-DESPUES-cancelar-cita.png` | Cancelar una cita desde su ventana de la agenda: el diálogo nuevo se abre **encima** de la ventana de la cita |
| `R5-ANTES-aviso.png` / `R5-DESPUES-aviso.png` | El aviso «Patient deleted»: se ve igual (era lo que se quería), ahora es un solo componente |
| `R5-DESPUES-aviso-error.png` | El aviso de error («Boom» simulado con una respuesta 500): rojo, se anuncia a los lectores de pantalla |
| `R6-ANTES-vacio.png` / `R6-DESPUES-vacio.png` | Sin resultados en la lista de pacientes: el estado vacío común (el título pasa a ser más legible) |
| `R7-ANTES-carga.png` / `R7-DESPUES-carga.png` | La lista mientras carga (con la petición retenida): del texto «Loading directory...» a las tarjetas esqueleto |
| `R8-ANTES-ficha.png` / `R8-DESPUES-ficha.png` | La ficha completa de un paciente: las insignias (consentimiento, borrador/cerrada, estado de las citas), los encabezados y los antecedentes se ven igual; es la prueba de que migrar a los componentes comunes no cambió la pantalla |
