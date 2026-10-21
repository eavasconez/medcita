# MedCita — Resumen de avances y recomendaciones futuras

> Fecha: 2026-07-24. Este documento resume el trabajo técnico completado en los Sprints 4, 5 y 6, y propone consideraciones para escalar el sistema y agregar nuevas funcionalidades una vez validado con médicos reales.

## 1. Resumen ejecutivo

MedCita es una agenda médica digital para consultorios independientes en Ecuador, con recordatorios automáticos por WhatsApp y Email para reducir el ausentismo de pacientes. **El MVP técnico está completo y desplegado en producción**, funcionando de verdad (no un prototipo local): backend, frontend, base de datos y notificaciones reales, todo sobre infraestructura gratuita. Lo único que queda del plan original es la **validación de negocio** — demos reales con médicos candidatos — que no depende de más trabajo técnico, sino de conseguir esos candidatos.

## 2. Avances por sprint

### Sprint 4 — QA y hardening
- **Testing funcional y cross-browser** (S4-01, S4-02): happy path y casos de error verificados en navegadores principales y móvil; encontrado y corregido un bug real de datos (cédula/email vacíos rompían el registro de pacientes por una restricción única de Prisma).
- **Seguridad** (S4-04): CORS restringido a orígenes conocidos, `JWT_SECRET` con fail-fast si es débil o el valor de ejemplo, eliminados los mensajes de error crudos expuestos al cliente en todas las rutas.
- **Performance** (S4-05): lazy loading por ruta (código dividido en chunks en vez de un bundle único), paginación en el listado de pacientes, queries de Prisma optimizadas (`select` en vez de `include` completo) — medido, no estimado: ~72% menos peso inicial de carga.
- **Documentación y datos de demo** (S4-06): `docs/TECHNICAL.md` con variables de entorno y endpoints; datos de demo ampliados a 3 médicos piloto con especialidades distintas; agregado un legend por médico en el calendario combinado del admin (bug de UX que antes pasaba desapercibido con un solo médico).
- **Checklist pre-deploy** (S4-07): auditoría real que encontró y corrigió 4 problemas — la URL del backend estaba hardcodeada en 26 lugares del frontend (bloqueaba cualquier deploy real), `@prisma/client` mal clasificado como dependencia de desarrollo, una dependencia fantasma (`lodash`), y código muerto de arquitecturas anteriores (LowDB, Sequelize nunca instalado).

### Sprint 5 — Deploy y validación
- **Infraestructura sin costo** (S5-01/S5-02): Render (backend + frontend) + Neon (Postgres) + UptimeRobot, ninguno pidió tarjeta de crédito. Runbook completo documentado en `docs/DEPLOY.md` para poder repetirlo. Se encontraron y corrigieron 3 bugs reales del deploy: navegación directa a rutas del SPA devolvía 404 (faltaba una regla de rewrite), `FRONTEND_URL` bloqueaba CORS del frontend real, y no había ningún endpoint público para que el monitor de uptime funcionara.
- **Validación end-to-end en producción** (S5-03): los 3 médicos piloto probados en vivo contra la app real — login, agendar cita, y **confirmación real de que las notificaciones de WhatsApp/Email llegan de verdad** (no en modo mock).
- **Plan de onboarding y feedback** (S5-04): guion de sesión y plantilla completa del formulario de feedback (NPS, usabilidad, intención de pago), listos para usarse en cuanto haya un médico piloto real confirmado.

### Sprint 6 — Material de demo (lo que no depende de médicos reales)
- Guion de demo de 10 minutos con el paso a paso visual completo (capturas reales de cada pantalla).
- Video crudo de la app real en producción, como material base para narrar/editar.
- Deck de presentación de 9 slides (problema, solución, demo, precio, cierre).
- Backlog priorizado para v1.0, compilado contra el código real (no una lista genérica).
- Un panel con **guía de autoservicio en PDF** agregado a la pantalla de login, para que cualquier persona probando el piloto (admin, doctor o secretaria) se oriente sin depender de que el equipo se lo explique en vivo.

## 3. Estado técnico actual

| Área | Detalle |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS — https://medcita-frontend.onrender.com |
| Backend | Node.js, Express 5, Prisma ORM — https://medcita-backend.onrender.com |
| Base de datos | PostgreSQL (Neon, free tier) |
| WhatsApp | Meta Cloud API (preferido) → Twilio Sandbox (fallback actual) → mock |
| Email | Brevo (preferido) → SendGrid (fallback) → mock |
| Monitoreo | UptimeRobot, ping cada 5 min a `/api/health` |
| Costo de infraestructura | $0 — todo en planes gratuitos |

## 4. Lo que queda del plan original (bloqueado, no técnico)

Las demos reales con médicos candidatos (usando el guion y el deck ya listos), documentar sus resultados reales (NPS, intención de pago), y la decisión estratégica del equipo sobre si seguir invirtiendo, pivotar, o pausar. Nada de esto se puede avanzar sin conseguir primero médicos piloto reales dispuestos a probar el sistema.

## 5. Futuras consideraciones y recomendaciones

El backlog técnico detallado (con archivo/línea de cada hallazgo) ya está en `docs/qa/S6-10-backlog-v1.md`. Esta sección lo complementa con una mirada más amplia de escalabilidad y producto, pensada para **después** de validar con médicos reales — no antes.

### Confiabilidad y calidad
- **Sin tests automatizados** (0% de cobertura) — es el riesgo técnico más grande a mediano plazo; cualquier cambio futuro depende 100% de pruebas manuales.
- Unificar los estados de cita (`pending_approval`/`scheduled`/`confirmed`) para que el cron de recordatorios los cubra todos — hoy una cita `pending_approval` nunca recibe el recordatorio de 24h.
- Agregar rate limiting al login y un flujo de recuperación de contraseña.
- Pasar de `prisma db push` a migraciones versionadas antes de que haya datos reales de pacientes en juego.

### Escalabilidad de infraestructura
- Los planes gratuitos de Render/Neon son perfectos para el piloto, pero tienen límites reales (el backend se duerme sin tráfico, límites de storage/cómputo). La señal para pasar a un plan pago no es "cuando crezca el código", sino **cuando haya médicos pagando** — ahí el costo se justifica con ingresos reales.
- Extender la paginación (ya hecha en pacientes) al listado de citas antes de que un consultorio activo acumule meses de historial.
- Si el tráfico crece, separar el cron de recordatorios a un proceso/worker propio en vez de compartirlo con el proceso de la API — así un recordatorio lento nunca afecta la latencia de la app.

### Seguridad
- Salir del Sandbox de Twilio hacia un número de WhatsApp Business real antes de cualquier lanzamiento comercial (el sandbox requiere que cada usuario se "una" manualmente, lo cual no escala a usuarios reales que no son parte del equipo).
- Registrar un dominio propio una vez haya ingresos que lo justifiquen (hoy la app vive en subdominios `*.onrender.com`, correcto para un piloto gratuito).
- Agregar auditoría de qué admin/secretaria modificó qué cita/paciente, relevante en cuanto haya más de una persona gestionando la agenda de varios médicos.

### Nuevas funcionalidades candidatas (post-validación)
- Recordatorios configurables (no solo a las 24h — permitir que cada médico ajuste el tiempo de aviso).
- Completar la localización a inglés (o decidir formalmente que el producto es bilingüe) — hoy la UI está en inglés pero las plantillas de WhatsApp/Email siguen en español.
- Reportes/analítica más ricos para el médico: tendencias de inasistencia por paciente, ingresos estimados, comparativas mes a mes.
- Portal propio para el paciente (ver, confirmar o reprogramar su cita sin tener que llamar) — hoy toda la gestión pasa por el médico/secretaria.
- Integración de pagos, si el modelo de negocio termina cobrando directamente dentro de la plataforma.
- Soporte multi-clínica / multi-sede, si algún cliente piloto resulta ser una clínica con varias ubicaciones, no un consultorio individual.

### Producto y negocio
La recomendación más importante: **no invertir en escalar infraestructura ni construir funcionalidades nuevas todavía**. El sistema ya tiene más funcionalidad de la que se ha podido validar con un solo médico real. El siguiente paso de mayor valor es conseguir esas demos (sección 4) — cualquier inversión técnica adicional antes de esa señal de mercado es especulativa.
