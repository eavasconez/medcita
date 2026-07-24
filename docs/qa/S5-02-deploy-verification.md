# S5-01 / S5-02 — Verificación de deploy en producción (Render + Neon)

> Reporte de lo hecho y verificado para levantar MedCita en un entorno público, real, usando solo servicios/planes gratuitos (sin tarjeta de crédito). Cubre #55 (infraestructura) y #56 (deploy de la aplicación). Fecha de ejecución: 2026-07-23.

## Resumen

| Componente | Servicio | URL | Estado |
|---|---|---|---|
| Backend | Render (Web Service, free) | `https://medcita-backend.onrender.com` | ✅ Live, verificado |
| Frontend | Render (Static Site, free) | `https://medcita-frontend.onrender.com` | ✅ Live, verificado |
| Base de datos | Neon (Postgres, free) | `ep-floral-leaf-ay0jjrvn.c-5.us-east-2.aws.neon.tech` | ✅ Esquema + seed cargados |
| Monitoreo/keep-alive | UptimeRobot (free) | monitor HTTP cada 5 min sobre `/api/health` | ✅ Configurado |

Ninguno de los 3 servicios pidió tarjeta de crédito (todos vía login con GitHub/registro simple).

## 1. Cuentas e infraestructura (#55)

- **Render**: cuenta creada con login de GitHub.
- **Neon**: cuenta creada con login de GitHub. Proyecto `medcita` en la región AWS US East 2 (Ohio). Plan free: 0.5 GB de almacenamiento, autoscaling hasta 2 CU, "scales to zero when inactive" (el compute se suspende solo, se reactiva rápido con la siguiente query), 10 branches por proyecto.
- **UptimeRobot**: cuenta creada, sin tarjeta.

### Esquema y datos de demo en Neon
Corridos desde una máquina local, apuntando `DATABASE_URL` a la connection string de Neon (nunca commiteada — se usó un archivo local `backend/.env.production.local`, cubierto por `.gitignore`):

```bash
npx prisma db push   # sincroniza el schema de Prisma con Neon
npx prisma db seed   # carga médicos, pacientes y citas de ejemplo
```

**Nota de proceso**: el seed de 3 médicos piloto (Dr. Santiago Pérez, Dra. Camila Torres, Dr. Andrés Mendoza) vive en la rama `S4-06-technical-docs-demo-data` (PR #53, aún no mergeada a `main`). Para no mezclar esa rama con el trabajo de deploy, se corrió el seed desde una rama local temporal (`temp-seed-3-doctors`, creada solo para ese propósito y borrada después, nunca pusheada) en vez de mergear o trabajar directamente sobre esa rama.

Verificado directamente contra Neon (consulta Prisma real, no el log del seed):

```
Doctores: [
  { "email": "admin@medcita.ec", "name": "Administrador MedCita", "role": "admin" },
  { "email": "demo@medcita.ec", "name": "Dr. Santiago Pérez", "role": "doctor", "specialty": "Medicina General" },
  { "email": "dra.torres@medcita.ec", "name": "Dra. Camila Torres", "role": "doctor", "specialty": "Pediatría" },
  { "email": "dr.mendoza@medcita.ec", "name": "Dr. Andrés Mendoza", "role": "doctor", "specialty": "Medicina Familiar" }
]
Total pacientes: 8
Total citas: 9
```

## 2. Deploy de la aplicación (#56)

### Backend — Render Web Service
- **Name**: `medcita-backend` · **Root**: `backend` · **Build**: `npm install` · **Start**: `node src/server.js` · **Plan**: Free
- **Rama desplegada**: en el momento de esta verificación, `S5-02-health-check-endpoint` (basada en `S4-07-pre-deploy-checklist`, PR #54 — necesaria para que `VITE_API_URL` funcione en el frontend; ver nota al final).
- **Variables de entorno**: `DATABASE_URL` (Neon), `JWT_SECRET` (generado con `crypto.randomBytes(32)`, nunca compartido en texto plano en este chat), `FRONTEND_URL` (ver hallazgo #2 abajo). Credenciales de WhatsApp/Email no configuradas todavía — el sistema cae a modo mock en producción, igual que en local sin credenciales.

Verificado con `curl` directo contra la URL pública:
```
POST https://medcita-backend.onrender.com/api/auth/login → 200, token válido
GET  https://medcita-backend.onrender.com/api/health → 200 {"status":"ok"}
```

### Frontend — Render Static Site
- **Name**: `medcita-frontend` · **Root**: `frontend` · **Build**: `npm run build` · **Publish**: `dist` · **Plan**: Free
- **Variable de entorno**: `VITE_API_URL=https://medcita-backend.onrender.com` (consumida por `frontend/src/config/api.js`, agregado en el PR #54).

### Hallazgo #1 (bug real, corregido) — 404 en navegación directa a rutas del SPA
Al entrar directamente a `https://medcita-frontend.onrender.com/login` (o cualquier ruta que no sea `/`), Render devolvía `404 Not Found`. Causa: es un Single Page Application con React Router — solo existe un `index.html` real; las rutas como `/login` o `/patients` las interpreta React Router **dentro del navegador**, no son archivos reales en el servidor. Al pedir esa ruta directamente, el hosting estático buscaba un archivo con ese nombre y no lo encontraba.

**Corregido**: se agregó una regla de rewrite en Render (Static Site → Redirects/Rewrites): `Source: /*` → `Destination: /index.html` → `Action: Rewrite`. Verificado que la navegación directa a `/patients` ya no muestra "Not Found" tras el cambio.

### Hallazgo #2 (bug real, corregido) — CORS bloqueando el frontend real
`FRONTEND_URL` en el backend quedó inicialmente en `http://localhost:5173` (placeholder usado mientras no existía la URL real del frontend). Sin actualizarla, el `cors({ origin: allowedOrigins })` de `server.js` habría rechazado todas las peticiones desde el dominio real del frontend.

**Corregido**: actualizada a `https://medcita-frontend.onrender.com` en las variables de entorno del backend (Render redespliega automáticamente al guardar). Verificado que las peticiones desde el frontend real ya no son bloqueadas (ver verificación end-to-end abajo).

### Hallazgo #3 — sin endpoint de health check (no bloqueante, corregido igual)
No existía ninguna ruta pública que devolviera `200` de forma confiable (todas requieren token, o no existen en la raíz) — un monitor de uptime pegándole a cualquier ruta existente habría visto 401/404 y reportado falsas caídas. Se agregó `GET /api/health` (sin autenticación, sin datos sensibles) en PR #59, y se configuró el monitor de UptimeRobot sobre esa ruta específica.

## 3. Verificación end-to-end (Playwright, contra las URLs reales de producción)

| Prueba | Resultado |
|---|---|
| Login como admin (`admin@medcita.ec`) → redirección a `/dashboard` | ✅ Ver captura 1 |
| Peticiones de red van a `https://medcita-backend.onrender.com` (no `localhost`) | ✅ Confirmado (`login`, `admin/medicos`, `appointments`) |
| Errores de consola / requests fallidos | ✅ Cero en ambos casos |
| Login como médico piloto (`demo@medcita.ec` — Dr. Santiago Pérez) → ve su propio calendario | ✅ Ver captura 2 (4 citas, 4 pacientes, 50% efectividad — coincide exactamente con lo sembrado para ese médico) |
| Navegación directa a `/patients` (no solo `/`) tras el fix del rewrite | ✅ Ya no muestra "Not Found" |
| `GET /api/health` | ✅ `200 {"status":"ok"}` |

**Capturas**:
- [Dashboard admin en producción](screenshots/s5-02/01-admin-dashboard-prod.png)
- [Dashboard de Dr. Santiago Pérez en producción](screenshots/s5-02/02-doctor-dashboard-prod.png)

## 4. UptimeRobot

Monitor HTTP configurado apuntando a `https://medcita-backend.onrender.com/api/health`, intervalo de 5 minutos. Objetivo: evitar que el backend gratuito de Render (que se duerme tras 15 min sin tráfico, con ~50s de cold-start al despertar) se quede dormido, ya que eso rompería silenciosamente el cron de recordatorios de 24h si coincide con la hora en que debería dispararse.

**Tradeoff conocido, no resuelto por completo**: el ping cada 5 min reduce mucho la ventana de sueño pero no la elimina al 100% (un ciclo de ping fallido, o un reinicio del lado de Render, podrían dejarlo dormir brevemente). Es la mitigación estándar y gratuita para este problema — una solución 100% garantizada requeriría un plan pago de Render.

## 5. Pendientes / notas para los siguientes tickets

- **Rama de deploy actual**: Render está desplegando desde `S5-02-health-check-endpoint` (no `main`), porque los fixes necesarios (`VITE_API_URL`, health check) todavía están en PRs abiertos (#54, #59). Cuando se mergeen a `main`, hay que actualizar el campo "Branch" de ambos servicios en Render para que apunten a `main` en vez de a esta rama.
- **Credenciales de WhatsApp/Email**: no configuradas en Render todavía — las notificaciones corren en modo mock en producción. Si S5-03 (validación con los 3 médicos piloto) necesita confirmar envíos reales, hay que agregar `BREVO_API_KEY`/`META_WHATSAPP_TOKEN`/etc. a las variables de entorno del backend en Render antes de esa validación.
- **PR #53 (S4-06)**: aunque no se mergeó, su seed de 3 médicos piloto ya está corrido manualmente contra Neon (ver sección 1) — si el PR se mergea más adelante con cambios adicionales al seed, habría que volver a correrlo (recordando que `prisma db seed` borra y recrea todo).
