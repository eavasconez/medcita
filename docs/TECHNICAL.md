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
npx prisma migrate deploy # crea las tablas aplicando prisma/migrations (ver sección 7; ya no se usa db push)
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
| `DATABASE_URL` | Sí | Connection string de PostgreSQL (`docker-compose.yml` expone `postgres:password123@localhost:5432/medcita`). Con Neon, la **directa** (host sin `-pooler`): `prisma migrate deploy` no funciona bien a través del pooler |
| `JWT_SECRET` | Sí | Secreto para firmar JWT. El servidor **falla al arrancar** (`process.exit(1)`) si falta, tiene menos de 32 caracteres, o es uno de los valores de ejemplo conocidos (`demo_secret_key_123`, `replace_me_with_a_generated_secret`). Generar con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `FRONTEND_URL` | No (default `http://localhost:5173`) | Origen(es) permitido(s) por CORS. Acepta una lista separada por comas para múltiples orígenes |
| `TRUST_PROXY` | No (default `false`; `2` en Render) | Número de proxies inversos delante de la app, para leer la IP real del cliente en los límites de intentos por IP. Nunca `true` (permite falsificar la IP). En Render, donde `RENDER=true`, el default es `2` (Cloudflare + balanceador de Render). Se verifica con `GET /api/admin/client-ip` |
| `LOG_PASSWORD_RESET_LINKS` | No (solo desarrollo) | Con `true`, imprime en consola el enlace de recuperación de contraseña (útil sin proveedor de email). **Nunca activarlo en producción**: un enlace en los logs es una credencial válida por 1 hora |
| `CLINIC_UTC_OFFSET_MINUTES` | No (default `-300`, Ecuador continental UTC-5) | Desfase horario de la clínica en minutos. Las citas guardan `date`/`time` como texto local sin zona horaria; el cron de recordatorios los interpreta con este desfase en lugar de la zona del servidor (Render corre en UTC) |
| `TEST_DATABASE_URL` | Solo para `npm test` | Base de datos **exclusiva para pruebas**. Su nombre debe terminar en `_test` o la suite se niega a correr (borra todas las tablas entre pruebas). Nunca se usa `DATABASE_URL`. Ver sección 6 |
| `META_WHATSAPP_TOKEN` / `META_WHATSAPP_PHONE_NUMBER_ID` | No | WhatsApp vía Meta Cloud API (proveedor preferido si están presentes). La confirmación y el recordatorio se envían como **plantillas aprobadas** (guía completa en `docs/DEPLOY.md`, sección 7) |
| `META_WHATSAPP_TEMPLATE_CONFIRMATION` / `META_WHATSAPP_TEMPLATE_REMINDER` | No (defaults `cita_confirmada` / `recordatorio_cita`) | Nombres de las plantillas registradas en Meta |
| `META_WHATSAPP_TEMPLATE_LANGUAGE` | No (default `es`) | Código de idioma de las plantillas |
| `META_GRAPH_VERSION` | No (default `v21.0`) | Versión de la Graph API de Meta |
| `META_GRAPH_BASE_URL` | No (default `https://graph.facebook.com`) | Solo para pruebas locales contra una Graph API falsa |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_WHATSAPP_NUMBER` | No | WhatsApp vía Twilio (fallback si no hay credenciales de Meta) |
| `BREVO_API_KEY` / `BREVO_FROM_EMAIL` | No | Email vía Brevo (proveedor preferido) |
| `SENDGRID_API_KEY` / `SENDGRID_FROM_EMAIL` | No | Email vía SendGrid (fallback si Brevo falla o no está configurado) |

Con Twilio o en modo mock, el WhatsApp es el mismo texto de la plantilla, ya completado (`backend/src/services/whatsappTemplates.js` es la única fuente de esos textos). `npm run whatsapp:test -- +593…` envía un mensaje de muestra con el proveedor configurado para comprobar la instalación.

Si ninguna credencial de WhatsApp/Email está presente, ambos servicios caen a modo **mock** (loguean el envío en consola en vez de enviarlo realmente) — útil para desarrollo local sin gastar créditos/cuotas.

## 4. Endpoints principales

Todas las rutas bajo `/api/*` (excepto `/api/auth/register` y `/api/auth/login`) requieren header `Authorization: Bearer <token>`. Roles: `doctor` (default), `secretary`, `admin`.

### Auth (`/api/auth`)

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| POST | `/register` | Público | Crea un nuevo médico (rol `doctor` por defecto) |
| POST | `/login` | Público | Devuelve `{ token, user }`. Limitado: tras 5 intentos fallidos por correo (o 20 por IP) en 15 min responde `429` (ver "Límite de intentos") |
| POST | `/forgot-password` | Público | Body `{ email }`. Responde siempre `200` con el mismo mensaje, exista o no la cuenta, y envía por email un enlace de recuperación si existe (ver "Recuperación de contraseña"). Limitado |
| POST | `/reset-password` | Público | Body `{ token, password }`. Cambia la contraseña con el token del enlace (un solo uso, válido 60 min). Token inválido, vencido o ya usado → `400 { error, code: "INVALID_RESET_LINK" }` (un único mensaje para los tres casos) |
| POST | `/change-password` | Autenticado | Body `{ currentPassword, newPassword }`. Cambia la contraseña de la sesión actual y devuelve `{ message, token, user }` con un token nuevo (las demás sesiones dejan de valer, ver "Sesiones y cambio de contraseña"). `400` si falta la actual, la nueva tiene menos de 6 caracteres o es igual a la actual; `403` si la contraseña actual es incorrecta (no es `401`: el frontend lo toma como sesión vencida). Limitado |
| GET | `/profile` | Autenticado | Perfil propio (nombre, especialidad, bio, dirección) |
| PUT | `/profile` | Autenticado | Actualiza el propio perfil |

### Citas (`/api/appointments`)

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/` | Autenticado | Lista **paginada** de citas (admin/secretaria ven todas o filtran por `doctorId`; un doctor solo ve las suyas). Filtros: `date`, `from` y `to` (rango inclusive `YYYY-MM-DD`), `patientId`, `doctorId`, `status`. Paginación: `page` (desde 1) y `pageSize` (por defecto 100, máx. 500). Responde `{ appointments, total, page, pageSize, totalPages }`. Las citas **canceladas no aparecen** salvo con `status=cancelled` |
| GET | `/stats` | Autenticado | Números del dashboard calculados en la base: `{ total, positive, cancelled, patients }` (`positive` = confirmadas o completadas; `total` y `patients` no cuentan las canceladas). Mismas reglas de visibilidad que la lista (`doctorId` para admin/secretaria) |
| POST | `/` | Autenticado | Crea cita (transacción serializable: valida disponibilidad, evita doble reserva, upsert de paciente). Envía confirmación por WhatsApp/Email |
| PUT | `/:id` | Autenticado (dueño, o admin/secretaria) | Actualiza fecha, hora, estado o notas. Si la cita **cambia de horario** o se **reactiva** (de `cancelled` a otro estado) pasa por las mismas reglas que al agendar, dentro de una transacción serializable: `400` si el médico no atiende a esa hora o si la nueva hora ya pasó (salvo citas `completed`, para corregir el registro); `409` si otra cita activa del médico ya ocupa ese horario. Las reglas se aplican al médico dueño de la cita, no a quien edita. Cambiar solo estado o notas no revisa el horario, y cancelar tampoco |
| DELETE | `/:id` | Autenticado (dueño, o admin/secretaria) | **Cancela** la cita: la deja con `status: "cancelled"` (no se borra, para conservar historial y estadísticas) y libera el horario. Repetirlo da el mismo resultado. Responde `{ message, appointment }` |

El calendario del frontend pide solo el rango de fechas que está mostrando (semana, mes, día o los 30 días de la agenda) y sigue las páginas hasta completarlo; los KPIs salen de `/stats`.

### Pacientes (`/api/patients`)

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/` | Autenticado | Lista paginada (`page`, `pageSize`; máx. 100 por página), con búsqueda por `search` (nombre, teléfono, cédula) |
| POST | `/` | Autenticado | Crea o actualiza (upsert por teléfono) |
| PUT | `/:id` | Autenticado | Actualiza datos del paciente |
| DELETE | `/:id` | Autenticado | Elimina un paciente **sin citas** (pensado para registros creados por error). Con cualquier cita —activa, cancelada o completada— responde `409` y lo conserva, porque ese historial es suyo; el mensaje distingue «tiene citas activas, cancélalas primero» de «tiene historial». `404` si no existe |

### Disponibilidad (`/api/availability`)

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/` | Autenticado | Horario semanal del médico (o `doctorId` dado). Si no hay ninguno configurado, devuelve un fallback de demo (Lun-Vie 8:00-18:00) |
| GET | `/slots?date=YYYY-MM-DD` | Autenticado | Slots de 30 min disponibles/ocupados para una fecha |
| POST | `/` | Autenticado | Reemplaza el horario completo del médico (array de `{ dayOfWeek, startTime, endTime }`) |

### Administración (`/api/admin`)

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/doctors` | admin, secretary | Lista médicos (filtro opcional `role`) |
| POST | `/doctors` | admin | Crea médico/secretaria |
| PUT | `/doctors/:id` | admin | Actualiza médico |
| DELETE | `/doctors/:id` | admin | Elimina médico (falla si tiene citas, aunque estén canceladas, o disponibilidad asociadas) |
| GET | `/reports/appointments-by-doctor` | admin | Conteo de citas por médico (sin las canceladas) |
| GET | `/client-ip` | admin | Diagnóstico de `TRUST_PROXY`: devuelve `{ ip, forwardedFor, trustProxy }`; `ip` debe ser tu IP pública |

`/api/admin/medicos` es el **nombre anterior** de `/api/admin/doctors`. Sigue respondiendo igual (mismos métodos y permisos) como alias temporal para clientes que no se hayan actualizado, por ejemplo un frontend viejo en caché mientras el backend ya está desplegado, y sus respuestas llevan el header `Deprecation: true`. Está pensado para eliminarse más adelante.

### Tareas (`server.js`)

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| POST | `/api/tasks/reminders` | admin, secretary | Dispara manualmente el recordatorio de 24h (normalmente corre por cron cada hora). Recuerda una sola vez (`Appointment.reminderSentAt`) a las citas `pending_approval`, `scheduled` o `confirmed` que ocurren en las próximas 24h; si ningún canal entrega, se reintenta en la siguiente corrida |

### Límite de intentos (rate limiting)

| Endpoint | Qué cuenta | Límite |
|---|---|---|
| `POST /api/auth/login` | Intentos **fallidos** (401), por correo | 5 cada 15 min |
| `POST /api/auth/login` | Intentos **fallidos** (401), por IP | 20 cada 15 min |
| `POST /api/auth/forgot-password` | Todas las solicitudes, por correo (exista o no la cuenta) | 3 por hora |
| `POST /api/auth/forgot-password` | Todas las solicitudes, por IP | 10 por hora |
| `POST /api/auth/reset-password` | Intentos fallidos (400), por IP | 10 cada 15 min |
| `POST /api/auth/change-password` | Contraseña actual incorrecta (403), por cuenta | 5 cada 15 min |

- En el login solo cuentan las credenciales incorrectas: los logins exitosos y las peticiones mal formadas (400) no gastan intentos. En `forgot-password` cuenta toda solicitud, porque cada una puede enviar un correo (el límite evita inundar la bandeja de alguien o gastar la cuota del proveedor).
- Al superar el límite responde `429 { error, retryAfterSeconds }` con los headers `Retry-After` y `RateLimit-*`, **incluso con la contraseña correcta**. El mensaje es el mismo para cuentas que existen y que no.
- El límite por correo es la defensa principal contra fuerza bruta porque no depende de detectar la IP; el de IP frena a quien prueba muchas cuentas distintas.
- Los contadores viven en memoria (la app corre en una sola instancia): se reinician al reiniciar el servicio. Con varias instancias habría que moverlos a un almacén compartido (Redis/Postgres).
- La IP se lee de `X-Forwarded-For` según `TRUST_PROXY` (sección 3). Un valor mal puesto hace que todos los usuarios compartan IP (muy bajo) o que se pueda falsificar (muy alto).

### Recuperación de contraseña

1. El usuario pide el enlace en `/forgot-password` (frontend). El backend responde **de inmediato** con el mismo mensaje exista o no el correo, y *después* busca la cuenta, crea el token y envía el email: así ni el contenido ni el tiempo de respuesta revelan qué correos tienen cuenta.
2. El token es aleatorio (32 bytes) y viaja solo en el enlace `{FRONTEND_URL}/reset-password?token=…`; en la base de datos (tabla `PasswordResetToken`) se guarda únicamente su **hash SHA-256**. Vale 60 minutos y pedir uno nuevo invalida el anterior.
3. En `/reset-password` el usuario elige la nueva contraseña (mínimo 6 caracteres, igual que el registro). El token se borra al usarse (un solo uso, incluso con dos peticiones simultáneas), se invalidan los demás enlaces de la cuenta y se levanta el bloqueo de login por intentos fallidos de ese correo.
4. El enlace usa el primer origen de `FRONTEND_URL`. Requiere un proveedor de email (Brevo o SendGrid); sin proveedor el envío es *mock* (ver `LOG_PASSWORD_RESET_LINKS` para desarrollo).
5. Al restablecer la contraseña se cierran todas las sesiones abiertas de la cuenta (ver la sección siguiente).

### Sesiones y cambio de contraseña

- Los JWT duran 24 h, pero ya no valen solo por su firma: el middleware `auth` consulta la cuenta por clave primaria en cada petición autenticada y rechaza con `401 Invalid token` el token de una cuenta **borrada** o emitido **antes del último cambio de contraseña** (`Doctor.passwordChangedAt`). Un fallo de la base de datos responde `500`, no `401`, para no cerrar la sesión de todos por un problema pasajero.
- Se registra `passwordChangedAt` al cambiar la contraseña desde Settings (`POST /api/auth/change-password`), al restablecerla con el enlace del correo y cuando un admin le asigna una nueva a un usuario (`PUT /api/admin/doctors/:id` con `password`). Editar otros datos no cierra sesiones. Las cuentas que nunca cambiaron su contraseña (`passwordChangedAt` nulo) no se ven afectadas.
- `iat` del JWT tiene resolución de un segundo, así que la comparación se hace a segundos: el token nuevo que devuelve `change-password` (mismo segundo que el cambio) sigue valiendo, y uno emitido en ese mismo segundo con la contraseña vieja también.
- Desde Settings, quien cambia la contraseña conserva su sesión (recibe un token nuevo); las demás se cierran. El rol dentro del JWT no se refresca: un cambio de rol hecho por un admin se nota al volver a iniciar sesión.

## 5. Datos de demo

`backend/prisma/seed.js` (`npx prisma db seed`) crea:

- 1 cuenta **admin**: `admin@medcita.ec` / `admin1234`
- 3 médicos piloto (rol `doctor`), cada uno con horario Lun-Vie 8:00-18:00 y citas de ejemplo en distintos estados (`scheduled`, `confirmed`, `pending_approval`) repartidas en los próximos días:
  - `demo@medcita.ec` / `demo1234` — Dr. Santiago Pérez (Medicina General)
  - `dra.torres@medcita.ec` / `demo1234` — Dra. Camila Torres (Pediatría)
  - `dr.mendoza@medcita.ec` / `demo1234` — Dr. Andrés Mendoza (Medicina Familiar)
- Pacientes de ejemplo con teléfono/cédula/email realistas, listos para mostrar el flujo completo (crear cita → confirmación → recordatorio) en una demo.

Volver a correr `npx prisma db seed` **borra y recrea** médicos, pacientes, disponibilidad y citas — no usar contra datos reales.

## 6. Pruebas automatizadas y CI

**Backend** (Jest + supertest, contra una base PostgreSQL real): cubre auth/JWT, citas (crear, listar con paginación y rangos, conflictos de horario, reservas simultáneas, actualizar, cancelar), pacientes, administración, disponibilidad/slots y el cron de recordatorios (`backend/tests/`). El frontend se valida con `npm run lint`.

Las pruebas **borran todas las tablas** de la base que usan, por eso necesitan una base propia y nunca tocan `DATABASE_URL`:

```bash
# 1. Crear la base de pruebas (una sola vez; con el contenedor de docker-compose)
docker exec medcita-db psql -U postgres -c "CREATE DATABASE medcita_test"

# 2. Correr la suite (antes de empezar vacía el esquema de la base de pruebas y lo reconstruye con `prisma migrate deploy`)
cd backend
TEST_DATABASE_URL="postgresql://postgres:password123@localhost:5432/medcita_test?schema=public" npm test

# Frontend
cd frontend && npm run lint
```

Detalles útiles:

- Si `TEST_DATABASE_URL` falta o su base no termina en `_test`, la suite falla **antes** de tocar nada.
- Los envíos de WhatsApp/Email están desactivados y sustituidos por registros en memoria: las pruebas nunca mandan mensajes reales, aunque tu `backend/.env` tenga credenciales.
- `server.js` exporta `app`; el cron y el puerto solo se activan al ejecutar `node src/server.js`, no al importarlo.
- Un caso marcado `it.failing` documenta un bug conocido: pasa en verde mientras el bug exista y empezará a fallar cuando se corrija (entonces hay que volverlo `it`).
- `tests/migrations.test.js` comprueba que lo que construyen las migraciones coincide con `schema.prisma` (y falla, mostrando el SQL que falta, si alguien cambió un modelo sin crear su migración).
- **CI** (`.github/workflows/ci.yml`): en cada Pull Request y en cada push a `main` corre `npm test` (con un PostgreSQL de servicio) y `npm run lint`.

## 7. Base de datos: migraciones de Prisma

El esquema está en `backend/prisma/schema.prisma` y su historial en `backend/prisma/migrations/`: una carpeta `<fecha>_<nombre>/migration.sql` por cada cambio. Desde S7-04 **ya no se usa `prisma db push`**: no deja historial ni se puede reproducir, y con pacientes y citas reales eso es un riesgo.

El cliente de Prisma (`@prisma/client`) se regenera solo en cada `npm install`/`npm ci` gracias al script `postinstall` de `backend/package.json`; no hace falta correr `prisma generate` a mano después de instalar. Orden y motivos de despliegue: `docs/DEPLOY.md`, «Contrato de despliegue del backend».

| Qué quieres hacer | Comando (dentro de `backend/`) |
|---|---|
| Crear las tablas en una base nueva (local o Neon) | `npx prisma migrate deploy` |
| Cambiar el esquema (un campo, una tabla…) | Editar `schema.prisma` y correr `npx prisma migrate dev --name <que_cambia>`: crea la carpeta de la migración, la aplica a tu base local y regenera el cliente |
| Ver qué migraciones faltan | `npx prisma migrate status` |
| Producción (Render) | Automático: el Build Command corre `prisma migrate deploy` (ver `docs/DEPLOY.md`) |

Reglas:

1. Un cambio en `schema.prisma` va **siempre en el mismo commit que su migración**. Si no, `tests/migrations.test.js` falla (también en CI) y muestra el SQL que falta.
2. Revisar el `migration.sql` generado antes de commitearlo, sobre todo si tiene `DROP` o renombra columnas: Prisma avisa cuando un cambio puede borrar datos.
3. Una migración ya mergeada **no se edita**: Prisma guarda su checksum y las bases que ya la aplicaron dejarían de coincidir. Si hay que corregir algo, se crea otra migración.
4. Las migraciones solo avanzan, no hay «deshacer»: para revertir un cambio se escribe otra migración que lo deshaga. Si una falla a medias en una base, tras limpiar a mano lo que quedó se marca con `npx prisma migrate resolve --rolled-back <nombre>` (o `--applied` si en realidad terminó).
5. No inventar nombres de carpeta: se aplican en orden alfabético y el prefijo de fecha (`AAAAMMDDHHMMSS`) es lo que garantiza el orden.

La primera migración, `20261019202135_baseline`, es el esquema completo tal como lo dejaba `db push` al cerrar S7-03 (`Doctor`, `Patient`, `Availability`, `Appointment` con `reminderSentAt` y `PasswordResetToken`). En una base vacía crea todo; en una base que ya existía (la de Neon) se marca como aplicada sin ejecutarla — ver «Neon que ya existía» en `docs/DEPLOY.md`.

**Mi base local se creó con `db push`** (antes de S7-04): tiene tablas pero ningún historial. `migrate deploy` falla con `P3005` sin tocar nada, y `migrate dev` avisa «Drift detected» y pregunta si resetear el esquema («All data will be lost»): **responde que no** (`N`) si quieres conservar los datos. Hay dos salidas:

- Si no importa perder los datos locales: `npx prisma migrate reset` borra la base, aplica las migraciones y vuelve a cargar el seed.
- Para conservarlos: `npx prisma migrate resolve --applied 20261019202135_baseline`. Solo anota el historial y no toca los datos. (Si tu base está desactualizada respecto del esquema, ponla al día antes con `npx prisma db push`.)

## 8. Idioma del producto

Decisión (S7-05): el producto es **bilingüe según quién lee el texto**, no monolingüe.

| Qué | Idioma | Por qué |
|---|---|---|
| Interfaz de la app (React) y mensajes de error de la API | Inglés | Es lo que ven el personal y quienes desarrollan, y ya era así en casi todo el código |
| Mensajes que **salen de la app**: WhatsApp y correos a pacientes, aviso de cita nueva al médico, correo de recuperación de contraseña | Español | Los reciben pacientes y médicos de Ecuador |
| Documentación (`docs/`) | Español | |
| Código, comentarios, ramas y commits | Inglés | |

Reglas para cambios nuevos:

- Un mensaje de error de la API se escribe en inglés. Hasta S7-05 había cinco en español, todos al crear una cita (horario, cita duplicada, paciente duplicado); ahora están en inglés como el resto.
- Las plantillas de WhatsApp y correo (`notificationService.js`, `emailService.js`) se escriben en español y **sin artículo delante del nombre del médico**: el nombre ya trae «Dr.» o «Dra.» y «con el Dra. Torres» está mal. Los tests lo cubren.
- Los textos de la interfaz también van en inglés: los horarios del modal de nueva cita ya no dicen «Libre»/«Ocupado» sino «Free»/«Booked».
- Excepciones conocidas: la tarjeta «Guía completa de demo» de la pantalla de login (material de demo en español) y la etiqueta «Cédula» (es el nombre del documento de identidad ecuatoriano).
- Si algún día el producto sale de Ecuador, el paso siguiente sería sacar los textos de la interfaz y de las plantillas a archivos de traducción. No se hace ahora porque no hay otro mercado.
