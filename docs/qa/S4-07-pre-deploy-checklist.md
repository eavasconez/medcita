# S4-07 — Checklist pre-deploy

> Revisión de variables de entorno, dependencias, scripts de build y configuración de producción, hecha contra el código real del repo (no una lista genérica). Fecha de ejecución: 2026-07-23. Nota: al momento de esta revisión, PR #52 (S4-05) y PR #53 (S4-06) todavía estaban abiertos (sin mergear a `main`) — la revisión asume que ambos se mergean tal cual están.

## Resumen

| Área | Resultado |
|---|---|
| Variables de entorno | ✅ Documentadas y con fail-fast en las críticas |
| Dependencias | ⚠️ 2 bugs reales encontrados y corregidos en este ticket; deuda técnica adicional eliminada |
| Scripts de build | ✅ Frontend y backend verificados; falta suite de tests (ya trackeado, fuera de alcance) |
| Configuración de producción | ⚠️ Bloqueante crítico encontrado y corregido (URL de API hardcodeada); quedan puntos recomendados no bloqueantes |

## 1. Variables de entorno

| Variable | Dónde | Estado |
|---|---|---|
| `JWT_SECRET` | backend | ✅ El servidor rechaza arrancar (`process.exit(1)`) si falta, es el valor de ejemplo, o tiene menos de 32 caracteres (`server.js`) |
| `FRONTEND_URL` | backend | ✅ Restringe CORS a orígenes conocidos en vez de aceptar cualquiera (`server.js`) |
| `DATABASE_URL` | backend | ✅ Documentada en `.env.example`, usada por Prisma |
| `META_WHATSAPP_*` / `TWILIO_*` | backend | ✅ Opcionales, con fallback a modo mock si faltan (documentado en `docs/TECHNICAL.md`) |
| `BREVO_*` / `SENDGRID_*` | backend | ✅ Opcionales, con fallback a modo mock si faltan |
| `VITE_API_URL` | frontend | ✅ **Nueva** (agregada en este ticket) — antes no existía ninguna forma de configurar a qué backend apunta el frontend en producción (ver hallazgo #2) |

`backend/.env.example` y el nuevo `frontend/.env.example` están al día con todas las variables realmente leídas por el código.

## 2. Dependencias

### Hallazgo #1 (bug real, corregido) — `@prisma/client` en `devDependencies`
`backend/package.json` tenía `@prisma/client` en `devDependencies`, pero `src/config/prisma.js` lo requiere en runtime (todas las rutas dependen de él). Un deploy que instale con `npm ci --omit=dev` (patrón común en Docker/CI de producción) se rompería con `Cannot find module '@prisma/client'`. **Corregido**: movido a `dependencies`. `prisma` (el CLI) se queda correctamente en `devDependencies` — no lo necesita el servidor en runtime, solo `db push`/`db seed` en tiempo de desarrollo/deploy.

### Hallazgo #2 (bug real, corregido) — `lodash` como dependencia fantasma en el frontend
`frontend/src/pages/Dashboard.jsx` hace `import { debounce } from 'lodash'`, pero `lodash` **no estaba declarado** en `frontend/package.json` — solo funcionaba porque `react-big-calendar` lo trae como dependencia transitiva y npm lo hoistea. Esto es frágil: si `react-big-calendar` alguna vez deja de depender de `lodash`, o se usa un gestor de paquetes más estricto (pnpm, npm con `--strict-peer-deps`), el import se rompe en producción sin aviso previo. **Corregido**: agregado explícitamente a `dependencies`.

### Hallazgo #3 (deuda técnica, eliminada) — código muerto de arquitecturas anteriores
Verificado con `grep` que ningún archivo activo los importa:
- `backend/src/models/index.js` — modelos Sequelize; `sequelize` ni siquiera está instalado como dependencia (habría roto en el primer `require`).
- `backend/src/config/db.js` — configuración de LowDB (arquitectura pre-Prisma).
- `backend/src/utils/sms.js` — envío de WhatsApp duplicado, reemplazado por `notificationService.js`.
- `backend/database.json` — archivo de datos residual de LowDB.

**Eliminados los 4 archivos**, junto con las dependencias que ya no usaba nadie: `lowdb`, `uuid` (backend). `lodash` en backend también estaba sin uso real y se eliminó de sus dependencias (el que se necesita es el de frontend, ver hallazgo #2).

### Pendiente (no bloqueante)
- 0% cobertura de tests automatizados (Jest/Vitest) — ya trackeado en `docs/ESTADO_PROYECTO.md`, fuera de alcance de este ticket.
- `npm audit` reporta vulnerabilidades preexistentes en transitivas de ambos proyectos (no introducidas por este ticket) — recomendar revisión aparte antes de producción.

## 3. Scripts de build

| Comando | Resultado |
|---|---|
| `cd backend && npm start` / `npm run dev` | ✅ Arranca correctamente (`node src/server.js` / `nodemon`) |
| `cd frontend && npm run build` | ✅ Corre limpio, sin errores, tras todos los cambios de este ticket |
| `cd frontend && npm run dev` / `npm run preview` | ✅ Verificado en vivo con Playwright (login + navegación por las 5 páginas principales, sin errores de consola ni requests fallidos) |
| `cd frontend && npm run lint` | ⚠️ La config de ESLint del repo (`eslint.config.js`) está rota (`TypeError: Cannot read properties of undefined ('recommended')`), preexistente — no se pudo correr lint real en ningún punto de esta sesión. Recomendado arreglarla antes de depender de CI con lint. |

## 4. Configuración de producción

### Hallazgo #4 (bloqueante crítico, corregido) — URL del backend hardcodeada en el frontend
`http://localhost:5000` estaba escrito literalmente en **26 lugares** de 8 archivos (`App.jsx`, `AdminDoctors.jsx`, `Availability.jsx`, `Dashboard.jsx`, `Patients.jsx`, `Register.jsx`, `Reports.jsx`, `Settings.jsx`). Esto significa que el frontend **no podía apuntar a ningún backend real** — cualquier deploy a un dominio de producción habría fallado por completo (todas las llamadas a la API habrían ido a `localhost:5000` del navegador del usuario final, no al servidor real).

**Corregido**: se centralizó en `frontend/src/config/api.js` (`API_BASE_URL`, leído de `import.meta.env.VITE_API_URL`, con `http://localhost:5000` como default solo para desarrollo local) y se actualizaron los 26 call-sites para usarlo. Verificado con Playwright que las 5 páginas principales (Dashboard, Patients, Availability, Manage Doctors, Reports, Settings) siguen funcionando sin errores tras el cambio, y que `vite build` sigue limpio.

### Ya resuelto en tickets anteriores (verificado, no repetido aquí)
- CORS restringido a `FRONTEND_URL` (S4-04).
- `JWT_SECRET` con fail-fast (S4-04).
- `helmet()` activo (preexistente).
- Ningún endpoint expone `err.message`/stack traces crudos al cliente — verificado con `grep` en las 5 rutas (`auth`, `appointments`, `patients`, `availability`, `admin`): todas devuelven mensajes genéricos en el `catch` y loguean el error real solo en servidor (S4-03/S4-04).

### Pendiente (recomendado, no bloqueante para este ticket)
- **Sin rate limiting** en `/api/auth/login` — un endpoint de login sin límite de intentos es un vector de fuerza bruta. Recomendado agregar `express-rate-limit` antes de exponer el login a internet.
- **`prisma db push` en vez de migraciones versionadas** (`prisma migrate deploy`) — funciona para desarrollo/demo, pero una base de datos de producción normalmente quiere migraciones versionadas y reversibles. Es una decisión de proceso, no un bug — requiere que el equipo decida el flujo antes del primer deploy real.
- **Sin `Dockerfile`/configuración de PM2** para backend o frontend — está fuera del alcance de este ticket (es explícitamente el objetivo de Sprint 5 - Deploy, según `docs/ESTADO_PROYECTO.md`), no un punto de este checklist de código.
