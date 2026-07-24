# S6-01 — Guión de demo oficial (10 min)

> Guión para la demo en vivo con cada médico candidato (S6-04 a S6-08). Estructura: problema → solución → live demo → precios → cierre. Fecha: 2026-07-24.

## Resumen de tiempos

| Sección | Tiempo | Objetivo |
|---|---|---|
| 1. Problema | 1.5 min | Que el médico se sienta identificado |
| 2. Solución | 1.5 min | Bajar la propuesta de valor a una frase simple |
| 3. Live demo | 5 min | Mostrar el "momento wow": la notificación real llegando |
| 4. Precios | 1 min | Dar el número sin rodeos |
| 5. Cierre | 1 min | Pedir el compromiso (carta de intención o pago) |

## 1. Problema (1.5 min)

> "¿Cuántas veces te ha pasado que un paciente simplemente no llega a su cita, y ni siquiera avisó? Cada inasistencia es tiempo y dinero perdido — y la forma más común de evitarlo hoy es que alguien de tu consultorio llame o escriba manualmente a cada paciente, uno por uno, el día anterior."

Puntos a tocar:
- La inasistencia (no-show) es el problema central que MedCita ataca.
- Hoy se resuelve con trabajo manual (llamadas, WhatsApp uno por uno) o no se resuelve — se resuelve pagando (empleado) o perdiendo (inasistencias).
- Adaptar el ejemplo a la especialidad del médico si se sabe de antemano (ej. pediatría: "cuántas veces un padre olvida la cita de control").

## 2. Solución (1.5 min)

> "MedCita es tu agenda digital — pero la diferencia real es que le avisa solo a cada paciente por WhatsApp y correo, un día antes, sin que nadie del consultorio tenga que acordarse de hacerlo."

Puntos a tocar:
- Agenda + recordatorio automático, no solo un calendario más.
- Corre solo — no requiere que una secretaria revise una lista cada mañana.
- Funciona igual para un médico solo o para una clínica con secretaria/varios médicos (roles: doctor, secretaria, admin).

## 3. Live demo (5 min) — el momento clave

Hacer esto **en la app real desplegada** (`https://medcita-frontend.onrender.com` o el dominio final), no en capturas.

1. **Login** con la cuenta que se le creó al médico de antemano (ver checklist de `docs/qa/S5-04-onboarding-plan.md`).
2. Mostrar su **calendario** (vacío o con 1-2 citas de ejemplo) — señalar la leyenda de colores (confirmada / agendada / pendiente).
3. **Agendar una cita en vivo**: buscar/crear un paciente de prueba usando **el propio número de WhatsApp del médico** (para que la notificación le llegue a él mismo, en vivo, durante la demo).
4. Confirmar la cita → mostrar el toast "Appointment scheduled! Notifications are being sent."
5. **Esperar la notificación real** (WhatsApp o Email) y que el médico la vea llegar en su propio celular — este es el momento que vende la demo, no una explicación teórica.
6. (Si hay tiempo) Mostrar brevemente **Availability** (cómo ajusta su propio horario) y **Patients** (directorio con búsqueda).

> Nota: no usar el número de teléfono de ningún paciente de demo ya sembrado (Juan Carlos Cevallos, María Elena Lasso, Ricardo Andrade, etc.) para esta prueba en vivo — ver el hallazgo documentado en `docs/qa/S5-03-production-validation.md` sección 5 sobre la colisión de teléfono con datos de demo.

## 4. Precios (1 min)

> "El plan pensado para un consultorio independiente como el tuyo está entre $15 y $30 al mes — mucho menos que lo que cuesta una sola cita perdida por inasistencia."

Puntos a tocar:
- Dar el rango exacto ($15-30/mes), no evadir la pregunta.
- Enmarcarlo contra el costo de UNA inasistencia (tiempo del consultorio, oportunidad perdida) para que el precio se sienta pequeño en comparación.

## 5. Cierre (1 min)

> "Lo que te pido hoy es simple: que pruebes esto con tus pacientes reales por unas semanas. Si te sirve, seguimos conversando el plan pago; si no, me dices exactamente qué te faltó."

Puntos a tocar:
- Pedir el compromiso concreto: carta de intención, o directamente el primer pago si hay disposición inmediata (criterio de éxito de S6-04 a S6-08).
- Compartir el link del formulario de feedback (`docs/qa/S5-04-onboarding-plan.md`, sección 4) antes de despedirse.
- Agradecer el tiempo, sin importar el resultado — cada "no" con razón concreta es información valiosa para el backlog (`docs/qa/S6-10-backlog-v1.md`).
