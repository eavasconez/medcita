# MedCita — Deploy a producción (Render + Neon, sin tarjeta de crédito)

> Guía paso a paso para volver a levantar (o entender cómo se levantó) la infraestructura de producción de MedCita, usando únicamente servicios con plan gratuito que no piden tarjeta de crédito. Complementa `docs/qa/S5-02-deploy-verification.md`, que documenta la verificación ya hecha — este archivo documenta el "cómo", paso a paso, para poder repetirlo.

## Por qué este stack

El plan original (Sprint 5) contemplaba DigitalOcean + dominio comprado + Nginx/Certbot manual. Se descartó porque **DigitalOcean, Oracle Cloud, AWS, GCP y Fly.io piden tarjeta de crédito** para verificación de identidad, incluso en sus tiers gratuitos. El stack final no pide tarjeta en ningún punto:

| Componente | Servicio | Por qué |
|---|---|---|
| Backend + Frontend | **Render.com** (Web Service + Static Site, plan Free) | Login con GitHub, sin tarjeta. Da HTTPS y subdominio automáticos — no hace falta Nginx/Certbot manual |
| Base de datos | **Neon.tech** (Postgres, plan Free) | Login con GitHub, sin tarjeta. Postgres real, compatible con Prisma tal cual |
| Mantener el backend despierto | **UptimeRobot.com** (plan Free) | Sin tarjeta. Hace ping periódico para evitar que Render duerma el servicio gratuito |

**Tradeoff a tener en cuenta**: los Web Services gratuitos de Render se duermen tras 15 min sin tráfico (la siguiente petición tarda ~50s en responder mientras despierta). El monitor de UptimeRobot lo mitiga (no lo elimina del todo) haciendo ping cada 5 min. Esto afecta en particular al cron de recordatorios de 24h (`node-cron`, corre dentro del mismo proceso) — si el servicio está dormido justo a la hora en que debería disparar, ese ciclo no corre.

## 1. Cuentas (una sola vez)

1. **Render**: [render.com](https://render.com) → "Get Started" → iniciar sesión con GitHub → autorizar acceso al repo `medcita`.
2. **Neon**: [neon.tech](https://neon.tech) → "Sign up" → "Continue with GitHub" → crear un proyecto (nombre `medcita`, región más cercana disponible, ej. AWS US East 2).
3. **UptimeRobot**: [uptimerobot.com](https://uptimerobot.com) → "Sign Up" → correo/Google, sin tarjeta.

## 2. Base de datos (Neon)

1. En el dashboard del proyecto de Neon, copiar la **connection string** completa (botón "Copy snippet" junto a "Show password" — copia el valor real aunque en pantalla se vea enmascarado con asteriscos).
2. En una máquina local con el repo clonado, crear un archivo **no versionado** (ya cubierto por `.gitignore`) con esa connection string:
   ```bash
   echo 'DATABASE_URL="<connection-string-de-neon>"' > backend/.env.production.local
   ```
3. Crear las tablas y cargar los datos de demo contra Neon:
   ```bash
   cd backend
   set -a; source .env.production.local; set +a
   npx prisma migrate deploy
   npx prisma db seed
   ```
   `migrate deploy` aplica las migraciones de `backend/prisma/migrations` (crea las tablas y anota cada migración aplicada en la tabla `_prisma_migrations`). El seed crea 1 admin + 3 médicos piloto + 8 pacientes + 9 citas de ejemplo (ver `prisma/seed.js`). **Correr `db seed` de nuevo borra y recrea todo** — no ejecutarlo contra datos reales de producción una vez haya pacientes reales.
4. Verificar (opcional): en el dashboard de Neon, menú lateral → **"Tables"** (explorador visual) o **"SQL Editor"** (`SELECT * FROM "Doctor";`).

> **Usa la connection string directa de Neon** (el host no lleva `-pooler`). Prisma Migrate toma un bloqueo de sesión que el pooler de Neon (PgBouncer) puede dejar colgado.

### Neon que ya existía (creada con `db push`): registrar el historial, una sola vez

Hasta S7-03 el esquema se subía a Neon con `db push`, que crea las tablas pero **no deja historial**. Con ese Neon, `migrate deploy` se niega a correr (error `P3005`, no modifica nada) hasta que se le diga a Prisma que la migración `20261019202135_baseline` —el esquema completo tal como estaba al cerrar S7-03— ya está aplicada. Registrarla **no ejecuta SQL ni toca datos**: solo crea la tabla `_prisma_migrations` y anota la migración.

```bash
cd backend
set -a; source .env.production.local; set +a

# 1. Solo lectura: comparar Neon con el esquema actual. Pueden aparecer las dos diferencias
#    conocidas de abajo (columna de S7-08, valor por defecto de S7-01); si no aparece nada,
#    responde "-- This is an empty migration."
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script --exit-code

# 2. Registrar la baseline como ya aplicada
npx prisma migrate resolve --applied 20261019202135_baseline

# 3. Verificar: debe decir que falta aplicar solo 20261020150000_add_password_changed_at (S7-08),
#    que `migrate deploy` aplicará en el siguiente build. Si no hay nada pendiente dirá
#    "Database schema is up to date!"
npx prisma migrate status
```

**La columna de S7-08.** La baseline es el esquema de S7-03. S7-08 agregó `Doctor.passwordChangedAt` en una migración aparte (`20261020150000_add_password_changed_at`), así que en el paso 1 es normal ver únicamente `ALTER TABLE "Doctor" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);`: **no la apliques a mano**, el build de Render la aplica con `migrate deploy` (es una columna nueva y nula, no toca datos). Si ya la creaste con `db push`, registra también esa migración (`npx prisma migrate resolve --applied 20261020150000_add_password_changed_at`) para que `migrate deploy` no falle por «column already exists».

**El valor por defecto de `status` (S7-01).** En una base creada antes de S7-01 también es normal ver `ALTER TABLE "Appointment" ALTER COLUMN "status" SET DEFAULT 'pending_approval';`: S7-01 cambió ese valor por defecto de `'scheduled'` a `'pending_approval'`. Es inofensivo (la app y el seed siempre indican el estado al crear una cita, y cambiar un valor por defecto no toca las filas existentes), pero conviene alinearlo **antes** de registrar la baseline para que el diff quede vacío: ejecuta esa sentencia en el SQL Editor de Neon y repite el paso 1. Así se hizo en producción el 20-oct-2026.

**Resultado `P3008` al registrar.** Si `migrate resolve` responde `P3008` («already recorded as applied»), esa migración ya estaba anotada en el historial: no es un error. Lo que cuenta es que `migrate status` termine en `Database schema is up to date!`.

Si el paso 1 imprime SQL distinto de esas dos diferencias (código de salida 2), a Neon le falta algo de un PR anterior (por ejemplo la columna `reminderSentAt` de S7-01 o la tabla `PasswordResetToken` de S7-03). Si el SQL solo agrega cosas (`CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE … ADD …`), corre `npx prisma db push` y repite el paso 1. Si aparece algún `DROP`, **detente y revísalo antes** de seguir: `db push` pediría `--accept-data-loss`.

Solo cuando el paso 3 esté bien, cambiar el **Build Command** del servicio en Render (sección 3). Hacerlo antes haría fallar el build con `P3005` (la versión anterior seguiría sirviendo, no se pierde nada). Guardar el Build Command lanza un despliegue del último commit, que sirve de prueba: en el log debe aparecer `No pending migrations to apply.` y el servicio debe quedar en *Live* (así salió el 20-oct-2026).

> **Orden al desplegar un cambio de esquema.** Mientras el Build Command de Render **no** incluya `migrate deploy`, las migraciones no se aplican solas: un PR que traiga una migración debe aplicarse a mano en Neon (SQL Editor o `migrate deploy`) **antes** de fusionarlo, porque Render despliega al fusionar. Pasó el 20-oct-2026 con S7-08: el código pedía `Doctor.passwordChangedAt`, la columna no existía en Neon y todas las rutas autenticadas respondieron 500 hasta crearla. Con `migrate deploy` en el Build Command el problema desaparece, porque la migración corre durante el build, antes de que la versión nueva atienda tráfico. Desde el 20-oct-2026 el Build Command de producción ya lo incluye; esta advertencia vale si se vuelve a omitir o al cambiar de servicio.

## 3. Backend (Render Web Service)

1. Dashboard de Render → **"+ New"** → **"Web Service"** → conectar el repo `medcita`.
2. Configuración:
   - **Name**: `medcita-backend`
   - **Branch**: la rama que se quiera desplegar (idealmente `main` una vez todos los PRs estén mergeados)
   - **Root Directory**: `backend`
   - **Runtime**: Node
   - **Build Command**: `npm install && npx prisma migrate deploy`
   - **Start Command**: `node src/server.js`
   - **Instance Type**: Free
   - **Health Check Path** (Settings → Health Check Path): `/api/health`. Render espera una respuesta `200` de esa ruta antes de pasar el tráfico a un despliegue nuevo; como la ruta responde `503` cuando la base de datos está atrasada respecto al código (una migración sin aplicar), un despliegue así **no sale a producción** y la versión anterior sigue sirviendo. Ver «Contrato de despliegue del backend»

   `migrate deploy` aplica en cada deploy las migraciones pendientes contra `DATABASE_URL` (Neon) y no hace nada si no hay ninguna. Si una migración falla, el build falla y Render sigue sirviendo la versión anterior. Para un servicio que **ya existe**, cambiar el Build Command en *Settings → Build & Deploy*, pero solo después de registrar el historial en Neon (sección 2). El CLI `prisma` está en `dependencies` (no en `devDependencies`) para que este comando lo encuentre aunque el build omita las dependencias de desarrollo.
3. **Environment Variables** (antes de crear el servicio):

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | La misma connection string de Neon usada en el paso 2 |
   | `JWT_SECRET` | Generar una nueva y real: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `FRONTEND_URL` | La URL del Static Site de Render (paso 4) — mientras no exista, usar un placeholder temporal y **actualizarlo después** (ver nota abajo) |
   | `ERROR_ALERT_EMAILS` | Opcional pero recomendada. Correos de los **desarrolladores / del equipo de MedCita** (uno o varios, separados por comas) que reciben un aviso cuando el servidor responde un error 500. Nunca la dirección de un consultorio. Ver «Despliegue de los límites persistentes y las alertas de errores» |
   | `TRUST_PROXY` | Opcional. Nº de proxies delante de la app para los límites de intentos por IP; en Render vale `2` por defecto (no hace falta definirla). Ver la verificación abajo |
   | `META_WHATSAPP_*` / `TWILIO_*` / `BREVO_*` / `SENDGRID_*` | Opcionales — sin ellas, WhatsApp/Email corren en modo mock (igual que en local). Para elegir entre WhatsApp con Meta (plantillas, número de prueba gratuito) y Twilio ver la sección 7 |

   > **Verificar `TRUST_PROXY` tras desplegar**: el login limita los intentos fallidos por IP y por correo, y la IP depende de cuántos proxies hay delante (en Render: Cloudflare + balanceador). Con un token de admin:
   > ```bash
   > curl -H "Authorization: Bearer <token-admin>" https://medcita-backend.onrender.com/api/admin/client-ip
   > # {"ip":"<tu IP pública>","forwardedFor":"...","trustProxy":2}
   > ```
   > `ip` debe ser **tu IP pública** (compárala con `curl ifconfig.me`). Si muestra una IP de Cloudflare o privada, sube `TRUST_PROXY` en 1; si muestra una IP que no es tuya, bájalo en 1. El límite por correo funciona igual aunque este valor esté mal; solo el límite por IP depende de él.

   > **Recuperación de contraseña**: necesita un proveedor de email real (`BREVO_API_KEY` y `BREVO_FROM_EMAIL`, o `SENDGRID_API_KEY`) y que `FRONTEND_URL` sea la URL real del frontend, porque el enlace del correo se arma con ella. La tabla `PasswordResetToken` forma parte de la migración baseline: en una Neon creada antes de S7-03, el paso 1 de la sección 2 avisa si todavía no la tiene.

4. **"Create Web Service"**. Al terminar el build, Render asigna una URL tipo `https://medcita-backend.onrender.com` — confirmarla con:
   ```bash
   curl https://medcita-backend.onrender.com/api/health
   # {"status":"ok"}
   ```

## 4. Frontend (Render Static Site)

1. Dashboard de Render → **"+ New"** → **"Static Site"** → mismo repo `medcita`.
2. Configuración:
   - **Name**: `medcita-frontend`
   - **Branch**: la misma que el backend
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build`
   - **Publish Directory**: `dist`
3. **Environment Variables**:

   | Key | Value |
   |---|---|
   | `VITE_API_URL` | La URL del backend del paso 3 (ej. `https://medcita-backend.onrender.com`) |

4. **"Create Static Site"**. Render asigna una URL tipo `https://medcita-frontend.onrender.com`.

### ⚠️ Paso obligatorio — regla de rewrite para el SPA
Sin esto, entrar directo a cualquier ruta que no sea `/` (ej. `/login`, `/patients`) da **404 Not Found** — React Router maneja esas rutas en el navegador, pero el hosting estático busca un archivo real con ese nombre.

1. En el Static Site → menú lateral → **"Redirects/Rewrites"**.
2. Agregar regla: **Source** `/*` → **Destination** `/index.html` → **Action** `Rewrite`.

### ⚠️ Paso obligatorio — actualizar `FRONTEND_URL` en el backend
Una vez se tiene la URL real del Static Site, volver al Web Service del backend (paso 3) → pestaña **Environment** → actualizar `FRONTEND_URL` con la URL real del frontend. El backend restringe CORS a este valor (`server.js`); sin actualizarlo, el navegador bloquea todas las peticiones del frontend real.

## 5. Mantener el backend despierto (UptimeRobot)

1. Dashboard de UptimeRobot → **"+ Add New Monitor"**.
2. **Monitor Type**: `HTTP(s)`
3. **URL**: `https://<tu-backend>.onrender.com/api/health` (el endpoint de health check, sin autenticación, pensado exactamente para esto — ver `server.js`)
4. **Monitoring Interval**: el mínimo disponible en el plan free (normalmente 5 min).

El monitor también sirve de alarma: `/api/health` responde `503` si la base de datos no responde o si le falta una tabla o columna que el código necesita, y UptimeRobot lo marca como caído (te llega el aviso). El resultado sano se recuerda una hora, así que el ping de cada 5 min **no** consulta la base y no la mantiene despierta (Neon apaga el cómputo tras unos minutos sin uso y su plan gratis tiene horas limitadas).

## 6. Verificación final

```bash
# Backend responde
curl https://medcita-backend.onrender.com/api/health

# Login real
curl -X POST https://medcita-backend.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@medcita.ec","password":"admin1234"}'
```

Luego, en el navegador: entrar a la URL del frontend, iniciar sesión, y confirmar en las DevTools (pestaña Network) que las peticiones van al dominio del backend real, sin errores de CORS ni en la consola. Ver `docs/qa/S5-02-deploy-verification.md` para el detalle completo de esta verificación con capturas.

## 7. WhatsApp: elegir el proveedor (Meta o Twilio) y configurarlo

MedCita envía WhatsApp con **un solo proveedor a la vez**, elegido por las variables de entorno del backend. El cliente decide cuál usar; el código soporta los dos.

### 7.0 Qué proveedor elegir

| | **Meta Cloud API** (recomendado, el de producción hoy) | **Twilio** |
|---|---|---|
| Se activa con | `META_WHATSAPP_TOKEN` y `META_WHATSAPP_PHONE_NUMBER_ID` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` y `TWILIO_WHATSAPP_NUMBER` (y que no estén las de Meta) |
| Qué se envía | **Plantillas aprobadas** en español (`cita_confirmada`, `recordatorio_cita`) | El mismo texto, como **mensaje normal** (no usa plantillas) |
| Llega a un paciente que nunca escribió | **Sí**, con el número de prueba (hasta 5 destinatarios registrados) o con un número propio | **No** con el sandbox: cada destinatario debe «unirse» enviando `join <código>` al número de Twilio, y la sesión expira a las ~72 h sin actividad |
| Para pacientes reales | Número propio + verificación del negocio (7.7) | Un remitente de WhatsApp aprobado en Twilio. Fuera de la ventana de 24 h, la política de WhatsApp exige plantillas, y **el código no envía plantillas por Twilio**; habría que añadirlo |
| Costo | Número de prueba gratuito; con número propio, tarifa por mensaje de utilidad fuera de la ventana de 24 h (7.7) | Tarifa de Twilio por mensaje más la de Meta, según su plan vigente |
| Mantenimiento | Token de usuario del sistema: 60 días sin negocio verificado (hoy vence el **19-dic-2026**), sin vencimiento con negocio verificado | Credenciales de Twilio sin vencimiento |
| Si falla un envío | Se registra el error de Meta con una pista en el log. **No se reintenta por Twilio** | Se registra el error de Twilio en el log |

**Orden de elección en el código** (`backend/src/services/notificationService.js`): Meta si sus dos variables están definidas; si no, Twilio si sus credenciales están; si no, **modo mock** (solo escribe en el log, no envía nada y responde como si hubiera funcionado).

**Cómo cambiar de uno a otro (sin tocar el código):**
- **A Meta:** definir `META_WHATSAPP_TOKEN` y `META_WHATSAPP_PHONE_NUMBER_ID` en Render (7.5). Tiene prioridad sobre Twilio aunque las variables de Twilio sigan puestas.
- **A Twilio:** borrar las dos variables de Meta y dejar las `TWILIO_*`. Solo sirve para pruebas con el sandbox o si se añade soporte de plantillas.
- **A ninguno (mock):** borrar las de Meta y las de Twilio.
- Render redespliega solo al guardar las variables. Después de cualquier cambio, prueba con `npm run whatsapp:test -- +593… ` y una cita real (7.6).

**Recomendación para producción:** usar solo Meta y **no cargar las variables `TWILIO_*` en Render** (una sola ruta de envío y menos secretos guardados). Twilio queda para desarrollo local. Las variables viejas en Render no hacen daño mientras las de Meta estén definidas, pero sí quedarían como respaldo manual: si Meta se cae, basta con borrar las de Meta para volver a Twilio.

**Estado al 21-oct-2026:** producción envía por **Meta** con el número de prueba. La confirmación de una cita agendada desde el sitio desplegado llegó al teléfono de prueba; evidencia en `docs/qa/S7-12-production-evidence.md`.

### 7.0b Cómo funciona Meta (resumen)

Hasta S7-06 producción enviaba WhatsApp con el **sandbox de Twilio**, que obliga a cada destinatario a «unirse» a mano antes de recibir nada. Con la API de Meta no hace falta: el **número de prueba es gratuito** y se pueden agregar hasta 5 destinatarios desde el panel de Meta, sin escribirle nunca al número.

> **Por qué plantillas.** Meta solo deja que un negocio abra una conversación con una **plantilla aprobada**. El texto libre únicamente se entrega dentro de las 24 h posteriores a que el paciente escribió. La confirmación de cita y el recordatorio los inicia MedCita, así que desde S7-06 se envían como plantillas (`backend/src/services/whatsappTemplates.js`). Sin credenciales de Meta nada cambia: Twilio y el modo mock envían el mismo texto como mensaje normal.

> **Guía completa paso a paso** (crear la cuenta, la app, las plantillas y el token, con los tropiezos de S7-06): [WHATSAPP_META_SETUP.md](WHATSAPP_META_SETUP.md). Esta sección es la referencia corta.

> Meta cambia los nombres de los menús con frecuencia. Si algo no está donde se indica, búscalo por su nombre en el buscador del panel.

### 7.1 Crear la app y el número de prueba (una sola vez)

1. Entra a [developers.facebook.com](https://developers.facebook.com) con la cuenta de Facebook que administrará esto → **My Apps → Create App** → tipo **Business** → asocia (o crea) un *business portfolio*.
2. En el panel de la app, agrega el producto **WhatsApp**. Meta crea una cuenta de WhatsApp Business de prueba con un **número de prueba**.
3. En **WhatsApp → API Setup** anota dos datos:
   - **Phone number ID** (un número largo; **no** es el teléfono): va en `META_WHATSAPP_PHONE_NUMBER_ID`.
   - **WhatsApp Business Account ID**: lo pedirá Meta al crear plantillas.

### 7.2 Agregar a quienes recibirán los mensajes de prueba (máx. 5)

**WhatsApp → API Setup →** campo **To →** **Manage phone number list →** agrega cada número con su código de país (por ejemplo `+593…`). Meta manda un código por WhatsApp a ese número para confirmarlo. Con el número de prueba, **un número que no esté en esta lista no recibe nada** (el error es el 131030).

### 7.3 Token de usuario del sistema

El token que muestra *API Setup* es temporal y **vence pronto**: el panel habla de 24 h, pero en las pruebas de S7-06 el generado desde *Pruébalo* dejó de funcionar en alrededor de **1 hora** (error 190, «Session has expired»). Sirve para probar de inmediato; para el backend desplegado hace falta uno de usuario del sistema:

1. [business.facebook.com/settings](https://business.facebook.com/settings) → **Users → System users → Add** (rol *Admin*).
2. **Add assets**: la **app** (control total) y la **cuenta de WhatsApp** (control total). La app debe pertenecer al mismo portfolio comercial (**Accounts → Apps**).
3. **Generate new token** → elige la app → marca los permisos `whatsapp_business_messaging` y `whatsapp_business_management`.
4. Copia el token (solo se muestra una vez) a `META_WHATSAPP_TOKEN`. Es una credencial: va en las variables de entorno de Render, nunca en el repositorio.

**Vencimiento.** Mientras el negocio no esté verificado, Meta no ofrece la opción *Never* y el token dura **60 días** (en S7-06 se generó uno con vencimiento a 60 días). Es suficiente para pruebas, pero **no es permanente**: anota la fecha, porque al vencer los envíos fallan con el error 190 y no hay respaldo automático a Twilio. Para ver cuándo vence, consulta `GET /debug_token?input_token=<token>` con ese mismo token (`expires_at` en segundos Unix; `0` significa que no vence). Con el negocio verificado (checklist de 7.7) se genera uno sin vencimiento.

### 7.4 Registrar las dos plantillas

En **WhatsApp Manager → Message templates → Create template** (o **WhatsApp → Message templates** en el panel de la app). Para las dos:

- **Category: Utility** · **Language: Spanish** (código `es`) · sin encabezado, pie ni botones.
- El nombre admite solo minúsculas, números y guiones bajos.
- Pega el texto **exactamente** como está abajo, con sus variables `{{1}}`, `{{2}}`… y completa los **ejemplos** que Meta pide para cada variable.

**Confirmación de cita** — nombre `cita_confirmada`:

```
MedCita: Hola {{1}}, tu cita con {{2}} ha sido agendada para el {{3}} a las {{4}}. ¡Te esperamos!
```
Ejemplos: `{{1}}` María Andrade · `{{2}}` Dr. Santiago Pérez · `{{3}}` 2026-10-21 · `{{4}}` 10:00

**Recordatorio** (a las 2, 24 o 48 h, según lo que elija cada consultorio) — nombre `recordatorio_cita`:

```
Recordatorio MedCita: Hola {{1}}, tienes una cita {{2}} a las {{3}} con {{4}}. Si no puedes asistir, avísanos con anticipación para liberar el horario. ¡Gracias!
```
Ejemplos: `{{1}}` María Andrade · `{{2}}` mañana 2026-10-21 · `{{3}}` 10:00 · `{{4}}` Dr. Santiago Pérez

**Recordatorio con la dirección y las indicaciones del consultorio** (opcional) — nombre `recordatorio_cita_consultorio`:

```
Recordatorio de {{1}}: Hola {{2}}, tienes una cita {{3}} a las {{4}} con {{5}}. Dónde y cómo llegar: {{6}}. Si no puedes asistir, avísanos con anticipación para liberar el horario. ¡Gracias!
```
Ejemplos: `{{1}}` Consultorio MedCita · `{{2}}` María Andrade · `{{3}}` mañana 2026-10-21 · `{{4}}` 10:00 · `{{5}}` Dr. Santiago Pérez · `{{6}}` Av. Amazonas N34-12, Quito. Llegar 10 minutos antes y traer la cédula

Es la que usa un consultorio que escribió una dirección o indicaciones en Settings → Reminders. **No se usa hasta que la registras y la apruebas**: después define en Render `META_WHATSAPP_TEMPLATE_REMINDER_DETAILED=recordatorio_cita_consultorio`. Mientras tanto Meta envía el recordatorio sencillo de arriba y la dirección y las indicaciones llegan solo por correo (Twilio y el modo simulado, que envían texto libre, sí las incluyen). Meta puede rechazarla por tener 6 variables: si pasa, acorta lo que va en `{{6}}` o alarga el texto, y cambia el mismo texto en `whatsappTemplates.js`.

> Meta rechaza una plantilla con demasiadas variables para lo corto que es el texto («demasiadas variables en relación con su longitud»), y no admite una variable al principio ni al final. Por eso el día y la fecha viajan juntos en `{{2}}` y el texto cierra con una frase.

La revisión es automática y puede tardar desde minutos hasta 24 h; solo las plantillas en estado **APPROVED** se pueden enviar. Si Meta las recategoriza como *Marketing*, el texto parece promocional: edítalo para que sea solo informativo. Si registras otro nombre o idioma (por ejemplo `es_MX`), indícalo en `META_WHATSAPP_TEMPLATE_CONFIRMATION`, `META_WHATSAPP_TEMPLATE_REMINDER` o `META_WHATSAPP_TEMPLATE_LANGUAGE`.

Si algún día cambia el texto en `whatsappTemplates.js`, hay que cambiar también la plantilla en Meta (se vuelve a aprobar); mientras tanto los envíos fallan con el error 132001. Un test comprueba que este documento y el código tengan el mismo texto.

### 7.5 Variables de entorno (Render)

| Key | Value |
|---|---|
| `META_WHATSAPP_TOKEN` | El token de usuario del sistema del paso 7.3 (vence a los 60 días si el negocio no está verificado) |
| `META_WHATSAPP_PHONE_NUMBER_ID` | El *Phone number ID* del paso 7.1 |
| `META_WHATSAPP_TEMPLATE_CONFIRMATION` / `META_WHATSAPP_TEMPLATE_REMINDER` | Opcionales. Nombres de las plantillas (por defecto `cita_confirmada` y `recordatorio_cita`) |
| `META_WHATSAPP_TEMPLATE_REMINDER_DETAILED` | Opcional. **Actívala solo cuando la plantilla `recordatorio_cita_consultorio` esté aprobada**: con ella los consultorios con dirección o indicaciones las mandan por WhatsApp. Sin definir, usan el recordatorio sencillo |
| `META_WHATSAPP_TEMPLATE_LANGUAGE` | Opcional. Idioma de las plantillas (por defecto `es`) |

Con `META_WHATSAPP_TOKEN` y `META_WHATSAPP_PHONE_NUMBER_ID` definidos, Meta tiene prioridad sobre Twilio. Para dejar de usar Twilio (recomendado en producción), borra las variables `TWILIO_*`; elegir entre Meta y Twilio se explica en la sección 7.0.

### 7.6 Comprobar que funciona

Desde `backend/`, con esas variables en tu `.env` local (o exportadas), y con tu número en la lista del paso 7.2:

```bash
npm run whatsapp:test -- +593999999999             # confirmación
npm run whatsapp:test -- +593999999999 reminder    # recordatorio
```

Debe imprimir `Provider: Meta Cloud API`, el nombre de la plantilla y `OK: Meta Cloud API accepted the message`, y el mensaje llega al teléfono **sin que nadie le haya escrito antes al número**. Si falla, el error de Meta aparece en las líneas anteriores con una pista de qué corregir. Los más comunes:

| Código | Qué pasó | Qué hacer |
|---|---|---|
| 190 | El token venció o es inválido | Genera un token de usuario del sistema (7.3) y actualiza `META_WHATSAPP_TOKEN` |
| 131030 | El número no está en la lista de destinatarios del número de prueba | Agrégalo en 7.2 |
| 132001 | No hay una plantilla **aprobada** con ese nombre e idioma | Revisa el estado en WhatsApp Manager y los nombres/idioma de 7.4 y 7.5 |
| 132000 / 132012 | La cantidad o el formato de las variables no coincide con la plantilla | Registra la plantilla con el texto exacto de 7.4 |
| 132015 / 132016 | Plantilla pausada o deshabilitada por baja calidad | Edítala en WhatsApp Manager o crea otra |
| 131047 | Mensaje de texto libre fuera de la ventana de 24 h | No debería pasar con plantillas: avisa si lo ves |

Después prueba el flujo real: agenda una cita con tu número como paciente y espera el WhatsApp de confirmación (y el recordatorio cuando falten menos de 24 h).

### 7.7 Checklist para pasar a un número real

El número de prueba sirve para validar, no para clientes reales (solo 5 destinatarios). Para producción:

- [ ] **Verificación del negocio** en Meta Business Suite (Business settings → Security centre). Sin ella los límites de envío son bajos.
- [ ] **Número propio** que no esté activo en la app de WhatsApp normal, con su *display name* aprobado.
- [ ] **Método de pago** en la cuenta de WhatsApp Business (Business settings → Payments). Sin él, Meta no deja enviar plantillas a destinatarios nuevos.
- [ ] **Plantillas aprobadas en la cuenta del número real.** Las plantillas pertenecen a la cuenta de WhatsApp Business: si el número real queda en otra cuenta que el de prueba, hay que registrarlas allí otra vez (7.4).
- [ ] Actualizar `META_WHATSAPP_PHONE_NUMBER_ID` (y el token si es de otra app) en Render.
- [ ] **Consentimiento de los pacientes.** La política de WhatsApp pide que el paciente haya aceptado recibir mensajes del negocio. Hoy el formulario de la cita no lo pregunta ni lo guarda.
- [ ] Revisar la **tarifa vigente**.

**Costo.** Los mensajes *utility* enviados **fuera** de la ventana de 24 h de atención al cliente (el caso de una confirmación o un recordatorio a quien no escribió) se cobran por mensaje; dentro de la ventana son gratis. Ecuador está en la región «Rest of Latin America». Como orden de magnitud, una guía de terceros de julio de 2026 lista unos US$0,0113 por mensaje *utility* en esa región (confirmación + recordatorio ≈ US$0,02 por cita): es una referencia, no un precio. Meta actualiza sus tarifas el primer día de cada trimestre; la vigente está en [developers.facebook.com/docs/whatsapp/pricing](https://developers.facebook.com/docs/whatsapp/pricing).

## Contrato de despliegue del backend (vale para cualquier servicio)

Render es solo donde corre hoy. Lo que el backend necesita es lo mismo en cualquier otro servicio (Railway, Fly.io, un VPS, Docker…). En este orden, dentro de `backend/`:

| Paso | Comando | Para qué |
|---|---|---|
| 1. Instalar | `npm install` (o `npm ci`) | Instala las dependencias. El `postinstall` del proyecto ejecuta `prisma generate`, así el cliente de Prisma coincide siempre con `schema.prisma`, incluso si el servicio reutiliza una caché de `node_modules` |
| 2. Migrar | `npx prisma migrate deploy` | Aplica a `DATABASE_URL` las migraciones pendientes. Debe terminar **antes** de que la versión nueva reciba tráfico |
| 3. Arrancar | `npm start` (`node src/server.js`) | Al arrancar compara el esquema de la base con lo que el código espera y deja el resultado en el log |
| 4. Esperar la salud | `GET /api/health` → `200` | La plataforma no debe enviar tráfico a la versión nueva hasta que responda `200`. Con `503` la base está inalcanzable o atrasada |

Por qué importa cada parte (aprendido el 20-oct-2026, cuando producción respondió 500):

- **El cliente de Prisma se genera, no se instala.** Si la plataforma reutiliza `node_modules` entre despliegues y nada regenera el cliente, el código nuevo pide campos que el cliente viejo no conoce. Las versiones recientes de npm además no ejecutan por defecto los scripts de instalación de las *dependencias* (entre ellos el de `@prisma/client`), por eso el `generate` vive en el `postinstall` del propio proyecto, que sí corre. Si algún día se omiten los scripts (`--ignore-scripts`), hay que correr `npx prisma generate` aparte.
- **La base debe estar migrada antes del código.** Desde S7-08 el middleware de autenticación lee una columna en cada petición; con la base sin migrar falla toda ruta protegida.
- **El servicio avisa si la base va atrasada (S7-11).** Al arrancar y en `/api/health` compara las tablas y columnas que el código espera con las que existen de verdad (`backend/src/services/schemaCheck.js`). Mira las columnas, no el historial de migraciones, así que también sirve para una base que vino de `db push`. Si falta algo, el log dice qué (`DATABASE SCHEMA IS OUT OF DATE: missing Doctor.passwordChangedAt…`) y cómo arreglarlo, y el health responde `503 { status: "error", reason: "schema_outdated" }` sin detallar qué falta (la ruta es pública). Se arregla solo: se vuelve a comprobar a los 10 s mientras falle, así que en cuanto se aplica la migración vuelve a `200` sin reiniciar. Si cambias de servicio, configura su health check apuntando a `/api/health`.
- **`prisma` está en `dependencies` a propósito**, para que `generate` y `migrate deploy` existan también en instalaciones de producción (`npm ci --omit=dev`).
- **Docker:** copia `package.json`, `package-lock.json` **y la carpeta `prisma/`** antes de `npm ci`, porque `postinstall` necesita `prisma/schema.prisma`.
- Si se cambia de servicio, la base no cambia de manos: hay que llevar la misma `DATABASE_URL` (y, si es una base nueva, correr `migrate deploy` o, para una que venga de `db push`, el registro de historial de la sección 2).

## Primer despliegue con consultorios (S8-01)

S8-01 agrega dos migraciones (`20261021120000_add_clinics` y `20261021120100_require_clinic_id`) que se aplican solas con el `prisma migrate deploy` del Build Command. Lo que hacen sobre los datos que ya existen:

1. `add_clinics` crea la tabla `Clinic`, agrega la columna `clinicId` (todavía opcional) a las cinco tablas y mete **todo lo que existe** en un consultorio por defecto: `Consultorio principal` (slug `principal`, id `00000000-0000-4000-8000-000000000001`). Una base vacía no recibe ningún consultorio.
2. `require_clinic_id` pasa lo que hubiera escrito una versión vieja entre los dos pasos a ese mismo consultorio, vuelve obligatoria la columna, cambia `phone` y `cedula` a únicos **por consultorio** y agrega las claves foráneas compuestas. Los datos no se tocan: solo se les agrega el consultorio.

Ambas se probaron con datos heredados en `backend/tests/clinicMigration.test.js` y la suite verifica que `schema.prisma` y las migraciones coinciden.

**Antes de fusionar.** Haz una copia por si algo sale mal: en Neon, *Branches → Create branch* desde la rama de producción con los datos actuales (por ejemplo `antes-de-s8-01`). Es instantánea y se puede consultar o restaurar; bórrala cuando ya no la necesites.

**Qué esperar durante el despliegue.** Entre que termina la migración y que la versión nueva responde `200` en `/api/health` (uno o dos minutos), la versión anterior sigue atendiendo pero **no puede crear ni editar pacientes, citas ni horarios**: no conoce el `clinicId` y falla con `500`. Las lecturas siguen funcionando. Con el *Health Check Path* configurado, Render no pasa el tráfico a la versión nueva hasta que está sana. Hazlo en un momento tranquilo; con los datos de demo de hoy no hay impacto.

**Verificar producción después de desplegar** (la regla del 20-oct: un PR con cambios de esquema se comprueba en producción):

- [ ] `GET /api/health` responde `200`.
- [ ] Iniciar sesión con la cuenta admin y comprobar que los pacientes y las citas son los de siempre (nada desapareció) y que la barra lateral dice `Consultorio principal`.
- [ ] En el SQL Editor de Neon: `SELECT name, slug FROM "Clinic";` debe devolver una sola fila. Si quieres otro nombre: `UPDATE "Clinic" SET name = 'Consultorio piloto' WHERE slug = 'principal';`
- [ ] `npx prisma migrate status` con la `DATABASE_URL` de Neon dice «Database schema is up to date!».

**Cuenta de operador de la plataforma.** No existe por defecto en producción (el seed no corre allí). Para crear una, genera el hash de la contraseña y ejecuta el SQL en Neon (el `id` lo genera la propia consulta):

```bash
node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" 'una-contraseña-larga'
```

```sql
INSERT INTO "Clinic" (id, name, slug) VALUES (gen_random_uuid()::text, 'MedCita (plataforma)', 'plataforma');
INSERT INTO "Doctor" (id, name, email, password, role, "clinicId")
SELECT gen_random_uuid()::text, 'Operador de la plataforma', 'tu@correo.com', '<hash de arriba>', 'superadmin', id
FROM "Clinic" WHERE slug = 'plataforma';
```

**Marcha atrás.** Las migraciones no tienen «deshacer». Con la base ya migrada, la versión anterior del código no puede escribir (le falta `clinicId`), así que la salida es corregir hacia adelante o restaurar la copia de Neon, perdiendo lo escrito después de hacerla.

## Despliegue de los tipos de cita (S9-04)

S9-04 agrega la migración `20261023100000_add_appointment_types`, que se aplica sola con el `prisma migrate deploy` del Build Command. Sobre los datos que ya existen hace esto, en este orden: crea la tabla `AppointmentType`; crea para **cada consultorio** su tipo predeterminado («Consultation», 30 min); agrega `Appointment.durationMinutes` (30 por defecto) y `Appointment.typeId`; asocia **todas las citas existentes** al predeterminado de su consultorio; y recién entonces agrega las claves foráneas. Ninguna cita, paciente ni horario cambia. Se probó con datos heredados en `backend/tests/appointmentTypesMigration.test.js`.

**Antes de fusionar.** En Neon, *Branches → Create branch* desde la rama de producción (por ejemplo `antes-de-s9-04`), como en «Primer despliegue con consultorios». Es instantánea; bórrala cuando ya no la necesites. Si hay staging, despliega ahí primero.

**Qué esperar.** A diferencia de S8-01, **la versión anterior sigue pudiendo agendar** entre la migración y el despliegue nuevo: `typeId` es opcional en la base y `durationMinutes` tiene valor por defecto, así que una cita creada por la versión vieja queda «sin tipo» y cuenta como del predeterminado. Y por lo mismo **volver atrás el código es seguro** (la tabla y las columnas nuevas quedan sin uso). No hay ventana en la que no se pueda escribir.

**Verificar producción después de desplegar:**

- [ ] `GET /api/health` responde `200`.
- [ ] La agenda de siempre se ve igual: las citas existentes con la misma hora y 30 minutos de duración.
- [ ] En Settings, «Appointment types» muestra «Consultation · 30 minutes · Default».
- [ ] En el SQL Editor de Neon: `SELECT count(*) FROM "Appointment" WHERE "typeId" IS NULL;` devuelve `0` (salvo citas que haya creado la versión anterior durante el despliegue; la aplicación las trata como del tipo predeterminado) y `SELECT "clinicId", count(*) FROM "AppointmentType" WHERE "isDefault" GROUP BY 1 HAVING count(*) > 1;` no devuelve filas.
- [ ] Agendar una cita de prueba con otro tipo (por ejemplo, 40 min) y comprobar que el calendario la dibuja más larga; cancelarla después.

## Despliegue de los límites persistentes y las alertas de errores (S9-08)

S9-08 hace dos cosas: los contadores de los límites de intentos (login, recuperación de contraseña, registro, invitaciones) pasan de la memoria del servidor a la base de datos, y un error del servidor (5xx) manda un correo **al equipo de desarrollo de MedCita**. Cómo probarlo antes y después: [`docs/qa/S9-08-guia-de-pruebas.md`](qa/S9-08-guia-de-pruebas.md).

### Antes de fusionar a `main`

- [ ] **Rama de respaldo en Neon** (por ejemplo `antes-de-s9-08`), como en «Primer despliegue con consultorios». La migración `20261026100000_add_rate_limit_counters` solo **crea la tabla `RateLimitCounter`**: no toca ninguna fila existente y la versión anterior, que cuenta en memoria, nunca la lee, así que seguir con ella o volver atrás es seguro. Se aplica sola con el `prisma migrate deploy` del Build Command y se probó sobre datos existentes (`backend/tests/rateLimitCountersMigration.test.js`).
- [ ] **Decidir los correos que recibirán las alertas**: los de los desarrolladores / del equipo que opera MedCita, **nunca** los de un cliente o consultorio.
- [ ] **Brevo y la lista de IPs autorizadas.** Si en Brevo está activa la lista de IPs (app.brevo.com → *Security → Authorised IPs*), Brevo **rechaza con 401** («unrecognised IP address») las llamadas desde cualquier IP que no esté en ella, y manda un correo «Verify a new IP» a la cuenta. Eso bloquea **todos** los correos de MedCita (invitaciones, altas, recuperación de contraseña, recordatorios por correo y estas alertas). Autoriza las **IPs de salida de Render** de la región del servicio (Render las muestra en el panel del servicio —busca «Outbound» en *Connect*— y en su documentación, «Outbound IP Addresses»; son compartidas por la región y pueden cambiar) o desactiva la restricción. Para probar desde una computadora local también hay que autorizar la IP de esa computadora (puede ser IPv6 y cambiar).

### Variables de entorno (Render → `medcita-backend` → *Environment*)

| Key | Value |
|---|---|
| `ERROR_ALERT_EMAILS` | Correos de los **desarrolladores o del equipo de soporte de MedCita**, uno o varios separados por comas (`dev1@…,dev2@…`); cada aviso llega a todos. Una dirección compartida (`soporte@…`) también sirve y no depende de una persona. **Nunca** la de un consultorio: el aviso nombra al consultorio afectado y es solo para quien opera la plataforma. Sin definir no se envía nada y todo sigue como antes. Necesita el correo funcionando (`BREVO_*`, sección 3). Render redespliega solo al guardar |

Nada más cambia: los límites siguen siendo los mismos (`docs/TECHNICAL.md`, «Límite de intentos»).

### Qué cambia al desplegar

- Los intentos fallidos ya **no se pierden con cada despliegue**: quien está bloqueado sigue bloqueado hasta que termine su ventana (de 15 minutos a 1 hora).
- Cada intento contado hace una escritura en Neon (también despierta la base si estaba dormida; el login ya la necesitaba). Las filas vencidas se borran cada hora.
- Si la base no responde al contar, la petición **pasa** (lo que sigue, un login o un alta, también necesita la base y falla por su cuenta).
- A partir de ahora **reiniciar el servicio ya no borra los límites**. Para pruebas y soporte existe `npm run limits:reset` (ver abajo).

### Probar las alertas en producción

La *Shell* de Render depende del plan (en el gratuito normalmente no está; compruébalo en tu panel), así que no cuentes con correr `npm run alerts:test` allí. Alternativas, de la más simple a la más completa:

1. **Probar el proveedor y los destinatarios desde tu computadora**, con las mismas `BREVO_*` y `ERROR_ALERT_EMAILS` de producción en tu `backend/.env`: `npm run alerts:test` debe imprimir `OK -> tu@correo.com (brevo)` y llegar «[MedCita · Consultorio de ejemplo] Error 500 en GET /api/alerts-test (src/routes/example.js:42)». Prueba la clave de Brevo y la dirección, **no** las IPs de Render.
2. **Probar que Render puede enviar correo** (las IPs): provoca un correo desde producción, por ejemplo «Forgot password» con una cuenta tuya, y mira en los *Logs* de Render: `[BREVO EMAIL] Email sent successfully` (bien) o `[BREVO EMAIL ERROR] 401` (falta autorizar las IPs de Render).
3. **Un error real en un ambiente de pruebas** (staging, o local con una base aparte): la receta paso a paso está en la guía de pruebas, sección 4.

No se recomienda provocar un 500 a propósito en producción.

### Verificar producción después de desplegar

- [ ] `GET /api/health` responde `200` y el despliegue terminó sin errores de migración.
- [ ] Iniciar sesión funciona. En el SQL Editor de Neon, `SELECT count(*) FROM "RateLimitCounter";` devuelve un número (la tabla existe; se llena solo con intentos **fallidos** y con solicitudes de registro o de recuperación).
- [ ] Los *Logs* de Render no muestran `Could not purge the rate limit counters` ni `[BREVO EMAIL ERROR]`.
- [ ] `ERROR_ALERT_EMAILS` está definida (Render → *Environment*) con las direcciones correctas y el punto 1 o 2 de arriba funcionó.
- [ ] Opcional: 6 intentos de login con una cuenta de prueba que no exista dan `429` en el sexto; reiniciar el servicio en Render y comprobar que sigue en `429`.

### Cuando llegue la primera alerta real

El correo trae la ruta, el consultorio (nombre, nombre corto e id), el dominio, el archivo y la línea del código, el tipo de error y un **id de la petición**. Para ver el mensaje completo: Render → *Logs* del servicio → busca ese id (`[request a602c1203971]`). El aviso no incluye el mensaje porque puede citar datos de pacientes. No se repite para la misma ruta y consultorio durante 15 minutos (el siguiente cuenta los que se callaron) y salen 10 como máximo por hora; si hay una tormenta de errores el resto está en los logs.

### Si alguien se bloquea por error, o tras una prueba

Los contadores se borran con `npm run limits:reset` desde `backend/`: **solo toca los contadores** y se niega a correr contra una base que no sea local, porque borrarlos en producción le daría intentos nuevos a quien adivina contraseñas. Para hacerlo a propósito en producción: `RATE_LIMIT_RESET_HOST=<host de Neon> npm run limits:reset` con la `DATABASE_URL` de Neon en el entorno. Esperar a que termine la ventana (hasta una hora) también funciona.

### Volver atrás

Revertir el código es seguro: la versión anterior vuelve a contar en memoria y la tabla `RateLimitCounter` queda sin uso. Quitar `ERROR_ALERT_EMAILS` apaga las alertas sin tocar el código.

## Despliegue de los recordatorios configurables (S9-03)

S9-03 agrega la migración `20261025100000_add_reminder_settings`, que solo **agrega columnas** (`Clinic`: `address`, `reminderEnabled`, `reminderHours`, `secondReminderHours`, `reminderWhatsapp`, `reminderEmail`, `reminderIndications`; `Appointment`: `secondReminderSentAt`), todas opcionales o con el valor que ya tenía el comportamiento: recordatorios activos, 24 horas, WhatsApp y correo. Ningún consultorio ni cita cambia y la versión anterior ignora las columnas, así que seguir con ella o volver atrás es seguro. Se probó sobre datos existentes en `backend/tests/reminderSettingsMigration.test.js`. Por la regla de los cambios de esquema, crea antes una rama de respaldo en Neon (por ejemplo `antes-de-s9-03`).

**Nada cambia para los pacientes hasta que un administrador toque los ajustes.** Los consultorios con dirección o indicaciones llevan esos datos por correo de inmediato; por WhatsApp solo cuando la plantilla `recordatorio_cita_consultorio` esté aprobada (7.4) y definas `META_WHATSAPP_TEMPLATE_REMINDER_DETAILED`.

**Verificar producción después de desplegar:**

- [ ] `GET /api/health` responde `200`.
- [ ] En *Settings → Reminders* aparecen los valores de siempre («24 hours before», sin segundo recordatorio, WhatsApp y Email marcados) y «Messages sent this month».
- [ ] El recordatorio de la próxima hora llega como siempre (revisar el historial de mensajes de una cita).
- [ ] Opcional: poner una dirección de prueba y comprobar la vista previa; borrarla después si no se quiere.

## Despliegue de los bloqueos de agenda (S9-05)

S9-05 agrega la migración `20261024100000_add_schedule_blocks`, que solo **crea la tabla `ScheduleBlock`**: no toca ninguna fila existente y la versión anterior del código nunca la lee, así que seguir con ella o volver atrás es seguro. Se probó sobre datos existentes en `backend/tests/scheduleBlocksMigration.test.js`. Aun así, por la regla de los cambios de esquema, crea antes una rama de respaldo en Neon (por ejemplo `antes-de-s9-05`).

**Verificar producción después de desplegar:**

- [ ] `GET /api/health` responde `200`.
- [ ] En *Availability*, la sección «Time off» carga («No time off coming up»).
- [ ] Bloquear un día lejano de prueba para un médico: ese día no ofrece horarios en la nueva cita y el calendario lo marca; quitar el bloqueo lo abre otra vez.

## Alta de consultorios e invitaciones: necesitan correo (S8-02)

Desde S8-02 nadie obtiene una cuenta sin recibir un correo: el alta se confirma con un enlace y las personas que invita un admin eligen su contraseña desde otro. Para producción:

- **El proveedor de correo (Brevo) tiene que funcionar.** Sin proveedor el envío es *mock*: se anota en el log y el enlace nunca llega, así que nadie podría registrarse ni aceptar una invitación. El panel avisa a quien invita cuando el correo no salió («Invitation saved, but the email could not be delivered») y la invitación se puede reenviar.
- **`FRONTEND_URL` debe empezar por el origen real de la aplicación**: los enlaces se arman con el primer origen de la lista (`https://…/verify-email?token=…`, `/accept-invitation?token=…`).
- **No definir `EXPOSE_ACCOUNT_LINKS`.** Es un modo solo para pruebas locales que devuelve el enlace en la respuesta; el servidor se niega a arrancar si lo encuentra con `NODE_ENV=production` o en Render.
- **Prueba de humo tras desplegar:** registrar un correo propio en `/register`, abrir el enlace del correo y comprobar que entra al consultorio nuevo; invitar a otro correo propio y aceptar la invitación.
- Las cuentas ya existentes no cambian. Una migración nueva crea las tablas `SignupRequest` e `Invitation` (no toca datos).

## Ramas: `main` es producción, `develop` es donde se integra

- **`main`** es lo que corre en producción (Render despliega de ahí). Solo recibe lo que ya se probó.
- **`develop`** es la rama de integración del Sprint 8 en adelante: cada ticket sale de `develop` y su PR apunta a `develop`.
- **Historia del 21-oct-2026.** S8-01 se fusionó a `main` por error (PR #103) y se revirtió con `3a61e01`, pero Render alcanzó a aplicar sus migraciones en Neon antes del revert: la base quedó **más adelante que el código** y guardar horarios, citas o pacientes daba `500` (`P2011`, `clinicId` nulo). Se arregló llevando `develop` a `main` (PR #108), con un `git revert` del revert. **Aprendizaje:** deshacer código no deshace migraciones; por eso existe el staging de abajo.
- **Para llevar `develop` a `main`:** abrir un PR de `develop` a `main` (o de una rama `release/…`), correr antes el checklist de staging y, tras fusionar, llevar `main` de vuelta a `develop` si hubo correcciones directas en `main`. Después seguir «Primer despliegue con consultorios» si hay migraciones nuevas.

## Ambiente de pruebas (staging) (S8-06)

Un segundo despliegue de MedCita, con su propia base y su propia URL, donde se prueba **todo lo que cambia el esquema antes de llevarlo a producción**. El 20-oct y el 21-oct (la migración de consultorios que quedó aplicada con el código revertido) se habrían visto aquí. La regla desde ahora:

> Un PR que agrega una migración se despliega primero en staging, se prueba ahí con el checklist de abajo y **solo entonces** se lleva a `main`.

Se crea una sola vez, en los paneles de Render y Neon (el repositorio no lo puede hacer por ti). Cuesta lo mismo que hoy: los planes gratuitos.

### 1. Base de datos: una rama de Neon que **no** es la de producción

1. Averigua cuál rama usa producción: en Render → `medcita-backend` → *Environment* → `DATABASE_URL`, el host (`ep-…`) corresponde a una rama en Neon → *Branches*. Anótala: esa es **producción** y no se toca. (En este proyecto la rama principal se llama `develop`; el nombre no significa nada, lo que importa es el host.)
2. Neon → *Branches* → **Create branch**, de nombre `staging`, **a partir de la de producción**. Así tiene el mismo esquema y el mismo historial de migraciones (`_prisma_migrations`), que es lo que hay que probar: aplicar la migración nueva sobre un esquema como el real.
3. En la rama nueva, copia la cadena de conexión **directa** (sin `-pooler`) y úsala solo para staging.
4. **Quita los datos reales de staging de inmediato.** Una rama copia también a los pacientes reales y no deben vivir en un ambiente de pruebas (LOPDP). Desde `backend/`:

   ```bash
   export DATABASE_URL='postgresql://…staging…'
   SEED_REMOTE_HOST=<el host de esa URL> npx prisma db seed
   ```

   El seed **borra todo** y carga los consultorios y las cuentas de demostración. Por seguridad se niega a correr contra una base que no sea local salvo que escribas el host en `SEED_REMOTE_HOST`: **compara ese host con el de producción antes de ejecutarlo**. Si alguna vez dudas, no lo corras.
5. Si necesitas probar con datos parecidos a los reales, usa *Data masking* de Neon sobre la rama de staging en lugar de dejar los datos como están.

### 2. Backend: un Web Service nuevo desde `develop`

Render → **+ New → Web Service**, mismo repositorio, con estos valores distintos a los de producción:

| Campo | Valor |
|---|---|
| **Name** | `medcita-backend-staging` |
| **Branch** | `develop` |
| **Root Directory / Build / Start / Health Check Path** | iguales a los de producción (sección 3) |
| `DATABASE_URL` | la de la rama `staging` (paso anterior) |
| `JWT_SECRET` | **uno nuevo**, distinto al de producción (así una sesión de staging nunca vale en producción) |
| `FRONTEND_URL` | la URL del sitio de staging (se conoce al crear el Static Site; actualízala después) |
| `BREVO_*` | Opcional. Sin ellas el correo es *mock* y las invitaciones y altas **no llegan a nadie**: para probarlas, configura Brevo con un remitente de pruebas |
| `META_WHATSAPP_*` / `TWILIO_*` | **Déjalas vacías.** Así WhatsApp corre en modo *mock* y staging nunca escribe a un paciente real. Si algún día se prueba la plantilla de Meta, que sea solo con tu número de prueba |
| `EXPOSE_ACCOUNT_LINKS` | **No definir**: el servidor se niega a arrancar con ella en Render |
| `S3_*` | Opcional: un bucket **propio de staging** (ver «Archivos privados»), nunca el de producción |

### 3. Frontend: un Static Site nuevo desde `develop`

Render → **+ New → Static Site**: `Name` `medcita-frontend-staging`, `Branch` `develop`, `Root Directory` `frontend`, `Build Command` `npm run build`, `Publish Directory` `dist`, más la regla de *rewrite* del SPA (sección 4). Variables:

| Key | Value |
|---|---|
| `VITE_API_URL` | la URL del backend de staging |
| `VITE_APP_ENV` | `staging` |

`VITE_APP_ENV=staging` pone una etiqueta amarilla «STAGING · TEST DATA» en lo alto de cada pantalla y el prefijo `[STAGING]` en la pestaña, para que nadie confunda las dos aplicaciones. Después, vuelve al backend y pon su `FRONTEND_URL` con la URL de este sitio.

### 4. Cómo se usa (cada ticket que cambie el esquema)

1. El PR del ticket se fusiona en `develop` y Render despliega staging (el *Build Command* ejecuta `prisma migrate deploy` sobre la rama `staging`).
2. En el log del deploy de staging: la migración nueva aparece aplicada y `GET /api/health` responde `200`.
3. Recorrer el checklist: iniciar sesión, **guardar un horario, agendar una cita con un paciente nuevo**, abrir Activity Log, el detalle de una cita y Analytics, y el flujo propio del ticket. Los logs de Render no deben tener `P2011` ni `P2022`. (Lo que falló el 21-oct era justo guardar datos nuevos.)
4. Solo si todo está bien, se lleva `develop` a `main` (sección «Ramas»).
5. Cuando staging se ensucia o queda atrás del esquema, se repite el paso 4 de «Base de datos» (o se borra la rama y se crea otra desde producción).

**Qué staging no prueba:** el rendimiento con datos reales, WhatsApp de verdad y el correo si no configuraste Brevo. Y si la diferencia entre staging y producción es el *contenido* de los datos (como un teléfono repetido en la base real), la migración puede pasar aquí y fallar allá: por eso la rama se crea **desde producción** antes de limpiarla, y por eso la copia de respaldo de Neon antes de migrar producción sigue siendo obligatoria.

## Archivos privados (S8-06)

Los documentos clínicos que vendrán (consentimientos firmados, recetas, imágenes) no pueden vivir en el disco de Render, que se borra en cada despliegue. Van a un **bucket privado compatible con S3** y la aplicación entrega **URLs firmadas de pocos minutos**. Hoy ningún flujo sube archivos: este ticket deja el almacenamiento listo, probado y verificable.

### Cómo se protege

- **El bucket es privado.** Nadie lee ni escribe directo: la lectura sin firma debe dar `401` o `403`. `npm run storage:check` lo comprueba de verdad (ver abajo).
- **URLs firmadas de 5 minutos** (`S3_URL_TTL_SECONDS`; el tope es de 15 minutos aunque se configure más).
- **Todo archivo cuelga de `clinics/<id del consultorio>/…`.** El código solo firma llaves del consultorio de quien pregunta, así que no se puede firmar la URL de un archivo de otro consultorio (`backend/src/services/fileStorage.js`, probado en `backend/tests/fileStorage.test.js`).
- Un bucket **por ambiente**: producción y staging nunca comparten bucket ni llaves.

### Crear el bucket (una sola vez, en el proveedor)

Sirve cualquier servicio con API S3. Cloudflare R2, AWS S3 y Backblaze B2 funcionan igual; lo que cambia es el endpoint y la región. Los pasos comunes:

1. Crear el bucket (por ejemplo `medcita-files` y `medcita-files-staging`) en una región razonable. Anota que los archivos de salud saldrán de Ecuador: es parte de lo que debe revisar un abogado (S8-07).
2. **Dejarlo privado**: sin acceso público ni dominio público. En AWS, activar *Block all public access*; en R2, no habilitar el acceso público (`r2.dev`) ni dominios personalizados.
3. Crear una llave de acceso **solo para este bucket** con permiso de leer, escribir y borrar objetos (en AWS: `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` sobre `arn:aws:s3:::<bucket>/*`; nada más).
4. Si algún día el navegador sube directo con la URL firmada, hará falta una regla CORS que permita `PUT` y `GET` desde el origen del frontend. Aún no hace falta.

### Variables (Render → backend → Environment, y `backend/.env` en local)

| Variable | Valor |
|---|---|
| `S3_BUCKET` | nombre del bucket |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | la llave del paso 3 (el secreto solo se muestra una vez) |
| `S3_REGION` | AWS: la región real (`us-east-1`…); Cloudflare R2: `auto` |
| `S3_ENDPOINT` | AWS: no definir; R2: `https://<id de la cuenta>.r2.cloudflarestorage.com`; Backblaze: el endpoint S3 del bucket |
| `S3_FORCE_PATH_STYLE` | `true` solo para MinIO y proveedores que lo piden |
| `S3_URL_TTL_SECONDS` | opcional, 300 por defecto, máximo 900 |

### Verificar

Con las variables en `backend/.env` (o exportadas), desde `backend/`:

```bash
npm run storage:check
# OK   upload with a signed URL
# OK   read it back with a signed URL
# OK   the same address without the signature is refused
# OK   remove the test file
```

Sube un archivo de prueba con una URL firmada, lo lee con otra, comprueba que **la misma dirección sin firma es rechazada** (si alguna vez ves `FAIL … without the signature`, el bucket es público: corrígelo antes de guardar nada) y lo borra. No deja nada. Devuelve código distinto de cero si algo falla, así que sirve como paso de una lista de verificación.

## Textos legales en el frontend (S8-07)

`/privacy` y `/terms` se compilan dentro del frontend a partir de `docs/legal/politica-de-privacidad.md` y `terminos-de-uso.md` (una carpeta **fuera** de `frontend/`). Render clona todo el repositorio, así que el *build* los encuentra, pero con *Root Directory* `frontend` un cambio que solo toque `docs/legal/` puede no disparar un despliegue: en el Static Site, *Settings → Build Filters*, agrega `docs/legal/**`, o lanza un *Manual Deploy* después de cambiar los textos. Cuando un abogado apruebe los textos, cambia `LEGAL_REVIEWED` a `true` en `frontend/src/config/legal.js` para quitar el aviso de borrador.

## Notas para futuros redeploys

- Cada deploy del backend ejecuta `prisma migrate deploy`. Para cambiar el esquema a partir de ahora (migraciones, qué revisar, cómo se prueba) ver `docs/TECHNICAL.md`, sección 7. Nunca usar `db push` contra Neon: no deja historial.
- Si se cambia de rama (ej. al mergear un PR a `main`), actualizar el campo **"Branch"** en la configuración de ambos servicios de Render (backend y frontend) — no se actualiza solo.
- `backend/.env.production.local` nunca se commitea (está en `.gitignore`) — si se pierde, hay que volver a copiar la connection string desde el dashboard de Neon.
- Neon "scales to zero" el compute cuando no hay actividad — la primera consulta tras un rato inactivo puede tardar un poco más (cold start de la base), separado del sleep del backend en Render.
