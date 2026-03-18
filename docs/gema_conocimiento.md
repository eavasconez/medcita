# 💎 Gema de Conocimiento: MedCita MVP Beta

Este documento resume la arquitectura, decisiones técnicas y flujos críticos de **MedCita**, una plataforma de agenda médica con notificaciones automáticas.

## 🏗️ Arquitectura del Sistema
- **Frontend:** React.js + Vite + Tailwind CSS.
- **Backend:** Node.js + Express.
- **Base de Datos:** PostgreSQL 15 gestionado mediante **Prisma ORM**.
- **Notificaciones:** Integración con **Twilio API** para mensajes de WhatsApp.
- **Infraestructura:** Despliegue local mediante **Docker Compose**.

## 📊 Modelo de Datos (Prisma)
Se definieron tres entidades principales con relaciones íntegras:
- `Doctor`: Gestión de perfil y autenticación (JWT + Bcrypt).
- `Patient`: Identificado de forma única por su **teléfono**. Incluye lógica de *upsert* para actualizar nombres automáticamente si el número ya existe.
- `Appointment`: Vincula médicos y pacientes con fecha, hora y estado.

## 📱 Integración con WhatsApp (Twilio)
### Flujos de Mensajería:
1.  **Confirmación:** Mensaje instantáneo al crear una cita en `/api/appointments` (POST).
2.  **Recordatorios 24h:** 
    - Proceso automático vía `node-cron` que corre diariamente.
    - Buscador de citas para "hoy" y "mañana" (optimizado para demos).
    - Opción de disparador manual desde el frontend a través de `/api/tasks/reminders`.

### Configuración Crítica:
- **Formato de Número:** Los números se formatean automáticamente con el prefijo `+` si el usuario lo omite.
- **Sandbox:** Requiere activación previa mediante el mensaje `join [code]` al número de Twilio.

## 🛠️ Notas de Implementación y Solución de Errores
- **Versión de Prisma:** Se forzó el uso de `@prisma/client@5.10.2` para asegurar compatibilidad con el entorno Node v22.3.0 de la máquina.
- **Persistencia:** Se eliminó la dependencia de LowDB (archivos JSON) en favor de PostgreSQL para evitar bucles infinitos de reinicio con Nodemon al escribir en disco.
- **Seguridad:** Middleware de autenticación que inyecta `req.doctorId` desde el token JWT para filtrar citas propiedad del médico logueado.

## 🚀 Guía de Reseteo Rápido
1. `docker compose down -v` (Borra BD y volumen).
2. `docker compose up -d` (Reinicia BD limpia).
3. `npx prisma db push` (Crea tablas).
4. `npx prisma db seed` (Carga médico y pacientes de prueba).

---
*Esta gema sirve como punto de partida para futuras fases de escalabilidad (múltiples sucursales, pagos o historia clínica).*
