# S10.5-04 — Capturas ANTES / DESPUÉS

Cada imagen compara la aplicación en `develop` (d30c481, ANTES) con la rama S10.5-04 (DESPUÉS), con los mismos datos de demostración y el mismo backend. Las de «móvil» son de 390 × 844 px; el resto, de 1280 × 800. Las secciones del ANTES se toman bajando la página hasta el título de cada bloque (era una sola página larga); las del DESPUÉS, pulsando la sección en la navegación. Para provocarlos creé en una base desechable la cuenta de una secretaria (`secretaria@medcita.ec`, que no existe en el seed) y un paciente con alergia, medicación, cuatro antecedentes, dos tomas de signos vitales, una nota cerrada con diagnóstico y otra en borrador; «sin datos clínicos» es un paciente del seed sin nada de eso.

| Imagen | Qué muestra |
|---|---|
| `R1-ANTES-resumen.png` / `R1-DESPUES-resumen.png` | Arriba de la ficha: antes, los datos personales; ahora, la navegación lateral y el Resumen (última consulta, últimos signos, diagnósticos recientes, antecedentes clave) |
| `R2-…-seccion-background.png` | Antecedentes: alergias, medicación e historia (edición en línea) |
| `R3-…-seccion-vitals.png` | Signos vitales (su contenido interno no cambia: es S10.5-05) |
| `R4-…-seccion-consultations.png` | Consultas (ahora siempre visible y ordenada por la fecha de la visita) |
| `R5-…-seccion-appointments.png` | Citas |
| `R6-…-seccion-data.png` | Datos del paciente (personales, contacto de emergencia, representante legal) |
| `R7-ANTES-editar-ficha.png` / `R7-DESPUES-editar-ficha.png` | Editar los datos: del formulario que reemplazaba las tarjetas al diálogo |
| `R8-…-paciente-sin-datos-clinicos.png` / `R9-…-paciente-sin-datos-antecedentes.png` | Un paciente sin nada clínico: el Resumen dice que no hay nada y «Background» ofrece «Add the first allergy / medicine / entry» |
| `R10-…-secretaria.png` | La secretaría: solo «Appointments» y «Patient data» en la navegación, sin banner ni botón «Timeline» |
| `R11-…-movil-resumen.png` | Móvil: las pastillas bajo la cabecera, sobre el Resumen |
| `R12-…-movil-signos-vitales.png` | Móvil, ya bajada a «Vital signs»: la cabecera, el banner y las pastillas siguen fijos |
| `R13-…-movil-secretaria.png` | Móvil, secretaría: dos pastillas |
| `R14-…-menor-sin-representante.png` | Un menor sin representante: conserva la insignia y el aviso, ahora arriba del contenido |
| `R15-DESPUES-enlace-directo-vitals.png` | Abrir `/patients/:id#vitals` directamente: la ficha ya está en «Vital signs» y la navegación lo marca |
