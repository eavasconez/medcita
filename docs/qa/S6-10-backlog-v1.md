# S6-10 — Backlog priorizado para versión 1.0

> Compilado a partir de todo lo encontrado en las auditorías de Sprint 4 y el deploy de Sprint 5 — no depende de los resultados de las demos con médicos reales (S6-04 a S6-08), aunque esa validación seguramente agregue puntos nuevos a este backlog. Cada punto está verificado contra el código actual, no es una lista genérica. Fecha: 2026-07-24.

## Cómo leer este documento

- **Alta**: afecta directamente la confiabilidad del producto o bloquea un lanzamiento real más allá del piloto.
- **Media**: mejora real de calidad/consistencia, no bloquea el piloto actual.
- **Baja**: limpieza/deuda técnica, sin impacto directo en el usuario.

## Alta prioridad

- [ ] **Sin framework de testing automatizado** (Jest/Vitest) — 0% cobertura en todo el proyecto. Cualquier regresión futura depende 100% de pruebas manuales.
- [ ] **Inconsistencia de estados de cita rompe los recordatorios**: `reminderTask.js` solo busca citas con `status: 'scheduled'` (`backend/src/tasks/reminderTask.js:27`) — las citas en `pending_approval` (el estado por defecto al crearlas, ver `appointments.js:139`) **nunca reciben el recordatorio de 24h** a menos que alguien las confirme manualmente antes. Esto es fácil de no notar porque no da error, simplemente no envía.
- [ ] **Sin rate limiting en `/api/auth/login`** — un endpoint de login sin límite de intentos es un vector de fuerza bruta abierto. (Ya documentado en `docs/qa/S4-07-pre-deploy-checklist.md`.)
- [ ] **Sin flujo de recuperación de contraseña** (`forgot password`) — `auth.js` solo tiene `login`/`register`/`profile`. Si un médico real olvida su contraseña, no hay forma de recuperarla sin intervención manual directa en la base de datos.
- [ ] **`prisma db push` en vez de migraciones versionadas** (`prisma migrate deploy`) — funciona para el piloto, pero una base de datos con pacientes/citas reales necesita migraciones reversibles antes de crecer más. (Ya documentado en `docs/qa/S4-07-pre-deploy-checklist.md`.)

## Media prioridad

- [ ] **Localización a inglés incompleta**: la UI está en inglés, pero las plantillas de WhatsApp/Email siguen en español (`emailService.js` — "Hola", no "Hello") y el endpoint de administración sigue en español (`/api/admin/medicos`, no `/api/admin/doctors`). Definir de una vez si el producto es bilingüe o monolingüe antes de que crezca más el inventario de strings.
- [ ] **Sin `DELETE /api/patients/:id`** — no hay forma de eliminar un paciente creado por error desde la API (solo editar).
- [ ] **Lista de citas sin paginar**: `GET /api/appointments` devuelve todas las citas del médico sin límite — funciona bien con pocos pacientes/citas (como en el piloto), pero un consultorio activo por meses puede acumular cientos. `patients.js` ya se paginó en S4-05; `appointments.js` quedó pendiente.
- [ ] **Bundle de frontend sin code-splitting más allá de por-página**: tras el lazy loading de S4-05, páginas como Dashboard/Reports siguen generando chunks grandes (~300-380 KB) por traer librerías pesadas completas (`react-big-calendar`, `recharts`). Se podría explorar `manualChunks` para separar esas librerías del código propio.
- [ ] **Dependencia de un tier gratuito con sleep** (Render free): válido para el piloto, pero antes de un lanzamiento con médicos pagando, evaluar un plan pago de Render (o equivalente) que no dependa de UptimeRobot como parche.
- [ ] **Sin dominio propio**: la app corre en subdominios `*.onrender.com` — antes de un lanzamiento comercial, registrar un dominio real (ahora sí justificado por ingresos reales, a diferencia de la fase de piloto gratuito).

## Baja prioridad / limpieza

- [ ] **Scripts ad-hoc de datos de prueba siguen en el repo**: `backend/fill-week.js`, `backend/fill-today.js`, `backend/appointment-test.js` — con UUIDs hardcodeados, no son una suite de pruebas real. Reemplazar por tests automatizados (ver ítem de Alta prioridad) y eliminar.
- [ ] **`eslint.config.js` roto**: `npm run lint` en el frontend falla con `TypeError: Cannot read properties of undefined ('recommended')` — no se pudo correr lint real en ningún punto de Sprint 4/5. Bloquea tener un chequeo de estilo automatizado en CI a futuro.
- [ ] **Sin auditoría de acciones de admin/secretaria**: no queda registro de qué secretaria/admin modificó qué cita/paciente de qué médico — relevante si se maneja más de un médico por cuenta de secretaria.

## Ya resuelto (referencia — no repetir en v1.0)

Para que quede claro qué NO hay que volver a evaluar: URL de API hardcodeada, CORS abierto, `JWT_SECRET` de ejemplo, errores crudos expuestos al cliente, código muerto de LowDB/Sequelize, dependencias fantasma/mal clasificadas, y la ausencia total de deploy — todo esto se resolvió en Sprint 4 y 5 (ver PRs de S4-03 a S4-07 y S5-01 a S5-03).
