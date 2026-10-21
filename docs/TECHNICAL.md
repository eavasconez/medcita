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
| `LOG_PASSWORD_RESET_LINKS` | No (solo desarrollo) | Con `true`, imprime en consola los enlaces que se envían por correo (recuperación de contraseña, confirmación del alta e invitaciones), útil sin proveedor de email. **Nunca activarlo en producción**: un enlace en los logs es una credencial válida hasta que vence |
| `EXPOSE_ACCOUNT_LINKS` | No (solo QA local) | Con `true`, las respuestas de `register` y de las invitaciones traen además el enlace como `devLink`, y se levantan los límites del alta, de los enlaces y de las invitaciones, para que Postman/newman complete los flujos sin leer un buzón. **El servidor se niega a arrancar** con `NODE_ENV=production` o en Render |
| `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | No (todavía ningún flujo sube archivos) | Bucket **privado** compatible con S3 para los documentos clínicos. Más `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` y `S3_URL_TTL_SECONDS` (5 min por defecto, máximo 15). Servicio: `services/fileStorage.js`; verificación: `npm run storage:check`. Guía: `docs/DEPLOY.md`, «Archivos privados» |
| `SEED_REMOTE_HOST` | Solo para sembrar una base remota | El seed borra todo y por eso se niega a correr contra una base que no sea local; para una de staging hay que escribir su host aquí (`utils/seedGuard.js`). **Nunca** apuntarlo a producción |
| `TEST_DATABASE_URL` | Solo para `npm test` | Base de datos **exclusiva para pruebas**. Su nombre debe terminar en `_test` o la suite se niega a correr (borra todas las tablas entre pruebas). Nunca se usa `DATABASE_URL`. Ver sección 6 |
| `META_WHATSAPP_TOKEN` / `META_WHATSAPP_PHONE_NUMBER_ID` | No | WhatsApp vía Meta Cloud API (proveedor preferido si están presentes). La confirmación y el recordatorio se envían como **plantillas aprobadas** (guía completa en `docs/DEPLOY.md`, sección 7) |
| `META_WHATSAPP_TEMPLATE_CONFIRMATION` / `META_WHATSAPP_TEMPLATE_REMINDER` | No (defaults `cita_confirmada` / `recordatorio_cita`) | Nombres de las plantillas registradas en Meta |
| `META_WHATSAPP_TEMPLATE_LANGUAGE` | No (default `es`) | Código de idioma de las plantillas |
| `META_GRAPH_VERSION` | No (default `v21.0`) | Versión de la Graph API de Meta |
| `META_GRAPH_BASE_URL` | No (default `https://graph.facebook.com`) | Solo para pruebas locales contra una Graph API falsa |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_WHATSAPP_NUMBER` | No | WhatsApp vía Twilio, como mensaje normal y no como plantilla. Solo se usa si **no** hay credenciales de Meta; si Meta responde con error, no se reintenta por Twilio. Cómo elegir entre uno y otro: `docs/DEPLOY.md`, sección 7.0. En producción se recomienda no definirlas |
| `BREVO_API_KEY` / `BREVO_FROM_EMAIL` | No | Email vía Brevo (proveedor preferido) |
| `SENDGRID_API_KEY` / `SENDGRID_FROM_EMAIL` | No | Email vía SendGrid (fallback si Brevo falla o no está configurado) |

Con Twilio o en modo mock, el WhatsApp es el mismo texto de la plantilla, ya completado (`backend/src/services/whatsappTemplates.js` es la única fuente de esos textos). `npm run whatsapp:test -- +593…` envía un mensaje de muestra con el proveedor configurado para comprobar la instalación.

Si ninguna credencial de WhatsApp/Email está presente, ambos servicios caen a modo **mock** (loguean el envío en consola en vez de enviarlo realmente) — útil para desarrollo local sin gastar créditos/cuotas.

## 4. Endpoints principales

Todas las rutas bajo `/api/*` (excepto `/api/auth/register` y `/api/auth/login`) requieren header `Authorization: Bearer <token>`. Roles: `doctor` (default), `secretary`, `admin` y `superadmin` (operador de la plataforma, ver «Consultorios»). Todo lo que se lee o se escribe ocurre **dentro del consultorio de quien pregunta** (S8-01, ver «Consultorios»).

### Auth (`/api/auth`)

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| POST | `/register` | Público | Pide crear un consultorio y su primer admin: body `{ name, email, password, clinicName }`. **No crea nada**: responde `202` con el mismo mensaje exista o no el correo y envía un enlace de confirmación (24 h, un solo uso). Si el correo ya tiene cuenta, su dueño recibe un aviso en vez del enlace. Limitado por correo y por IP (ver «Límite de intentos») |
| POST | `/verify-email` | Público | Body `{ token }`. Usa el enlace de confirmación: crea el consultorio con el nombre elegido y su admin, y devuelve `201 { token, user }` ya con sesión. Enlace inválido, vencido o usado → `400 { error, code: "INVALID_LINK" }` (un solo mensaje) |
| POST | `/invitation-preview` | Público | Body `{ token }`. Dice a dónde se invita: `{ clinicName, name, email, role, invitedByName }`. No gasta la invitación. Mismo `400 INVALID_LINK` |
| POST | `/accept-invitation` | Público | Body `{ token, password }`. La persona elige su contraseña: se crea la cuenta en el consultorio que invitó, con el rol de la invitación, y devuelve `201 { token, user }`. Un solo uso |
| POST | `/login` | Público | Devuelve `{ token, user }` (`user` incluye `clinic: { id, name }`). Limitado: tras 5 intentos fallidos por correo (o 20 por IP) en 15 min responde `429` (ver "Límite de intentos") |
| POST | `/forgot-password` | Público | Body `{ email }`. Responde siempre `200` con el mismo mensaje, exista o no la cuenta, y envía por email un enlace de recuperación si existe (ver "Recuperación de contraseña"). Limitado |
| POST | `/reset-password` | Público | Body `{ token, password }`. Cambia la contraseña con el token del enlace (un solo uso, válido 60 min). Token inválido, vencido o ya usado → `400 { error, code: "INVALID_RESET_LINK" }` (un único mensaje para los tres casos) |
| POST | `/change-password` | Autenticado | Body `{ currentPassword, newPassword }`. Cambia la contraseña de la sesión actual y devuelve `{ message, token, user }` con un token nuevo (las demás sesiones dejan de valer, ver "Sesiones y cambio de contraseña"). `400` si falta la actual, la nueva tiene menos de 6 caracteres o es igual a la actual; `403` si la contraseña actual es incorrecta (no es `401`: el frontend lo toma como sesión vencida). Limitado |
| GET | `/profile` | Autenticado | Perfil propio (nombre, especialidad, bio, dirección y `clinic: { id, name }`) |
| PUT | `/profile` | Autenticado | Actualiza el propio perfil |

### Citas (`/api/appointments`)

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/` | Autenticado | Lista **paginada** de citas (admin/secretaria ven todas o filtran por `doctorId`; un doctor solo ve las suyas). Filtros: `date`, `from` y `to` (rango inclusive `YYYY-MM-DD`), `patientId`, `doctorId`, `status`. Paginación: `page` (desde 1) y `pageSize` (por defecto 100, máx. 500). Responde `{ appointments, total, page, pageSize, totalPages }`. Las citas **canceladas no aparecen** salvo con `status=cancelled` |
| GET | `/stats` | Autenticado | Números del dashboard calculados en la base: `{ total, positive, cancelled, noShow, patients }` (`positive` = confirmadas, llegó, en consulta o completadas; `noShow` = las que no asistió; `total` y `patients` no cuentan las canceladas). Mismas reglas de visibilidad que la lista (`doctorId` para admin/secretaria) |
| POST | `/` | Autenticado | Crea cita (transacción serializable: valida disponibilidad, evita doble reserva, upsert de paciente). Envía confirmación por WhatsApp/Email |
| PUT | `/:id` | Autenticado (dueño, o admin/secretaria) | Actualiza fecha, hora, estado o notas. Si la cita **cambia de horario** o se **reactiva** (de `cancelled` a otro estado) pasa por las mismas reglas que al agendar, dentro de una transacción serializable: `400` si el médico no atiende a esa hora o si la nueva hora ya pasó (salvo citas `completed`, para corregir el registro); `409` si otra cita activa del médico ya ocupa ese horario. Las reglas se aplican al médico dueño de la cita, no a quien edita. Cambiar solo estado o notas no revisa el horario, y cancelar tampoco |
| DELETE | `/:id` | Autenticado (dueño, o admin/secretaria) | **Cancela** la cita: la deja con `status: "cancelled"` (no se borra, para conservar historial y estadísticas) y libera el horario. Repetirlo da el mismo resultado. Responde `{ message, appointment }` |
| GET | `/unclosed` | Autenticado | Citas **pasadas que nadie cerró** (siguen `pending_approval`, `scheduled`, `confirmed`, `arrived` o `in_progress` aunque su hora ya pasó), de la más antigua a la más nueva: `{ total, appointments }` (hasta 50). Misma visibilidad que la lista |
| GET | `/attendance` | Autenticado | Control de asistencia de un mes (`?month=YYYY-MM`, el actual por defecto; un mes mal escrito da `400`): `{ month, attended, noShow, noShowRate, confirmed, notConfirmed, noShowByPatient }`. `noShowRate` = no asistieron ÷ (atendidas + no asistieron), en % con un decimal, o `null` si aún no se cerró ninguna; `noShowByPatient` son los 10 pacientes con más inasistencias (en todo el historial). Misma visibilidad que la lista |
| GET | `/:id/notifications` | Autenticado (dueño, o admin/secretaria) | Los mensajes que se enviaron sobre la cita (ver «Historial de mensajes»): `{ notifications, reminderPending }` |

**Estados de la cita (S8-05).** `pending_approval` → `scheduled` → `confirmed` → `arrived` (llegó) → `in_progress` (en consulta) → `completed`, y los finales `no_show` (no asistió) y `cancelled`. No hay un orden obligatorio, salvo una regla: **`no_show` solo se acepta cuando la hora de la cita ya llegó** (`400` si no). Una cita `no_show` puede corregirse a `completed` si el paciente llegó tarde. Todos conservan el horario (solo `cancelled` lo libera), el recordatorio de 24 h solo se manda a `pending_approval`, `scheduled` y `confirmed`, y un cambio hecho por administración/secretaría queda en la auditoría con el estado antes y después. En el Dashboard, el modal de la cita ofrece los pasos que corresponden al estado actual y un aviso lista las citas pasadas sin cerrar (**Seen** / **No-show**); en Reportes, el bloque **No-shows** muestra la tasa del mes, confirmadas contra sin confirmar y los pacientes que más faltan.

El calendario del frontend pide solo el rango de fechas que está mostrando (semana, mes, día o los 30 días de la agenda) y sigue las páginas hasta completarlo; los KPIs salen de `/stats`.

### Pacientes (`/api/patients`)

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/` | Autenticado | Lista paginada **de los pacientes del consultorio** (`page`, `pageSize`; máx. 100 por página), con búsqueda por `search` (nombre, teléfono, cédula) |
| POST | `/` | Autenticado | Crea o actualiza (upsert por teléfono **dentro del consultorio**: el mismo teléfono en otro consultorio es otro paciente) |
| PUT | `/:id` | Autenticado | Actualiza datos del paciente |
| DELETE | `/:id` | Autenticado | Elimina un paciente **sin citas** (pensado para registros creados por error). Con cualquier cita —activa, cancelada o completada— responde `409` y lo conserva, porque ese historial es suyo; el mensaje distingue «tiene citas activas, cancélalas primero» de «tiene historial». `404` si no existe |
| GET | `/consent-document` | Autenticado | El texto del consentimiento de datos de salud vigente con el nombre del consultorio: `{ kind, version, title, paragraphs, methods }` |
| GET | `/:id/consents` | Autenticado | Cómo está el paciente respecto del consentimiento y todos sus eventos: `{ status: none \| granted \| withdrawn, upToDate, current, history, currentVersion }`. De otro consultorio, `404` |
| POST | `/:id/consents` | Autenticado | Registra que el paciente **dio** (`granted: true`) o **retiró** (`false`) el consentimiento, con `method` (`in_person_signed`, `in_person_verbal`, `electronic`, `other`). La versión es siempre la vigente; si se envía `documentVersion` y ya no lo es, `409`. Es un evento nuevo, nunca una edición. Quedó en el Activity Log si lo hizo un admin o una secretaria. `201` con el estado nuevo |
| GET | `/:id/export` | Solo admin | Todos los datos del paciente como archivo (`Content-Disposition: attachment`): paciente, citas con sus notas, mensajes enviados (sin texto, con el destino enmascarado) y consentimientos. Cada exportación queda en el Activity Log (`read` sobre `patient_export`). Secretaria y médico: `403` |

### Disponibilidad (`/api/availability`)

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/` | Autenticado | Horario semanal del médico (o `doctorId` dado, que debe ser de tu consultorio: otro responde `404 Doctor not found`, igual que en `/slots` y `POST`). Si no hay ninguno configurado, devuelve un fallback de demo (Lun-Vie 8:00-18:00) |
| GET | `/slots?date=YYYY-MM-DD` | Autenticado | Slots de 30 min disponibles/ocupados para una fecha |
| POST | `/` | Autenticado | Reemplaza el horario completo del médico (array de `{ dayOfWeek, startTime, endTime }`) |

### Administración (`/api/admin`)

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/doctors` | admin, secretary | Lista las cuentas del consultorio (filtro opcional `role`) |
| POST | `/doctors` | admin | **Invita** a una persona (`{ name, email, role }`): crea una invitación y le envía un enlace de 7 días. No acepta `password` (`400`): cada persona elige la suya. `409` si ya tiene cuenta en el consultorio; un correo con cuenta en otro consultorio se invita igual, sin revelarlo. No puede invitar `superadmin`. Limitado: 20 por admin por hora |
| GET | `/invitations` | admin | Invitaciones pendientes del consultorio (id, nombre, correo, rol, quién invitó, vencimiento, `expired`), sin enlaces |
| POST | `/invitations/:id/resend` | admin | Enlace nuevo (el anterior deja de servir) y una semana más. `404` si no es de su consultorio |
| DELETE | `/invitations/:id` | admin | Cancela la invitación: su enlace deja de servir. `404` si no es de su consultorio |
| PUT | `/clinic` | admin | Cambia el propio consultorio: `{ name }` (2 a 80 caracteres) y/o `{ timezone }` (zona IANA, p. ej. `America/Guayaquil`) |
| PUT | `/doctors/:id` | admin | Actualiza nombre, correo y rol (nunca la contraseña: `400`) |
| DELETE | `/doctors/:id` | admin | Elimina médico (falla si tiene citas, aunque estén canceladas, o disponibilidad asociadas) |
| GET | `/reports/appointments-by-doctor` | admin | Conteo de citas por médico (sin las canceladas) |
| GET | `/audit-log` | admin | Registro de auditoría del consultorio: lo que hicieron sus admins y secretarias, paginado y filtrable (ver «Registro de auditoría»). Solo lectura |
| GET | `/notification-status` | admin | Si el WhatsApp y el correo del consultorio están saliendo: por canal, los envíos fallidos seguidos y el último error (ver «Historial de mensajes») |
| GET | `/client-ip` | admin | Diagnóstico de `TRUST_PROXY`: devuelve `{ ip, forwardedFor, trustProxy }`; `ip` debe ser tu IP pública |

`/api/admin/medicos` es el **nombre anterior** de `/api/admin/doctors`. Sigue respondiendo igual (mismos métodos y permisos) como alias temporal para clientes que no se hayan actualizado, por ejemplo un frontend viejo en caché mientras el backend ya está desplegado, y sus respuestas llevan el header `Deprecation: true`. Está pensado para eliminarse más adelante.

### Consultorios (S8-01)

Desde S8-01 los datos pertenecen a un **consultorio** (`Clinic`: nombre, `slug` único y zona horaria). Cada cuenta, paciente, cita, horario y entrada de auditoría lleva su `clinicId`, y una persona solo trabaja dentro del suyo.

- **De dónde sale el consultorio.** El middleware `auth` lo lee de la cuenta (`req.clinicId`), nunca del token ni de la petición: un `clinicId` enviado en el cuerpo o en la URL se ignora. Todas las consultas pasan por `inClinic(req, where)` (`backend/src/utils/clinicScope.js`).
- **Un id de otro consultorio no existe.** Pedir, editar o borrar un paciente, una cita o una cuenta de otro consultorio responde `404`, igual que uno inexistente. Un `doctorId` ajeno (al agendar o al leer o cambiar horarios) responde `404 Doctor not found`. Los listados solo traen lo propio, y filtrar por un médico o un paciente ajeno devuelve una lista vacía.
- **Teléfono y cédula** son únicos **por consultorio** (`@@unique([clinicId, phone])` y `[clinicId, cedula]`): el mismo número puede ser un paciente distinto en otro consultorio, y agendar nunca toca al paciente de otro. El **correo** de una cuenta sigue siendo único en toda la plataforma, porque es con lo que se inicia sesión.
- **La base de datos también lo exige.** `Appointment` y `Availability` apuntan a su médico (y la cita a su paciente) con claves foráneas compuestas `(id, clinicId)`: aunque una ruta futura olvidara filtrar, la base rechaza (`P2003`) una cita entre un médico y un paciente de consultorios distintos. `clinicId` es obligatorio en las cinco tablas.
- **Alta.** `POST /api/auth/register` pide el nombre del consultorio y no crea nada hasta que la persona confirma su correo con el enlace (`POST /api/auth/verify-email`): entonces se crean el consultorio con ese nombre y su primer **admin**. Se guarda como `SignupRequest` (solo el hash del enlace y de la contraseña). Las demás personas entran por invitación (ver «Invitaciones»).
- **Sesión.** `login`, `register` y `change-password` devuelven `user.clinic = { id, name, timezone }`, y `GET /api/auth/profile` también. El frontend lo muestra en la tarjeta de usuario de la barra lateral; una sesión guardada antes de S8-01 lo pide una vez al abrir la app.
- **Zona horaria (S9-01).** Las citas guardan `date` y `time` como texto local, sin zona; `Clinic.timezone` (nombre IANA, `America/Guayaquil` por defecto) dice a qué instante real corresponden. `utils/clinicTime.js` lo calcula con `Intl`, así que respeta horario de verano y zonas como Galápagos (`Pacific/Galapagos`, UTC-6) o un consultorio fuera de Ecuador. El middleware de autenticación deja la zona en `req.clinicTimezone` y la usan los horarios libres («hoy» y «ya pasó»), las citas sin cerrar, la asistencia mensual y el filtro por fechas de la auditoría; el cron de recordatorios recorre los consultorios y lee las horas de cada uno en la suya. El administrador la cambia en Settings (`PUT /api/admin/clinic { timezone }`, solo nombres IANA reales). Cambiar la zona **no mueve** las citas ya agendadas: conservan su hora local. La variable `CLINIC_UTC_OFFSET_MINUTES` ya no existe (si está en Render, se puede borrar).
- **Operador de la plataforma.** El rol `superadmin` cuida de MedCita, no de un consultorio. Solo se crea en la base de datos o con el seed (un admin no puede asignarlo) y su cuenta pertenece a un consultorio propio (`plataforma`); en las rutas de un consultorio se comporta como un médico más de ese. Lo único que hace de más:

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/api/platform/clinics` | superadmin | Consultorios paginados (`page`, `pageSize`; 50 por defecto, máx. 200) con `{ id, name, slug, timezone, createdAt, _count: { doctors, patients, appointments } }`. Solo tamaños: nunca el contenido de un consultorio |

**Límites actuales.** No hay pantalla para el operador. Un consultorio se crea al confirmar un alta o con SQL (`docs/DEPLOY.md`, «Primer despliegue con consultorios»). Un consultorio no se puede borrar ni mover cuentas entre consultorios.

### Invitaciones (S8-02)

Nadie escribe la contraseña de otra persona. Un admin invita (`POST /api/admin/doctors`) y se crea una `Invitation` (consultorio, correo, rol, quién invitó, hash del enlace, vencimiento; una pendiente por consultorio y correo). La persona recibe un correo que **nombra el consultorio**, abre `/accept-invitation`, ve a qué consultorio entra y con qué rol, elige su contraseña y queda con sesión. Los enlaces (de alta y de invitación) son aleatorios de 32 bytes, solo se guarda su hash, valen una vez y viajan en el cuerpo de las peticiones, no en la URL, para que no queden en los logs de acceso. Invitar de nuevo al mismo correo reemplaza la invitación. Las invitaciones y su cancelación quedan en el registro de auditoría (`entity: invitation`, solo el rol; ni nombre ni correo).

### Registro de auditoría

Desde S7-09 queda escrito qué hicieron los **administradores y las secretarias** sobre las citas, los pacientes y las cuentas de usuario; desde S8-03 también **cómo entra la gente**: cada inicio de sesión y cada cambio de contraseña, de **cualquier rol**. Un médico que trabaja con su propia agenda no genera registro de sus citas ni de sus pacientes.

**Qué se registra.** Cada entrada tiene quién (`actor`: id, nombre y rol *en ese momento*), cuándo (`createdAt`), qué (`action`: `create`, `update`, `cancel`, `delete`, `login`, `login_failed`, `password_change`, `password_reset` o `read`; `entity`: `appointment`, `patient`, `user` o `invitation`, y `entityId`), desde dónde (`ip` y `userAgent`, recortado a 255 caracteres; la IP de un cliente IPv4 se guarda sin el prefijo `::ffff:`), el médico afectado (`doctor`, cuando la acción toca su agenda) y qué cambió (`changes`):

| Acción | Se registra |
|---|---|
| Agendar, mover o editar una cita (`POST`/`PUT /api/appointments`) | `create` o `update`, con la fecha, la hora y el estado antes y después. Pasar a `cancelled` por `PUT` cuenta como `cancel` |
| Cancelar una cita (`DELETE /api/appointments/:id`) | `cancel`, con el estado antes y después. Repetirlo no deja una segunda entrada |
| Crear, editar o borrar un paciente (`/api/patients`) | `create`, `update` (solo los **nombres** de los campos que cambiaron) o `delete`. Una reserva hecha por personal que crea o modifica al paciente deja también su entrada de paciente |
| Invitar o cancelar una invitación (`/api/admin/doctors`, `/api/admin/invitations`) | `create`, `update` (invitar de nuevo con otro rol) o `delete`, con `entity: invitation` y solo el rol; ni el nombre ni el correo |
| Editar o eliminar una cuenta (`/api/admin/doctors`) | `update` o `delete`. Nombre y rol con antes y después; del correo solo que cambió. Al eliminar queda el nombre y el rol, que es lo único que sobrevive de la cuenta |
| Iniciar sesión (`POST /api/auth/login`, y el que empiezan confirmar un alta o aceptar una invitación) | `login`, `entity: user`, de cualquier rol. Un intento con contraseña equivocada contra una cuenta que **existe** deja `login_failed` a nombre de esa cuenta y de su consultorio; un correo que no existe no deja nada (no pertenece a ningún consultorio). Cuando el límite de intentos bloquea la cuenta ya no se registran más |
| Cambiar la contraseña (`POST /api/auth/change-password`) o restablecerla con el enlace del correo | `password_change` o `password_reset`. Una contraseña actual equivocada (`403`) no deja nada |
| Cambios de rol | Ya quedan como `update` de la cuenta, con el rol antes y después |
| Leer algo que debe quedar trazado (la historia clínica, cuando exista) | `read`: el tipo y `recordRead()` ya existen, pero nada lo llama todavía |

**Qué nunca se guarda.** Datos de contacto de pacientes (nombre, teléfono, correo, cédula), el texto de las notas de una cita (pueden contener datos médicos), correos ni contraseñas (ni su hash), y **nada de lo que alguien escribió al intentar entrar**: ni el correo ni la contraseña de un intento: de esos campos solo consta que cambiaron, como `{ "notes": { "changed": true } }`. Los campos visibles aparecen como `{ "time": { "from": "10:00", "to": "11:30" } }`. Una petición que no cambia nada, o que se rechaza (horario ocupado, validación, no existe), no deja entrada.

**Garantías.** La entrada se escribe en la **misma transacción** que la acción (`services/auditLog.js`): si no se puede registrar, la acción no ocurre y se responde `500`; y no queda constancia de algo que no sucedió. Las entradas son solo de lectura (no hay ruta para modificarlas o borrarlas) y no tienen claves foráneas, así que sobreviven a la cuenta o al dato al que se refieren. `seq` (serie) fija el orden de inserción: la base le pone la misma hora a todo lo escrito en una transacción, y así se sabe qué ocurrió primero. Los inicios de sesión se registran antes de entregar la sesión: si no se puede escribir la entrada, el inicio de sesión responde `500` y no se entrega token.

**Consulta.** `GET /api/admin/audit-log` (solo admin; secretaria y médico reciben `403`). Cada entrada guarda el `clinicId` de quien actuó y cada admin solo ve las de su consultorio. Más reciente primero, de 50 en 50 por defecto (máx. 200: `page`, `pageSize`). Filtros opcionales: `from` y `to` (fechas `YYYY-MM-DD` de la clínica, ambos extremos incluidos), `actorId` (quién), `entity`, `entityId`, `action` y `doctorId`. Un valor inválido responde `400`; el mensaje de `action` lista las acciones válidas. Responde `{ entries, total, page, pageSize, totalPages }`:

```json
{
  "id": "…", "createdAt": "2026-10-20T19:50:12.000Z",
  "actor": { "id": "…", "name": "Ana Secretaria", "role": "secretary" },
  "action": "update", "entity": "appointment", "entityId": "…",
  "doctor": { "id": "…", "name": "Dra. Camila Torres" },
  "changes": { "time": { "from": "10:00", "to": "11:30" } },
  "ip": "203.0.113.7", "userAgent": "Mozilla/5.0 (X11; Linux x86_64) … Chrome/130.0 Safari/537.36"
}
```

**Pantalla.** Los administradores la ven en **Activity Log** (`/activity`): las entradas del consultorio, de 25 en 25, con filtros por fecha, persona y acción, frases legibles («Changed their password», «Failed sign-in attempt»…), la IP y un navegador corto («Chrome on Linux»). **Límites actuales.** No se registran los cambios de horarios de atención (`/api/availability`). Un intento fallido contra un correo que no existe queda fuera a propósito. La tabla `AuditLog` no se purga: crece con el uso, y ahora cada inicio de sesión suma una fila (conviene pensar en una política de retención antes de tener mucho tráfico).

### Consentimiento y exportación de datos (S8-07)

Base para tratar datos de salud (documentos en `docs/legal/`, **borrador sin revisión de un abogado**: ver `docs/legal/puntos-para-el-abogado.md`).

- **`PatientConsent`**: una fila por evento (dado o retirado) con la versión del texto que se mostró (`backend/src/legal/healthDataConsent.js`), el método, la fecha y quién lo registró (nombre y rol guardados como texto, para que el registro sobreviva a la cuenta). Nunca se edita ni se borra; solo desaparece junto con un paciente creado por error. No tiene nota libre a propósito: acabaría guardando datos de salud.
- **Versión del texto.** Si el texto cambia se sube la versión (en el código y en `docs/legal/consentimiento-datos-salud.md`; `tests/legalDocs.test.js` falla si no coinciden) y quien aceptó la anterior aparece como «Consent: old text».
- **Pantalla.** Pacientes muestra el estado de cada uno, el escudo abre el consentimiento (texto, cómo aceptó, historial) y, para administradores, el botón de descarga exporta sus datos.
- **Públicas.** `/privacy` y `/terms` muestran `docs/legal/politica-de-privacidad.md` y `terminos-de-uso.md`, con un aviso de borrador mientras `LEGAL_REVIEWED` (`frontend/src/config/legal.js`) sea `false`. Los enlaces están en el inicio de sesión y en el registro; **aún no se registra la aceptación de los términos**.

### Historial de mensajes (S8-04)

Cada WhatsApp y cada correo que MedCita intenta enviar deja una fila en `NotificationLog` (`services/notificationLog.js`), para enterarse de una falla el mismo día y no cuando un paciente reclama (como el 20-oct).

| Campo | Qué guarda |
|---|---|
| `kind` | Para qué era: `appointment_confirmation`, `appointment_reminder`, `doctor_new_appointment`, `password_reset`, `invitation`, `signup_confirmation`, `account_exists` |
| `channel`, `provider`, `recipient` | `whatsapp` o `email`; quién lo manejó (`meta`, `twilio`, `brevo`, `sendgrid` o `mock`); a quién iba (`patient`, `doctor`, `user`) |
| `status` | `sent`, `failed` o `simulated` (no hay proveedor configurado: no salió nada de verdad) |
| `errorCode`, `error` | Si falló: código del proveedor (`meta_190`, `brevo_unauthorized`, `sendgrid_401`, `twilio_21211`, `timeout`, `network`…) y su mensaje, con correos y números tapados y 300 caracteres como máximo. Los errores de Meta con pista conocida añaden dónde arreglarlo (token vencido, plantilla sin aprobar…) |
| `providerMessageId` | El id que devolvió el proveedor (`wamid…`, el de Brevo), para buscarlo en su panel |
| `destination` | El destino **enmascarado** (`+593***042`, `pa******@gmail.com`) |
| `clinicId`, `appointmentId` | El consultorio y la cita, cuando los hay. El alta de un consultorio (no existe aún) y el aviso «ya tienes cuenta» no llevan consultorio, para que nadie lo vea |

**Nunca se guarda** el texto del mensaje ni la dirección completa. Si SendGrid entrega lo que Brevo no pudo, la fila queda `sent` por `sendgrid` y `error` dice qué falló en Brevo. Escribir la fila nunca puede fallar ni retrasar un envío: si no se pudo, solo queda en el log del servidor. No se purga (una fila por mensaje): conviene una política de retención al crecer.

Lo que ve la aplicación:

- **Detalle de una cita** (Dashboard): bloque «Messages» con la confirmación y el recordatorio por cada canal («Confirmation failed by WhatsApp» en rojo con el motivo), el aviso al médico y si el recordatorio de 24 h todavía no sale. `GET /api/appointments/:id/notifications` → `{ notifications, reminderPending }`, con la misma visibilidad que la cita (un médico solo las suyas; otro consultorio, `404`).
- **Aviso para el administrador** (arriba del Dashboard): `GET /api/admin/notification-status` devuelve, por canal, cuántos envíos seguidos fallaron desde el último que salió (mira la última semana, ignora los simulados), `failing: true` desde **3** seguidos, el último error y cuándo salió el último bueno. El aviso desaparece solo cuando vuelve a salir un mensaje.

### Salud (`/api/health`)

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/api/health` | Público | `200 { status: "ok" }` si la base de datos responde y tiene todas las tablas y columnas que el código espera. `503 { status: "error", reason }` con `reason` = `schema_outdated` (falta una migración) o `database_unreachable`. No dice qué falta: el detalle va al log del servidor |

Al arrancar el servidor hace la misma comprobación y deja el resultado en el log (`backend/src/services/schemaCheck.js`). Compara el esquema de `schema.prisma` (lo que espera el cliente de Prisma) con `information_schema.columns`, no con el historial de migraciones, así que detecta una columna o tabla ausente incluso en una base creada con `db push`. Un resultado sano se recuerda 1 hora (no consulta la base en cada ping, para no mantener despierta a Neon); uno malo se vuelve a comprobar a los 10 s, de modo que el servicio se recupera solo cuando se aplica la migración. Ver `docs/DEPLOY.md`, «Contrato de despliegue del backend».

### Tareas (`server.js`)

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| POST | `/api/tasks/reminders` | admin, secretary | Dispara manualmente el recordatorio de 24h **solo para el consultorio de quien lo pide** (el cron de cada hora cubre todos los consultorios). Recuerda una sola vez (`Appointment.reminderSentAt`) a las citas `pending_approval`, `scheduled` o `confirmed` que ocurren en las próximas 24h; si ningún canal entrega, se reintenta en la siguiente corrida |

### Límite de intentos (rate limiting)

| Endpoint | Qué cuenta | Límite |
|---|---|---|
| `POST /api/auth/login` | Intentos **fallidos** (401), por correo | 5 cada 15 min |
| `POST /api/auth/login` | Intentos **fallidos** (401), por IP | 20 cada 15 min |
| `POST /api/auth/forgot-password` | Todas las solicitudes, por correo (exista o no la cuenta) | 3 por hora |
| `POST /api/auth/forgot-password` | Todas las solicitudes, por IP | 10 por hora |
| `POST /api/auth/reset-password` | Intentos fallidos (400), por IP | 10 cada 15 min |
| `POST /api/auth/change-password` | Contraseña actual incorrecta (403), por cuenta | 5 cada 15 min |
| `POST /api/auth/register` | Solo las solicitudes que envían correo (202), por correo | 3 por hora |
| `POST /api/auth/register` | Solo las que envían correo (202), por IP | 5 por hora |
| `verify-email`, `invitation-preview`, `accept-invitation` | Intentos con enlace inválido (400), por IP, compartido | 10 cada 15 min |
| `POST /api/admin/doctors` y `/invitations/:id/resend` | Todas, por admin | 20 por hora |

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
- Se registra `passwordChangedAt` al cambiar la contraseña desde Settings (`POST /api/auth/change-password`) y al restablecerla con el enlace del correo (un admin ya no puede asignar contraseñas). Editar otros datos no cierra sesiones. Las cuentas que nunca cambiaron su contraseña (`passwordChangedAt` nulo) no se ven afectadas.
- `iat` del JWT tiene resolución de un segundo, así que la comparación se hace a segundos: el token nuevo que devuelve `change-password` (mismo segundo que el cambio) sigue valiendo, y uno emitido en ese mismo segundo con la contraseña vieja también.
- Desde Settings, quien cambia la contraseña conserva su sesión (recibe un token nuevo); las demás se cierran. El rol dentro del JWT no se refresca: un cambio de rol hecho por un admin se nota al volver a iniciar sesión.

## 5. Datos de demo

`backend/prisma/seed.js` (`npx prisma db seed`) crea:

- **Dos consultorios de demostración** que no se ven entre sí, y un tercero para el operador de la plataforma.
- **Consultorio MedCita (demo)** (`medcita-demo`):
  - 1 cuenta **admin**: `admin@medcita.ec` / `admin1234`
  - 3 médicos piloto (rol `doctor`), cada uno con horario Lun-Vie 8:00-18:00 y citas de ejemplo en distintos estados (`scheduled`, `confirmed`, `pending_approval`) repartidas en los próximos días:
    - `demo@medcita.ec` / `demo1234` — Dr. Santiago Pérez (Medicina General)
    - `dra.torres@medcita.ec` / `demo1234` — Dra. Camila Torres (Pediatría)
    - `dr.mendoza@medcita.ec` / `demo1234` — Dr. Andrés Mendoza (Medicina Familiar)
  - Pacientes de ejemplo con teléfono/cédula/email realistas, listos para mostrar el flujo completo (crear cita → confirmación → recordatorio) en una demo.
- **Clínica Vida (demo)** (`clinica-vida`): `admin@clinicavida.ec` / `admin1234` y la Dra. Paula Vega (`dra.vega@clinicavida.ec` / `demo1234`, Ginecología), con 2 pacientes y 2 citas propias. Sirve para comprobar que cada consultorio solo ve lo suyo.
- **MedCita (plataforma)** (`plataforma`): el operador `plataforma@medcita.ec` / `admin1234` (rol `superadmin`, sin pacientes).

Volver a correr `npx prisma db seed` **borra y recrea** consultorios, médicos, pacientes, disponibilidad, citas y el registro de auditoría — no usar contra datos reales.

## 6. Pruebas automatizadas y CI

**Backend** (Jest + supertest, contra una base PostgreSQL real): cubre auth/JWT, citas (crear, listar con paginación y rangos, conflictos de horario, reservas simultáneas, actualizar, cancelar), pacientes, administración, disponibilidad/slots el cron de recordatorios y la comprobación del esquema de la base (`backend/tests/`). El frontend se valida con `npm run lint`. Al cerrar el Sprint 7 la suite tenía 433 pruebas, con S8-01 llegó a 470 con S8-02 a 525 y con S8-04 a 567 y con S8-05 a 593 y con S8-06 a 624 y con S8-07 a 651 (30 de aislamiento entre consultorios, que fallan si se quita cualquiera de los filtros, y 6 que ejecutan las migraciones de consultorios sobre datos heredados), todas en verde con `npm test` (que usa `--runInBand`: las suites comparten una sola base y, en paralelo, se pisan). Además de las pruebas, el 21-oct-2026 se recorrió el sitio desplegado con un navegador (ver `docs/qa/S7-12-production-evidence.md`).

**Postman** (`backend/postman/MedCita.postman_collection.json`, 319 peticiones y 540 aserciones al cierre de S8-07). Se corre contra un backend local con la base ya sembrada **y arrancado con `EXPOSE_ACCOUNT_LINKS=true`**, porque el alta y las invitaciones entregan su enlace por correo y ese modo lo devuelve en la respuesta (`devLink`): `EXPOSE_ACCOUNT_LINKS=true npm run dev` y, en otra terminal, `npx newman run backend/postman/MedCita.postman_collection.json --env-var baseUrl=http://localhost:5000`. Los límites de intentos de login viven en memoria y las pruebas de S1-02 gastan los de la IP: **reinicia el backend entre una corrida y otra** o la tercera seguida responde `429`.

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
- Hoy no hay ningún caso marcado `it.failing`. Si hace falta documentar un bug conocido se usa esa marca: el caso pasa en verde mientras el bug exista y empezará a fallar cuando se corrija (entonces hay que volverlo `it`).
- `tests/migrations.test.js` comprueba que lo que construyen las migraciones coincide con `schema.prisma` (y falla, mostrando el SQL que falta, si alguien cambió un modelo sin crear su migración).
- **CI** (`.github/workflows/ci.yml`): en cada Pull Request y en cada push a `main` corre `npm test` (con un PostgreSQL de servicio) y `npm run lint`.

### Guía en PDF (`frontend/public/medcita-demo-guide.pdf`)

Es la guía que se descarga desde la pantalla de login (credenciales de prueba, qué probar por rol, flujo de una cita, y la configuración de WhatsApp con Meta). Es **pública**: no debe contener tokens, IDs de la cuenta de Meta ni capturas con datos personales. Su fuente es `docs/guide/medcita-demo-guide.html` (con las capturas en `docs/guide/img/`, copias JPEG de `docs/qa/screenshots/s7-12/`). Cuando cambie la app o la configuración de WhatsApp, edita el HTML y regenera el PDF desde `docs/guide/` con Chrome o Chromium:

```bash
google-chrome --headless=new --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=../../frontend/public/medcita-demo-guide.pdf \
  "file://$PWD/medcita-demo-guide.html"
```

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
