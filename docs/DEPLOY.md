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

# 1. Solo lectura: comprobar que Neon es idéntica al esquema actual.
#    Debe responder "-- This is an empty migration." (código de salida 0)
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script --exit-code

# 2. Registrar la baseline como ya aplicada
npx prisma migrate resolve --applied 20261019202135_baseline

# 3. Verificar: debe decir "Database schema is up to date!"
npx prisma migrate status
```

Si el paso 1 imprime SQL (código de salida 2), a Neon le falta algo de un PR anterior (por ejemplo la columna `reminderSentAt` de S7-01 o la tabla `PasswordResetToken` de S7-03). Si el SQL solo agrega cosas (`CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE … ADD …`), corre `npx prisma db push` y repite el paso 1. Si aparece algún `DROP`, **detente y revísalo antes** de seguir: `db push` pediría `--accept-data-loss`.

Solo cuando el paso 3 esté bien, cambiar el **Build Command** del servicio en Render (sección 3). Hacerlo antes haría fallar el build con `P3005` (la versión anterior seguiría sirviendo, no se pierde nada).

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

   `migrate deploy` aplica en cada deploy las migraciones pendientes contra `DATABASE_URL` (Neon) y no hace nada si no hay ninguna. Si una migración falla, el build falla y Render sigue sirviendo la versión anterior. Para un servicio que **ya existe**, cambiar el Build Command en *Settings → Build & Deploy*, pero solo después de registrar el historial en Neon (sección 2). El CLI `prisma` está en `dependencies` (no en `devDependencies`) para que este comando lo encuentre aunque el build omita las dependencias de desarrollo.
3. **Environment Variables** (antes de crear el servicio):

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | La misma connection string de Neon usada en el paso 2 |
   | `JWT_SECRET` | Generar una nueva y real: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `FRONTEND_URL` | La URL del Static Site de Render (paso 4) — mientras no exista, usar un placeholder temporal y **actualizarlo después** (ver nota abajo) |
   | `TRUST_PROXY` | Opcional. Nº de proxies delante de la app para los límites de intentos por IP; en Render vale `2` por defecto (no hace falta definirla). Ver la verificación abajo |
   | `META_WHATSAPP_*` / `TWILIO_*` / `BREVO_*` / `SENDGRID_*` | Opcionales — sin ellas, WhatsApp/Email corren en modo mock (igual que en local). Para WhatsApp con Meta (plantillas, número de prueba gratuito) ver la sección 7 |

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

## 7. WhatsApp con Meta Cloud API (plantillas)

Hasta ahora producción enviaba WhatsApp con el **sandbox de Twilio**, que obliga a cada destinatario a «unirse» a mano antes de recibir nada. Con la API de Meta no hace falta: el **número de prueba es gratuito** y se pueden agregar hasta 5 destinatarios desde el panel de Meta, sin escribirle nunca al número.

> **Por qué plantillas.** Meta solo deja que un negocio abra una conversación con una **plantilla aprobada**. El texto libre únicamente se entrega dentro de las 24 h posteriores a que el paciente escribió. La confirmación de cita y el recordatorio los inicia MedCita, así que desde S7-06 se envían como plantillas (`backend/src/services/whatsappTemplates.js`). Sin credenciales de Meta nada cambia: Twilio y el modo mock envían el mismo texto como mensaje normal.

> Meta cambia los nombres de los menús con frecuencia. Si algo no está donde se indica, búscalo por su nombre en el buscador del panel.

### 7.1 Crear la app y el número de prueba (una sola vez)

1. Entra a [developers.facebook.com](https://developers.facebook.com) con la cuenta de Facebook que administrará esto → **My Apps → Create App** → tipo **Business** → asocia (o crea) un *business portfolio*.
2. En el panel de la app, agrega el producto **WhatsApp**. Meta crea una cuenta de WhatsApp Business de prueba con un **número de prueba**.
3. En **WhatsApp → API Setup** anota dos datos:
   - **Phone number ID** (un número largo; **no** es el teléfono): va en `META_WHATSAPP_PHONE_NUMBER_ID`.
   - **WhatsApp Business Account ID**: lo pedirá Meta al crear plantillas.

### 7.2 Agregar a quienes recibirán los mensajes de prueba (máx. 5)

**WhatsApp → API Setup →** campo **To →** **Manage phone number list →** agrega cada número con su código de país (por ejemplo `+593…`). Meta manda un código por WhatsApp a ese número para confirmarlo. Con el número de prueba, **un número que no esté en esta lista no recibe nada** (el error es el 131030).

### 7.3 Token permanente

El token que muestra *API Setup* es temporal y **vence pronto**: el panel habla de 24 h, pero en las pruebas de S7-06 el generado desde *Pruébalo* dejó de funcionar en alrededor de **1 hora** (error 190, «Session has expired»). Sirve para probar de inmediato; para producción hace falta uno permanente:

1. [business.facebook.com/settings](https://business.facebook.com/settings) → **Users → System users → Add** (rol *Admin*).
2. **Add assets**: la **app** (control total) y la **cuenta de WhatsApp** (control total).
3. **Generate new token** → elige la app → marca los permisos `whatsapp_business_messaging` y `whatsapp_business_management` → vencimiento **Never**.
4. Copia el token (solo se muestra una vez) a `META_WHATSAPP_TOKEN`. Es una credencial: va en las variables de entorno de Render, nunca en el repositorio.

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

**Recordatorio de 24 h** — nombre `recordatorio_cita`:

```
Recordatorio MedCita: Hola {{1}}, tienes una cita {{2}} a las {{3}} con {{4}}. Si no puedes asistir, avísanos con anticipación para liberar el horario. ¡Gracias!
```
Ejemplos: `{{1}}` María Andrade · `{{2}}` mañana 2026-10-21 · `{{3}}` 10:00 · `{{4}}` Dr. Santiago Pérez

> Meta rechaza una plantilla con demasiadas variables para lo corto que es el texto («demasiadas variables en relación con su longitud»), y no admite una variable al principio ni al final. Por eso el día y la fecha viajan juntos en `{{2}}` y el texto cierra con una frase.

La revisión es automática y puede tardar desde minutos hasta 24 h; solo las plantillas en estado **APPROVED** se pueden enviar. Si Meta las recategoriza como *Marketing*, el texto parece promocional: edítalo para que sea solo informativo. Si registras otro nombre o idioma (por ejemplo `es_MX`), indícalo en `META_WHATSAPP_TEMPLATE_CONFIRMATION`, `META_WHATSAPP_TEMPLATE_REMINDER` o `META_WHATSAPP_TEMPLATE_LANGUAGE`.

Si algún día cambia el texto en `whatsappTemplates.js`, hay que cambiar también la plantilla en Meta (se vuelve a aprobar); mientras tanto los envíos fallan con el error 132001. Un test comprueba que este documento y el código tengan el mismo texto.

### 7.5 Variables de entorno (Render)

| Key | Value |
|---|---|
| `META_WHATSAPP_TOKEN` | El token permanente del paso 7.3 |
| `META_WHATSAPP_PHONE_NUMBER_ID` | El *Phone number ID* del paso 7.1 |
| `META_WHATSAPP_TEMPLATE_CONFIRMATION` / `META_WHATSAPP_TEMPLATE_REMINDER` | Opcionales. Nombres de las plantillas (por defecto `cita_confirmada` y `recordatorio_cita`) |
| `META_WHATSAPP_TEMPLATE_LANGUAGE` | Opcional. Idioma de las plantillas (por defecto `es`) |

Con `META_WHATSAPP_TOKEN` y `META_WHATSAPP_PHONE_NUMBER_ID` definidos, Meta tiene prioridad sobre Twilio. Para dejar de usar Twilio, borra las variables `TWILIO_*`.

### 7.6 Comprobar que funciona

Desde `backend/`, con esas variables en tu `.env` local (o exportadas), y con tu número en la lista del paso 7.2:

```bash
npm run whatsapp:test -- +593999999999             # confirmación
npm run whatsapp:test -- +593999999999 reminder    # recordatorio
```

Debe imprimir `Provider: Meta Cloud API`, el nombre de la plantilla y `OK: Meta Cloud API accepted the message`, y el mensaje llega al teléfono **sin que nadie le haya escrito antes al número**. Si falla, el error de Meta aparece en las líneas anteriores con una pista de qué corregir. Los más comunes:

| Código | Qué pasó | Qué hacer |
|---|---|---|
| 190 | El token venció o es inválido | Genera el token permanente (7.3) y actualiza `META_WHATSAPP_TOKEN` |
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

## Notas para futuros redeploys

- Cada deploy del backend ejecuta `prisma migrate deploy`. Para cambiar el esquema a partir de ahora (migraciones, qué revisar, cómo se prueba) ver `docs/TECHNICAL.md`, sección 7. Nunca usar `db push` contra Neon: no deja historial.
- Si se cambia de rama (ej. al mergear un PR a `main`), actualizar el campo **"Branch"** en la configuración de ambos servicios de Render (backend y frontend) — no se actualiza solo.
- `backend/.env.production.local` nunca se commitea (está en `.gitignore`) — si se pierde, hay que volver a copiar la connection string desde el dashboard de Neon.
- Neon "scales to zero" el compute cuando no hay actividad — la primera consulta tras un rato inactivo puede tardar un poco más (cold start de la base), separado del sleep del backend en Render.
