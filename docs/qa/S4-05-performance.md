# S4-05 — Optimización básica de performance

> Comparación real antes/después, medida contra builds de producción (`vite build`) y el backend real corriendo en local. Fecha de ejecución: 2026-07-22.

## Resumen

| Cambio | Área |
|---|---|
| `React.lazy()` + `Suspense` en todas las rutas | Frontend — code splitting |
| Deduplicación de fetch de stats/citas en el Dashboard | Frontend — data fetching |
| `select` en vez de `include` completo para `patient` en `appointments.js` | Backend — Prisma |
| Paginación (`take`/`skip`) en `GET /api/patients` | Backend — Prisma |

## 1. Lazy loading (React.lazy + Suspense)

**Antes** (`main`, bundle único): `vite build` genera un solo archivo JS de **1,046 KB** (321.5 KB gzip), con advertencia explícita de Vite:
```
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
```

**Después** (esta rama, cada ruta en su propio chunk):
```
dist/assets/Login-DGmrNeLf.js           4.37 kB │ gzip:   1.63 kB
dist/assets/Patients-B1PCIUEj.js        9.79 kB │ gzip:   3.21 kB
dist/assets/index-D6A6An1T.js         273.25 kB │ gzip:  89.69 kB   (compartido)
dist/assets/Dashboard-D9RUfIXd.js     337.47 kB │ gzip: 108.58 kB
dist/assets/Reports-Bg6WKxZm.js       379.38 kB │ gzip: 112.18 kB
```

- **Carga inicial de Login**: antes descargaba los 321.5 KB gzip completos (incluyendo `react-big-calendar`, la librería de gráficos de Reports, etc., sin usar nada de eso). Después, solo `index` (89.69 KB) + `Login` (1.63 KB) ≈ **~91 KB gzip** — **~72% menos** en la carga inicial.
- **Carga de Dashboard**: antes 321.5 KB gzip (todo). Después `index` + `Dashboard` + `Layout` ≈ **~201 KB gzip** — **~38% menos** (ya no arrastra la librería de gráficos de Reports).

### Medición real de tiempo (Playwright, build de producción servido localmente)

Flujo completo: login → Dashboard visible.

| Condición | Antes (bundle único) | Después (code-split) | Mejora |
|---|---|---|---|
| Red local (sin throttling) | ~950ms | ~870ms | ~8% |
| Red simulada ~1.6 Mbps / 150ms RTT (similar a una conexión móvil real) | **6,811ms** | **5,105ms** | **~25% (1.7s menos)** |

La diferencia es modesta en localhost (la red no es el cuello de botella ahí), pero bajo condiciones de red realistas (relevante para el caso de uso real de la app — médicos/pacientes en Ecuador, no necesariamente con banda ancha) la mejora es sustancial.

## 2. Deduplicación de fetch en el Dashboard

**Hallazgo**: `fetchAppointments()` (lista del calendario) y `fetchStats()` (KPIs) llamaban al mismo endpoint `GET /api/appointments?doctorId=X` por separado cuando no hay ningún filtro activo — dos peticiones idénticas en cada carga del Dashboard y en cada acción (crear/editar/eliminar/arrastrar una cita).

**Qué se hizo**: cuando no hay filtro de estado/paciente activo, `fetchAppointments` calcula las estadísticas directamente de su propia respuesta (ya tiene el set completo del médico), y `fetchStats` se salta su propia petición en ese caso. Cuando sí hay un filtro activo (donde las dos respuestas legítimamente difieren, ya que los KPIs deben reflejar el total del médico y no la vista filtrada), `fetchStats` sigue haciendo su petición normalmente — el comportamiento correcto no cambió, solo se eliminó la petición duplicada en el caso común.

**Verificado**: con Playwright, capturando las peticiones de red reales al cargar el Dashboard — el endpoint `?doctorId=...` solo se llama **una vez** (antes se llamaba dos veces en el caso sin filtros).

## 3. Prisma — `select` en vez de `include` completo

`backend/src/routes/appointments.js`: los 3 lugares que devuelven una cita con su paciente (`GET /`, `POST /`, `PUT /:id`) usaban `include: { patient: true }`, trayendo la fila completa del paciente (incluyendo `createdAt`, que ningún consumidor usa). Se reemplazó por `select` con exactamente los 5 campos que el frontend y `notificationService` realmente consumen (`id`, `name`, `phone`, `email`, `cedula`).

## 4. Paginación en Patients

**Hallazgo de S4-02**: la base de desarrollo llegó a acumular 144 pacientes de pruebas anteriores, y `GET /api/patients` los devolvía **todos** sin límite — con volumen real de pacientes, esto degrada tanto la respuesta del backend como el render del frontend (confirmado en S4-02: ~48,000px de alto en móvil con esa cantidad).

**Qué se hizo**: `GET /api/patients` ahora acepta `page`/`pageSize` (default 25, máximo 100) y devuelve `{ patients, total, page, pageSize, totalPages }` en vez de un array plano. Se actualizaron los 3 lugares del frontend que consumen este endpoint (`Patients.jsx`, y los dos buscadores de pacientes en `Dashboard.jsx`). `Patients.jsx` ahora muestra controles de paginación (solo cuando hay más de una página).

**Verificado**: se sembraron 30 pacientes de prueba (superando el límite de 25 por página) — la UI mostró "Page 1 of 2", el botón "Next" avanzó correctamente a "Page 2 of 2" (botón "Previous" habilitado), y "Previous" regresó a la página 1. Datos de prueba eliminados después.

## Pruebas realizadas por el desarrollador
- `vite build` real para antes (`main`) y después (esta rama), comparando tamaños de bundle reales.
- Medición de tiempo real login→Dashboard visible con Playwright, sirviendo ambos builds de producción, con y sin throttling de red simulado.
- Verificado con captura de peticiones de red que la deduplicación de stats/citas funciona (una sola petición `?doctorId=...`, no dos).
- Prueba end-to-end de agendar una cita real tras los cambios — sin errores de consola.
- Prueba end-to-end de la paginación de pacientes (30 registros sembrados, navegación Next/Previous verificada, datos de prueba limpiados).
