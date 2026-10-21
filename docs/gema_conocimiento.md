# 💎 Gema de Conocimiento: MedCita MVP Beta

Este documento resume la arquitectura, decisiones técnicas y flujos críticos de **MedCita**, una plataforma de agenda médica con notificaciones automáticas.

## 🏗️ Arquitectura del Sistema
- **Frontend:** React.js + Vite + Tailwind CSS.
- **Backend:** Node.js + Express.
- **Base de Datos:** PostgreSQL 15 gestionado mediante **Prisma ORM**.
- **Notificaciones:** WhatsApp con **Meta Cloud API** (plantillas aprobadas); Twilio como alternativa para desarrollo; correo con Brevo (SendGrid de respaldo).
- **Infraestructura:** Local con **Docker Compose**; producción en Render (backend y frontend) + Neon (PostgreSQL) + UptimeRobot (ver `docs/DEPLOY.md`).

## 📊 Modelo de Datos (Prisma)
Se definieron tres entidades principales con relaciones íntegras:
- `Doctor`: Gestión de perfil y autenticación (JWT + Bcrypt).
- `Patient`: Identificado de forma única por su **teléfono**. Incluye lógica de *upsert* para actualizar nombres automáticamente si el número ya existe.
- `Appointment`: Vincula médicos y pacientes con fecha, hora y estado.

## 📱 Integración con WhatsApp (Meta; Twilio opcional)
### Flujos de Mensajería:
1.  **Confirmación:** Mensaje instantáneo al crear una cita en `/api/appointments` (POST).
2.  **Recordatorios 24h:**
    - Proceso automático vía `node-cron` que corre cada hora.
    - Recuerda una sola vez (`reminderSentAt`) las citas `pending_approval`, `scheduled` y `confirmed` que ocurren en las próximas 24 horas, con la hora de la clínica.
    - Disparador manual por API: `POST /api/tasks/reminders` (admin o secretaria).

### Configuración Crítica:
- **Formato de Número:** Los números se formatean automáticamente con el prefijo `+` si el usuario lo omite.
- **Proveedor:** el backend usa uno solo: Meta si hay credenciales, si no Twilio, si no un mock. Con Meta se envían **plantillas aprobadas** (el paciente las recibe sin haber escrito antes); con el número de prueba solo reciben hasta 5 destinatarios registrados. Con Twilio sandbox, cada destinatario debe enviar `join [code]` al número de Twilio. Comparación y cambio de proveedor: `docs/DEPLOY.md`, sección 7.0.

## 🛠️ Notas de Implementación y Solución de Errores
- **Versión de Prisma:** Se forzó el uso de `@prisma/client@5.10.2` para asegurar compatibilidad con el entorno Node v22.3.0 de la máquina.
- **Persistencia:** Se eliminó la dependencia de LowDB (archivos JSON) en favor de PostgreSQL para evitar bucles infinitos de reinicio con Nodemon al escribir en disco.
- **Seguridad:** Middleware de autenticación que consulta al usuario en cada petición e inyecta `req.doctorId`, `req.userRole` y `req.userName` desde el token JWT; rechaza tokens anteriores a un cambio de contraseña. Límite de intentos de login y registro de auditoría (`AuditLog`) de lo que hacen administradores y secretarias.
- **Salud:** `/api/health` responde 503 si la base está inalcanzable o atrasada respecto al código (comprobación de esquema).

## 🚀 Guía de Reseteo Rápido
1. `docker compose down -v` (Borra BD y volumen).
2. `docker compose up -d` (Reinicia BD limpia).
3. `npx prisma migrate deploy` (Crea las tablas aplicando las migraciones; ya no se usa `db push`).
4. `npx prisma db seed` (Carga médico y pacientes de prueba).

---
*Esta gema sirve como punto de partida para futuras fases de escalabilidad (múltiples sucursales, pagos o historia clínica).*
