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
| `TRUST_PROXY` | No (default `false`; `3` en Render) | Número de proxies inversos delante de la app, para leer la IP real del cliente en los límites de intentos por IP. Nunca `true` (permite falsificar la IP). En Render, donde `RENDER=true`, el default es `3` (Cloudflare + los balanceadores de Render; con `2` el servidor veía la IP de Cloudflare, comprobado el 22-oct-2026). Se verifica con `GET /api/admin/client-ip` |
| `LOG_PASSWORD_RESET_LINKS` | No (solo desarrollo) | Con `true`, imprime en consola los enlaces que se envían por correo (recuperación de contraseña, confirmación del alta e invitaciones), útil sin proveedor de email. **Nunca activarlo en producción**: un enlace en los logs es una credencial válida hasta que vence |
| `ERROR_ALERT_EMAILS` | No (recomendada en producción) | Correos de los **desarrolladores o del equipo de soporte de MedCita**, uno o varios separados por comas (`dev1@…,dev2@…`); **nunca** de un consultorio. Reciben un correo cuando una petición termina en error del servidor (5xx). Sin definir no se envía nada y los errores solo quedan en el log, como antes. Ver «Alertas de errores del servidor». Se prueba con `npm run alerts:test` |
| `EXPOSE_ACCOUNT_LINKS` | No (solo QA local) | Con `true`, las respuestas de `register` y de las invitaciones traen además el enlace como `devLink`, y se levantan los límites del alta, de los enlaces y de las invitaciones, para que Postman/newman complete los flujos sin leer un buzón. **El servidor se niega a arrancar** con `NODE_ENV=production` o en Render |
| `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | No (todavía ningún flujo sube archivos) | Bucket **privado** compatible con S3 para los documentos clínicos. Más `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` y `S3_URL_TTL_SECONDS` (5 min por defecto, máximo 15). Servicio: `services/fileStorage.js`; verificación: `npm run storage:check`. Guía: `docs/DEPLOY.md`, «Archivos privados» |
| `SEED_REMOTE_HOST` | Solo para sembrar una base remota | El seed borra todo y por eso se niega a correr contra una base que no sea local; para una de staging hay que escribir su host aquí (`utils/seedGuard.js`). **Nunca** apuntarlo a producción |
| `TEST_DATABASE_URL` | Solo para `npm test` | Base de datos **exclusiva para pruebas**. Su nombre debe terminar en `_test` o la suite se niega a correr (borra todas las tablas entre pruebas). Nunca se usa `DATABASE_URL`. Ver sección 6 |
| `META_WHATSAPP_TOKEN` / `META_WHATSAPP_PHONE_NUMBER_ID` | No | WhatsApp vía Meta Cloud API (proveedor preferido si están presentes). La confirmación y el recordatorio se envían como **plantillas aprobadas** (guía completa en `docs/DEPLOY.md`, sección 7) |
| `META_WHATSAPP_TEMPLATE_CONFIRMATION` / `META_WHATSAPP_TEMPLATE_REMINDER` | No (defaults `cita_confirmada` / `recordatorio_cita`) | Nombres de las plantillas registradas en Meta |
| `META_APP_SECRET` | No (S9-02) | *App secret* de la app de Meta. Con él el webhook de WhatsApp comprueba la firma `X-Hub-Signature-256` de cada llamada; **sin él el webhook responde `503` y no acepta nada**, y los recordatorios salen sin botones. Es una credencial |
| `META_WEBHOOK_VERIFY_TOKEN` | No (S9-02) | Texto al azar, inventado por quien opera la plataforma, que se escribe igual en Render y en el panel de Meta; solo sirve para la verificación inicial de la URL del webhook (`GET`) |
| `META_WHATSAPP_TEMPLATE_REMINDER_BUTTONS` / `META_WHATSAPP_TEMPLATE_REMINDER_DETAILED_BUTTONS` | No (S9-02; defaults `recordatorio_cita_botones` / `recordatorio_cita_consultorio_botones`) | Nombre de las plantillas de recordatorio **con botones**. Una plantilla se usa solo cuando su variable está definida y hay `META_APP_SECRET`. Ver «Respuestas de los pacientes por WhatsApp» |
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
| POST | `/` | Autenticado | Crea cita (transacción serializable: valida disponibilidad, evita traslapes, upsert de paciente). `typeId` opcional: el tipo de cita (por defecto, el predeterminado del consultorio, 30 min); su duración se copia a la cita (`durationMinutes`). `400` si el tipo no es un tipo **activo** del consultorio. Envía confirmación por WhatsApp/Email |
| PUT | `/:id` | Autenticado (dueño, o admin/secretaria) | Actualiza fecha, hora, estado, notas o `typeId` (otro tipo cambia la duración: se revisa como un cambio de horario). Si la cita **cambia de horario**, **cambia de duración** o se **reactiva** (de `cancelled` a otro estado) pasa por las mismas reglas que al agendar, dentro de una transacción serializable: `400` si el médico no atiende ese día (bloqueo de agenda) ni a esa hora o si la nueva hora ya pasó (salvo citas `completed`, para corregir el registro); `409` si otra cita activa del médico se traslapa con ese horario. Las reglas se aplican al médico dueño de la cita, no a quien edita. Cambiar solo estado o notas no revisa el horario, y cancelar tampoco |
| DELETE | `/:id` | Autenticado (dueño, o admin/secretaria) | **Cancela** la cita: la deja con `status: "cancelled"` (no se borra, para conservar historial y estadísticas) y libera el horario. Repetirlo da el mismo resultado. Responde `{ message, appointment }` |
| GET | `/unclosed` | Autenticado | Citas **pasadas que nadie cerró** (siguen `pending_approval`, `scheduled`, `confirmed`, `arrived` o `in_progress` aunque su hora ya pasó), de la más antigua a la más nueva: `{ total, appointments }` (hasta 50). Misma visibilidad que la lista |
| GET | `/attendance` | Autenticado | Control de asistencia de un mes (`?month=YYYY-MM`, el actual por defecto; un mes mal escrito da `400`): `{ month, attended, noShow, noShowRate, confirmed, notConfirmed, noShowByPatient }`. `noShowRate` = no asistieron ÷ (atendidas + no asistieron), en % con un decimal, o `null` si aún no se cerró ninguna; `noShowByPatient` son los 10 pacientes con más inasistencias (en todo el historial). Misma visibilidad que la lista |
| GET | `/:id/notifications` | Autenticado (dueño, o admin/secretaria) | Los mensajes que se enviaron sobre la cita (ver «Historial de mensajes»): `{ notifications, reminderPending }` |

**Estados de la cita (S8-05).** `pending_approval` → `scheduled` → `confirmed` → `arrived` (llegó) → `in_progress` (en consulta) → `completed`, y los finales `no_show` (no asistió) y `cancelled`. No hay un orden obligatorio, salvo una regla: **`no_show` solo se acepta cuando la hora de la cita ya llegó** (`400` si no). Una cita `no_show` puede corregirse a `completed` si el paciente llegó tarde. Todos conservan el horario (solo `cancelled` lo libera), el recordatorio de 24 h solo se manda a `pending_approval`, `scheduled` y `confirmed`, y un cambio hecho por administración/secretaría queda en la auditoría con el estado antes y después. En el Dashboard, el modal de la cita ofrece los pasos que corresponden al estado actual y un aviso lista las citas pasadas sin cerrar (**Seen** / **No-show**); en Reportes, el bloque **No-shows** muestra la tasa del mes, confirmadas contra sin confirmar y los pacientes que más faltan.

El calendario del frontend pide solo el rango de fechas que está mostrando (semana, mes, día o los 30 días de la agenda) y sigue las páginas hasta completarlo; los KPIs salen de `/stats`.

### Pacientes (`/api/patients`)

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/` | Autenticado | Lista paginada **de los pacientes del consultorio** (`page`, `pageSize`; máx. 100 por página), con búsqueda por `search` (nombre, teléfono, cédula), filtros `consent` (`none`, `granted`, `outdated`, `withdrawn`) y `minor` (`true`, `false`) y orden `sort` (`name`, `cedula`, `phone`, `age`, `createdAt`) y `order` (`asc`, `desc`). Ver «Lista de pacientes: filtros y orden» (S10.5-07) |
| GET | `/:id` | Autenticado | **La ficha** (S10-02): `{ patient, appointments, canViewClinical }`. `patient` trae los datos, la edad (`age: { years, months }`), `isMinor` y `missingGuardian`; `appointments`, de la más reciente a la más antigua, con médico, tipo y estado. Las `notes` de las citas son **notas administrativas** (*booking notes*) y las ven todos los roles; lo clínico va en la nota de consulta. `canViewClinical` dice si la pantalla puede pedir las partes clínicas. De otro consultorio, `404` |
| POST | `/` | Autenticado | Crea o actualiza (upsert por teléfono **dentro del consultorio**: el mismo teléfono en otro consultorio es otro paciente). Acepta los campos de la ficha |
| PUT | `/:id` | Autenticado | Actualiza datos del paciente y de su ficha. Solo cambia lo que se envía; una cadena vacía borra el campo |
| DELETE | `/:id` | Autenticado | Elimina un paciente **sin citas** (pensado para registros creados por error). Con cualquier cita —activa, cancelada o completada— responde `409` y lo conserva, porque ese historial es suyo; el mensaje distingue «tiene citas activas, cancélalas primero» de «tiene historial». `404` si no existe |
| GET | `/consent-document` | Autenticado | El texto del consentimiento de datos de salud vigente con el nombre del consultorio: `{ kind, version, title, paragraphs, methods }` |
| GET | `/:id/consents` | Autenticado | Cómo está el paciente respecto del consentimiento y todos sus eventos: `{ status: none \| granted \| withdrawn, upToDate, current, history, currentVersion }`. De otro consultorio, `404` |
| POST | `/:id/consents` | Autenticado | Registra que el paciente **dio** (`granted: true`) o **retiró** (`false`) el consentimiento, con `method` (`in_person_signed`, `in_person_verbal`, `electronic`, `other`). La versión es siempre la vigente; si se envía `documentVersion` y ya no lo es, `409`. Es un evento nuevo, nunca una edición. Quedó en el Activity Log si lo hizo un admin o una secretaria. `201` con el estado nuevo |
| GET | `/:id/export` | Solo admin | Todos los datos del paciente (ficha incluida) como archivo (`Content-Disposition: attachment`), en **JSON** (por defecto) o en **PDF** (`?format=pdf`, S10-07; otro formato, `400`): paciente, citas con sus notas, mensajes enviados (sin texto, con el destino enmascarado) y consentimientos. Cada exportación queda en el Activity Log (`read` sobre `patient_export`, con el `format` en `changes`). Secretaria y médico: `403` |

### Ficha del paciente (S10-02)

Además del nombre, teléfono, correo y cédula, `Patient` guarda (todo opcional, para que quien se reservó por teléfono siga sin ficha): `birthDate` (texto `YYYY-MM-DD` del consultorio, como `Appointment.date`), `sex` (`female`, `male`, `other`), `address`, `occupation`, `emergencyContactName`/`Phone`, `insuranceProvider`/`Number` y, para menores, el representante legal (`guardianName`, `guardianCedula`, `guardianPhone`, `guardianRelationship`).

- **Datos demográficos, no clínicos.** La secretaría los ve y los edita como el resto de la ficha administrativa; la regla clínica de S10-01 empieza en lo que viene después (antecedentes y alergias, notas de consulta, diagnósticos, signos vitales). Las notas de las citas son **notas de reserva** administrativas desde S10-04.
- **Validación** (`services/patientRecord.js`, mensajes en inglés): fecha real, no futura y no anterior a 1900; sexo de la lista; teléfonos de 6 a 25 caracteres (dígitos, `+`, espacios, `-`, paréntesis); textos de 60 a 300 caracteres. Se valida antes de tocar la base: un valor malo no guarda nada.
- **Edad.** Se calcula con la fecha del consultorio (su zona, S9-01), en años y meses; menores de 2 años se muestran en meses. `isMinor` = menor de 18. `missingGuardian` = menor sin `guardianName`: la pantalla avisa, pero **no bloquea** guardar (la secretaría no puede quedarse sin registrar a un niño por un dato que aún no tiene).
- **Auditoría.** Cada cambio queda como `update` sobre `patient` con **solo los nombres de los campos** que cambiaron; ni la dirección ni el contacto ni el seguro se copian al registro. Sin cambios, sin entrada.
- **Reservas.** Reservar o crear un paciente existente (por teléfono) no borra su ficha: solo se tocan los campos que se envían.
- **Pantalla.** `/patients/:id` (desde el nombre o el icono de la tarjeta en Patients): datos, aviso de menor sin representante, edición en la misma página y las citas.
- **Migración** `20261027100000_add_patient_record_fields`: solo `ADD COLUMN` nulos; probada sobre datos existentes en `tests/patientRecordMigration.test.js`.

### Antecedentes y alergias (S10-03)

Rutas bajo `/api/patients/:id/clinical`, protegidas por `auth` y `clinicalAccess` (S10-01): **médico y admin**; la secretaría recibe `403` en todas y un paciente de otro consultorio, `404`. Cada ruta busca primero al paciente dentro del consultorio de quien pregunta.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/summary` | `{ allergies, medications, backgrounds }` en una llamada (lo que usa la ficha y el aviso de la cita). **Una** entrada de auditoría (`read`, `section: summary`) |
| GET | `/allergies`, `/medications`, `/backgrounds` | La lista; `read` con la sección. Alergias y medicación: activas primero, las más graves primero, luego las más nuevas |
| POST | `/allergies`, `/medications`, `/backgrounds` | Crea una entrada (`201`). Máximo 100 por tipo y paciente (`409`) |
| PUT | `/<tipo>/:itemId` | Cambia solo lo enviado; cadena vacía borra un campo opcional. `active: false` = alergia resuelta o medicamento suspendido: **se conserva** |
| DELETE | `/<tipo>/:itemId` | Para algo escrito por error |

- **Campos** (`services/clinicalBackground.js`): alergia = `substance` (obligatoria), `reaction`, `severity` (`mild`, `moderate`, `severe`), `active`; medicación = `name` (obligatorio), `dose`, `frequency`, `active`; antecedente = `category` (`personal`, `family`, `surgical`, `habit`; obligatoria), `description` (obligatoria, hasta 500) y `noted` (cuándo, texto libre). Cada fila guarda quién la registró (`recordedById`/`recordedByName`, como texto para que sobreviva a la cuenta).
- **Auditoría de cambios** (`recordClinicalWrite`): a diferencia de `recordAudit`, **se escribe también cuando actúa un médico**. Entidades `patient_allergy`, `patient_medication`, `patient_background`; `changes` lleva el paciente (`patientId`), si sigue activo o la categoría, y de los demás campos **solo que cambiaron**, nunca su texto. Un cambio sin cambios no deja entrada.
- **Aviso.** `ClinicalAlert` muestra en rojo las alergias activas (con su gravedad) y la medicación habitual, arriba de la ficha y en la ventana de la cita para médico y admin; la secretaría no lo pide. Cada vez que se abre es una lectura auditada.
- **Un paciente con datos clínicos no se borra**: las claves foráneas son `RESTRICT` (a diferencia de los consentimientos, que se van con el paciente), y `DELETE /api/patients/:id` responde `409`. La exportación de datos del paciente incluye las tres listas.
- **Migración** `20261028100000_add_clinical_background`: solo crea tres tablas; probada sobre datos existentes en `tests/clinicalBackgroundMigration.test.js`.
- **Pendiente (S10-04).** Las notas internas de las citas siguen viéndose en la agenda para todos los roles; la nota de consulta SOAP las reemplazará con acceso clínico.

### Nota de consulta SOAP (S10-04)

La nota clínica de una cita, en las cuatro partes del formato SOAP: **S**ubjetivo (lo que cuenta el paciente), **O**bjetivo (lo que se observa y mide), **A**nálisis (la impresión diagnóstica) y **P**lan. Rutas bajo `/api/patients/:id/clinical/notes`, con la misma regla que el resto de lo clínico: médico y admin; secretaría `403`; otro consultorio `404`.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/templates` | `general`, `pediatrics`, `blank` |
| GET | `/` | Las notas del paciente, **sin texto** (cita, autor, estado, fechas, cuántas adendas). `read` auditado |
| GET | `/:noteId` | La nota con su texto, su `revision` y sus adendas. `read` auditado con `section: note:<id>` |
| POST | `/` | `{ appointmentId, template }` (por defecto `general`). Una nota por cita: otra igual da `409` con el `noteId` existente; cita cancelada, `409`; cita de otro paciente u otro consultorio, `404` |
| PUT | `/:noteId` | Guarda el borrador: `{ revision, subjective?, objective?, assessment?, plan? }` (hasta 10 000 caracteres cada una). Devuelve la `revision` nueva |
| POST | `/:noteId/close` | `{ revision }`. Cierra la nota, definitivamente, y **pasa la cita a `completed`** si seguía abierta (S10.5-01) |
| POST | `/:noteId/addenda` | `{ text }` (hasta 5 000). Solo a una nota cerrada |
| DELETE | `/:noteId` | Solo un borrador |

- **Quién hace qué.** Cualquier médico o admin la inicia y queda como **autor**. Solo el autor edita, cierra o borra el borrador (`403` para los demás, también el admin). Cualquier médico o admin agrega una adenda, con su propio nombre y fecha. Una nota **cerrada** nunca se edita ni se borra; una adenda tampoco (no hay ruta).
- **La cita se completa al cerrar (S10.5-01).** En la misma transacción del cierre, una cita en `pending_approval`, `scheduled`, `confirmed`, `arrived` o `in_progress` pasa a `completed` y queda en el Activity Log como un cambio de estado de la cita (`status: { from, to }`, también para un médico). Una cita `no_show`, `cancelled` o ya `completed` no se toca ni deja entrada. Si el cierre se rechaza, la cita no cambia. Con eso la cita sale de «citas sin cerrar» y cuenta en la asistencia sin que nadie pulse **Seen**. Las constantes de estados abiertos están en `utils/appointmentStatus.js`.
- **Autoguardado sin pisarse.** La pantalla guarda a los 1,5 s de dejar de escribir. Cada guardado lleva la `revision` que vio; si otra pestaña guardó en medio, responde `409` con `currentRevision` y la pantalla ofrece recargar, en vez de sobrescribir. Dos guardados simultáneos con la misma revisión: gana uno. Al salir de la pantalla se guarda lo pendiente y el navegador avisa antes de cerrar la pestaña con cambios sin guardar.
- **Cerrar.** Se rechaza (`400`) una nota en la que solo están los encabezados de la plantilla. Guarda quién la cerró y cuándo.
- **Plantillas.** Solo ponen encabezados en español en las cuatro partes (motivo de consulta, examen físico, impresión diagnóstica, tratamiento...); el médico cambia lo que quiera.
- **Auditoría** (`recordClinicalWrite`, también para médicos): `create`, el cierre (`update` con `status: draft → closed`), `delete` de un borrador y cada adenda, siempre con el paciente y **sin el texto**. **Los guardados del borrador no se registran uno por uno** (serían una entrada por pausa al escribir); la lectura sí, siempre.
- **Notas administrativas de la cita.** `Appointment.notes` sigue existiendo pero ya no es clínico: se llama *Booking notes* en la pantalla, con el aviso de no escribir datos médicos, y las ven todos los roles (incluida la ficha, donde S10-02 las ocultaba a la secretaría). Las ya guardadas no se tocaron.
- **Integridad.** `RESTRICT`: no se borra una cita ni un paciente con nota (`409` al borrar el paciente) ni una nota con adendas. La exportación de datos del paciente incluye las notas con sus adendas.
- **Migración** `20261029100000_add_consultation_notes`: solo crea dos tablas, probada con datos existentes en `tests/consultationNotesMigration.test.js`.
- **Pantalla.** `/patients/:id/appointments/:appointmentId/note`, desde la cita en la agenda («Consultation note») o desde la ficha («Write note», «Continue draft», «Open note»), con el aviso de alergias arriba. Los diagnósticos codificados (CIE-10) llegan con S10-05 y los signos vitales con S10-06.

### Diagnósticos CIE-10 (S10-05)

El médico escribe el diagnóstico de la nota eligiéndolo de la lista CIE-10 por **código** o por **nombre** (sin importar mayúsculas ni tildes), o lo escribe como **texto libre** cuando no está en la lista.

**MedCita no incluye la clasificación.** La tabla `DiagnosisCode` nace vacía y se carga con un comando desde un archivo local; el repositorio (público) no contiene la lista. Mientras esté vacía, la búsqueda no encuentra nada, la pantalla lo avisa y el texto libre sigue funcionando.

- **Cargar:** `npm run diagnoses:import -- <archivo> [--source msp-rdacaa] [--version CIE10]`. Acepta el `CIE.sql` (sentencias `INSERT`) del Ministerio de Salud Pública o un CSV/TSV de «código, nombre» por línea. Reemplaza, en una transacción, las filas del mismo `--source` y no toca nada más (los diagnósticos ya escritos en notas llevan su propia copia). Carga ~14 500 filas en menos de un segundo. En una base que no sea local exige nombrar el host: `DIAGNOSES_IMPORT_HOST=<host> npm run diagnoses:import -- <archivo>`.
- **Los códigos.** Se guardan con punto después del tercer carácter (`E11.9`) y se aceptan con o sin él (`e119`). Un código que se subdivide (`T90` en `T90.0`, `T90.1`...) es un **encabezado** (`selectable: false`) y no se puede elegir ni sale en la búsqueda.
- **Rutas.** `GET /api/diagnoses/search?q=&limit=` (2 caracteres como mínimo, hasta 50 resultados; algo que parece un código busca por el inicio del código, lo demás exige que estén todas las palabras en el nombre) y `GET /api/diagnoses/status` (cuántos códigos hay y de qué fuente). Solo médico y admin (`clinicalAccess`); no se auditan porque la lista es la misma para todos los consultorios y no contiene datos de pacientes.
- **Diagnósticos de la nota** (`/api/patients/:id/clinical/notes/:noteId/diagnoses`, `POST`, `PUT /:diagnosisId`, `DELETE /:diagnosisId`): `{ code }` (el nombre sale de la lista, no del cuerpo) o `{ name }` en texto libre (hasta 300 caracteres), `kind` (`primary` o `secondary`, por defecto `secondary`) y `certainty` (`presumptive` o `definitive`, por defecto presuntivo). Máximo 20 por nota; el mismo código dos veces, `409`; una nota tiene **un solo principal**: marcar otro lo pasa a secundario. El nombre solo se cambia en los de texto libre.
- **Reglas de la nota.** Igual que el texto: solo el autor del borrador los cambia; con la nota cerrada son definitivos (`409`). Las operaciones bloquean la fila de la nota (`FOR UPDATE`), así que cerrarla no puede colarse entre la comprobación y el cambio. Borrar un borrador se lleva sus diagnósticos. Como el texto del borrador, **los cambios sobre los diagnósticos de un borrador no se registran uno por uno** (cada fila guarda quién la agregó); su lectura sí, porque viajan con la nota.
- **Copia, no enlace.** El código y el nombre se **copian** a la nota: una nota cerrada dice siempre lo que decía, aunque la lista se recargue o cambie después. La nota abierta trae `diagnoses` (el principal primero), la lista de notas trae `principalDiagnosis`, y la exportación de datos del paciente incluye los diagnósticos.
- **Presentación.** La lista del Ministerio viene en mayúsculas y casi sin tildes (`COLERA DEBIDO A...`): se guarda tal cual y la pantalla la muestra como oración. No se cambia ningún código ni nombre.
- **Migración** `20261030100000_add_diagnoses`: solo crea dos tablas (la lista, vacía, y los diagnósticos), probada con datos existentes en `tests/diagnosesMigration.test.js`. Las pruebas y el seed usan códigos y nombres **inventados** o texto libre.

**De dónde sale la lista y el riesgo de licencia (a leer antes de cobrar).** Verificado el 23-oct-2026:

- La **OMS es titular del copyright del CIE-10** y puede licenciarlo para uso comercial y no comercial. Según su documento «FAQ Licensing ICD-10» (`cdn.who.int/media/docs/default-source/publishing-policies/copyright/who-faq-licensing-icd-10.pdf`; los metadatos del PDF son de 2014, así que **hay que confirmar los términos vigentes**), para incorporar la clasificación a un producto de software que se vende, la OMS emite una **licencia comercial** «no exclusiva, intransferible y por tiempo limitado», que no permite modificar, traducir ni enmendar los códigos o descripciones ni sugerir que la OMS respalda el producto. La solicitud va por el formulario de licencias de la OMS (`licensing@who.int`). La versión **en español** la gestiona la OPS (`pubrights@paho.org`); la OMS solo distribuye en formato de base de datos la inglesa y la francesa.
- La lista que se carga es la que el **Ministerio de Salud Pública del Ecuador** publica en su repositorio abierto de RDACAA: `https://gitlab.com/MSP_EC/rdacaa`, archivo `base_rdacaa/Scripts/SCRIPTS_SQLITE/CIE.sql` (14 462 filas CIE-10). El repositorio está bajo **GPL-3.0** (en una traducción no oficial; GitLab lo etiqueta «Other»), **no dice de dónde sale la lista ni da condiciones de reutilización propias para ella**, y su README apunta a otro servidor (`git.msp.gob.ec`). No encontré una publicación del MSP o del INEC con condiciones explícitas para la lista.
- **Eso no es una licencia de la OMS ni de la OPS.** Cargar la lista del MSP fue una decisión consciente de quien lleva el proyecto, tomada con este riesgo a la vista. Para no redistribuirla, **el archivo no se guarda en el repositorio**: se descarga y se carga en cada base con el comando de arriba. Si más adelante se obtiene la licencia de la OMS/OPS, se carga su archivo con `--source` propio (los códigos del mismo `--source` se reemplazan); si se decide dejar de usar la lista, basta vaciar la tabla (`DELETE FROM "DiagnosisCode"`), sin tocar las notas.
- Queda anotado entre los puntos para el abogado (`docs/legal/puntos-para-el-abogado.md`, 1.6).

### Signos vitales y medidas (S10-06)

Rutas bajo `/api/patients/:id/clinical/vitals`, con la misma regla que el resto de lo clínico: médico y admin; secretaría `403`; otro consultorio `404`. Una fila (`PatientVitals`) es **una toma**: peso, talla, presión arterial, frecuencia cardíaca, frecuencia respiratoria, temperatura y saturación de oxígeno. Cualquiera puede faltar, no todas. Solo unidades métricas.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/` | `{ readings, truncated }`: las tomas del paciente, la más reciente primero (por cuándo se midió, no por cuándo se escribió), **también las anuladas** (marcadas), cada una con su `bmi`. Hasta 500; `truncated` avisa si hay más. `read` auditado (`section: vitals`) |
| POST | `/` | Registra una toma (`201`). `measuredAt` opcional (por defecto ahora), `appointmentId` opcional |
| POST | `/:vitalId/void` | `{ reason? }`. Anula una toma hecha por error. La puede anular quien la registró o un admin |

- **Validación** (`services/vitals.js`; mensajes en inglés): cada medida es un número (no texto) dentro de un rango que solo descarta lo imposible —no dice qué es normal—: peso 0,3 a 500 kg (hasta 2 decimales), talla 20 a 260 cm (1 decimal), sistólica 40 a 300 y diastólica 20 a 200 mmHg, frecuencia cardíaca 20 a 300, respiratoria 4 a 100, temperatura 25 a 45 °C (1 decimal), saturación 30 a 100 %. La presión va **completa o no va** y la sistólica debe ser mayor que la diastólica. Al menos una medida. `measuredAt`: ISO 8601, no en el futuro (se toleran 5 minutos de reloj adelantado) ni antes de 2000. `appointmentId` debe ser una cita **del mismo paciente y consultorio**, o `404`.
- **IMC.** No se guarda: se calcula (kg/m², un decimal) con el peso y la talla **de la misma toma**; sin los dos es `null`. Es el cálculo de adultos; no hay percentiles para niños.
- **Una toma no se edita ni se borra** (no hay ruta: `404`). Una hecha por error se **anula**: queda en el historial, tachada y con quién la anuló y por qué, pero sale de las gráficas y de los «últimos valores». Anular dos veces, `409`.
- **Auditoría** (`recordClinicalWrite`): crear una toma y anularla, con el paciente y la cita, **nunca las medidas ni el motivo** (del motivo solo que existe). Cada lectura del historial también queda.
- **Integridad.** `RESTRICT`: no se borra un paciente (`409`) ni una cita con tomas. La exportación de datos del paciente incluye `vitalSigns` (todas, también las anuladas, de la más antigua a la más reciente).
- **Migración** `20261031100000_add_patient_vitals`: solo crea una tabla, probada con datos existentes en `tests/vitalsMigration.test.js`.
- **Pantallas.** En la ficha, «Vital signs» (solo médico y admin): el último valor de cada medida con su fecha (un peso puede ser de hace un mes y un pulso de hoy), una **gráfica** por medida (peso, IMC, presión con dos líneas, pulso, respiración, temperatura, saturación; la librería de gráficas solo se descarga si el paciente tiene tomas), el historial completo y el formulario «Record vitals». En la nota de consulta, «Vital signs of this visit» registra y muestra las tomas de esa cita.
- **Pendiente.** Las tomas no se comparan con rangos normales por edad ni se marcan como fuera de rango; tampoco hay curvas de crecimiento pediátricas.

### Línea de tiempo y exportación clínica (S10-07)

**Línea de tiempo.** `GET /api/patients/:id/clinical/timeline` (médico y admin; secretaría `403`; otro consultorio `404`): la historia del paciente en un solo orden, la más reciente primero. Cada evento es `{ type, at, id, ... }`:

| `type` | Cuándo (`at`) | Qué trae |
|---|---|---|
| `appointment` | el instante de la cita, en la zona del consultorio | fecha, hora, estado, médico, tipo, `noteId` si tiene nota |
| `note` | cuando se **cerró** (un borrador: la última vez que se tocó) | estado, autor, quién la cerró, `diagnoses` (el principal primero) y cuántas adendas; **nunca el texto de la nota** |
| `addendum` | cuando se escribió | autor y texto de la adenda |
| `vitals` | cuando se **midió** | las medidas, el IMC y `voided` |
| `consent` | cuando se registró | otorgado o retirado, versión del texto, método, quién lo registró |

- **Parámetros.** `types` (lista separada por comas de los de arriba; otro valor, `400`), `limit` (1 a 200, por defecto 50) y `before` (fecha ISO: solo lo **estrictamente más antiguo**). La respuesta trae `nextBefore` para pedir la página siguiente (`null` en la última). Una página **nunca parte los eventos del mismo instante**: si el corte cae en medio de un empate, la página los incluye todos.
- **Auditoría.** Cada llamada es una lectura (`section: timeline`). Los parámetros desconocidos se ignoran.
- **Límite de lectura.** Se carga la historia del paciente y se mezcla aquí, hasta 2 000 por tipo, para no cargar entera una historia desbordada.
- **Pantalla.** `/patients/:id/timeline` (botón «Timeline» de la ficha, solo médico y admin): los eventos por mes, con filtros (todo, visitas, notas, signos vitales, consentimientos), enlaces a la nota de cada visita y «Show older» para la página siguiente.

**Exportación en PDF.** `GET /api/patients/:id/export?format=pdf`: el mismo contenido que el JSON (`services/patientExport.js` arma los datos, `services/patientExportPdf.js` los dibuja) pensado para leerse y entregar al paciente. Solo admin, igual que el JSON. Es un **documento para el paciente, así que está en español**: datos personales y representante legal, consentimiento, alergias, medicación, antecedentes, signos vitales (las anuladas marcadas), cada nota de consulta con sus cuatro partes, diagnósticos y adendas (un borrador dice «BORRADOR sin cerrar»), citas y mensajes enviados (sin su texto, con el destino enmascarado). Las notas salen **por fecha y hora de la visita** (no por cuándo se escribió cada nota) y un título —de sección, de consulta o de una de las cuatro partes— **nunca queda solo al pie de una página**: el dibujo mide el título junto con lo que le sigue y salta de página una sola vez (S10.5-01). Las fechas van en la zona del consultorio y cada página lleva el nombre del consultorio y del paciente, «confidencial» y su número.

- **Qué lleva el PDF** se arma primero como una lista de bloques (`buildBlocks`), aparte de cómo se dibuja, para poder probarlo sin leer un PDF.
- **Tipografía.** Usa **DejaVu Sans** (`backend/src/assets/fonts/`, sin modificar, con su licencia en `LICENSE.txt`) y no las fuentes estándar de los PDF, que solo imprimen Latin-1: un «β-bloqueante» o un «SpO₂» escrito por el médico no saldrían. El PDF se hace con `pdfkit` (MIT), dependencia nueva del backend.
- **Pantallas.** «Export PDF» en la ficha y un segundo icono de descarga en cada tarjeta de Patients (solo admin).
- **Sin migración.**

### Disponibilidad (`/api/availability`)

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/` | Autenticado | Horario semanal del médico (o `doctorId` dado, que debe ser de tu consultorio: otro responde `404 Doctor not found`, igual que en `/slots` y `POST`). Si no hay ninguno configurado, devuelve un fallback de demo (Lun-Vie 8:00-18:00) |
| GET | `/slots?date=YYYY-MM-DD` | Autenticado | Lista vacía si el día está bloqueado. Si no, horarios `{ time, status: available \| booked }` de una fecha. `typeId` opcional (tipo activo del consultorio; si no, el predeterminado): cada horario dura lo que el tipo, ver «Tipos de cita y duración». `400` con un tipo que no sea del consultorio o esté archivado |
| POST | `/` | Autenticado | Reemplaza el horario completo del médico (array de `{ dayOfWeek, startTime, endTime }`) |

### Tipos de cita (`/api/appointment-types`)

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/` | Autenticado | Los tipos **activos** del consultorio, el predeterminado primero y luego por nombre: `[{ id, name, durationMinutes, color, isDefault, active }]`. Crea el predeterminado si aún no existe. Un admin puede pedir también los archivados con `?includeArchived=true` |
| POST | `/` | admin | `{ name, durationMinutes, color? }`: nombre de 2 a 40 caracteres (único en el consultorio, `409` si se repite), duración de 5 a 240 minutos **en múltiplos de 5**, color `#rrggbb` (por defecto `#0ea5e9`). Hasta 30 tipos por consultorio |
| PUT | `/:id` | admin | Cambia `name`, `durationMinutes`, `color` y/o `active`. El predeterminado se puede renombrar y cambiar de duración, pero no archivar (`400`). `404` si es de otro consultorio |
| DELETE | `/:id` | admin | **Archiva** el tipo (`active: false`): deja de ofrecerse y las citas que lo tienen lo conservan. Repetirlo da el mismo resultado; el predeterminado no se puede archivar. Para recuperarlo, `PUT { active: true }` |

Todo cambio queda en el registro de auditoría (`entity: appointment_type`, con nombre, duración, color y estado antes y después).

### Tipos de cita y duración (S9-04)

- **Modelo.** `AppointmentType` (consultorio, nombre, duración, color, `isDefault`, `active`) y en `Appointment` dos columnas: `typeId` y `durationMinutes`. La duración se **copia a la cita al agendar**: editar un tipo después no mueve ni traslapa lo que ya está en la agenda.
- **Tipo predeterminado.** Cada consultorio tiene exactamente uno: «Consultation», 30 min, el que reemplaza lo que eran todas las citas antes. La migración lo crea para los consultorios existentes y asocia a él **todas las citas existentes** (también las canceladas); para un consultorio nuevo se crea la primera vez que hace falta (`services/appointmentTypes.js`), así que ningún flujo de alta tiene que acordarse.
- **`typeId` es opcional en la base de datos, a propósito.** Si fuera obligatorio, la versión anterior del código no podría agendar entre la migración y el despliegue nuevo, y volver a una versión anterior dejaría la agenda sin poder escribir (lo que pasó con S8-01 el 21-oct). Con la columna opcional, una cita sin tipo vale como del predeterminado (30 min por defecto) y volver atrás es seguro. La aplicación siempre lo rellena.
- **Reglas de agenda.** Una cita cabe si **empieza y termina dentro de un bloque de trabajo** del médico (terminar justo cuando termina el bloque es válido; `400 The appointment does not fit in the doctor's working hours` si se pasa) y **no se traslapa** con otra cita activa del mismo médico y día: pegadas una tras otra sí caben. Una cita no puede pasar de medianoche. Si el médico no tiene horario configurado (modo demo) solo rige esto último.
- **Horarios libres (`/slots`).** Dentro de cada bloque se ofrece un horario cada `duración` minutos desde el inicio del bloque, **más uno justo donde termina cada cita ya agendada**, para que una cita de 40 minutos no deje un hueco inservible. Un horario cuenta como `booked` si se traslapa con cualquier cita, sea cual sea su duración. Con el tipo predeterminado el resultado es el de antes (cada 30 minutos).
- **Interfaz.** Settings (solo admin) lista, crea, edita y archiva tipos; la nueva cita pide el tipo antes de la fecha (solo si hay más de uno); el calendario dibuja cada cita con la duración de su tipo y marca su color; el detalle de la cita muestra tipo y duración. Los reportes por tipo llegan con S9-06.

### Bloqueos de agenda (`/api/schedule-blocks`)

Días en que un médico, o todo el consultorio, no atiende: vacaciones, un congreso, un feriado. Son **días completos** (`startDate` a `endDate`, ambos incluidos, `YYYY-MM-DD` en la hora del consultorio).

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/` | Autenticado | Los bloqueos que tocan el rango `?from`..`?to` (opcionales, inclusivos), por fecha: `[{ id, scope: doctor \| clinic, doctorId, doctorName, startDate, endDate, reason, createdAt }]`. Admin y secretaria ven todos del consultorio (o los que tocan a un médico con `?doctorId`); un médico solo ve los suyos y los de todo el consultorio |
| POST | `/` | Autenticado | Bloquea días: `{ startDate, endDate?, reason, scope?, doctorId? }`. `endDate` por defecto es `startDate`; `reason` de 2 a 120 caracteres; hasta 366 días por bloqueo y 500 por consultorio; no puede terminar en el pasado. `scope: "doctor"` (por defecto): admin/secretaria indican `doctorId` (de su consultorio, si no `404`); un médico bloquea su propia agenda (otro `doctorId` → `403`). `scope: "clinic"`: solo admin/secretaria (`403` para un médico). Responde `201 { block, affectedTotal, affectedAppointments }` con las citas **ya agendadas** en esos días (hasta 200, sin las canceladas). **No se cancela ninguna**: se listan para reprogramarlas |
| GET | `/:id/appointments` | Autenticado | Lo que sigue agendado dentro del bloqueo (`{ block, affectedTotal, affectedAppointments }`); un médico ve solo sus citas. Baja a medida que se reprograman o cancelan. `404` si el bloqueo es de otro consultorio o de otro médico |
| DELETE | `/:id` | Autenticado | Abre los días otra vez. Admin y secretaria quitan cualquiera del consultorio; un médico solo los suyos (uno de todo el consultorio da `403`, el de otro médico `404`) |
| GET | `/holidays?year=` | Autenticado | Feriados nacionales de Ecuador del año (2000 a 2100; el actual por defecto): `{ year, holidays: [{ date, name, note }] }`. Atajo para bloquear el consultorio, **no un calendario oficial** |

### Bloqueos de agenda (S9-05)

- **Qué cambian.** En un día bloqueado para el médico (suyo o de todo el consultorio): `POST /appointments` responde `400 The doctor does not attend on this date`; mover una cita a ese día o reactivar una cancelada también; y `GET /availability/slots` devuelve `[]`. Las citas que **ya estaban** ese día se quedan (el médico las reprograma o cancela) y pueden seguir cambiando de estado o de tipo; sacarlas de ahí sí está permitido. Los bloqueos se suman: quitar uno deja cerrados los días que otro sigue cubriendo.
- **Atajo de feriados.** `services/ecuadorHolidays.js` calcula los feriados nacionales: fijos (Año Nuevo, Día del Trabajo, Batalla de Pichincha, Primer Grito, Independencia de Guayaquil, Difuntos, Independencia de Cuenca, Navidad) y los que dependen de la Pascua (Carnaval lunes y martes, Viernes Santo). Es solo un punto de partida: el Ministerio del Trabajo puede trasladar varios a un lunes y los feriados locales no están, así que la pantalla los muestra editables (fecha y motivo) y avisa antes de guardar. Se bloquea el consultorio entero, un bloqueo por feriado.
- **Modelo.** `ScheduleBlock` (consultorio, `doctorId` opcional —nulo es todo el consultorio—, fechas, motivo). Borrar a un médico borra sus bloqueos (`ON DELETE CASCADE`); los de todo el consultorio no se tocan.
- **Auditoría.** Crear y quitar bloqueos (cuando los hace admin o secretaria) queda como `entity: schedule_block` con las fechas; **el motivo no se guarda** en el registro porque es texto libre («operación de rodilla») que puede decir de más.
- **Interfaz.** Sección «Time off» en la página Availability (lista de lo que viene, formulario, atajo «Ecuador holidays», y por bloqueo las citas que siguen agendadas); el calendario los dibuja como eventos de todo el día y tiñe esos días; la nueva cita dice que el médico no atiende en vez de mostrar una lista vacía. Los bloqueos por horas (medio día) no existen todavía: son días completos.

### Reporte de asistencia (S9-06)

`GET /api/admin/reports/attendance` (solo admin, como la pantalla Analytics) cuenta las citas cuya **fecha** cae en el periodo, con la fecha del consultorio. Periodo: `from` y `to` (ambos incluidos; hasta 1096 días, tres años; por defecto el mes en curso completo, en la zona del consultorio (así lo que está agendado para más adelante y espera confirmación también cuenta)) y, opcionalmente, un solo médico (`doctorId`).

- **Cifras.** Cada fila trae `total`, `attended` (llegó, en consulta o atendida), `noShow`, `cancelled`, `confirmed`, `notConfirmed` (pendiente o agendada, aún sin respuesta) y `noShowRate`: no asistieron ÷ (atendidas + no asistieron), en % con un decimal, o `null` mientras no se haya cerrado ninguna cita (es la misma definición que `GET /appointments/attendance`). Las canceladas no entran en la tasa.
- **Tres cortes.** `totals` (todo el periodo), `byDoctor` y `byType` (cada tipo de cita con su nombre y color), de mayor a menor número de citas. Una cita agendada antes de que existieran los tipos cuenta como del tipo predeterminado. Un tipo archivado sigue apareciendo en los periodos en que se usó.
- **Pacientes.** `noShowByPatient` son los 10 pacientes con más inasistencias del periodo (se muestran en pantalla, no se exportan).
- **CSV.** `GET /api/admin/reports/attendance/export` devuelve `text/csv; charset=utf-8` con BOM (Excel lee bien las tildes), una fila `total`, una por médico y una por tipo, con las columnas `section,name,total,attended,no_show,cancelled,confirmed,not_confirmed,no_show_rate_percent` y la tasa vacía cuando no hay citas cerradas. **Solo conteos: ningún dato de pacientes** (ni nombre, ni teléfono, ni notas). Los nombres de médicos y de tipos los escribe gente, así que uno que empiece con `=`, `+`, `-` o `@` se neutraliza con una comilla para que una hoja de cálculo no lo ejecute como fórmula. Como no lleva datos de pacientes, la descarga no se registra en el Activity Log. Nota de uso: el CSV va separado por comas y los decimales con punto; si un Excel con configuración regional en español lo abre todo en una columna, usar *Datos → Desde texto/CSV* (o abrirlo con Google Sheets o LibreOffice).
- **Pantalla.** En Analytics, el bloque «No-shows» tiene periodos rápidos (este mes completo, el mes pasado, últimos 30 días, este año completo), fechas libres, filtro por médico, la tasa, confirmadas contra sin confirmar, tablas por médico y por tipo de cita con la tasa en barras, los pacientes que más faltan y el botón «Export CSV». Reemplaza al selector de mes de S8-05, que sigue disponible en la API (`GET /appointments/attendance`).

### Recordatorios configurables (S9-03)

Cada consultorio decide cómo recuerda a sus pacientes, en *Settings → Reminders* (solo admin; `GET` y `PUT /api/admin/reminder-settings`). Se guarda en columnas de `Clinic`; los valores por defecto son lo que hacían todos antes: activado, **24 horas**, WhatsApp y correo, un solo recordatorio, sin nada añadido. La migración no cambia el comportamiento de ningún consultorio existente.

- **Qué se configura.** `reminderEnabled`; `reminderHours` (cuánto antes: **2, 24 o 48**); `secondReminderHours` (opcional, también 2, 24 o 48, y **más cercano** a la cita que el primero); `reminderWhatsapp` y `reminderEmail` (al menos uno si está activado); `address` y `reminderIndications` (texto de una sola línea, 150 y 200 caracteres). Una combinación sin sentido responde `400` y no guarda nada. El cambio rige desde la siguiente corrida horaria; lo ya recordado no se recuerda otra vez.
- **El proceso.** `tasks/reminderTask.js` recorre los consultorios y, para cada uno con recordatorios activos, hace una o dos **rondas**: la primera (`reminderSentAt`) con su anticipación y la segunda (`secondReminderSentAt`). En cada ronda toma las citas `pending_approval`, `scheduled` o `confirmed` cuya hora local cae entre «ahora» y «ahora + horas», las reclama de forma atómica antes de enviar y, si ningún canal entrega, suelta la reclamación para reintentar. El día se dice según el calendario del consultorio: «hoy», «mañana», «pasado mañana» o «el».
- **Segundo recordatorio.** No se manda si el primero **ya salió dentro de su ventana** (una cita agendada una hora antes no recibe dos mensajes seguidos): en ese caso la fecha del segundo queda anotada y deja de deberse. En el historial de mensajes aparece como `appointment_second_reminder` («Second reminder»).
- **Canales.** WhatsApp y correo se apagan por separado; el correo solo sale si el paciente tiene uno. Un consultorio sin ningún canal no envía nada (y la cita no figura como «recordatorio pendiente»).
- **El texto de WhatsApp sigue siendo la plantilla aprobada por Meta** (`recordatorio_cita`). Lo editable son sus variables: el nombre del consultorio, la dirección y las indicaciones van en una plantilla aparte, `recordatorio_cita_consultorio` (6 variables), que usan los consultorios que escribieron una dirección o indicaciones **solo cuando esa plantilla está registrada y aprobada** (`META_WHATSAPP_TEMPLATE_REMINDER_DETAILED`, ver `docs/DEPLOY.md`). Mientras no lo esté, Meta envía la plantilla sencilla y la dirección y las indicaciones llegan **por correo**; Twilio y el modo simulado, que mandan texto libre, las incluyen siempre. La pantalla muestra la vista previa real y avisa cuando los detalles no van por WhatsApp.
- **Consumo.** La respuesta trae `usage`: los mensajes del mes (en el calendario del consultorio) que **realmente salieron** (`status: sent`), por WhatsApp y por correo, y cuántos fueron recordatorios. Los fallidos y los simulados no cuentan. Cada mensaje de WhatsApp fuera de la ventana de 24 h tiene costo con Meta; las tarifas están en `docs/DEPLOY.md`.
- **Auditoría.** Cada cambio queda en el Activity Log (`entity: reminder_settings`) con los interruptores y las horas antes y después; de la dirección y las indicaciones solo consta que cambiaron.

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
| GET | `/reports/attendance` | admin | Asistencia de un periodo (ver «Reporte de asistencia»): `?from`, `?to` (`YYYY-MM-DD`, ambos incluidos; el mes en curso por defecto) y `?doctorId` (`404` si no es de tu consultorio). Responde `{ from, to, doctorId, totals, byDoctor, byType, noShowByPatient }` |
| GET | `/reminder-settings` | admin | Cómo recuerda el consultorio a sus pacientes: `{ enabled, hours, secondHours, whatsapp, email, address, indications, options: { hours }, usage, preview }` (ver «Recordatorios configurables») |
| PUT | `/reminder-settings` | admin | Cambia cualquiera de `enabled`, `hours` (2, 24 o 48), `secondHours` (`null` o 2, 24, 48 y más cercano que `hours`), `whatsapp`, `email`, `address` (hasta 150 caracteres) e `indications` (hasta 200). Responde igual que el `GET` |
| GET | `/reports/attendance/export` | admin | El mismo reporte como CSV descargable (`attendance_<from>_<to>.csv`), solo conteos |
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

Desde S7-09 queda escrito qué hicieron los **administradores y las secretarias** sobre las citas, los pacientes y las cuentas de usuario; desde S8-03 también **cómo entra la gente**: cada inicio de sesión y cada cambio de contraseña, de **cualquier rol**. Un médico que trabaja con su propia agenda no genera registro de sus citas ni de sus pacientes. Desde S9-02 también queda escrito lo que **el paciente** hace con los botones del recordatorio de WhatsApp (confirmar o cancelar su cita): `actor.role` = `patient`, nombre «Patient (WhatsApp)» y su id (nunca su nombre ni su teléfono).

**Qué se registra.** Cada entrada tiene quién (`actor`: id, nombre y rol *en ese momento*), cuándo (`createdAt`), qué (`action`: `create`, `update`, `cancel`, `delete`, `login`, `login_failed`, `password_change`, `password_reset` o `read`; `entity`: `appointment`, `patient`, `user`, `invitation`, `consent`, `patient_export`, `appointment_type`, `schedule_block`, `reminder_settings`, `clinical_record`, `patient_allergy`, `patient_medication`, `patient_background`, `consultation_note`, `consultation_addendum` o `patient_vitals`, y `entityId`), desde dónde (`ip` y `userAgent`, recortado a 255 caracteres; la IP de un cliente IPv4 se guarda sin el prefijo `::ffff:`), el médico afectado (`doctor`, cuando la acción toca su agenda) y qué cambió (`changes`):

| Acción | Se registra |
|---|---|
| Agendar, mover o editar una cita (`POST`/`PUT /api/appointments`) | `create` o `update`, con la fecha, la hora y el estado antes y después. Pasar a `cancelled` por `PUT` cuenta como `cancel` |
| Cancelar una cita (`DELETE /api/appointments/:id`) | `cancel`, con el estado antes y después. Repetirlo no deja una segunda entrada |
| Crear, editar o borrar un paciente (`/api/patients`) | `create`, `update` (solo los **nombres** de los campos que cambiaron) o `delete`. Una reserva hecha por personal que crea o modifica al paciente deja también su entrada de paciente |
| Invitar o cancelar una invitación (`/api/admin/doctors`, `/api/admin/invitations`) | `create`, `update` (invitar de nuevo con otro rol) o `delete`, con `entity: invitation` y solo el rol; ni el nombre ni el correo |
| Crear, editar o archivar un tipo de cita (`/api/appointment-types`) | `create` o `update`, con `entity: appointment_type`: nombre, duración, color y estado antes y después |
| Bloquear o abrir días (`/api/schedule-blocks`) | `create` o `delete`, con `entity: schedule_block`: solo las fechas, nunca el motivo |
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

### Datos clínicos: quién los ve y cómo se audita (S10-01)

Regla para todo lo clínico que traiga el Sprint 10 (ficha ampliada, antecedentes, notas, diagnósticos, signos vitales):

| Rol | Lee y escribe datos clínicos |
|---|---|
| `doctor` | Sí, de **cualquier paciente de su consultorio** (no solo de los que atendió) |
| `admin` | Sí, de los pacientes de su consultorio |
| `secretary` | **No**: `403` en toda ruta clínica. Sigue agendando y viendo la ficha administrativa (nombre, teléfono, correo, cédula) |
| Cualquier rol de **otro** consultorio | Un paciente ajeno no existe: `404`, sin entrada de auditoría |

- **`middleware/clinicalAccess.js`** (`CLINICAL_ROLES = ['doctor', 'admin']`) va después de `auth` en cada ruta clínica. Lee el rol **de la cuenta en cada petición**, no el del token, que dura horas: un médico pasado a secretaría, o una cuenta borrada, pierde el acceso al instante (`403`/`401`). Cuesta una consulta por clave primaria.
- **Auditoría de lecturas.** Cada ruta que devuelva datos clínicos llama a `recordClinicalRead(db, req, { patientId, section })` (`services/auditLog.js`): `action: read`, `entity: clinical_record`, `entityId` = el paciente y `changes.section` = qué parte se abrió (`notes`, `allergies`…). **Nunca guarda el contenido.** Se registra para cualquier rol y en cada lectura, también las repetidas. Se llama después de comprobar el acceso y de cargar el paciente dentro del consultorio, así que un intento rechazado no deja entrada. En el Activity Log aparece como «Viewed a patient's clinical record».
- **Ruta clínica nueva = pruebas de acceso cruzado**: secretaría `403`, otro consultorio `404`, sin token `401`, rol cambiado tras emitir el token, y la entrada de auditoría. `tests/clinicalAccess.test.js` es la plantilla.
- Este ticket no agrega rutas clínicas: dejó la regla y la auditoría listas para S10-02 en adelante. Lo único visible por HTTP es que `GET /api/admin/audit-log?entity=clinical_record` ya es un filtro válido.
- El **Activity Log** lo ve solo el administrador; los médicos no ven quién leyó qué.

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
| `kind` | Para qué era: `appointment_confirmation`, `appointment_reminder`, `appointment_second_reminder`, `doctor_new_appointment`, `password_reset`, `invitation`, `signup_confirmation`, `account_exists`; y, desde S9-02, lo que pasó con los botones del recordatorio: `patient_confirmed`, `patient_cancelled`, `patient_reschedule_request`, `patient_reply_ignored` (mensajes **recibidos**), `patient_reply_answer` (la respuesta al paciente) y `reschedule_request_notice` (el correo a la secretaría) |
| `channel`, `provider`, `recipient` | `whatsapp` o `email`; quién lo manejó (`meta`, `twilio`, `brevo`, `sendgrid` o `mock`); a quién iba (`patient`, `doctor`, `user`) |
| `status` | `sent`, `failed` o `simulated` (no hay proveedor configurado: no salió nada de verdad); y `received` (S9-02): un mensaje que **llegó** del paciente, no uno enviado |
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
| POST | `/api/tasks/reminders` | admin, secretary | Dispara manualmente los recordatorios **solo para el consultorio de quien lo pide** (el cron de cada hora cubre todos los consultorios), con la configuración de ese consultorio (ver «Recordatorios configurables»). Recuerda una sola vez cada ronda (`Appointment.reminderSentAt` y, en el segundo recordatorio, `secondReminderSentAt`) a las citas `pending_approval`, `scheduled` o `confirmed` que entran en la ventana; si ningún canal entrega, se reintenta en la siguiente corrida |

### Respuestas de los pacientes por WhatsApp (S9-02)

El recordatorio de WhatsApp puede llevar tres botones de respuesta rápida: **«Confirmo»**, **«Cancelar»** y **«Cambiar hora»**. Al tocar uno, Meta llama al **webhook** y la agenda se actualiza sola. Cómo configurarlo en Meta: `docs/WHATSAPP_META_SETUP.md`, paso 12; cómo activarlo en producción: `docs/DEPLOY.md`, «Despliegue de las respuestas por WhatsApp»; cómo probarlo: `docs/qa/S9-02-guia-de-pruebas.md`. **No hay migración.**

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/api/webhooks/whatsapp` | Público (lo llama Meta) | Verificación inicial: con `hub.mode=subscribe` y `hub.verify_token` igual a `META_WEBHOOK_VERIFY_TOKEN`, responde el `hub.challenge` como `text/plain`. Token o modo incorrectos: `403`; un `hub.challenge` con algo que no sean letras, números, `_` o `-` (no se devuelve tal cual): `400`; sin `META_WEBHOOK_VERIFY_TOKEN`: `503` |
| POST | `/api/webhooks/whatsapp` | Público (lo llama Meta) | Cada mensaje que recibe el número de WhatsApp de MedCita y cada acuse de entrega. **Sin firma válida no se hace nada**: `403`. `200 { received: true }` cuando se guardó lo que correspondía; `500` si no se pudo guardar, para que Meta lo reenvíe |

**Es el primer endpoint abierto a internet sin login**, así que nada se acepta hasta que prueba venir de Meta (`routes/webhooks.js`):

- **Firma.** Meta firma el **cuerpo exacto** con el *App secret* (`X-Hub-Signature-256: sha256=<HMAC-SHA256 hex>`). El cuerpo se lee crudo (`express.raw`, máximo 256 kB; el router va **antes** de `express.json()`) y la firma se compara en tiempo constante; recién después se interpreta como JSON. Sin `META_APP_SECRET` responde `503` a todo: sin secreto no hay nada que comprobar, así que no se acepta nada.
- **Límite.** Solo cuentan las llamadas que Meta nunca haría (token o firma incorrectos, `403`): **30 cada 15 minutos por IP**. Las llamadas válidas no cuentan nunca.
- **Solo el número de MedCita.** Si `META_WHATSAPP_PHONE_NUMBER_ID` está definido, se ignoran los mensajes de cualquier otro número de la misma app.

**A qué cita se refiere un toque** (`services/whatsappButtons.js`). No por el teléfono (único solo dentro de un consultorio: el mismo número puede ser paciente de dos), sino por el **identificador que lleva el botón**, que MedCita escribe al enviar el recordatorio (la plantilla de Meta solo define el texto del botón):

```
<acción>.<id de la cita>.<fecha y hora de la cita, 12 dígitos>.<firma>      p. ej.  x.0b9f3a52-….203001151000.Kq1…
```

La firma es un HMAC con `JWT_SECRET` (con una etiqueta aparte, así que no hay otro secreto que configurar; **cambiar `JWT_SECRET` deja sin efecto los botones de los recordatorios ya enviados**). Inventar o alterar un identificador es imposible sin ese secreto. Incluir la fecha y la hora hace que un botón de un recordatorio sobre un horario **anterior** no actúe sobre la cita movida después. Mide 74 caracteres (Meta permite 128).

**Qué se hace con cada toque** (`services/patientReplies.js`; todo en una transacción *Serializable*, como agendar):

| Si… | Resultado | Respuesta al paciente |
|---|---|---|
| «Confirmo» y la cita está `pending_approval` o `scheduled` | Pasa a `confirmed`; auditoría (`update`) | «…quedó confirmada» |
| «Confirmo» y ya está `confirmed` | Nada | «…ya estaba confirmada» |
| «Cancelar» y la cita está abierta (`pending_approval`, `scheduled`, `confirmed`) | Pasa a `cancelled` (el horario queda libre); auditoría (`cancel`) | «Cancelamos tu cita…» |
| «Cancelar» y ya está cancelada | Nada | «…ya estaba cancelada» |
| «Cambiar hora» y la cita está abierta | **La cita no cambia.** Correo a los administradores y secretarias del consultorio (`reschedule_request_notice`); un segundo toque en 24 h no manda otro correo | «Recibimos tu solicitud…» |
| La cita ya pasó, está cancelada (salvo «Cancelar») o cerrada (`arrived`, `in_progress`, `completed`, `no_show`) | Nada | «Esta cita ya no admite cambios por WhatsApp…» |
| El botón es de un horario anterior de la cita | Nada | «Este mensaje corresponde a un horario anterior…» |
| El toque viene de **otro número** (un recordatorio reenviado) | Nada | Ninguna (no es el paciente) |
| Mensaje repetido (Meta lo reenvía, o el mismo `id`) | Nada | Ninguna |
| Texto libre, foto, o un botón que no es nuestro o está mal firmado | Nada | Ninguna: no se responde a desconocidos (evita bucles con otros robots). Solo queda una línea en el log del servidor, con el número enmascarado y **sin el texto** |

**Dónde queda registrado.** Todo toque que corresponde a una cita deja una fila en `NotificationLog` (`channel: whatsapp`, `provider: meta`, `status: received`): `patient_confirmed`, `patient_cancelled`, `patient_reschedule_request` o `patient_reply_ignored` (con `errorCode`: `already_confirmed`, `already_cancelled`, `repeated`, `past`, `closed`, `cancelled`, `stale`, `other_number`). `providerMessageId` guarda el `wamid` del mensaje del paciente: así se reconocen los reenvíos de Meta (se busca dentro de las filas de esa cita, que tienen índice). Las respuestas al paciente son filas `patient_reply_answer` y el aviso a la secretaría `reschedule_request_notice`. El estado `received` no cuenta como éxito ni como fallo en el aviso del administrador. Se ven en el bloque «Messages» de la cita («The patient confirmed the appointment by WhatsApp»). Confirmar y cancelar también escriben en la **auditoría** como `actorRole: patient`, `actorName: "Patient (WhatsApp)"` y `actorId` = el id del paciente (nunca su nombre ni su teléfono); la IP es la de Meta.

**Cómo se responde.** Primero se decide y se guarda; solo entonces se responde `200` a Meta; recién después se manda la respuesta al paciente (texto libre, dentro de la ventana de 24 h que abre su toque) y el correo a la secretaría, para no hacer esperar a Meta por otros proveedores. Si lo que falla es esa respuesta, la decisión ya está guardada y Meta recibe `200`. Si falla guardar, Meta recibe `500` y reenvía; lo ya guardado se reconoce como repetido.

**Qué no hace (todavía).** No interpreta texto libre. No avisa al médico cuando un paciente confirma o cancela (la cita cambia en la agenda). No hay un interruptor por consultorio para apagar los botones: la plantilla es global. «Cambiar hora» no mueve la cita ni muestra un marcador en la agenda; avisa por correo.

**Probar sin Meta.** `npm run whatsapp:reply -- <id de la cita> confirm|cancel|reschedule [--from <número>]` arma el botón de esa cita, lo firma con `META_APP_SECRET` como lo hace Meta y llama al servidor local; se niega a hablarle a un servidor que no sea local.

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
| `GET` y `POST /api/webhooks/whatsapp` | Solo las que Meta nunca haría (token o firma incorrectos, 403), por IP | 30 cada 15 min |

- En el login solo cuentan las credenciales incorrectas: los logins exitosos y las peticiones mal formadas (400) no gastan intentos. En `forgot-password` cuenta toda solicitud, porque cada una puede enviar un correo (el límite evita inundar la bandeja de alguien o gastar la cuota del proveedor).
- Al superar el límite responde `429 { error, retryAfterSeconds }` con los headers `Retry-After` y `RateLimit-*`, **incluso con la contraseña correcta**. El mensaje es el mismo para cuentas que existen y que no.
- El límite por correo es la defensa principal contra fuerza bruta porque no depende de detectar la IP; el de IP frena a quien prueba muchas cuentas distintas.
- **Los contadores viven en la base de datos** (tabla `RateLimitCounter`, `services/rateLimitStore.js`, desde S9-08): **sobreviven a un despliegue o reinicio** y los comparten todas las instancias del backend. Antes estaban en memoria y cada despliegue le daba a quien probaba contraseñas un juego nuevo de intentos. Cada fila es `<límite>:<SHA-256 del cliente>` (el correo o la IP **no se guardan en claro**), con su cuenta y el fin de su ventana; el aumento es una sola sentencia atómica (con la hora de la base), así que dos peticiones simultáneas, o de dos instancias, no pierden ningún intento. Las filas vencidas se borran cada hora (`cron`, y al arrancar). Si la base no responde al contar, la petición **pasa** (lo que sigue, un login o un alta, también necesita la base y falla por su cuenta).
- **Para QA y pruebas locales:** como los contadores ya no se borran al reiniciar, una prueba que gaste un límite (Postman, un ciclo de contraseñas incorrectas) lo deja gastado hasta que termine su ventana (hasta una hora). `npm run limits:reset` los borra (solo en una base local, a menos que escribas el host en `RATE_LIMIT_RESET_HOST`); `prisma db seed` también los borra.
- La IP se lee de `X-Forwarded-For` según `TRUST_PROXY` (sección 3). Un valor mal puesto hace que todos los usuarios compartan IP (muy bajo) o que se pueda falsificar (muy alto).

### Alertas de errores del servidor (S9-08)

Un error 500 solo se veía en los logs de Render, así que podía seguir sin que nadie lo notara hasta que un usuario se quejaba (como en los incidentes del 20 y el 21 de octubre). **Quién lo recibe: solo el equipo que opera MedCita (soporte), nunca un cliente.** Las únicas destinatarias son las direcciones de `ERROR_ALERT_EMAILS`, que pone en Render quien opera la plataforma; no hay ningún camino para que un aviso llegue a la cuenta de un consultorio (ni a su administrador, ni a sus médicos o pacientes), y el aviso nombra al consultorio justamente porque es para soporte. Quien tuvo el error en pantalla solo ve la misma respuesta genérica de siempre y, en la cabecera `X-Request-Id`, un id que puede darle a soporte. Si `ERROR_ALERT_EMAILS` tiene una o más direcciones, cada respuesta con código **5xx** (menos el `/api/health`, que ya vigila el monitor de disponibilidad) manda un correo a esas direcciones (`services/errorAlerts.js`, registrado en `server.js` antes de las rutas, así que avisa cuando la respuesta ya salió y nunca la retrasa).

**Qué dice** (ejemplo real en `docs/qa/screenshots/s9-08/`):

- **La ruta** por su patrón (`GET /api/appointments/:id/notifications`, nunca la ruta real) y el código de estado.
- **A qué consultorio pertenece**: nombre, nombre corto (`slug`) e id de la **cuenta con la que se hizo la petición** (`req.clinicId`, que pone el middleware de autenticación). Va también en el asunto: `[MedCita · Clínica Vida] Error 500 en …`. Una petición sin sesión (un login, un alta) dice «no identificado». Si la base de datos es lo que falla y no se puede consultar el nombre, el aviso sale igual con el id.
- **Desde qué dominio se usó la app** (`Origin` que manda el navegador, solo esquema, dominio y puerto) y el servidor que respondió. Hoy todos los consultorios comparten un solo dominio, así que **lo que distingue a un consultorio es su cuenta**; cuando cada uno tenga el suyo, el dominio lo nombrará también.
- **La línea exacta del código**: archivo, línea y columna del código de MedCita donde se produjo el error (`src/routes/patients.js:57:15`, y la función), más la cadena de llamadas de MedCita (hasta 5 líneas). Se toma de la pila del error ignorando las librerías, y si la pila no pasa por código de MedCita (los errores de Prisma suelen nacer dentro de su librería) se toma del sitio de la llamada que Prisma escribe en su mensaje. También el tipo y el código del error (`PrismaClientKnownRequestError (P2022)`) y, de Prisma, los **nombres** de columna, tabla o campos de la restricción (nunca valores). El asunto lleva el archivo y la línea.
- **El id de la petición**, el servicio y la versión (`RENDER_SERVICE_NAME`, `RENDER_GIT_COMMIT`), la hora y cuántos errores de esa ruta y consultorio se callaron desde el último aviso.

**Cómo se ve el mensaje completo.** Cada petición recibe un id que se manda en la cabecera `X-Request-Id` y se imprime delante de sus líneas de error en el log (`[request a1b2c3d4e5f6] List patients error: …`). El correo trae ese id: se busca en los logs de Render y ahí está el mensaje completo.

**Cómo sabe el aviso del error aunque la ruta lo haya atrapado.** Casi todas las rutas atrapan su error, lo escriben con `console.error` y responden 500 ellas mismas. Cada petición corre dentro de un contexto (`AsyncLocalStorage`) y `console.error` recuerda el error que se le pasa mientras se atiende una petición; así no hace falta tocar cada ruta. Un error que nadie atrapó (lanzado o pasado a `next`) termina en el último manejador de la app, que responde `500 { error }` en JSON en vez de la página de Express.

**Qué nunca lleva:** el cuerpo ni la consulta de la petición, los ids de la ruta, quién la hizo, su IP ni **el mensaje del error**. Un mensaje puede citar lo que se estaba guardando (el nombre de un paciente, una cédula), un correo no va cifrado y pasa por el proveedor: el mensaje se queda en el log, y el correo da el id para encontrarlo en un paso. Pruebas lo comprueban con un error cuyo mensaje cita el nombre y la cédula de un paciente.

**No inunda la bandeja:** un correo por ruta **y consultorio** cada 15 minutos (el siguiente cuenta los que se callaron) y como mucho 10 por hora en toda la plataforma. El límite está en memoria de cada instancia: tras un reinicio puede salir un aviso más por ruta.

**Probar la configuración:** `npm run alerts:test` manda **una** alerta de ejemplo (con consultorio y línea de ejemplo) a las direcciones de `ERROR_ALERT_EMAILS`, con el mismo código y el mismo proveedor de correo que una real (código de salida 0 si el proveedor la aceptó, 1 si no; con el proveedor simulado avisa de que no se envió nada).

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

**Postman** (`backend/postman/MedCita.postman_collection.json`, 617 peticiones y 1007 aserciones al cierre de S11-01). Se corre contra un backend local con la base ya sembrada **y arrancado con `EXPOSE_ACCOUNT_LINKS=true`**, porque el alta y las invitaciones entregan su enlace por correo y ese modo lo devuelve en la respuesta (`devLink`): `EXPOSE_ACCOUNT_LINKS=true npm run dev` y, en otra terminal, `npx newman run backend/postman/MedCita.postman_collection.json --env-var baseUrl=http://localhost:5000`. Los límites de intentos de login viven en la base de datos y las pruebas de S1-02 y S9-08 gastan los de la IP: **corre `npm run limits:reset` (o vuelve a sembrar) entre una corrida y otra**, porque reiniciar el backend ya no los borra, o la segunda seguida responde `429`.

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
- **S9-08 (límites persistentes y alertas):** como los contadores de los límites viven en la base de datos, `resetDb()` también los borra entre pruebas; fuera de las pruebas, `npm run limits:reset` (o volver a sembrar) los borra. Las alertas de error no envían correos reales en la suite: `serverErrorAlert.test.js` sustituye `emailService.deliverEmail`. La guía para probarlo a mano, con correos reales, está en `docs/qa/S9-08-guia-de-pruebas.md`.
- **S9-02 (respuestas por WhatsApp):** las pruebas del webhook (`whatsappWebhook.test.js`) firman cada llamada con el mismo HMAC que usa Meta y esperan, con una espera acotada, lo que el servidor manda **después** de contestar (la respuesta al paciente y el correo a la secretaría); ambos pasan por los proveedores simulados, no por uno real. `reminderButtons.test.js` cubre el identificador de los botones y qué plantilla elige `reminderTemplateKey`, `patientReplies.test.js` las decisiones puras (teléfonos, estados, hora local) y `whatsappReplyScript.test.js` el script `npm run whatsapp:reply`. `setupEnv.js` deja vacías las variables del webhook para que un `.env` local no entre a las pruebas.
- **CI** (`.github/workflows/ci.yml`): en cada Pull Request y en cada push a `main` corre `npm test` (con un PostgreSQL de servicio) y `npm run lint`.

### Guía en PDF (`frontend/public/medcita-demo-guide.pdf`)

Es la guía que se descarga desde la pantalla de login (credenciales de prueba, qué probar por rol, flujo de una cita, y la configuración de WhatsApp con Meta). Es **pública**: no debe contener tokens, IDs de la cuenta de Meta ni capturas con datos personales. Su fuente es `docs/guide/medcita-demo-guide.html` (con las capturas en `docs/guide/img/`: las de la historia clínica y la lista de pacientes se sacaron de la app con los datos del seed, a 1280 × 800, tras el Sprint 10.5; el resto, copias JPEG de `docs/qa/screenshots/s7-12/`). Cuando cambie la app o la configuración de WhatsApp, edita el HTML y regenera el PDF desde `docs/guide/` con Chrome o Chromium:

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

## 9. Componentes base de la interfaz (S10.5-02)

La interfaz tiene un sistema de diseño mínimo y propio (Tailwind, sin librerías de componentes). **Tokens:** `frontend/src/index.css` define los colores como triples HSL (`--primary`, `--secondary` y, para cada estado `success`, `warning`, `danger`, `info` y `neutral`, cuatro valores: el color fuerte, `-soft` para el fondo, `-line` para el borde y `-ink` para el texto sobre el fondo suave), los radios (`--radius-card`, `--radius-control`) y la tipografía (`--font-sans`). `tailwind.config.js` los lee como `bg-success-soft`, `text-danger-ink`, `rounded-card`…, y la opacidad (`bg-primary/10`) sigue funcionando. Cambiar un valor en `index.css` cambia toda la app. Las clases `page-title`, `section-title` y `eyebrow` dan un mismo título a cada pantalla. El plugin `tailwindcss-animate` (devDependency) hace que `animate-in`, `zoom-in-95` o `slide-in-from-bottom-5` funcionen: antes se usaban y no hacían nada.

**Componentes** (`frontend/src/components/ui/`, se importan de `components/ui`):

| Componente | Para qué |
|---|---|
| `Modal` | El único diálogo de la app: se pinta en un portal, tiene `role="dialog"` y `aria-modal`, se cierra con Escape, mantiene el Tab dentro, **devuelve el foco** a lo que lo abrió y bloquea el scroll de la página. Si hay varios abiertos, solo reacciona el último (la pregunta que sale dentro del modal de una cita). Hacer clic fuera **no** lo cierra salvo `closeOnOverlayClick` |
| `ConfirmDialog` + `useConfirm()` | Reemplaza `window.confirm` y `window.prompt`. `await confirm({ title, message, confirmLabel, tone })` devuelve `true`/`false`; `await askReason({ title, reason: { label } })` devuelve el texto (puede ir vacío) o `null` si se cancela. `tone="danger"` empieza con el foco en Cancelar |
| `Toast` + `useToast()` | Un solo aviso para toda la app (`showToast(mensaje, 'success' \| 'error')`, con identidad estable): sobrevive a un cambio de página, se va solo a los 4 s, los errores se anuncian con `role="alert"` |
| `Badge`, `AppointmentStatusBadge`, `NoteStatusBadge`, `MinorBadge` (+ `ConsentBadge`) | Un solo color y una sola etiqueta para cada estado: cita (los colores del calendario), borrador/cerrada, menor, consentimiento |
| `EmptyState` | «No hay nada aquí», con icono, texto y una acción; para una petición que **falló** sigue `LoadError` |
| `SectionHeader` | Encabezado de un bloque (título, línea, icono, acciones); `variant="label"` es el título pequeño en mayúsculas |
| `Skeleton` | Marcador gris mientras carga, con el tamaño de lo que llegará |
| `useFocusTrap` | El foco atrapado de `Modal` y del cajón del menú en móvil (`Sidebar`) |

Reglas: no usar `window.confirm`, `window.prompt` ni `window.alert` (no se pueden ver ni probar, ni respetan el diseño); no volver a crear un toast ni un modal por página. Los pills de rol de `AdminDoctors` y los de acción de `AuditLog` conservan sus colores propios (naranja, morado…) porque no son estados.

### Cabecera del paciente y banner de alerta (S10.5-03)

`frontend/src/components/PatientHeader.jsx` es el bloque «de quién es esta pantalla» de la ficha, la nota de consulta y la línea de tiempo: migas (`Patients › nombre › pantalla`), nombre, edad · sexo · cédula, `ConsentBadge`, `MinorBadge` y las acciones de cada pantalla (`actions`). Recibe `patient`, `summary` (el resumen clínico, **solo se pasa si el rol puede leerlo**), `crumb` (la última miga) y `loading` (muestra un esqueleto de la misma altura, así que la cabecera no cambia de alto cuando llegan los datos). Sin `patient` ni `loading` pinta solo la miga «Patients» (pantalla vacía, error o sin permiso).

- **Fija.** Desde `md` todo el bloque (migas, identidad, acciones y banner) es una sola cuadrícula `sticky top-0`. Por debajo de `md` el contenedor es `display: contents` y solo la identidad y el banner quedan fijos, **justo debajo de la barra superior del móvil** (`top-[calc(3rem+24px)]`, la altura de esa barra); las migas y los botones se desplazan con la página para no gastar la pantalla. Para que `sticky` funcione hubo que quitar `overflow-y-auto` de `<main>` en `Layout.jsx` (un ancestro con `overflow` distinto de `visible` se vuelve el contenedor del sticky y, como `<main>` no tiene altura fija, nunca se desplazaba); queda `overflow-x-clip`, que sigue recortando a lo ancho sin crear contenedor de scroll.
- **Banner** (`ClinicalAlert` con `banner`): `role="alert"`, **rojo** si hay alguna alergia activa, **ámbar** si solo hay medicación activa, y **no pinta nada** (ni ocupa espacio) si no hay ninguna. Tiene un tope de altura (`24vh` en móvil, `30vh` en escritorio) con scroll propio para que una lista muy larga no se coma la pantalla; en el móvil omite la reacción y la dosis (están en «Clinical background»). El modal de la cita del Dashboard sigue usando `ClinicalAlert compact`, sin cambios.
- **`canViewClinical(user)`** (`frontend/src/utils/clinicalAccess.js`): el único sitio que dice qué roles leen lo clínico (`doctor` y `admin`, espejo de `CLINICAL_ROLES` en `backend/src/middleware/clinicalAccess.js`). Lo usan el Dashboard (antes comparaba con `'secretary'`), la nota y la línea de tiempo (antes dependían del 403) y la ficha, que además exige `canViewClinical === true` en la respuesta de `GET /api/patients/:id` (el backend lo relee en cada petición: solo puede **restar**). Quien no puede, **no hace ninguna petición clínica**: la nota y la línea de tiempo muestran «Clinical data is not available to your role» sin llamar a la API. Quien sí puede y recibe un 403 ve el mismo mensaje que antes. El backend sigue siendo el que decide.
- **Cambios visibles a propósito:** el banner ya no es una tarjeta dentro de la ficha sino una franja fija bajo la cabecera; la ficha ya no escribe «No allergies or regular medication recorded» cuando no hay nada (la sección «Clinical background» muestra sus listas vacías); la línea de tiempo y la nota muestran ahora las alergias (una lectura más del resumen clínico, auditada como las demás).

### Ficha del paciente en secciones (S10.5-04)

`/patients/:id` (`frontend/src/pages/PatientRecord.jsx`) ya no es una página larga: tiene la cabecera de S10.5-03 fija arriba y, debajo, la **navegación de secciones** junto al contenido, que es lo único que se desplaza. Las secciones, en orden: **Summary · Background · Vital signs · Consultations · Appointments · Patient data**; la secretaría solo recibe las dos últimas (lo clínico no se pinta ni se pide, como en S10.5-03). **Timeline** es otra pantalla, así que en la navegación es un enlace a `/patients/:id/timeline` (con un separador) y no una sección.

- **Altura completa.** `Layout` acepta `fullHeight`: desde `md` la pantalla mide exactamente la ventana y `<main>` no se desplaza; el contenido de la ficha tiene su propio `overflow-y-auto`. En el móvil no cambia nada del `Layout`: se desplaza la ventana, la cabecera sigue fija bajo la barra superior y **la navegación son pastillas** (`RecordNav` con `pills`) dentro de ese bloque fijo (`PatientHeader` recibe `children`). Hay dos `<nav aria-label="Record sections">` en el DOM (lista lateral y pastillas) y solo uno se ve a la vez; ambos comparten estado.
- **Scroll-spy** (`frontend/src/utils/useSectionSpy.js`). No usa `IntersectionObserver`: en cada scroll (con `requestAnimationFrame`) elige la **última sección cuyo borde superior ya pasó la línea** (el borde de la caja que se desplaza, o la base de las pastillas en el móvil, más 24 px), así que funciona con secciones de cualquier altura; al llegar **al final** la activa es la última, que puede ser demasiado corta para llegar arriba. Tras un clic la sección elegida queda activa hasta que termina el desplazamiento que causó (si no, una sección corta cerca del final se la quita su vecina) y luego se **realinea**: en el móvil la cabecera es más alta hasta el primer scroll (aún está la miga) y la primera medida cae unos píxeles abajo. `prefers-reduced-motion` quita la animación.
- **Enlaces directos.** Cada entrada es un `<a href="#seccion">` real (teclado, copiar enlace, `aria-current="true"` en la que se está leyendo); el clic usa `history.replaceState` para no llenar el historial. `/patients/:id#vitals` abre la ficha ahí: espera a que lleguen el resumen clínico, los signos vitales y las notas (para que las secciones tengan su altura final) y entonces se desplaza sin animación. Un `#` que no existe, o una sección clínica para la secretaría, no hace nada.
- **Resumen** (`RecordSummary`, sin endpoint propio: se arma en el cliente con lo que la pantalla ya tiene, `utils/recordSummary.js`): última consulta (la nota de la visita más reciente, con su estado y su diagnóstico principal), últimos signos vitales (el valor más reciente de cada medida con su fecha), **diagnósticos recientes** y antecedentes clave (los cinco primeros). *Diagnósticos activos:* el modelo no tiene «activo» (un diagnóstico es parte de una nota), así que se muestran el diagnóstico principal de las últimas notas, sin repetir.
- **Edición.** Alergias, medicación y antecedentes siguen **en línea** (`ClinicalBackground`). Los datos del paciente, un formulario de muchos campos, se editan en un **diálogo** (`EditRecordModal`, con `Modal`): Escape o Cancelar descartan lo escrito y guardar recarga la ficha. Estados vacíos con acción: «Add the first allergy / medicine / entry», «Record the first vital signs», y en consultas y citas un enlace a donde se hacen.
- **Cambios visibles a propósito:** «Consultation notes» pasa a «Consultations» y siempre se ve (antes solo si había notas), ordenada por la fecha de la visita; las citas y las notas muestran la fecha en una columna más ancha; el aviso de menor sin representante queda arriba del contenido que se desplaza.

### Signos vitales en la ficha y en la nota (S10.5-05)

Solo cambia cómo se ven; **sin backend ni migración** (las rutas, la validación, el IMC y las anulaciones son los de S10-06). `frontend/src/components/VitalsSection.jsx`:

- **Tarjetas de tendencia.** Una por medida (`MEASURES` en `utils/vitals.js`): el último valor con su unidad y su fecha y **el cambio respecto a la toma anterior que tiene esa misma medida** («−0.6 since Oct 22, 2026»; la presión como «−6/−4»), o «Single reading — no trend yet» si solo hay una; sin datos, «Not recorded». `trends()` calcula el último valor, el anterior y el cambio; `latestValues()` (el Resumen de la ficha) sale de ella. **Las tomas anuladas no cuentan** ni en las tarjetas ni en el gráfico. No hay colores de «bueno» o «malo» (no hay rangos normales: sigue pendiente, como en S10-06); la flecha solo dice hacia dónde fue.
- **Gráfico.** La tarjeta con gráfico es un botón (`aria-pressed`) que elige la medida que se dibuja (la talla no tiene gráfico y es una tarjeta sin botón); por defecto, la primera medida con datos. Sigue **cargándose en diferido** (`React.lazy`: el paquete principal no engorda). El eje Y se calcula con números redondos (`axisFor` en `VitalsChart.jsx`: unos cinco intervalos de 1, 2 o 5 por una potencia de diez, con un margen arriba y abajo) y tiene ancho para cifras como `100.75` o `1000`, que antes se cortaban en el borde izquierdo; la línea une los puntos con segmentos rectos (la curva suavizada inventaba una tendencia entre dos tomas).
- **Historial en tabla.** Una fila por toma, una columna por medida (con su unidad en el encabezado), quién la registró y, si es suya o es admin, «Void». Una toma anulada queda tachada y atenuada, con quién la anuló y por qué; sale de las tarjetas y del gráfico. En una pantalla estrecha la tabla se desplaza dentro de su caja, no la página. Anular sigue usando `askReason` (S10.5-02).
- **Registrar.** Sin cambios: desde la ficha no guarda `appointmentId`; desde la nota sí (verificado contra la API). Los estados vacíos ofrecen la acción («Record the first vital signs»).
- **En la nota** («Vital signs of this visit», `components/VisitVitals.jsx`): cada toma de esa visita sale con quién y cuándo y una pastilla por valor con su unidad («WEIGHT 80.6 kg», «BP 118/76 mmHg»); sin tomas, «Record the first measurements» abre el formulario. Mientras cargan se ve un esqueleto (antes aparecía un instante el mensaje de «sin tomas»).

### Pantalla de la nota de consulta (S10.5-06)

`/patients/:id/appointments/:appointmentId/note` (`frontend/src/pages/ConsultationNote.jsx`). Solo cambia cómo se ve y se maneja; **sin backend ni migración**, y se conserva todo el comportamiento de S10-04 (autoguardado a 1500 ms, `revision` y el `409` de conflicto con «Reload», el aviso `beforeunload`, el borrador de otro médico de solo lectura, quién edita y quién cierra).

- **Estructura.** `Layout fullHeight` como la ficha: desde `md` la cabecera (`PatientHeader` con el banner de alertas, la fecha y el médico de la visita y la insignia Draft/Closed) y la **barra de acciones** quedan fijas y solo se desplaza el contenido; en el móvil se desplaza la ventana, la cabecera sigue fija y la barra es `sticky bottom-0`. El texto SOAP va al centro (`max-w-3xl`), los signos de la visita y los diagnósticos conservan su lugar.
- **Barra fija abajo.** Estado de guardado (los mismos mensajes de antes, con `role="status"`; el conflicto en rojo y su «Reload»), el botón del panel de contexto (`aria-expanded`, `aria-controls`), y, solo para el autor de un borrador, «Delete draft» y «Close note». Una nota cerrada o un borrador ajeno muestran en la barra «Closed … · autor» o «Draft by … — read only» y solo el botón del contexto. La nota cerrada sigue mostrando autor, fecha de cierre y adendas, y **agregar una adenda no pide confirmación**.
- **Panel de contexto** (`NoteContextPanel`): antecedentes, últimos signos vitales (de cualquier visita) y el diagnóstico principal de las consultas anteriores (con enlace a su nota). **No pide nada nuevo**: usa el resumen clínico y los signos que la pantalla ya carga y la lista de notas que ya se pedía al abrir, y no frena la escritura (muestra esqueletos mientras llegan). En escritorio es una columna a la derecha, **abierta al empezar**; en el móvil es un **cajón** (`role="dialog"`, foco atrapado, Escape lo cierra) que **empieza cerrado**. Abrirlo o cerrarlo no desmonta el texto de la nota (el estado vive en la pantalla).
- **Cierre y borrado con resumen** (`ConfirmDialog`): «This note has 1 diagnosis and 1 set of vital signs of this visit. Once closed it cannot be edited again: later corrections are added as addenda.» (o «no diagnoses and no vital signs of this visit»); al borrar: «This deletes its four parts and its N diagnoses. The vital signs recorded at this visit are kept.» Las tomas no se tocan al borrar un borrador (comprobado en la ruta).
- Los controles de cada diagnóstico (certeza, «Make main», quitar) van juntos y ya no dejan la «×» sola en una línea cuando la columna es angosta.

### Lista de pacientes: filtros, orden y recientes (S10.5-07)

**API** (`GET /api/patients`, `backend/src/services/patientList.js`; aditiva, **sin migración**; el resto de la respuesta no cambia):

| Parámetro | Valores | Qué hace |
|---|---|---|
| `search` | texto (se recorta; vacío = sin búsqueda) | Nombre, teléfono o cédula, como antes |
| `consent` | `none`, `granted`, `outdated`, `withdrawn` | Por el **último** evento de consentimiento de cada paciente (`granted` = dado al texto vigente; `outdated` = dado a un texto anterior; `none` = ninguno). Se calcula con una consulta `DISTINCT ON` sobre `PatientConsent` **del consultorio** |
| `minor` | `true`, `false` | Menor de 18 con la misma regla que `isMinor` (cumplir 18 hoy ya es adulto), escrita como comparación con una fecha de corte de la **fecha del consultorio**. Sin fecha de nacimiento no se sabe que sea menor: entra en `false` |
| `sort` | `name`, `cedula`, `phone`, `age`, `createdAt` (por defecto) | Solo columnas de la fila del paciente. **No** se ordena por consentimiento ni por número de citas (necesitarían un `JOIN` y un conteo sobre todos los pacientes en cada página) |
| `order` | `asc`, `desc` | Por defecto `desc` para `createdAt` (los más nuevos primero, como antes) y `asc` para el resto; `age` ascendente = el más joven primero. Los vacíos (cédula, fecha de nacimiento) van **al final** en las dos direcciones |

- **Validación.** Un valor fuera de la lista, o un parámetro repetido, responde **`400`** con el mensaje de los valores válidos (no se ignora, para que un error de escritura no parezca «sin filtro»). Los filtros se combinan con `AND`; el consultorio sale siempre de la sesión (`inClinic`), también en la consulta de consentimientos.
- **Paginación estable.** Todo orden termina en el `id` (clave única), así que dos pacientes con el mismo valor (mismo nombre, misma fecha de alta) no se intercambian entre páginas y no se repite ni se omite ninguno; antes el orden por `createdAt` no desempataba.
- **Orden por nombre.** Lo hace la aplicación (`sortByName`, con `Intl.Collator('es')`: sin distinguir mayúsculas ni tildes), no la base, porque PostgreSQL ordena según la intercalación con que se creó la base y no es igual en todas partes (en la base local de Docker ordena por bytes: «zoe» después de «Zoe», «María» después de «Marta»). Cuesta una consulta extra de `id` y nombre de todos los que cumplen el filtro; es razonable para el tamaño de un consultorio y, si algún día hay decenas de miles de pacientes, habrá que guardar una clave de orden en la fila (con migración).
- **Límite del filtro de consentimiento:** se resuelve como una lista de `id` (`IN` / `NOT IN`), cómoda hasta unos miles de pacientes con consentimiento.

**Pantalla** (`/patients`, `frontend/src/pages/Patients.jsx`): desde `md`, una **tabla** (fila entera clicable, encabezados que ordenan con `aria-sort`: primer clic ascendente, segundo descendente, tercero vuelve al orden por defecto) y, en el móvil, las **tarjetas** de antes con un selector de orden. La búsqueda espera **300 ms** sin teclear (`useDebouncedValue`) antes de consultar; cambiar la búsqueda, un filtro o el orden vuelve a la página 1. Hay tres vacíos distintos (sin pacientes, sin resultados de la búsqueda, sin resultados con filtros, los dos últimos con su «Clear…»), esqueletos con la forma de la tabla y el aviso de error con reintento. Las acciones por paciente (`PatientActions`) son las mismas de antes: abrir la ficha, consentimiento, editar, borrar (bloqueado con citas) y, solo admin, las dos exportaciones. La secretaría usa la lista igual, sin nada clínico.

**Recientes** (`utils/recentPatients.js`, `RecentPatients`): al abrir una ficha se guarda en el **navegador** `{ id, name }` (nada clínico ni de contacto), hasta 8, el último primero. La clave lleva el consultorio **y** el usuario (`medcita:recent-patients:<clínica>:<usuario>`): otra persona en el mismo equipo u otro consultorio no los ve, y una lista guardada bajo otra clave no se lee. Se borran **todas** al cerrar sesión y cuando la sesión expira (401), y un paciente borrado desde la lista sale de ellas.

### Línea de tiempo y enlaces desde la agenda (S10.5-08)

Solo frontend. `frontend/src/pages/PatientTimeline.jsx` (`/patients/:id/timeline`) carga al paciente y los eventos (`GET …/clinical/timeline`, filtros por `types`, «Show older» con `before`) y los pinta con `frontend/src/components/TimelineEvents.jsx`, que solo muestra: recibe `events` y `patientId`, agrupa por mes y no sabe nada de la red, así que cualquier otra pantalla puede reutilizarlo. Cada evento lleva una `Badge` con su tipo (`EVENT_KINDS`: icono, color y etiqueta por tipo) y, si procede, otra con su estado, con los componentes de `ui/StatusBadges` (`AppointmentStatusBadge`, `NoteStatusBadge`) para que el color de un estado sea el mismo que en el calendario y la lista. Mientras carga hay tres `Skeleton`; sin eventos, `EmptyState`. La ficha sigue enlazando a la línea de tiempo desde `RecordNav` (no es una sección de la ficha, ver S10.5-04).

El modal de gestión de la cita del Dashboard (`Modal`, cierra con Escape y devuelve el foco) muestra bajo el nombre dos enlaces: `/patients/:id` (todos los roles) y `/patients/:id/appointments/:id/note` (solo `canViewClinical`, y no en citas canceladas). La secretaría tampoco pide el resumen clínico para el banner del modal. El cambio en `Dashboard.jsx` se limita a ese bloque.

## 10. Documentos para el paciente (Sprint 11)

### Membrete, firma, sello y datos profesionales (S11-01)

**Datos.** `Doctor`: `title`, `licenseNumber`, `phone`, `contactEmail`, `signatureKey`, `sealKey`. `Clinic`: `phone`, `email`, `logoKey` (la dirección ya existía). Todo es opcional y la migración `20261101100000_add_letterhead_fields` solo agrega columnas nulas. Las imágenes **no** están en la base: las columnas `*Key` guardan la llave del archivo en el bucket privado (`clinics/<id>/letterhead/<tipo>-<dueño>-<marca de tiempo>.<png|jpg>`); cada subida usa una llave nueva y borra la anterior, así nunca se lee una copia vieja.

**API** (`backend/src/routes/letterhead.js`, montada en `/api/letterhead`; solo médico y admin, con el rol releído en cada petición como el resto de lo clínico; la secretaría recibe `403`):

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/` | Médico, admin | Los datos del consultorio y del médico que pregunta, `storageConfigured`, `canEditClinic` y qué imágenes existen (`hasLogo`, `hasSignature`, `hasSeal`); nunca las llaves |
| PUT | `/doctor` | Médico, admin | Sus datos: `title`, `licenseNumber`, `phone`, `contactEmail` (`''` borra; correo y teléfono se validan; límites de largo) |
| PUT | `/clinic` | Admin | `address`, `phone`, `email` del consultorio (el nombre sigue en `PUT /api/admin/clinic`) |
| PUT | `/images/:kind` | Logo: admin. Firma y sello: el propio médico | `{ data }` en base64 o data URL. Máximo 500 KB; se comprueba que sea PNG o JPG **por sus primeros bytes**. `409` si no hay almacenamiento configurado |
| GET | `/images/:kind` | Según el tipo | `{ url }`: dirección firmada de unos minutos; `404` si no hay imagen |
| DELETE | `/images/:kind` | Según el tipo | Quita la imagen y su archivo (`204`) |
| DELETE | `/doctors/:id/images/:kind` | Admin | Quita la firma o el sello de un médico **de su consultorio** (otro consultorio: `404`) |
| GET | `/preview` | Médico, admin | PDF de ejemplo con el membrete de quien pregunta |

Esta ruta lee su propio cuerpo JSON con límite de 1 MB (`server.js`, antes del `express.json()` general de 100 KB) y solo después de saber quién pregunta.

**Servicios.** `services/letterhead.js` valida (`parseImage`, `cleanFields`, `sniffImage`) y arma los datos de un documento (`loadLetterhead`: el consultorio, el médico y las imágenes como `Buffer`; una imagen que no se pueda leer se deja fuera y se anota, nunca rompe el documento). `services/pdfLetterhead.js` dibuja con `pdfkit` y las fuentes DejaVu: `drawHeader` (logo y consultorio a la izquierda, el médico a la derecha), `drawSignature` (sello y firma sobre una línea, con el nombre y el registro), `drawFooters` (fecha y «Página N de M») y `renderPreview`. **S11-02, S11-03 y S11-04 usan estas mismas funciones**; no dibujan su propio encabezado. `services/fileStorage.js` ganó `putFile` y `getFile` (el servidor escribe y lee lo que ya validó).

**Auditoría.** Entidades `professional_profile` (solo dice qué campos cambiaron) y `letterhead` (qué imagen se subió o quitó: `kind`, o los campos de contacto del consultorio que cambiaron). Se escribe para **todos** los roles (también el médico que edita lo suyo) y nunca copia valores ni imágenes.

**Sin bucket.** `GET /` trae `storageConfigured: false` y la pantalla desactiva la subida de imágenes. Con el bucket sin configurar, los PDF salen sin logo, firma ni sello. Mientras MedCita esté en versión de prueba se puede trabajar así; el bucket privado y `npm run storage:check` (`docs/DEPLOY.md`, «Archivos privados») son obligatorios antes de usarlo con pacientes reales.

**Pruebas.** `backend/tests/letterhead.test.js` (27: permisos por rol, validación, imágenes con un bucket simulado en memoria, aislamiento entre consultorios, auditoría sin valores, PDF con y sin imágenes) y la carpeta «S11-01» de Postman.


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
