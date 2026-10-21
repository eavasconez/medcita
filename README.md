# MedCita 🩺 — Agenda Médica Digital (MVP Beta)

MedCita es una plataforma diseñada para médicos independientes y clínicas pequeñas que buscan gestionar su agenda y reducir el ausentismo mediante recordatorios automáticos por WhatsApp y Email.

**Estado actual:** MVP técnico completo — desplegado y funcionando en producción (Render + Neon, sin costo). El Sprint 7 se cerró el 21-oct-2026: pruebas automatizadas con CI, migraciones de Prisma, recuperación y cambio de contraseña, límite de intentos de login, registro de auditoría y WhatsApp con plantillas de Meta, todo comprobado en el sitio desplegado (ver `docs/qa/S7-12-production-evidence.md`). Pendiente: validación de negocio con médicos piloto reales y pasar WhatsApp a un número propio (hoy usa el número de prueba de Meta, que solo admite 5 destinatarios).

## 🌐 Producción (en vivo)

- **App:** https://medcita-frontend.onrender.com
- **API:** https://medcita-backend.onrender.com

> Nota: el backend gratuito de Render se duerme tras ~15 min sin tráfico — la primera petición tras un rato inactivo puede tardar ~50s en responder mientras despierta. Hay un monitor de UptimeRobot pegándole a `/api/health` cada 5 min para minimizarlo.

## 🚀 Guía de Instalación Rápida (local)

Sigue estos pasos para tener el sistema funcionando en tu entorno local:

### 1. Iniciar Base de Datos (PostgreSQL)
Asegúrate de tener Docker instalado. Levanta el contenedor de la base de datos:
```bash
docker compose up -d
```

### 2. Configurar el Backend
Crea tu archivo de variables de entorno:
```bash
cd backend
cp .env.example .env
npm install
```
*(Opcional: edita `.env` con tus credenciales de Meta (o Twilio) para WhatsApp y de Brevo (o SendGrid) para correo, y así enviar mensajes reales. Sin ellas, el sistema corre en modo mock: solo registra el envío en la consola).*

### 3. Crear la Base de Datos con Prisma
Aplica las migraciones (el historial está en `backend/prisma/migrations/`; ya no se usa `db push`) y puebla la base con datos de prueba:
```bash
npx prisma migrate deploy
npx prisma db seed
```
*(Si tu base local ya existía de antes, creada con `db push`, `migrate deploy` se niega a correr con el error `P3005`: la solución, sin perder datos, está en `docs/TECHNICAL.md`, sección 7).*

### 4. Configurar el Frontend
Instala las dependencias de la interfaz de usuario:
```bash
cd ../frontend
npm install
```
*(Opcional: crea `frontend/.env` a partir de `.env.example` si quieres apuntar a un backend distinto al local — por defecto usa `http://localhost:5000`).*

### 5. Iniciar el Proyecto
Debes tener dos terminales abiertas:
- **Terminal 1 (Backend):** `cd backend && npm run dev`
- **Terminal 2 (Frontend):** `cd frontend && npm run dev`

---

## 🔑 Credenciales de Prueba

- **URL del Panel (local):** `http://localhost:5173`

| Rol | Email | Contraseña | Quién es |
|---|---|---|---|
| Admin | `admin@medcita.ec` | `admin1234` | Administrador de la clínica |
| Doctor | `demo@medcita.ec` | `demo1234` | Dr. Santiago Pérez — Medicina General |
| Doctor | `dra.torres@medcita.ec` | `demo1234` | Dra. Camila Torres — Pediatría |
| Doctor | `dr.mendoza@medcita.ec` | `demo1234` | Dr. Andrés Mendoza — Medicina Familiar |
| Admin (2.º consultorio) | `admin@clinicavida.ec` | `admin1234` | Clínica Vida: otro consultorio, no ve nada de los de arriba |
| Doctor (2.º consultorio) | `dra.vega@clinicavida.ec` | `demo1234` | Dra. Paula Vega — Ginecología |
| Operador de la plataforma | `plataforma@medcita.ec` | `admin1234` | Rol `superadmin`: solo `GET /api/platform/clinics` (la lista de consultorios y su tamaño) |

> **Altas e invitaciones (S8-02):** registrarse en `/register` pide el nombre del consultorio y envía un enlace de confirmación por correo; las demás personas se agregan desde **Manage Doctors → Invite User**. Sin proveedor de correo configurado, activa `LOG_PASSWORD_RESET_LINKS=true` en `backend/.env` y el enlace sale en la consola del backend.

> La app en producción tiene su propia copia de estos mismos datos de demo (sembrados en Neon). **Estas contraseñas están en este repositorio, que es público: cámbialas desde Ajustes → Update Password antes de cargar pacientes reales en producción.** También hay un **PDF de guía completa** descargable directo desde la pantalla de login (panel lateral): credenciales, qué probar según el rol, el flujo de una cita con el WhatsApp y el correo que recibe el paciente, y la configuración de WhatsApp con Meta paso a paso. Su fuente está en `docs/guide/` (cómo regenerarlo: `docs/TECHNICAL.md`).

## 🛠️ Tecnologías Utilizadas
- **Frontend:** React 19, Vite, Tailwind CSS, React Router, Lucide React, react-big-calendar, Recharts.
- **Backend:** Node.js, Express 5, JWT, Node-Cron, Helmet.
- **Base de Datos:** PostgreSQL, Prisma ORM (con migraciones).
- **Calidad:** Jest + supertest contra PostgreSQL real, colección de Postman y CI en GitHub Actions (`npm test` y `npm run lint` en cada Pull Request).
- **Notificaciones:**
  - WhatsApp: Meta Cloud API (preferido si hay credenciales) → Twilio (fallback) → mock.
  - Email: Brevo (preferido) → SendGrid (fallback) → mock.
- **Infraestructura de producción:** Render (Web Service + Static Site, free), Neon (Postgres, free), UptimeRobot (monitoreo, free) — sin tarjeta de crédito. Ver `docs/DEPLOY.md` para el runbook completo.

## 📱 Notificaciones de WhatsApp

**En producción** los mensajes salen por la **API de WhatsApp Cloud de Meta**, con dos plantillas aprobadas en español (`cita_confirmada` y `recordatorio_cita`). Meta solo deja que un negocio inicie una conversación con una plantilla aprobada, y así el paciente recibe el mensaje sin haberle escrito antes al número.

- **Número de prueba.** Hoy se usa el número de prueba gratuito de Meta, que solo entrega a **5 destinatarios registrados** en el panel de Meta. Para pacientes reales hace falta un número propio y la verificación del negocio (`docs/DEPLOY.md`, sección 7.7).
- **Token.** El token de usuario del sistema dura 60 días mientras el negocio no esté verificado; el actual vence el **19-dic-2026**. Al vencer, los envíos fallan con el error 190.
- **Probar un envío:** desde `backend/`, `npm run whatsapp:test -- +593XXXXXXXXX` (confirmación) o `... reminder` (recordatorio).
- **Guía paso a paso** para crear la cuenta, la app, las plantillas y el token: `docs/WHATSAPP_META_SETUP.md`. Variables de entorno y tabla de errores: `docs/DEPLOY.md`, sección 7.

**Orden de proveedores:** Meta (si hay `META_WHATSAPP_TOKEN` y `META_WHATSAPP_PHONE_NUMBER_ID`) → Twilio (si hay `TWILIO_*`) → mock. Solo se elige uno: si Meta responde con error, **no se intenta con Twilio**.

**Twilio (opcional, solo desarrollo).** Si no defines las variables de Meta, el backend usa el **Sandbox de Twilio**. Ahí el destinatario debe unirse una sola vez: agregar `+1 415 523 8886` a los contactos de WhatsApp y enviarle `join cotton-left`. La sesión del sandbox expira tras ~72 h sin actividad. En producción no se usa; se recomienda no cargar las variables `TWILIO_*` en Render.

### Funciones incluidas
- **Confirmación:** mensaje automático (WhatsApp + Email) al crear una cita.
- **Recordatorio 24h:** cron que corre cada hora y avisa una sola vez (`reminderSentAt`) de las citas `pending_approval`, `scheduled` y `confirmed` que ocurren en las próximas 24 horas, con la hora del consultorio (su zona horaria, `Clinic.timezone`).
- **Disparo manual:** `POST /api/tasks/reminders` (requiere rol admin/secretaria) — endpoint de backend para forzar el proceso de recordatorios sin esperar al cron; no tiene un botón dedicado en la interfaz todavía.

## 🔐 Seguridad y trazabilidad
- **Login:** límite de intentos fallidos por correo (5 en 15 min) y por IP, y recuperación de contraseña por correo con enlace de un solo uso (60 min).
- **Contraseña:** cada usuario puede cambiarla en *Settings*; al hacerlo, las sesiones anteriores dejan de valer.
- **Registro de auditoría:** lo que hacen administradores y secretarias con citas, pacientes y cuentas queda guardado en la tabla `AuditLog`, en la misma transacción que la acción. Lo consulta un administrador con `GET /api/admin/audit-log` (aún no tiene pantalla). Detalle en `docs/TECHNICAL.md`.
- **Salud:** `GET /api/health` responde `503` si la base de datos está inalcanzable o va atrasada respecto al código, y las pantallas muestran un error con reintento en vez de «sin datos».

## 📚 Documentación adicional

- **`docs/TECHNICAL.md`** — variables de entorno completas y endpoints de la API por módulo.
- **`docs/DEPLOY.md`** — cómo se desplegó a producción (Render + Neon + UptimeRobot), paso a paso, para poder rehacerlo, y el contrato de despliegue que vale para cualquier servicio.
- **`docs/WHATSAPP_META_SETUP.md`** — guía completa para configurar WhatsApp con Meta con tus propias cuentas.
- **`docs/qa/`** — reportes de testing, seguridad, performance y validación en producción de cada sprint, con capturas.
- **`docs/qa/S6-01-demo-script.md`** + **`docs/qa/S6-03-demo-deck.html`** — guión y deck para demos con médicos candidatos.
- **`docs/qa/S6-10-backlog-v1.md`** — backlog priorizado de lo que falta para una v1.0 real (actualizado al cierre del Sprint 7: lo resuelto, el incidente del 20-oct y lo pendiente).
- **`CHANGELOG.md`** — notas del release del Sprint 7: novedades, checklist de despliegue y lo que queda fuera del código.
- **`docs/qa/S7-12-production-evidence.md`** — evidencia de la ejecución en producción el 21-oct-2026, con capturas del flujo completo, el WhatsApp y el correo recibidos.

## 🚧 Lo que falta (según el plan original)

El MVP técnico está completo. Lo que queda es la **validación de negocio**: demos reales con médicos candidatos (usando el guión/deck de arriba), recopilar su feedback e intención de pago, y con esos resultados reales decidir si se sigue invirtiendo, se pivota, o se pausa.

Antes de abrir producción a pacientes reales, el backlog (`docs/qa/S6-10-backlog-v1.md`) marca como prioritario: cambiar las contraseñas de demo, configurar el *Health Check Path* de Render, actualizar las dependencias con vulnerabilidades conocidas y pasar WhatsApp a un número propio con el negocio verificado.

---
*Desarrollado para el MVP de MedCita Ecuador.*
