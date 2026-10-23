# S10-05 — Capturas ANTES / DESPUÉS

Cada imagen compara la aplicación en `develop` (ba7827d, ANTES) con la rama S10-05 (DESPUÉS), con los mismos datos de demostración. Para las capturas cargué la lista del Ministerio de Salud Pública en la base desechable con `npm run diagnoses:import` (el repositorio no la lleva; ver `docs/TECHNICAL.md`, «Diagnósticos CIE-10»), así que los nombres que se ven en R2 a R4 son de esa lista. El borrador es el de María Elena Lasso (Dra. Camila Torres) y la nota cerrada de R6 trae diagnósticos en texto libre, que es lo que lleva el seed.

| Imagen | Qué muestra |
|---|---|
| `R1-ANTES-borrador.png` / `R1-DESPUES-borrador.png` | El borrador de la nota: ahora termina con la tarjeta «Diagnoses» |
| `R2-DESPUES-busqueda-por-nombre.png` | Buscar por nombre: «diabetes mellitus tipo 2» |
| `R3-DESPUES-busqueda-por-codigo.png` | Buscar por código: «i10» |
| `R4-DESPUES-diagnosticos-agregados.png` | Tres diagnósticos: uno principal de la lista, otro de la lista y uno de texto libre, cada uno con su certeza |
| `R5-DESPUES-ficha-con-diagnostico.png` | La ficha: la lista de notas muestra el diagnóstico principal de la nota cerrada |
| `R6-DESPUES-nota-cerrada.png` | La nota cerrada: los diagnósticos son de solo lectura |
