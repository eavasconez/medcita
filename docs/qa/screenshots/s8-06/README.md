# S8-06 — Capturas ANTES / DESPUÉS

El mismo código compilado de dos maneras: ANTES sin `VITE_APP_ENV` (como producción) y DESPUÉS con `VITE_APP_ENV=staging` (como el sitio de staging), con los mismos datos de demostración.

| Imagen | Qué muestra |
|---|---|
| `R1-pantalla-de-inicio-de-sesion.png` | La etiqueta «STAGING · TEST DATA» en el inicio de sesión del sitio de staging |
| `R2-dashboard-en-staging.png` | La misma etiqueta flotando sobre el Dashboard, sin mover el contenido |

El resto del ticket no tiene pantalla: son la guía de staging y de archivos privados (`docs/DEPLOY.md`), el servicio de URLs firmadas y `npm run storage:check`, cuya salida está en la descripción del PR.
