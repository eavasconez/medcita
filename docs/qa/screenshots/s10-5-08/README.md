# S10.5-08 — Capturas ANTES / DESPUÉS

Cada imagen compara la aplicación en `develop` (b36271b, ANTES) con la rama S10.5-08 (DESPUÉS), con los mismos datos de demostración y el mismo backend (no cambia en este ticket). Las de «móvil» son de 390 × 844 y las de «escritorio» de 1280 × 800. Paciente de los ejemplos: María Elena Lasso (visitas, notas, addendum, signos vitales y consentimiento); la cita del modal es una de ella en la agenda.

| Imagen | Qué muestra |
|---|---|
| `R01-ANTES-escritorio-linea-de-tiempo.png` / `R01-DESPUES-…` | La línea de tiempo: cada evento gana una insignia con su tipo y otra con su estado (Draft, Given, …) junto a la fecha |
| `R02-…-escritorio-filtro-notas.png` | Filtro «Notes»: notas y addenda con sus insignias |
| `R03-…-escritorio-filtro-signos-vitales.png` | Filtro «Vital signs»: el título «Vital signs» pasa de ser texto a insignia y la lectura queda como contenido |
| `R04-…-escritorio-sin-eventos.png` | Un filtro sin eventos («Consent» en Hugo Paez, que no tiene consentimientos): «Nothing recorded yet» |
| `R05-…-movil-linea-de-tiempo.png` | Móvil: las insignias pasan a su propia línea si no caben |
| `R06-…-secretaria-linea-de-tiempo.png` | La secretaría: el mensaje de que los datos clínicos no están disponibles para su rol; sin banner y sin pedir nada clínico |
| `R07-…-escritorio-cargando.png` | La carga (con la API retrasada 4 s): tres tarjetas esqueleto en lugar de una pantalla vacía |
| `R08-…-escritorio-modal-cita-medico.png` | Modal de la cita para un médico: los enlaces «Patient record» y «Consultation note» bajo el nombre (antes, solo la nota y al final) |
| `R09-…-escritorio-modal-cita-secretaria.png` | Modal de la cita para la secretaría: solo «Patient record», sin banner clínico |
| `R10-…-movil-modal-cita-medico.png` / `R11-…-movil-modal-cita-medico-abajo.png` | Móvil: los enlaces apilados arriba y, al desplazar, los botones de estado de la cita |

El calendario, el flujo de reserva y las notificaciones no cambian.
