# MedCita — Documentación técnica

> Guía de referencia para levantar el proyecto localmente, entender las variables de entorno y consultar los endpoints principales del backend. Última actualización: 2026-07-23.

## 1. Requisitos previos

- Node.js 18+ y npm
- Docker + Docker Compose (para PostgreSQL local)

## 2. Setup del proyecto

```bash
# 1. Levantar PostgreSQL local
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env      # completar valores según la sección 3
npm install
npx prisma db push        # crea el esquema en la base de datos (no se usan migrations, solo db push)
npx prisma db seed        # carga médicos, pacientes y citas de ejemplo (ver sección 5)
npm run dev                # nodemon src/server.js -> http://localhost:5000

# 3. Frontend (en otra terminal)
cd frontend
npm install
npm run dev                # vite -> http://localhost:5173
```

El frontend asume que el backend corre en `http://localhost:5000` (la URL está hardcodeada en varios archivos de `frontend/src/pages/*.jsx`; sacarla a variable de entorno es un pendiente conocido, ver `docs/ESTADO_PROYECTO.md`).

## 3. Variables de entorno (`backend/.env`)

| Variable | Requerida | Descripción |
|---|---|---|
| `PORT` | No (default `5000`) | Puerto del servidor Express |
| `DATABASE_URL` | Sí | Connection string de PostgreSQL (`docker-compose.yml` expone `postgres:password123@localhost:5432/medcita`) |
| `JWT_SECRET` | Sí | Secreto para firmar JWT. El servidor **falla al arrancar** (`process.exit(1)`) si falta, tiene menos de 32 caracteres, o es uno de los valores de ejemplo conocidos (`demo_secret_key_123`, `replace_me_with_a_generated_secret`). Generar con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `FRONTEND_URL` | No (default `http://localhost:5173`) | Origen(es) permitido(s) por CORS. Acepta una lista separada por comas para múltiples orígenes |
| `META_WHATSAPP_TOKEN` / `META_WHATSAPP_PHONE_NUMBER_ID` | No | WhatsApp vía Meta Cloud API (proveedor preferido si están presentes) |
| `META_GRAPH_VERSION` | No (default `v21.0`) | Versión de la Graph API de Meta |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_WHATSAPP_NUMBER` | No | WhatsApp vía Twilio (fallback si no hay credenciales de Meta) |
| `BREVO_API_KEY` / `BREVO_FROM_EMAIL` | No | Email vía Brevo (proveedor preferido) |
| `SENDGRID_API_KEY` / `SENDGRID_FROM_EMAIL` | No | Email vía SendGrid (fallback si Brevo falla o no está configurado) |

Si ninguna credencial de WhatsApp/Email está presente, ambos servicios caen a modo **mock** (loguean el envío en consola en vez de enviarlo realmente) — útil para desarrollo local sin gastar créditos/cuotas.

## 4. Endpoints principales

Todas las rutas bajo `/api/*` (excepto `/api/auth/register` y `/api/auth/login`) requieren header `Authorization: Bearer <token>`. Roles: `doctor` (default), `secretary`, `admin`.

### Auth (`/api/auth`)
| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| POST | `/register` | Público | Crea un nuevo médico (rol `doctor` por defecto) |
| POST | `/login` | Público | Devuelve `{ token, user }` |
| GET | `/profile` | Autenticado | Perfil propio (nombre, especialidad, bio, dirección) |
| PUT | `/profile` | Autenticado | Actualiza el propio perfil |

### Citas (`/api/appointments`)
| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/` | Autenticado | Lista citas (admin/secretaria ven todas o filtran por `doctorId`; un doctor solo ve las suyas). Filtros: `date`, `patientId`, `doctorId`, `status` |
| POST | `/` | Autenticado | Crea cita (transacción serializable: valida disponibilidad, evita doble reserva, upsert de paciente). Envía confirmación por WhatsApp/Email |
| PUT | `/:id` | Autenticado (dueño, o admin/secretaria) | Actualiza fecha, hora, estado o notas |
| DELETE | `/:id` | Autenticado (dueño, o admin/secretaria) | Cancela/elimina la cita |

### Pacientes (`/api/patients`)
| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/` | Autenticado | Lista paginada (`page`, `pageSize`; máx. 100 por página), con búsqueda por `search` (nombre, teléfono, cédula) |
| POST | `/` | Autenticado | Crea o actualiza (upsert por teléfono) |
| PUT | `/:id` | Autenticado | Actualiza datos del paciente |

No existe `DELETE /api/patients/:id` (pendiente, ver `docs/ESTADO_PROYECTO.md`).

### Disponibilidad (`/api/availability`)
| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/` | Autenticado | Horario semanal del médico (o `doctorId` dado). Si no hay ninguno configurado, devuelve un fallback de demo (Lun-Vie 8:00-18:00) |
| GET | `/slots?date=YYYY-MM-DD` | Autenticado | Slots de 30 min disponibles/ocupados para una fecha |
| POST | `/` | Autenticado | Reemplaza el horario completo del médico (array de `{ dayOfWeek, startTime, endTime }`) |

### Administración (`/api/admin`)
| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/medicos` | admin, secretary | Lista médicos (filtro opcional `role`) |
| POST | `/medicos` | admin | Crea médico/secretaria |
| PUT | `/medicos/:id` | admin | Actualiza médico |
| DELETE | `/medicos/:id` | admin | Elimina médico (falla si tiene citas/disponibilidad asociadas) |
| GET | `/reports/appointments-by-doctor` | admin | Conteo de citas por médico |

### Tareas (`server.js`)
| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| POST | `/api/tasks/reminders` | admin, secretary | Dispara manualmente el recordatorio de 24h (normalmente corre por cron cada hora) |

## 5. Datos de demo

`backend/prisma/seed.js` (`npx prisma db seed`) crea:

- 1 cuenta **admin**: `admin@medcita.ec` / `admin1234`
- 3 médicos piloto (rol `doctor`), cada uno con horario Lun-Vie 8:00-18:00 y citas de ejemplo en distintos estados (`scheduled`, `confirmed`, `pending_approval`) repartidas en los próximos días:
  - `demo@medcita.ec` / `demo1234` — Dr. Santiago Pérez (Medicina General)
  - `dra.torres@medcita.ec` / `demo1234` — Dra. Camila Torres (Pediatría)
  - `dr.mendoza@medcita.ec` / `demo1234` — Dr. Andrés Mendoza (Medicina Familiar)
- Pacientes de ejemplo con teléfono/cédula/email realistas, listos para mostrar el flujo completo (crear cita → confirmación → recordatorio) en una demo.

Volver a correr `npx prisma db seed` **borra y recrea** médicos, pacientes, disponibilidad y citas — no usar contra datos reales.
