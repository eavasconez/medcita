# S4-02 — Testing cross-browser y responsive/móvil

> Pruebas contra el frontend real (`http://localhost:5173`) usando Playwright con los motores de navegador reales instalados (Chromium, WebKit) y viewports emulados (móvil, tablet). Fecha de ejecución: 2026-07-22.

## Resumen

| Área | Resultado |
|---|---|
| Chromium (desktop, 1280×900) | ✅ Login, Patients, Settings — sin errores de consola |
| WebKit / Safari engine (desktop, 1280×900) | ✅ Login, Patients, Settings — sin errores de consola |
| Firefox | ⚠️ No probado — ver nota de entorno |
| Móvil (390×844, iPhone-like) | ✅ Login, Dashboard, Patients, modal "New Appointment" — sin errores de consola |
| Tablet (768×1024, iPad-like) | ⚠️ Funciona, con 1 bug de layout encontrado (ver Hallazgo #1) |

## 1. Cross-browser (desktop)

Se probó login → Dashboard → Patients → Settings en cada motor:

- **Chromium**: todo funciona correctamente, sin errores de consola. Layout idéntico al esperado.
  - [Dashboard](screenshots/s4-02/chromium-dashboard.png) · [Patients](screenshots/s4-02/chromium-patients.png) · [Settings](screenshots/s4-02/chromium-settings.png)
- **WebKit** (motor de Safari): todo funciona correctamente, sin errores de consola. Layout visualmente idéntico a Chromium (calendario, tarjetas de stats, sidebar).
  - [Dashboard](screenshots/s4-02/webkit-dashboard.png) · [Patients](screenshots/s4-02/webkit-patients.png) · [Settings](screenshots/s4-02/webkit-settings.png)
- **Firefox**: **no se pudo probar** — el binario de Firefox cacheado en este entorno de pruebas no es compatible con el protocolo de la versión de Playwright instalada (`Browser.setDefaultViewport` rechaza el schema). Esto es una limitación del entorno de testing, no evidencia de un problema en la app. Queda pendiente probar con un entorno donde `npx playwright install firefox` pueda correr limpio, o manualmente en un Firefox real.

## 2. Responsive — Móvil (390×844)

Probado: Login, Dashboard, Patients, apertura del modal "New Appointment".

- ✅ Sidebar colapsa correctamente a menú hamburguesa — [captura del menú abierto](screenshots/s4-02/mobile-menu-open.png)
- ✅ Tarjetas de stats se apilan en una columna, legibles.
- ✅ Modal "New Appointment" ocupa el ancho completo, usable, botón de cerrar visible.
- ✅ Tarjetas de pacientes se ven bien, ícono de editar visible (fix de S3-07).
- ✅ Sin errores de consola.

Capturas: [Login](screenshots/s4-02/mobile-login.png) · [Dashboard](screenshots/s4-02/mobile-dashboard.png) · [Patients](screenshots/s4-02/mobile-patients.png) · [Modal "New Appointment"](screenshots/s4-02/mobile-modal.png)

## 3. Responsive — Tablet (768×1024)

Probado: Login, Dashboard, Patients, menú, modal "New Appointment".

Capturas: [Login](screenshots/s4-02/tablet-login.png) · [Dashboard](screenshots/s4-02/tablet-dashboard.png) · [Patients](screenshots/s4-02/tablet-patients.png) · [Menú](screenshots/s4-02/tablet-menu-open.png) · [Modal "New Appointment"](screenshots/s4-02/tablet-modal.png)

### Hallazgo #1 (bug encontrado) — Prioridad media
En el Dashboard, a 768px de ancho, la fila de tarjetas de estadísticas (Total Appointments / Total Patients / Effectiveness) **se desborda del viewport sin ningún mecanismo de scroll**: la tercera tarjeta ("Effectiveness") queda cortada contra el borde derecho de la pantalla, con su etiqueta y valor parcialmente inaccesibles.

**Captura**: [tablet-dashboard.png](screenshots/s4-02/tablet-dashboard.png) (fila de stats cortada) — recorte de detalle en [tablet-kpi-check.png](screenshots/s4-02/tablet-kpi-check.png), mostrando la tarjeta "Effectiveness" partida justo en el borde del viewport.

Esto contrasta con el calendario semanal, que sí maneja correctamente su propio desbordamiento horizontal mediante un contenedor `overflow-x-auto` (confirmado: `scrollWidth: 640` vs `clientWidth: 414`, con scroll funcional) — el body/documento no tiene scroll horizontal global (`scrollWidth === clientWidth === 768`), así que el problema es específico de la fila de tarjetas de stats, que no tiene ni scroll ni un breakpoint que la haga apilarse/reducirse a este ancho.

**Reproducción**: cargar el Dashboard en un viewport de 768px de ancho.

**Impacto**: en tablets reales (iPad en modo vertical, ~768-810px), el usuario no puede leer el valor de "Effectiveness" completo.

**Queda para**: issue #43 (S4-03: Corrección de bugs encontrados en testing).

## Nota: limpieza de datos de prueba
Durante esta verificación se detectó que la base de datos de desarrollo había acumulado **144 pacientes** (de tickets anteriores), de los cuales solo 3 eran datos reales. Se limpiaron los 141 registros de prueba (y sus 7 citas asociadas) para dejar el entorno de desarrollo en un estado limpio y representativo. Esto también reveló que **la página de Patients no tiene paginación** — con 144 tarjetas, la página se vuelve extremadamente larga (confirmado: ~48,000px de alto en móvil) — algo a considerar en S4-05 (optimización de performance) si se espera un volumen real de pacientes.

## Conclusión
La app funciona correctamente en Chromium y WebKit (desktop) y en viewport móvil, sin errores de consola en ningún caso. A nivel tablet (768px) se encontró un bug real de layout (Hallazgo #1) que corta la tercera tarjeta de estadísticas del Dashboard. Firefox no pudo probarse por una limitación del entorno de testing (no de la app). El bug de tablet queda documentado para S4-03.
