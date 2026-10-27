# S10.5-07 — Capturas ANTES / DESPUÉS

Cada imagen compara la aplicación en `develop` (c1b2e00, ANTES) con la rama S10.5-07 (DESPUÉS), con los mismos datos de demostración y el mismo backend (el nuevo, que sigue entendiendo lo que mandaba el ANTES). Las de «móvil» son de 390 × 844 px; el resto, de 1280 × 800. Para provocarlas creé en una base desechable 24 pacientes más (con fechas de nacimiento, consentimientos dados, retirados y a un texto anterior) y la cuenta de una secretaria (`secretaria@medcita.ec`, que no existe en el seed). Las capturas del DESPUÉS «sin pacientes» y «cargando» detienen la petición de la lista para mostrar ese estado.

| Imagen | Qué muestra |
|---|---|
| `R1-ANTES-lista.png` / `R1-DESPUES-lista.png` | La lista: de las tarjetas a la tabla, con los filtros y el total arriba |
| `R2-ANTES-ordenada-por-nombre.png` / `R2-DESPUES-ordenada-por-nombre.png` | Ordenar por nombre con el encabezado «Patient» (flecha de orden en el encabezado); el ANTES no podía ordenar |
| `R3-ANTES-filtros-consentimiento-y-menores.png` / `R3-DESPUES-filtros-consentimiento-y-menores.png` | Filtros combinados «Consent given» + «Minors»: 5 pacientes y el botón «Clear» |
| `R4-…-vacio-busqueda.png` | Una búsqueda sin resultados: antes «No patients found» genérico; ahora dice qué se buscó y ofrece «Clear the search» |
| `R5-…-vacio-con-filtros.png` | Sin resultados con filtros activos: otro mensaje y «Clear filters» |
| `R6-DESPUES-vacio-sin-pacientes.png` | Sin pacientes en el consultorio: «No patients yet» con «Register the first patient» |
| `R7-ANTES-recientes.png` / `R7-DESPUES-recientes.png` | La franja de recientes sobre la búsqueda (los 4 últimos abiertos, el más nuevo primero) |
| `R8-…-secretaria.png` | La secretaria: la misma tabla, sin exportaciones y sin nada clínico |
| `R9-…-medico-sin-exportar.png` | Un médico: lo mismo, sin los botones de exportar (solo administradores) |
| `R10-…-movil-lista.png` / `R11-…-movil-filtrada.png` | Móvil: las tarjetas de siempre con los filtros (de dos en dos) y un selector de orden; filtrada por menores y ordenada por nombre |
| `R12-DESPUES-cargando.png` | La carga: filas esqueleto con la forma de la tabla (antes, seis tarjetas esqueleto) |

El diálogo de consentimiento, el de crear y editar, el borrado bloqueado con citas (botón atenuado en la fila de un paciente con citas) y la paginación no cambian de aspecto.
