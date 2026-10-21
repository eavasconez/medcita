# Cambios de MedCita

## Sprint 8 (en curso)

- **Alta con correo confirmado e invitaciones (S8-02, #97).** Registrarse pide el nombre del consultorio y no crea nada hasta abrir el enlace del correo (24 h, un solo uso); responde igual exista o no la cuenta. Los administradores ya no escriben contraseñas: invitan por correo (7 días) y cada persona elige la suya, viendo a qué consultorio entra; hay lista de pendientes con reenviar y cancelar. El nombre del consultorio ahora se ve completo en la barra lateral, en la barra móvil, en la pestaña, en Settings (donde el admin lo puede renombrar) y en los correos. Necesita el correo funcionando en producción: `docs/DEPLOY.md`, «Alta de consultorios e invitaciones».
- **Datos separados por consultorio (S8-01, #96).** Pacientes, citas, horarios y cuentas pertenecen a un consultorio y cada persona solo ve y edita lo del suyo; teléfono y cédula son únicos por consultorio; quien se registra obtiene un consultorio propio; el operador de la plataforma (`superadmin`) ve los consultorios y su tamaño, no su contenido. Migración en dos pasos que pone los datos actuales en `Consultorio principal`: antes de fusionar leer `docs/DEPLOY.md`, «Primer despliegue con consultorios». Detalle: `docs/TECHNICAL.md`, «Consultorios».

## Sprint 7 — 21-oct-2026

Cierre del Sprint 7: pruebas automatizadas, migraciones, seguridad de acceso, registro de auditoría y WhatsApp con plantillas de Meta, todo comprobado en el sitio desplegado (`docs/qa/S7-12-production-evidence.md`).

### Novedades

- **WhatsApp con la API de Meta (S7-06, #75, PR #81 y #93).** La confirmación y el recordatorio se envían como plantillas aprobadas en español (`cita_confirmada`, `recordatorio_cita`): llegan aunque el paciente nunca haya escrito al número. Twilio y el modo simulado siguen disponibles; cómo elegir entre ellos está en `docs/DEPLOY.md`, sección 7.0. Guía de configuración: `docs/WHATSAPP_META_SETUP.md` y el PDF de la pantalla de login.
- **Registro de auditoría (S7-09, #84, PR #92).** Lo que hacen administradores y secretarias con citas, pacientes y cuentas se guarda en la tabla `AuditLog`, en la misma transacción que la acción. Consulta para administradores: `GET /api/admin/audit-log` (aún sin pantalla).
- **Cambio de contraseña desde Settings (S7-08, #83, PR #87).** Los tokens emitidos antes del cambio dejan de valer.
- **Recuperación de contraseña y límite de intentos (S7-03, #72, PR #78).** Enlace por correo de un solo uso y 60 minutos; 5 intentos fallidos por correo en 15 minutos y límites por IP.
- **Mover una cita aplica las mismas reglas que agendarla (S7-07, #82, PR #86):** responde `409` si el horario está ocupado.
- **API y pantallas (S7-05, #74, PR #80):** citas paginadas con rango de fechas y `/stats` para los indicadores, `DELETE /api/patients/:id` (solo sin citas), `/api/admin/doctors` (el alias `/medicos` queda obsoleto), decisión de idioma documentada y carga del calendario por rango.
- **Salud y errores de carga (S7-11, #89, PR #90).** `GET /api/health` responde `503` si la base está inalcanzable o atrasada respecto al código; las pantallas muestran un error con reintento en vez de «sin datos».

### Calidad y operación

- **Pruebas automatizadas y CI (S7-02, #71, PR #77):** Jest + supertest contra PostgreSQL real (433 pruebas al cierre), colección de Postman ampliada y GitHub Actions con `npm test` y `npm run lint` en cada PR. El lint del frontend quedó en 0 errores y 0 advertencias.
- **Migraciones de Prisma (S7-04, #73, PR #79 y #88):** baseline `20261019202135`, `migrate deploy` en cada despliegue y `prisma generate` en cada instalación.
- **Recordatorios (S7-01, #70, PR #76):** se recuerdan las citas `pending_approval`, `scheduled` y `confirmed`, una sola vez (`reminderSentAt`) y con la hora de la clínica.
- **Documentación y evidencia (S7-10 y S7-12):** backlog reescrito, README, manual de demo, flujo de la aplicación, guía técnica, guía de despliegue y guía en PDF actualizados, y evidencia del recorrido en producción.

### Incidente del 20-oct-2026

Tras fusionar S7-08, producción respondió `500` en las rutas autenticadas porque a la base de Neon le faltaban cambios de esquema (había sido creada con `db push`). Causas, correcciones y cómo se previene: `docs/qa/S6-10-backlog-v1.md`, «Lecciones del Sprint 7».

### Para quien despliega (checklist)

Todo esto ya está aplicado en el servicio actual; sirve para un servicio nuevo o para auditar el actual. Detalle en `docs/DEPLOY.md`.

- [ ] Build Command del backend: `npm install && npx prisma migrate deploy`.
- [ ] **Health Check Path** de Render: `/api/health`.
- [ ] `JWT_SECRET` real (32 o más caracteres), `FRONTEND_URL` con la URL real del frontend, `DATABASE_URL` directa de Neon (sin `-pooler`).
- [ ] WhatsApp: `META_WHATSAPP_TOKEN` y `META_WHATSAPP_PHONE_NUMBER_ID` (o `TWILIO_*` si el cliente elige Twilio; no cargar ambos grupos en producción).
- [ ] Correo: `BREVO_API_KEY` y `BREVO_FROM_EMAIL` (necesario para la recuperación de contraseña).
- [ ] Verificar `TRUST_PROXY` con `GET /api/admin/client-ip`.

### Pendiente y fuera del código

Esto no se resuelve con un cambio en el repositorio; lo hace el equipo o el cliente.

- **Cambiar las contraseñas de las cuentas de demo** en producción (`admin1234` y `demo1234`, públicas en el repositorio).
- **Pasar WhatsApp a un número propio**: el número de prueba solo entrega a 5 destinatarios registrados. Requiere verificar el negocio, método de pago y consentimiento del paciente (`docs/DEPLOY.md`, sección 7.7).
- **Token de Meta:** vence el **19-dic-2026** si el negocio no está verificado. Rotarlo si alguna vez quedó visible. Rotar también la contraseña de Neon y el token de GitHub que se habían aplazado, y retirar las variables `TWILIO_*` de Render si siguen cargadas.
- **Dependencias con vulnerabilidades conocidas** (`npm audit --omit=dev`): todas con arreglo sin cambios mayores; ver el backlog.
- **Demos con médicos reales** (S6-04 a S6-08): bloqueadas por falta de candidatos.

El resto de lo pendiente está priorizado en `docs/qa/S6-10-backlog-v1.md`.
