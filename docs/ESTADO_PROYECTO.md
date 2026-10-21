# MedCita — Estado del Proyecto

> Documento de referencia con el estado real del proyecto (verificado en código), no solo lo que describen el README o los documentos de planificación. Última actualización: 2026-07-15.

---

## 1. Resumen ejecutivo

**MedCita** es una plataforma web (MVP Beta) pensada para médicos independientes y clínicas pequeñas en Ecuador. Permite gestionar la agenda de citas y reducir el ausentismo de pacientes ("no-shows") mediante notificaciones automáticas por **WhatsApp** y **Email**.

- **Problema que resuelve:** en Ecuador se estima que 30,000+ médicos independientes gestionan sus citas con agendas físicas, llamadas o grupos de WhatsApp, perdiendo hasta 2 horas diarias en coordinación manual, con una tasa de inasistencia que supera el 25%.
- **Propuesta de valor:** recordatorios automáticos por WhatsApp sin intervención manual, configuración en 10 minutos sin instalaciones, precio accesible ($15-30/mes) frente a sistemas HIS que cuestan $200+/mes.
- **Público objetivo:** médicos generales y especialistas con consulta propia; secundario: odontólogos, psicólogos, nutricionistas.
- **Estado actual:** MVP funcional **solo en entorno local** (Docker + npm run dev). No ha sido desplegado a producción ni validado con médicos reales todavía.

---

## 2. Stack tecnológico

| Capa | Tecnología | Detalle |
|---|---|---|
| **Frontend** | React 19 + Vite 5 | SPA, JavaScript/JSX puro (sin TypeScript) |
| | Tailwind CSS 3.4 | Estilos + PostCSS + Autoprefixer |
| | react-router-dom 7 | Enrutamiento cliente |
| | react-big-calendar | Calendario de citas (con soporte drag-and-drop) |
| | recharts | Gráficos de analítica clínica |
| | axios | Llamadas HTTP al backend |
| | lucide-react | Iconografía |
| | date-fns, lodash | Utilidades de fecha y debounce |
| **Backend** | Node.js + Express 5 | API REST (CommonJS) |
| | Prisma ORM 5 | Capa de datos activa (ver sección de deuda técnica sobre restos de LowDB/Sequelize) |
| | PostgreSQL 15 | Base de datos |
| | jsonwebtoken + bcryptjs | Autenticación JWT + hash de contraseñas |
| | Twilio | Envío de WhatsApp |
| | @sendgrid/mail | Envío de Email |
| | node-cron | Job diario de recordatorios |
| | helmet, cors, morgan | Middleware de seguridad/logging |
| **Infraestructura** | Docker Compose | Contenedor `postgres:15-alpine` (`medcita-db`, puerto 5432) |
| **Dev tools** | ESLint 9 (flat config), nodemon | Linting frontend, hot-reload backend |

No hay librería de i18n instalada (ni `i18next` ni similares) — la "localización a inglés" es texto hardcodeado directamente en el JSX, no un sistema de traducción real.

---

## 3. Arquitectura y estructura de carpetas

Monorepo con dos aplicaciones independientes (sin workspace compartido) más un contenedor de base de datos:

```
medcita/
├── README.md              # Guía de instalación, credenciales, stack
├── MANUAL_DEMO.md         # Guion de demo paso a paso
├── docker-compose.yml     # Contenedor Postgres 15
├── docs/
│   ├── APP_FLOW.md                        # Roles, flujo de citas (diagrama mermaid)
│   ├── gema_conocimiento.md               # Resumen de arquitectura
│   ├── MedCita_Plan_Completo.xlsx         # Plan de sprints original (ver sección 8)
│   └── AppNova_ Project Innovation.docx   # Caso de negocio / venture sheet
├── backend/
│   ├── .env / .env.example    # PORT, DATABASE_URL, JWT_SECRET, Twilio, SendGrid
│   ├── prisma/
│   │   ├── schema.prisma      # Modelos de datos
│   │   └── seed.js            # Seed: admin, doctor demo, 4 pacientes, 4 citas de hoy
│   └── src/
│       ├── server.js                  # Entry point, monta rutas y cron
│       ├── config/prisma.js           # Cliente Prisma (capa activa)
│       ├── middleware/auth.js         # Verifica JWT → req.doctorId, req.userRole
│       ├── middleware/admin.js        # Guard solo-admin
│       ├── routes/
│       │   ├── auth.js, appointments.js, patients.js, availability.js, admin.js
│       ├── services/notificationService.js  # WhatsApp + Email (con fallback MOCK)
│       └── tasks/reminderTask.js             # Cron diario de recordatorios
└── frontend/
    ├── vite.config.js, tailwind.config.js, eslint.config.js
    └── src/
        ├── App.jsx             # AuthContext + rutas (API_URL hardcodeada a localhost:5000)
        ├── components/         # Layout.jsx, Sidebar.jsx
        └── pages/              # Login, Register, Dashboard, Patients, Availability,
                                 # AdminDoctors, Settings, Reports
```

No hay una carpeta de componentes reutilizables más allá de `Layout`/`Sidebar`: modales, toasts y tarjetas están duplicados dentro de cada página.

---

## 4. Modelo de datos (Prisma)

Cuatro modelos en `backend/prisma/schema.prisma`:

- **Doctor** — actúa como tabla de usuarios para los 3 roles (`admin`, `secretary`, `doctor`). Campos: id, name, email (único), password (hash), role.
- **Patient** — name, phone (único, formato WhatsApp), email (opcional), cedula (opcional, único).
- **Availability** — dayOfWeek, startTime, endTime por doctor; único por (doctorId, dayOfWeek, startTime).
- **Appointment** — doctorId, patientId, status (default `scheduled`), notes. **Nota importante:** `date` y `time` están guardados como **strings**, no como `DateTime`.

---

## 5. Funcionalidades implementadas (por módulo)

| Módulo | Estado | Detalle |
|---|---|---|
| **Autenticación** | ✅ Completo | Login/registro con JWT (expira en 24h), passwords con bcrypt. El frontend no re-verifica el token contra el backend al recargar — confía en lo guardado en `localStorage`. |
| **RBAC** (admin/secretaria/doctor) | ✅ Completo | Aplicado consistentemente en frontend (rutas, menú) y backend (middleware `admin.js`, lógica `isSpecialRole` en varias rutas). Detalle menor: `DELETE /appointments/:id` no reconoce roles especiales, a diferencia del `PUT`. |
| **Citas y calendario** | ✅ Completo | Dashboard con `react-big-calendar`, drag-and-drop, modal de reserva en 3 pasos, chequeo de disponibilidad y de citas duplicadas, slots pasados bloqueados visualmente. |
| **Pacientes** | ✅ Completo (sin delete) | CRUD de creación/edición/búsqueda por nombre, teléfono o cédula. No existe endpoint de borrado de paciente. |
| **Gestión de usuarios/médicos** | ✅ Completo | Solo admin: crear/editar/eliminar usuarios con rol, con protección contra auto-eliminación. |
| **Disponibilidad/horarios** | ✅ Completo | Configuración semanal de horarios, cálculo de slots de 30 min, fallback Lun-Vie 8-18h si no hay configuración. |
| **Analítica clínica (Reports)** | ✅ Completo pero mínimo | Un solo reporte: citas por médico (gráfico de barras + circular). Sin filtro de fechas ni desglose por estado. |
| **Configuración (Settings)** | ⚠️ **Stub, no funcional** | El formulario de "Información Personal" no tiene `onSubmit`; el botón "Guardar" es decorativo. La sección de seguridad muestra el texto fijo "temporalmente bloqueada para cuentas demo". |
| **Notificaciones WhatsApp/Email** | ⚠️ **Funcional con fallback MOCK** | Si no hay credenciales reales de Twilio/SendGrid, el sistema simula el envío y responde éxito igualmente (`[MOCK]` en logs). Revisa tu `.env` para confirmar si tienes credenciales reales activas. Los mensajes siguen redactados en español. |
| **Localización a inglés** | ⚠️ **Parcial** | No hay librería i18n; es texto en inglés hardcodeado en el JSX. Quedan restos en español: mensajes de notificación, algunos errores de backend (`appointments.js`), un toast en `Dashboard.jsx`, la etiqueta "citas" en `Reports.jsx`, y el endpoint `/api/admin/medicos`. |

---

## 6. Cómo correr el proyecto y credenciales de prueba

```bash
# 1. Levantar la base de datos
docker compose up -d

# 2. Backend
cd backend && cp .env.example .env && npm install
npx prisma db push
npx prisma db seed
npm run dev        # http://localhost:5000

# 3. Frontend (otra terminal)
cd frontend && npm install
npm run dev         # http://localhost:5173
```

| Rol | Email | Contraseña |
|---|---|---|
| Administrador | `admin@medcita.ec` | `admin1234` |
| Médico (demo) | `demo@medcita.ec` | `demo1234` |

> El seed crea automáticamente 4 citas de ejemplo para el día en que se ejecuta (asignadas al médico demo) para que el calendario no se vea vacío al probar la app — no son citas reales agendadas por el usuario.

---

## 7. Pendientes y deuda técnica

### Alta prioridad
- **Settings sin persistencia real** — el formulario de perfil no guarda nada.
- **Notificaciones en modo mock por defecto** — sin credenciales reales, no se envía nada de verdad pese a que la documentación promete "entrega en tiempo real".
- **URL de API hardcodeada** (`http://localhost:5000/api`) repetida en ~20 lugares del frontend — bloquea cualquier despliegue sin tocar código.
- **Manejo de errores inseguro** — todas las rutas backend devuelven `err.message` crudo al cliente (riesgo de fuga de información).
- **CORS completamente abierto** (`app.use(cors())` sin restricción de origen).

### Media prioridad
- **Estados de cita inconsistentes**: se crean como `pending_approval`, el seed usa `scheduled`/`confirmed`, y el cron de recordatorios solo busca `scheduled` — las citas recién creadas no reciben recordatorio automático.
- **Falta endpoint DELETE de pacientes.**
- **`DELETE /appointments/:id`** no soporta roles especiales (admin/secretaria), a diferencia de `PUT`.
- **Localización incompleta** (ver sección 5).
- **Endpoints admin en español** (`/api/admin/medicos`), inconsistente con el resto de la API en inglés.

### Baja prioridad / limpieza
- **Código muerto**: `backend/src/config/db.js` (adaptador LowDB, de la primera versión del backend), `backend/src/models/index.js` (modelos Sequelize **rotos** — `sequelize` ni siquiera está instalado como dependencia), `backend/src/utils/sms.js` (duplicado de `notificationService.js`), `backend/database.json` (dato obsoleto de LowDB).
- **Dependencias no usadas**: `lowdb`, referencia a `sequelize`, `uuid`.
- **Scripts ad-hoc de desarrollo** (`appointment-test.js`, `fill-week.js`, `fill-today.js`) con UUIDs de médico hardcodeados — no son tests automatizados.

### Sin automatización de pruebas
No existe ningún framework de testing (Jest/Vitest/Mocha) ni script `test` en ningún `package.json`. Cobertura: 0%.

### Seguridad
- `JWT_SECRET` de ejemplo trivial (`demo_secret_key_123`) — debe reemplazarse antes de cualquier uso real.
- Revisar que las credenciales reales de Twilio/SendGrid en el `.env` local (correctamente ignorado por git) se roten antes de cualquier despliegue público.

---

## 8. Plan original vs. estado real (Sprint 0 → Sprint 6)

`docs/MedCita_Plan_Completo.xlsx` contiene el plan de sprints original del equipo: 6 semanas hábiles, 2 desarrolladores, del **jueves 12 de marzo de 2026** al **miércoles 22 de abril de 2026**, 240 horas totales en 7 fases con ~84 tareas puntuales. `docs/AppNova_ Project Innovation.docx` contiene el caso de negocio (problema, propuesta de valor, costos estimados de $4,500-5,500 USD para el MVP, y KPIs de validación con médicos piloto).

| Sprint | Objetivo | Estado |
|---|---|---|
| **Sprint 0** — Setup & Arquitectura | Repo, stack base, schema, convenciones | ✅ Hecho |
| **Sprint 1** — Backend Core | Auth JWT, CRUD citas/pacientes, horarios | ✅ Hecho (falta formalizar pruebas Postman) |
| **Sprint 2** — Frontend | Login, dashboard, calendario, CRUD UI | ✅ Hecho en su mayoría (manejo de errores parcial) |
| **Sprint 3** — Integraciones WhatsApp + Email | Confirmaciones y recordatorios automáticos | ⚠️ Código completo, pero en modo MOCK sin credenciales reales verificadas end-to-end |
| **Sprint 4** — QA, Testing & Ajustes | Testing, seguridad, performance, checklist pre-deploy | ❌ Pendiente casi en su totalidad |
| **Sprint 5** — Deploy & Validación con Pilotos | Servidor, dominio, SSL, deploy, médicos piloto | ❌ Pendiente en su totalidad |
| **Sprint 6** — Demo Oficial & Cierre MVP | Demos, KPIs, backlog v1.0 | ❌ Pendiente en su totalidad |

**Conclusión:** el desarrollo técnico (Sprints 0-3) está construido en un ~85-90%, con matices de robustez pendientes. Lo que falta por completo es todo lo relacionado con **calidad/seguridad**, **despliegue a producción** y **validación de negocio con médicos reales** — coincide con que el proyecto "sigue en fase de inicio": el MVP funciona técnicamente en local, pero no ha salido de ahí.

---

## 9. Listado de tareas pendientes (checklist)

### QA y hardening (Sprint 4 pendiente)
- [ ] Agregar framework de testing (Jest/Vitest) con pruebas de los endpoints críticos (auth, citas, disponibilidad)
- [ ] Testing manual de happy path y casos de error en navegadores principales y móvil
- [ ] Sacar la URL de API hardcodeada (`localhost:5000`) a variable de entorno en el frontend
- [ ] Sanear mensajes de error del backend (no exponer `err.message` crudo al cliente)
- [ ] Restringir CORS a orígenes conocidos
- [ ] Reemplazar `JWT_SECRET` de ejemplo por uno robusto antes de producción
- [ ] Revisar/optimizar performance básica (lazy loading, queries Prisma)
- [ ] Limpiar código muerto: `config/db.js` (LowDB), `models/index.js` (Sequelize roto), `utils/sms.js`, `database.json`, dependencias no usadas (`lowdb`, `uuid`, referencia a `sequelize`)
- [ ] Unificar estados de cita (`pending_approval` vs `scheduled` vs `confirmed`) para que el cron de recordatorios los cubra a todos
- [ ] Completar o remover el stub de la página Settings (guardar cambios, sección de seguridad)
- [ ] Terminar la localización a inglés (mensajes de WhatsApp/Email, errores backend, endpoint `/api/admin/medicos`)

### Despliegue (Sprint 5 pendiente)
- [ ] Levantar servidor de producción (DigitalOcean u otro), Nginx, dominio/DNS, SSL
- [ ] Desplegar backend con PM2 y frontend (build) detrás de Nginx
- [ ] Migrar base de datos a producción y correr smoke test end-to-end
- [ ] Confirmar que las credenciales reales de Twilio/SendGrid están activas y probar envío real

### Validación de negocio (Sprint 6 pendiente)
- [ ] Onboarding con 2-3 médicos piloto reales y recopilar feedback (NPS, usabilidad)
- [ ] Preparar guion/video/deck de demo
- [ ] Ejecutar demos con médicos candidatos y medir intención de pago (KPI: 5 médicos)
- [ ] Documentar resultados y crear backlog priorizado para v1.0
