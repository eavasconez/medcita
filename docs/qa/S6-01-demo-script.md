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

Hacer esto **en la app real desplegada** (`https://medcita-frontend.onrender.com` o el dominio final), no en capturas — las capturas de abajo son la referencia de qué esperar en cada paso, tomadas contra la app real en producción.

> Antes de empezar: no usar el número de teléfono de ningún paciente de demo ya sembrado (Juan Carlos Cevallos, María Elena Lasso, Ricardo Andrade, etc.) para la prueba en vivo — ver el hallazgo documentado en `docs/qa/S5-03-production-validation.md` sección 5 sobre la colisión de teléfono con datos de demo. Usar siempre un número que no esté ya en la base.

### Paso 1 — Login

Entrar con la cuenta que se le creó al médico de antemano (ver checklist de `docs/qa/S5-04-onboarding-plan.md`).

[Pantalla de login](screenshots/s6-01/01-login-empty.png) · [con las credenciales completadas](screenshots/s6-01/02-login-filled.png)

### Paso 2 — Mostrar el calendario

Tras iniciar sesión, señalar la leyenda de colores (confirmada / agendada / pendiente) y la vista semanal.

[Dashboard / calendario](screenshots/s6-01/03-dashboard.png)

### Paso 3 — Abrir "New Appointment" y buscar/crear paciente

Clic en **"New Appointment"** (arriba a la derecha) → se abre el paso 1 de 3, **"Who are we seeing?"**. Si el paciente no existe, clic en **"Create New Patient"**.

[Modal paso 1 — buscar paciente](screenshots/s6-01/04-modal-step1-search.png)

### Paso 4 — Elegir fecha y horario

Paso 2 de 3, **"When?"** — elegir la fecha (por defecto hoy) y un horario libre (en verde, "LIBRE").

[Modal paso 2 — horarios disponibles](screenshots/s6-01/05-modal-step2-slots.png)

### Paso 5 — Completar los datos del paciente

Paso 3 de 3, **"Last details"** — nombre completo, número de WhatsApp (**usar el del médico para esta demo**, no un dato de prueba genérico), email opcional.

[Modal paso 3 — formulario vacío](screenshots/s6-01/06-modal-step3-empty.png) · [formulario completado](screenshots/s6-01/07-modal-step3-filled.png)

### Paso 6 — Confirmar y esperar la notificación real

Clic en **"Confirm Appointment"** → aparece el toast **"Appointment scheduled! Notifications are being sent."** y la cita se ve en el calendario.

[Cita confirmada — toast y calendario actualizado](screenshots/s6-01/08-confirmed-toast.png)

**Esperar la notificación real** (WhatsApp o Email) y que el médico la vea llegar en su propio celular — este es el momento que vende la demo, no una explicación teórica.

### Paso 7 (si hay tiempo)

Mostrar brevemente **Availability** (cómo ajusta su propio horario) y **Patients** (directorio con búsqueda).

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
