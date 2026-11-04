# S12-04 — Capturas ANTES / DESPUÉS: datos de demostración en el despliegue

Todas son de la **aplicación real** (backend + frontend) contra una base Postgres local recién creada, que es lo que pasa con un Postgres nuevo de Railway: las migraciones crean las tablas pero la base nace sin filas. Las tablas son las de Adminer. «ANTES» es el flujo de siempre (`migrate deploy` solo); «DESPUÉS» es el `npm run migrate` de la raíz con `DEMO_SEED=true`, que es lo que ejecuta Railway como *pre-deploy*.

| Imagen | Qué muestra |
|---|---|
| `R01-ANTES-login-demo.png` / `R01-DESPUES-…` | El login de `demo@medcita.ec` / `demo1234` en la base nueva: antes, «Invalid credentials» (el servidor está sano pero no hay cuentas); después, entra al panel del Consultorio MedCita (demo) |
| `R02-ANTES-tablas-base-demo.png` / `R02-DESPUES-…` | Las tablas de la base: antes, todas con 0 filas; después, 3 consultorios, 7 usuarios, 10 pacientes, 59 citas y 30 horarios |
| `R03-segundo-despliegue-conserva-datos.png` | Un segundo despliegue con `DEMO_SEED=true`: el paciente creado a mano antes de repetir el pre-deploy sigue en la lista (el log dice «already has data … not loaded again»); un seed normal lo habría borrado |
| `R04-produccion-sin-demo-seed-no-carga-datos.png` | Producción: el mismo `npm run migrate` **sin** `DEMO_SEED` sobre una base vacía no carga nada (el log dice «DEMO_SEED is not "true"») |

Las líneas del log de cada caso (`The database at … is empty and DEMO_SEED is "true": loading the demo data`, `… already has data (3 clinics, 7 users, 11 patients): the demo data is not loaded again.`, `DEMO_SEED is not "true": the demo data is not loaded.`) son las que salen de `backend/scripts/seedDemoIfEmpty.js`.

La interfaz de la aplicación no cambia en este ticket.
