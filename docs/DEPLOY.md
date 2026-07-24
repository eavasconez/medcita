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
3. Sincronizar el esquema y cargar los datos de demo contra Neon:
   ```bash
   cd backend
   set -a; source .env.production.local; set +a
   npx prisma db push
   npx prisma db seed
   ```
   Esto crea 1 admin + 3 médicos piloto + 8 pacientes + 9 citas de ejemplo (ver `prisma/seed.js`). **Correr `db seed` de nuevo borra y recrea todo** — no ejecutarlo contra datos reales de producción una vez haya pacientes reales.
4. Verificar (opcional): en el dashboard de Neon, menú lateral → **"Tables"** (explorador visual) o **"SQL Editor"** (`SELECT * FROM "Doctor";`).

## 3. Backend (Render Web Service)

1. Dashboard de Render → **"+ New"** → **"Web Service"** → conectar el repo `medcita`.
2. Configuración:
   - **Name**: `medcita-backend`
   - **Branch**: la rama que se quiera desplegar (idealmente `main` una vez todos los PRs estén mergeados)
   - **Root Directory**: `backend`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node src/server.js`
   - **Instance Type**: Free
3. **Environment Variables** (antes de crear el servicio):

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | La misma connection string de Neon usada en el paso 2 |
   | `JWT_SECRET` | Generar una nueva y real: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `FRONTEND_URL` | La URL del Static Site de Render (paso 4) — mientras no exista, usar un placeholder temporal y **actualizarlo después** (ver nota abajo) |
   | `META_WHATSAPP_*` / `TWILIO_*` / `BREVO_*` / `SENDGRID_*` | Opcionales — sin ellas, WhatsApp/Email corren en modo mock (igual que en local) |

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

## Notas para futuros redeploys

- Si se cambia de rama (ej. al mergear un PR a `main`), actualizar el campo **"Branch"** en la configuración de ambos servicios de Render (backend y frontend) — no se actualiza solo.
- `backend/.env.production.local` nunca se commitea (está en `.gitignore`) — si se pierde, hay que volver a copiar la connection string desde el dashboard de Neon.
- Neon "scales to zero" el compute cuando no hay actividad — la primera consulta tras un rato inactivo puede tardar un poco más (cold start de la base), separado del sleep del backend en Render.
