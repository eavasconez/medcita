# MedCita 🩺 — Agenda Médica Digital (MVP Beta)

MedCita es una plataforma diseñada para médicos independientes que buscan gestionar su agenda y reducir el ausentismo mediante recordatorios automáticos por WhatsApp.

## 🚀 Guía de Instalación Rápida (5 Pasos)

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
*(Opcional: Edita `.env` con tus credenciales de Twilio para enviar mensajes reales).*

### 3. Sincronizar Base de Datos con Prisma
Ejecuta las migraciones y puebla la base de datos con datos de prueba:
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

### 5. Iniciar el Proyecto
Debes tener dos terminales abiertas:
- **Terminal 1 (Backend):** `cd backend && npm run dev`
- **Terminal 2 (Frontend):** `cd frontend && npm run dev`

---

## 🔑 Credenciales de Prueba
- **URL del Panel:** `http://localhost:5173`
- **Usuario:** `demo@medcita.ec`
- **Contraseña:** `demo1234`

## 🛠️ Tecnologías Utilizadas
- **Frontend:** React.js, Vite, Tailwind CSS, Lucide React.
- **Backend:** Node.js, Express, JWT, Node-Cron.
- **Base de Datos:** PostgreSQL 15, Prisma ORM.
- **Notificaciones:** Twilio API (WhatsApp).

## 📱 Notificaciones de WhatsApp (Para la Demo)

Debido a que el proyecto usa el **Sandbox de Twilio**, los mensajes NO llegarán a cualquier número automáticamente. Para que un usuario nuevo pueda recibir notificaciones en su celular:

1.  **Unirse al Sandbox:** Debe agregar el número `+1 415 523 8886` a sus contactos.
2.  **Enviar Mensaje:** Debe enviar el mensaje `join cotton-left` por WhatsApp a ese número.
3.  **Probar:** Una vez reciba la confirmación de Twilio, ya puede agendar citas en MedCita para su número.

### Funciones incluidas:
*   **Confirmación:** Mensaje automático al momento de crear la cita.
*   **Recordatorios:** Proceso automático que busca citas próximas.
*   **Procesamiento Manual:** Botón **"Procesar Recordatorios"** en el Dashboard para disparar mensajes de citas de hoy/mañana durante la presentación.

---
*Desarrollado para el MVP de MedCita Ecuador.*