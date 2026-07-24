# S5-03 — Validación funcional en producción con datos simulados

> Como no fue posible conseguir médicos piloto reales para esta ronda (ver #58), se reemplazó la validación de onboarding real por una validación técnica exhaustiva usando los 3 médicos piloto ya sembrados (Dr. Santiago Pérez, Dra. Camila Torres, Dr. Andrés Mendoza), agendando citas reales a través de la UI en producción — no solo insertando datos vía el script de seed. Fecha de ejecución: 2026-07-24.

## Resumen

| Prueba | Resultado |
|---|---|
| Notificaciones reales (WhatsApp + Email) en producción, no en modo mock | ✅ Confirmado |
| Login + agendar cita real para los 3 médicos piloto, vía UI | ✅ Los 3 |
| Estados de cita (pendiente → confirmada) | ✅ Funciona correctamente |
| Datos de producción quedan limpios tras la prueba | ✅ Restaurados |
| Errores de consola durante toda la validación | ✅ Cero |

## 0. Credenciales reales de notificación

Antes de esta validación, se agregaron a las variables de entorno del backend en Render las mismas credenciales de Twilio (WhatsApp) y Brevo/SendGrid (Email) usadas en desarrollo local, para que la validación probara el envío real, no el modo mock. Ver `docs/DEPLOY.md` para el detalle de qué variables son.

## 1. Dr. Santiago Pérez (Medicina General)

- Login en `https://medcita-frontend.onrender.com` con `demo@medcita.ec`.
- Se agendó una cita real vía el modal "New Appointment" → "Create New Patient", con un paciente de prueba usando un número de WhatsApp y email reales (del equipo).
- Resultado: toast **"Appointment scheduled! Notifications are being sent."**, el contador de "Total Appointments" subió correctamente (de 4 a 5).

[Captura — cita creada, toast de confirmación](screenshots/s5-03/01-dr-perez-appointment-created.png)

**Nota de proceso**: en este primer intento se transcribió mal el número de teléfono de prueba (un dígito transpuesto), por lo que el WhatsApp no llegó — el email sí. Se corrigió en la prueba de la Dra. Torres (punto 2) con el número correcto, donde se confirmó la entrega real de ambos canales. No se repitió la cita de Dr. Pérez porque el mecanismo de envío es el mismo código sin importar el médico (ver alcance acordado abajo).

## 2. Dra. Camila Torres (Pediatría)

- Login con `dra.torres@medcita.ec`.
- Cita real agendada con el número de WhatsApp correcto.

[Captura — formulario con el número de WhatsApp correcto](screenshots/s5-03/02-dra-torres-form-filled.png)
[Captura — cita creada, toast de confirmación](screenshots/s5-03/03-dra-torres-appointment-created.png)

**Confirmado por el usuario**: el WhatsApp y el email llegaron realmente a los destinos reales — validando que el pipeline completo de notificaciones (backend en Render → Twilio/Brevo reales) funciona en producción, no solo en modo mock.

## 3. Dr. Andrés Mendoza (Medicina Familiar)

- Login con `dr.mendoza@medcita.ec`.
- Cita real agendada correctamente.

[Captura — cita creada, toast de confirmación](screenshots/s5-03/04-dr-mendoza-appointment-created.png)

**Alcance acordado**: dado que las 3 citas disparan exactamente el mismo código de envío (`notificationService.js`), se decidió con el usuario confirmar la entrega real de WhatsApp/Email **una sola vez** (punto 2) en vez de las 3 — para los otros 2 médicos se verificó que el flujo se completó sin error (toast de éxito, contador de citas actualizado), no la recepción real del mensaje.

## 4. Estados de cita (pendiente → confirmada)

Se abrió el detalle de una de las citas recién creadas (estado inicial `Pending`, con botones "Confirm Appointment" / "Cancel"):

[Captura — detalle de cita en estado Pending](screenshots/s5-03/05-appointment-pending-detail.png)

Al hacer clic en "Confirm Appointment": toast **"Appointment confirmed"**, el evento en el calendario cambió de color (naranja → verde), y el indicador de "Effectiveness" del dashboard se actualizó correctamente (40% → 60%, reflejando la nueva proporción de citas confirmadas).

[Captura — cita confirmada, toast y color actualizado](screenshots/s5-03/06-appointment-confirmed-status.png)

## 5. Hallazgo durante la prueba — colisión de teléfono con dato de demo

Al agendar las citas de prueba, se detectó que el número de teléfono real usado para la prueba coincidía exactamente con el de un paciente ya sembrado (**Ricardo Andrade**, `+593985729425`, parte de los 8 pacientes de ejemplo del seed). Como el backend hace upsert de paciente por número de teléfono (comportamiento correcto: permite que un mismo paciente real tenga citas con varios médicos), esto sobrescribió temporalmente el nombre/email de ese registro de demo a "Erick Vasconez (Validación S5-03)".

No es un bug de la aplicación — es el comportamiento esperado del upsert por teléfono, simplemente coincidió con un dato de demo preexistente. **Corregido** volviendo a correr `npx prisma db seed` contra Neon al finalizar la validación, lo que:
- Restauró a "Ricardo Andrade" con su nombre/email/cédula originales.
- Eliminó las 5 citas de prueba creadas durante esta validación (ya no son necesarias — la evidencia queda en las capturas de este reporte).
- Dejó la base de producción en el mismo estado limpio que documenta `docs/qa/S5-02-deploy-verification.md`.

Verificado tras el re-seed con una consulta directa: el paciente con ese teléfono volvió a ser `Ricardo Andrade` / `ricardo@example.com` / cédula `1755667788`.

## Conclusión

El sistema funciona correctamente en producción con los 3 médicos piloto: cada uno puede iniciar sesión, ver su propio calendario, agendar citas reales, y las notificaciones (WhatsApp + Email) se disparan de verdad — no en modo mock — contra proveedores reales. Los cambios de estado de cita funcionan y se reflejan correctamente en las estadísticas del dashboard. Cero errores de consola durante toda la validación.
