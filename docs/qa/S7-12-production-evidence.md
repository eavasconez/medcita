# S7-12 — Evidencia de ejecución en producción (Sprint 7)

> Prueba hecha con un navegador real contra el sitio desplegado (`https://medcita-frontend.onrender.com`), por la interfaz y no por la API, el **21-oct-2026**, con el despliegue que incluye S7-01 a S7-11 (el PR #93 ya estaba en `main`). Se usó el médico demo (Dr. Santiago Pérez) y el administrador del seed. Las capturas de pantalla las tomó Playwright; las del teléfono y la bandeja de entrada las aportó Erick. Los correos personales que aparecen (el remitente del correo y el buzón temporal del paciente de prueba) están pixelados.

## Resumen

| Prueba | Resultado |
|---|---|
| Todas las pantallas cargan con datos, sin errores de carga ni «sin datos» (S7-11) | ✅ |
| Agendar una cita real desde la interfaz | ✅ Aviso «Appointment scheduled! Notifications are being sent.» |
| **WhatsApp con plantilla de Meta** (S7-06, #75) llega al teléfono sin que nadie le haya escrito antes al número | ✅ Llegó 3 veces (8:46, 8:54 y 8:58) |
| **Correo de confirmación** (Brevo) llega a la bandeja de entrada | ✅ Llegó a las 8:58:30 |
| Confirmar y cancelar una cita desde la interfaz | ✅ |
| Editar un paciente (cambio de correo) desde la interfaz | ✅ |
| Producción queda sin datos de prueba | ✅ 4 citas, sin citas futuras y el correo de Ricardo restaurado |

## 1. Pantallas (sin escribir datos)

Entrando como el médico demo, el administrador y en un móvil (390 px de ancho).

| Pantalla | Captura |
|---|---|
| Login, registro y recuperar contraseña | [01](screenshots/s7-12/01-login.png) · [02](screenshots/s7-12/02-register.png) · [03](screenshots/s7-12/03-forgot-password.png) |
| Calendario del médico: semana, mes, día y agenda | [04](screenshots/s7-12/04-doctor-calendar-week.png) · [05](screenshots/s7-12/05-doctor-calendar-month.png) · [06](screenshots/s7-12/06-doctor-calendar-day.png) · [07](screenshots/s7-12/07-doctor-calendar-agenda.png) |
| Pacientes, disponibilidad y ajustes | [08](screenshots/s7-12/08-doctor-patients.png) · [09](screenshots/s7-12/09-doctor-availability.png) · [10](screenshots/s7-12/10-doctor-settings.png) |
| Administrador: calendario, usuarios y analíticas | [11](screenshots/s7-12/11-admin-calendar.png) · [12](screenshots/s7-12/12-admin-users.png) · [13](screenshots/s7-12/13-admin-analytics.png) |
| Móvil: calendario y menú | [14](screenshots/s7-12/14-mobile-calendar.png) · [15](screenshots/s7-12/15-mobile-menu.png) |

Las analíticas muestran 10 citas y 3 médicos activos, y la gestión de usuarios lista los 4 del seed.

## 2. Ciclo de una cita

Paciente: Ricardo Andrade (seed), con el número y el correo de prueba de Erick. Cita: vie 23-oct, 10:00.

1. **Agendar**: [paso 1, paciente](screenshots/s7-12/16-new-appointment-1-patient.png) → [paso 2, horarios libres](screenshots/s7-12/17-new-appointment-2-slots.png) → [paso 3, notas y confirmar](screenshots/s7-12/18-new-appointment-3-notes.png). Resultado: [aviso de éxito y contador 4 → 5](screenshots/s7-12/19-appointment-created-toast.png); la cita queda [pendiente en la agenda](screenshots/s7-12/20-appointment-pending-in-agenda.png).
2. **Confirmar**: [estado *Confirmed*](screenshots/s7-12/21-appointment-confirmed.png).
3. **Cancelar**: el botón *Cancel* abre un diálogo del navegador («Are you sure you want to cancel this appointment?»). Al aceptarlo, la cita [sale de la agenda](screenshots/s7-12/22-appointment-cancelled-agenda.png) (borrado lógico: pasa a `cancelled`).

## 3. Notificaciones reales

### WhatsApp (plantilla de Meta aprobada, S7-06)

[Captura del teléfono](screenshots/s7-12/28-whatsapp-received-on-phone.png): el mensaje `cita_confirmada` llegó con el texto exacto de la plantilla:

> MedCita: Hola Ricardo Andrade, tu cita con Dr. Santiago Pérez ha sido agendada para el 2026-10-23 a las 10:00. ¡Te esperamos!

La captura muestra además, más arriba, los mensajes de prueba de `npm run whatsapp:test`. En el del recordatorio se ve el fallo que se corrigió en el PR #93: el día salía como «-» («tienes una cita - a las 10:00»). El envío real de recordatorios no estaba afectado, porque lo arma `notificationService.sendReminder`.

### Correo (Brevo)

[Captura de la bandeja de entrada](screenshots/s7-12/29-email-received-in-inbox.png): «Confirmación de Cita - MedCita», con paciente, médico, fecha y hora. Antes se cambió el correo del paciente desde la interfaz ([formulario](screenshots/s7-12/23-patient-edit-new-email.png) y [ficha actualizada](screenshots/s7-12/24-patient-updated-in-list.png)) y se agendó otra cita ([captura](screenshots/s7-12/25-appointment-created-with-email.png)).

## 4. Producción después de la prueba

Se canceló la cita y se devolvió a Ricardo su correo original: [agenda sin citas](screenshots/s7-12/26-production-clean-agenda.png) (4 citas, como antes) y [correo restaurado](screenshots/s7-12/27-production-clean-patient-email.png).

## Lo que esta prueba no cubre

- **Mover una cita de hora** (conflicto de horario de S7-07): la interfaz solo permite arrastrarla en el calendario y no se probó. Lo cubre la suite de pruebas y Postman.
- **Crear y borrar pacientes o usuarios**, y el **cambio de contraseña**: no se ejecutaron en producción. El registro de auditoría (S7-09) no tiene pantalla; solo se comprobó que `GET /api/admin/audit-log` responde 401 sin token y 403 como médico.
- **El recordatorio de 24 h**: solo sale cuando faltan menos de 24 horas para la cita; no se esperó a que corriera.
- **La entrega depende del número de prueba de Meta**, que solo admite 5 destinatarios registrados. Con pacientes reales hace falta un número propio y el negocio verificado (`docs/DEPLOY.md`, sección 7.7).
- Las capturas de pantalla muestran lo que ve el navegador. Que el WhatsApp y el correo llegaron lo confirma Erick con las dos capturas finales; el log del servidor no se consultó.
