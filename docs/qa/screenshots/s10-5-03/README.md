# S10.5-03 — Capturas ANTES / DESPUÉS

Cada imagen compara la aplicación en `develop` (fccfc64, ANTES) con la rama S10.5-03 (DESPUÉS), con los mismos datos de demostración y el mismo backend. Las capturas de «desplazada» se toman con la página ya bajada (de 250 a 700 px según la pantalla) para ver **qué queda a la vista**; las «móvil» son de 390 × 844 px. Para provocarlos creé en una base desechable al médico demo, una secretaria (`secretaria@medcita.ec`, que no existe en el seed) y un paciente adulto con una alergia severa a la penicilina y metformina como medicación, con una nota en borrador.

| Imagen | Qué muestra |
|---|---|
| `R1-ANTES-ficha-con-alergias-desplazada.png` / `R1-DESPUES-ficha-con-alergias-desplazada.png` | La ficha de un paciente con alergia, ya bajada: antes no queda a la vista ni el nombre ni la alergia; ahora la cabecera y el banner rojo siguen arriba |
| `R2-ANTES-nota-de-consulta-desplazada.png` / `R2-DESPUES-nota-de-consulta-desplazada.png` | La nota de consulta, escribiendo en «Objective»: antes la alergia ni siquiera estaba en esta pantalla; ahora está fija bajo el nombre y las migas |
| `R3-ANTES-linea-de-tiempo-desplazada.png` / `R3-DESPUES-linea-de-tiempo-desplazada.png` | La línea de tiempo bajada: la misma cabecera y el mismo banner que la ficha |
| `R4-ANTES-ficha-sin-alertas.png` / `R4-DESPUES-ficha-sin-alertas.png` | Un paciente sin alergias ni medicación: el banner no ocupa espacio (antes quedaba la línea «No allergies or regular medication recorded.») |
| `R5-ANTES-ficha-secretaria.png` / `R5-DESPUES-ficha-secretaria.png` | La ficha con la cuenta de la secretaría: sin banner, sin «Timeline» y sin ninguna petición clínica a la API |
| `R6-ANTES-movil-ficha-desplazada.png` / `R6-DESPUES-movil-ficha-desplazada.png` | La ficha en el móvil, ya bajada: quedan fijos solo el nombre y el banner (sin reacción ni dosis), justo bajo la barra superior |
| `R7-ANTES-movil-nota-desplazada.png` / `R7-DESPUES-movil-nota-desplazada.png` | La nota de consulta en el móvil, con el mismo bloque fijo |
| `R8-ANTES-menor-sin-representante.png` / `R8-DESPUES-menor-sin-representante.png` | Un menor sin representante legal: conserva la insignia «Minor» y el aviso ámbar de siempre |
| `R9-ANTES-movil-secretaria.png` / `R9-DESPUES-movil-secretaria.png` | La ficha de la secretaría en el móvil: las migas y los botones se desplazan con la página |
| `R10-DESPUES-cabecera-cargando.png` | La cabecera mientras llega el paciente (con la petición retenida): el esqueleto tiene la misma altura que la cabecera ya cargada |

Los esqueletos pulsan, así que la captura R10 puede salir con los bloques más o menos tenues.
