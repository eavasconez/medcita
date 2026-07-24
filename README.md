# MedCita 🩺 — Agenda Médica Digital (MVP Beta)

MedCita es una plataforma diseñada para médicos independientes y clínicas pequeñas que buscan gestionar su agenda y reducir el ausentismo mediante recordatorios automáticos por WhatsApp y Email.

**Estado actual:** MVP técnico completo — desplegado y funcionando en producción (Render + Neon, sin costo). Pendiente: validación de negocio con médicos piloto reales.

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
*(Opcional: edita `.env` con tus credenciales de Twilio/Meta/Brevo/SendGrid para enviar mensajes reales — sin ellas, el sistema corre en modo mock).*

### 3. Sincronizar Base de Datos con Prisma
Sincroniza el esquema (no se usan migrations, solo `db push`) y puebla la base con datos de prueba:
```bash
npx prisma db push
npx prisma db seed
```

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

> La app en producción tiene su propia copia de estos mismos datos de demo (sembrados en Neon). También hay un **PDF de guía completa** descargable directo desde la pantalla de login (panel lateral) con credenciales, qué probar según el rol, y el flujo paso a paso con capturas.

## 🛠️ Tecnologías Utilizadas
- **Frontend:** React 19, Vite, Tailwind CSS, React Router, Lucide React, react-big-calendar, Recharts.
- **Backend:** Node.js, Express 5, JWT, Node-Cron, Helmet.
- **Base de Datos:** PostgreSQL, Prisma ORM.
- **Notificaciones:**
  - WhatsApp: Meta Cloud API (preferido si hay credenciales) → Twilio (fallback) → mock.
  - Email: Brevo (preferido) → SendGrid (fallback) → mock.
- **Infraestructura de producción:** Render (Web Service + Static Site, free), Neon (Postgres, free), UptimeRobot (monitoreo, free) — sin tarjeta de crédito. Ver `docs/DEPLOY.md` para el runbook completo.

## 📱 Notificaciones de WhatsApp (Sandbox de Twilio)

Mientras el proyecto use el **Sandbox de Twilio** (no un número de WhatsApp Business real), los mensajes NO llegan a ningún número hasta que ese número se una al sandbox una sola vez:

1. **Unirse al Sandbox:** agregar el número `+1 415 523 8886` a los contactos de WhatsApp.
2. **Enviar mensaje:** enviarle por WhatsApp, tal cual, `join cotton-left`.
3. **Probar:** tras la confirmación automática de Twilio, ese número ya puede recibir notificaciones reales de MedCita.

> La sesión del sandbox expira tras ~72h sin actividad — si dejó de llegar, hay que volver a enviar `join cotton-left`.

### Funciones incluidas
- **Confirmación:** mensaje automático (WhatsApp + Email) al crear una cita.
- **Recordatorio 24h:** cron que corre cada hora, buscando citas a punto de cumplir ~24h antes de su horario (solo para citas en estado `scheduled` — ver pendiente abajo).
- **Disparo manual:** `POST /api/tasks/reminders` (requiere rol admin/secretaria) — endpoint de backend para forzar el proceso de recordatorios sin esperar al cron; no tiene un botón dedicado en la interfaz todavía.

## 📚 Documentación adicional

- **`docs/TECHNICAL.md`** — variables de entorno completas y endpoints de la API por módulo.
- **`docs/DEPLOY.md`** — cómo se desplegó a producción (Render + Neon + UptimeRobot), paso a paso, para poder rehacerlo.
- **`docs/qa/`** — reportes de testing, seguridad, performance y validación en producción de cada sprint, con capturas.
- **`docs/qa/S6-01-demo-script.md`** + **`docs/qa/S6-03-demo-deck.html`** — guión y deck para demos con médicos candidatos.
- **`docs/qa/S6-10-backlog-v1.md`** — backlog priorizado de lo que falta para una v1.0 real (0% de tests automatizados, recordatorios que no cubren citas `pending_approval`, sin rate limiting en login, entre otros).

## 🚧 Lo que falta (según el plan original)

El MVP técnico está completo. Lo que queda es la **validación de negocio**: demos reales con médicos candidatos (usando el guión/deck de arriba), recopilar su feedback e intención de pago, y con esos resultados reales decidir si se sigue invirtiendo, se pivota, o se pausa.

---
*Desarrollado para el MVP de MedCita Ecuador.*
