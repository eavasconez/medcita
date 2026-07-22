# S4-01 — Testing funcional (happy path + casos de error)

> Reporte de pruebas manuales/automatizadas contra el backend y frontend reales corriendo en local (`npm run dev` en ambos). Fecha de ejecución: 2026-07-22.

## Resumen

| Área | Resultado |
|---|---|
| Flujo feliz (registro → login → agendar cita) | ⚠️ Funciona, pero con 1 bug encontrado que lo rompe en un escenario común (ver Hallazgo #1) |
| Recordatorio de WhatsApp (24h antes) | ✅ Entrega real confirmada |
| Casos de error — autenticación | ✅ Todos manejados con mensajes claros |
| Casos de error — creación de citas | ✅ Todos manejados con mensajes claros |
| Casos de error — doble reserva | ✅ Rechazado correctamente |
| Casos de error — rutas protegidas | ✅ Rechazado correctamente |

## 1. Flujo feliz (vía UI, Playwright)

| Paso | Resultado | Captura |
|---|---|---|
| Registro de nuevo médico (`/register`) | ✅ Redirige a `/dashboard` tras registrar | [formulario](screenshots/s4-01/01-register-filled.png) · [tras registrar](screenshots/s4-01/02-after-register.png) |
| Login (`/login`) | ✅ Redirige a `/dashboard` | [dashboard tras login](screenshots/s4-01/03-dashboard-after-login.png) |
| Abrir modal "New Appointment" → "Create New Patient" | ✅ | [paso 1](screenshots/s4-01/04-modal-step1-patient.png) |
| Seleccionar fecha (+5 días) y slot libre | ✅ Slot disponible, se selecciona | [paso 2](screenshots/s4-01/05-modal-step2-date.png) |
| Completar datos del paciente (nombre, WhatsApp, email) y confirmar | ⚠️ **Ver hallazgo #1** | [paso 3](screenshots/s4-01/06-modal-step3-details.png) · [formulario lleno](screenshots/s4-01/07-modal-filled.png) |

### Hallazgo #1 (bug encontrado) — Prioridad alta
Al crear un paciente **sin cédula** desde el modal del Dashboard, el frontend envía `cedula: ""` (string vacío, no `null`/`undefined`, porque es un input controlado de React). El backend pasa ese valor tal cual a `tx.patient.upsert({ ..., create: { cedula: patientCedula } })` (`backend/src/routes/appointments.js:122-123`), y como `cedula` tiene `@unique` en el schema, **el segundo paciente creado sin cédula falla** con un error de restricción única de Prisma.

Peor aún: ese error crudo de Prisma (stack trace completo, incluyendo rutas del filesystem) se expone directamente en un toast al usuario final, en vez de un mensaje manejado.

**Captura del error real**: [08-after-confirm.png](screenshots/s4-01/08-after-confirm.png) — se ve el toast rojo con el stack trace de Prisma superpuesto al modal.

**Reproducción**: crear dos citas nuevas seguidas, cada una con un paciente nuevo, ambas sin llenar el campo "Identification (Cédula)".

**Impacto**: bloquea agendar citas para cualquier paciente sin cédula a partir del segundo intento — un flujo común, ya que la cédula es opcional.

**Queda para**: issue #43 (S4-03: Corrección de bugs encontrados en testing).

## 2. Casos de error (vía API)

| # | Caso | Esperado | Resultado |
|---|---|---|---|
| 1 | Login con contraseña incorrecta | 401 + mensaje claro | ✅ `401 {"error":"Invalid credentials"}` |
| 2 | Login con email inexistente | 401 + mensaje claro (sin revelar si el email existe) | ✅ `401 {"error":"Invalid credentials"}` |
| 3 | Login sin password | 400 + mensaje claro | ✅ `400 {"error":"Email and password are required"}` |
| 4 | Crear cita sin nombre de paciente | 400 + mensaje claro | ✅ `400 {"error":"Patient name is required"}` |
| 5 | Crear cita sin teléfono | 400 + mensaje claro | ✅ `400 {"error":"Patient phone is required"}` |
| 6 | Crear cita con fecha en formato inválido | 400 + mensaje claro | ✅ `400 {"error":"A valid date (YYYY-MM-DD) is required"}` |
| 7 | Crear cita con hora en formato inválido | 400 + mensaje claro | ✅ `400 {"error":"A valid time (HH:MM) is required"}` |
| 8 | Doble reserva (mismo médico, misma fecha/hora) | 400 + mensaje de conflicto | ✅ `400 {"error":"Ya existe una cita en este horario"}` |
| 9 | Acceso a ruta protegida sin token | 401 | ✅ `401 {"error":"No token provided"}` |
| 10 | Acceso con token inválido | 401 | ✅ `401 {"error":"Invalid token"}` |
| 11 | Disparo manual del job de recordatorios (`POST /api/tasks/reminders`) | 200 | ✅ `200 {"message":"Reminders task triggered manually"}` |
| 12 | Entrega real del recordatorio de WhatsApp | El paciente recibe el mensaje | ✅ Cita real creada para "mañana" con `status: scheduled`; tras disparar el job, **confirmado por el usuario que el WhatsApp llegó**, y la cita pasó a `status: confirmed` en la base de datos (evita reenvío duplicado) |

## Datos de prueba
Se crearon y limpiaron después de la verificación: 1 médico de prueba, 1 paciente de prueba, 3 citas de prueba (una vía UI con conflicto de cédula, una vía API para el test de doble-reserva, una vía API para la evidencia de entrega del recordatorio).

## Conclusión
El flujo feliz (registro → login → agendar → recordatorio WhatsApp) funciona de punta a punta, incluyendo la entrega real confirmada del WhatsApp de recordatorio (caso #12) — **con la excepción del Hallazgo #1**: crear un paciente sin cédula rompe el flujo a partir del segundo intento, exponiendo un error crudo de Prisma al usuario. Los 10 casos de error probados (#1–#10) devuelven respuestas claras y con el código HTTP correcto. En resumen: el happy path **no está 100% funcional** para el escenario de paciente sin cédula; ese bug queda documentado para arreglarse en S4-03.
