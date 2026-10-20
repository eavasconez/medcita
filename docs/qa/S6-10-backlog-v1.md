# S6-10 — Backlog priorizado para versión 1.0

> Compilado a partir de todo lo encontrado en las auditorías de Sprint 4 y el deploy de Sprint 5 — no depende de los resultados de las demos con médicos reales (S6-04 a S6-08), aunque esa validación seguramente agregue puntos nuevos a este backlog. Cada punto está verificado contra el código actual, no es una lista genérica. Fecha: 2026-07-24.
>
> **Actualizado el 2026-10-20, al cierre del Sprint 7** (S7-01 a S7-11): lo que el Sprint 7 resolvió pasó a «Ya resuelto» y se agregaron los pendientes que descubrió el propio sprint, incluido el incidente del 20-oct (ver «Lecciones del Sprint 7»). Cada punto se verificó contra el código y contra producción en esa fecha.

## Cómo leer este documento

- **Alta**: afecta directamente la confiabilidad del producto o bloquea un lanzamiento real más allá del piloto.
- **Media**: mejora real de calidad/consistencia, no bloquea el piloto actual.
- **Baja**: limpieza/deuda técnica, sin impacto directo en el usuario.

## En curso (tickets abiertos)

| Ticket | Qué falta |
|---|---|
| S7-06 (#75) WhatsApp con plantillas de Meta | Código y documentación fusionados (PR #81). Falta la prueba real, ver el segundo punto de Alta prioridad |
| S7-10 (#85) Backlog y documentación | Este documento |

## Alta prioridad

- [ ] **Configurar el Health Check Path de Render** (`/api/health`, en *Settings → Health Check Path* de `medcita-backend`). Desde S7-11 esa ruta responde `503` si la base está inalcanzable o va atrasada respecto al código. Solo con ese ajuste Render espera un `200` antes de pasar el tráfico a un despliegue nuevo y conserva la versión anterior si no llega; sin él, el `503` solo sirve de alarma para UptimeRobot y de línea en el log. Ver `docs/DEPLOY.md`, sección 3.
- [ ] **Terminar WhatsApp con Meta (S7-06, #75)**: el código ya envía confirmaciones y recordatorios como plantillas. Falta (a) que Meta apruebe `cita_confirmada` y `recordatorio_cita`, (b) el envío de prueba a un tester (`npm run whatsapp:test`) y (c) cargar las variables `META_WHATSAPP_*` en Render: hoy producción sigue con el sandbox de Twilio, que obliga a cada destinatario a «unirse» a mano. El token de usuario del sistema dura 60 días y el actual vence el **19-dic-2026**; con un negocio verificado se puede pasar a uno permanente (`docs/DEPLOY.md`, sección 7).
- [ ] **Vulnerabilidades en dependencias de producción** (`npm audit --omit=dev`, 20-oct-2026): backend 8 (1 crítica, 3 altas, 3 moderadas, 1 baja) y frontend 8 (6 altas, 2 moderadas). La crítica es `proxy-addr` (suplantación de IP con subredes IPv6 mapeadas; la trae Express) y probablemente no es explotable aquí, porque `TRUST_PROXY` cuenta saltos en vez de usar subredes y el límite principal del login es por correo. Las altas son `axios` (en el backend lo traen Twilio y SendGrid; en el frontend es directa), `path-to-regexp`, `form-data`, `lodash` y `react-router-dom`. **Todas tienen arreglo disponible y ninguno es un cambio mayor** (`npm audit fix`): hay que actualizar y volver a probar envíos (Twilio, Brevo), rutas del backend y navegación del frontend. Prisma 5.10 tiene además una versión mayor disponible; evaluarla aparte.

## Media prioridad

- [ ] **Verificar `TRUST_PROXY` en producción**: `GET /api/admin/client-ip` con un token de admin debe devolver tu IP pública (`docs/DEPLOY.md`, sección 3). Con un valor mal puesto el límite de intentos por IP agrupa a todos los usuarios o se puede falsificar; el límite por correo funciona igual.
- [ ] **`POST /api/appointments` acepta fechas pasadas** por API: solo el calendario las bloquea. `PUT /api/appointments/:id` sí las rechaza desde S7-07.
- [ ] **Mover una cita que ya recibió su recordatorio no lo reinicia**: `reminderSentAt` se conserva y el paciente no recibe un recordatorio para la fecha nueva.
- [ ] **El rol dentro del JWT no se refresca**: un cambio de rol hecho por un admin se nota al volver a iniciar sesión (el token dura hasta 24 h). El `iat` del token tiene resolución de un segundo, así que uno emitido en el mismo segundo exacto de un cambio de contraseña no se invalida.
- [ ] **Límites de intentos en memoria**: los contadores de `login`, `forgot-password`, `reset-password` y `change-password` viven en el proceso (`middleware/rateLimiters.js`). Válido con una sola instancia; con varias haría falta un almacén compartido (Redis o Postgres).
- [ ] **`/api/auth/register` revela si un correo ya existe** (`Email already registered`) y crea cuentas sin verificar el correo.
- [ ] **Dependencia de un tier gratuito con sleep** (Render free): válido para el piloto, pero antes de un lanzamiento con médicos pagando, evaluar un plan pago de Render (o equivalente) que no dependa de UptimeRobot como parche.
- [ ] **Sin dominio propio**: la app corre en subdominios `*.onrender.com` — antes de un lanzamiento comercial, registrar un dominio real (ahora sí justificado por ingresos reales, a diferencia de la fase de piloto gratuito).

## Baja prioridad / limpieza

- [ ] **El registro de auditoría (S7-09) tiene huecos y no se ve en la app**: no registra los cambios de horarios de atención que hace un admin o una secretaria sobre un médico (`/api/availability`), solo existe el endpoint `GET /api/admin/audit-log` (sin pantalla en la interfaz) y la tabla `AuditLog` no se purga. Revisarlo si el volumen crece o si hace falta que lo consulte alguien sin acceso a la API.
- [ ] **Retirar el alias `/api/admin/medicos`** (responde con `Deprecation: true`) cuando ningún cliente lo use; el nombre vigente es `/api/admin/doctors`.
- [ ] **Revisar el material de demo contra la app actual** (`S6-01` guion, `S6-02` video, `S6-03` deck): desde julio cambiaron la paginación, la recuperación y el cambio de contraseña, los textos y los errores de carga. Las demos con médicos reales (S6-04 a S6-08) siguen bloqueadas por no tener candidatos.
- [ ] **`README.md` y `docs/gema_conocimiento.md` describen el setup anterior** (`prisma db push`); ahora el esquema se crea con `npx prisma migrate deploy` (`docs/TECHNICAL.md`, secciones 2 y 7).

## Ya resuelto (referencia — no repetir en v1.0)

Sprint 4 y 5: URL de API hardcodeada, CORS abierto, `JWT_SECRET` de ejemplo, errores crudos expuestos al cliente, código muerto de LowDB/Sequelize, dependencias fantasma/mal clasificadas y la ausencia total de deploy (ver PRs de S4-03 a S4-07 y S5-01 a S5-03).

Sprint 7:

| Punto del backlog o hallazgo | Resuelto en |
|---|---|
| Sin framework de testing | **S7-02** (#71, PR #77): Jest + supertest contra PostgreSQL real (381 pruebas) y CI en GitHub Actions con pruebas y lint. Colección de Postman ampliada (283 aserciones) |
| Los estados de cita rompían los recordatorios | **S7-01** (#70, PR #76): se recuerdan las citas `pending_approval`, `scheduled` y `confirmed`, una sola vez (`reminderSentAt`) y con la hora de la clínica |
| Sin límite de intentos en el login | **S7-03** (#72, PR #78): por correo (5 fallos / 15 min) y por IP, y límites también en recuperar contraseña |
| Sin recuperación de contraseña | **S7-03** (#72, PR #78): enlace por correo, un solo uso, 60 min |
| `prisma db push` en vez de migraciones | **S7-04** (#73, PR #79 y #88): migración baseline, `migrate deploy` en cada despliegue y cliente de Prisma regenerado en cada instalación. Desde el 20-oct-2026 el Build Command de producción incluye `migrate deploy` y Neon tiene su historial registrado |
| Localización incompleta | **S7-05** (#74, PR #80): decisión bilingüe según quién lee el texto (`docs/TECHNICAL.md`, sección 8) y endpoint `/api/admin/doctors` |
| Sin `DELETE /api/patients/:id` | **S7-05** (#74, PR #80) |
| Lista de citas sin paginar | **S7-05** (#74, PR #80): paginación, rango de fechas y `/stats` para los KPI |
| Bundle sin separar | **S7-05** (#74, PR #80): `manualChunks` para el calendario y las gráficas |
| Scripts ad-hoc con UUID fijos | **S7-02** (#71, PR #77): eliminados y sustituidos por pruebas |
| `eslint.config.js` roto | **S7-02** (#71, PR #77); desde S7-11, 0 errores y 0 advertencias |
| No se podía cambiar la contraseña y las sesiones viejas valían 24 h | **S7-08** (#83, PR #87): cambio desde Settings y tokens anteriores al cambio rechazados |
| `PUT` de citas podía dejar dos citas en el mismo horario | **S7-07** (#82, PR #86): mismas reglas que al agendar, `409` si está ocupado |
| No quedaba registro de lo que hacían admin y secretaria | **S7-09** (#84, PR #92): tabla `AuditLog`, registro en la misma transacción de la acción y `GET /api/admin/audit-log` solo para administradores |
| WhatsApp solo llegaba dentro de la ventana de 24 h | **S7-06** (#75, PR #81): plantillas de Meta (falta la prueba real, ver Alta prioridad) |
| Una base atrasada no avisaba y las pantallas lo mostraban como «sin datos» | **S7-11** (#89, PR #90): comprobación de esquema, `/api/health` con `503` y errores de carga con reintento |

## Lecciones del Sprint 7: el incidente del 20-oct-2026

Al fusionar S7-08, producción respondió `500` en todas las rutas autenticadas y la app mostraba «0 citas» y «No patients found», sin ningún error visible.

| Qué falló | Por qué | Qué lo previene hoy |
|---|---|---|
| A la base de Neon le faltaban `Appointment.reminderSentAt`, la tabla `PasswordResetToken` y `Doctor.passwordChangedAt`, y `Appointment.status` tenía el valor por defecto anterior a S7-01 | Neon se creó en julio con `db push`; los cambios de esquema posteriores nunca se aplicaron ahí y el Build Command de Render solo hacía `npm install` | `npx prisma migrate deploy` en el Build Command (activo desde el 20-oct) y el historial de migraciones registrado en Neon |
| Render siguió usando un cliente de Prisma generado con el esquema anterior | Reutiliza `node_modules` en caché y nada regeneraba el cliente | `"postinstall": "prisma generate"` (PR #88) |
| Nadie se enteró | `/api/health` respondía «ok» sin mirar la base | S7-11: comprobación de esquema al arrancar y en `/api/health` (`503`), con el detalle en el log |
| La app lo disfrazó de «sin datos», y Disponibilidad invitaba a guardar un horario vacío, lo que habría borrado los reales | Los errores de carga se descartaban | S7-11: error con reintento, y sin editor ni botón de guardar mientras los horarios no carguen |

Los recordatorios de 24 h (S7-01) y «Forgot password» (S7-03) tampoco podían funcionar en producción desde que se desplegaron el 19-oct, y nadie lo notó. Reglas para adelante: **un PR con cambios de esquema se verifica en producción después del despliegue**, y la base se migra antes de que el código nuevo reciba tráfico (`docs/DEPLOY.md`, «Contrato de despliegue del backend»).
