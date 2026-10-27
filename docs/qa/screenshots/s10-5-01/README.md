# S10.5-01 — Capturas ANTES / DESPUÉS

Cada imagen compara la aplicación en `develop` (839bff2, ANTES) con la rama S10.5-01 (DESPUÉS), con los mismos datos de demostración (la historia de María Elena Lasso, sembrada el 26-oct-2026). Para provocar los defectos agregué a esa historia, en una base desechable: una visita más antigua (19-oct, 10:00) que seguía «En consulta» y cuyo borrador de nota escribí después que las demás notas, una toma de signos vitales y un antecedente más (así el título de las notas cae justo al final de la página 1). La nota la cerré desde la pantalla real, con la cuenta del Dr. Santiago Pérez; el PDF lo bajé como administrador con el mismo endpoint del botón «Export PDF» y lo convertí a imágenes.

| Imagen | Qué muestra |
|---|---|
| `R1-ANTES-visitas-sin-cerrar.png` / `R1-DESPUES-visitas-sin-cerrar.png` | La agenda justo después de cerrar la nota de la visita del 19-oct. ANTES el aviso sigue diciendo «4 past appointments are still open» y la visita de María Elena Lasso del 19-oct sigue en la lista; DESPUÉS el aviso dice 3 y esa visita ya no está |
| `R2-ANTES-pdf-1.png` | Página 1 del PDF: «NOTAS DE CONSULTA» queda sola al pie, sin ninguna nota debajo |
| `R2-ANTES-pdf-2.png` | Página 2 del PDF: las notas salen del 23-oct, 22-oct y 19-oct (por cuándo se escribió cada una), y en «Citas» la visita del 19-oct aparece «En consulta» aunque su nota está cerrada |
| `R2-DESPUES-pdf-1.png` | Página 1: termina en los signos vitales; el título de las notas ya no queda solo |
| `R2-DESPUES-pdf-2.png` | Página 2: empieza con «NOTAS DE CONSULTA», las notas salen por fecha de visita (19-oct, 22-oct, 23-oct) y la visita del 19-oct figura «Atendida» |
| `R2-DESPUES-pdf-3.png` | Página 3: «Mensajes enviados al paciente» pasa entera a la página nueva, con su línea explicativa y su contenido (antes quedaba el título al pie y «Ninguno.» en la página siguiente) |
