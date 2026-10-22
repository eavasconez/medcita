# S9-08 — Guía de pruebas: límites persistentes y alertas de errores

Para quien prueba S9-08 (en local o después de desplegar). Qué cambió: los contadores de los límites de intentos (login, recuperación de contraseña, registro, invitaciones) ahora viven en la base de datos y sobreviven a un reinicio; y un error del servidor (5xx) manda un correo **al equipo de desarrollo de MedCita** (nunca a un consultorio) con la ruta, el consultorio, el dominio y la línea exacta del código. Para el despliegue a producción: [`docs/DEPLOY.md`](../DEPLOY.md), «Despliegue de los límites persistentes y las alertas de errores».

## 1. Pruebas automáticas

Necesitan la base de pruebas (`docs/TECHNICAL.md`, sección 6) y corren con `TZ=UTC`:

```bash
cd backend
TEST_DATABASE_URL="postgresql://postgres:password123@localhost:5432/medcita_test?schema=public" npx jest --runInBand \
  tests/rateLimitStore.test.js tests/errorAlerts.test.js tests/serverErrorAlert.test.js \
  tests/limitsAndAlertsScripts.test.js tests/rateLimitCountersMigration.test.js
```

| Archivo | Qué comprueba |
|---|---|
| `rateLimitStore.test.js` | El contador en la base: cuenta, ventana, 25 peticiones simultáneas sin perder ninguna, aislamiento por límite, claves con hash (sin correos ni IPs en claro), purga, y que un bloqueo sigue en pie en una **segunda copia de la app** (un «reinicio») |
| `errorAlerts.test.js` | Lo que dice el correo (ruta, consultorio, dominio, línea del código, id), que nunca lleva el mensaje del error, los límites de frecuencia y la lectura de pilas y mensajes de Prisma **con el formato real** |
| `serverErrorAlert.test.js` | Contra la app real: un 500 provoca el aviso, a quién llega (solo las direcciones de soporte, nunca el consultorio) y que sin la variable no se envía nada |
| `limitsAndAlertsScripts.test.js` | `npm run limits:reset` y `npm run alerts:test` |
| `rateLimitCountersMigration.test.js` | La migración sobre una base que ya tiene datos |

Se corre toda la suite con `npm test`. Un fallo suelto de `patientConsent.test.js` («not.toMatch(/111/)») es una prueba inestable conocida: falla si un UUID aleatorio contiene «111»; vuelve a correrla.

## 2. Postman

Carpeta «S9-08 - Límites de intentos persistentes (POST /auth/login)»: 5 intentos fallidos con una cuenta inexistente (401), el sexto bloqueado (429, con `retryAfterSeconds`), el siguiente también, y otra cuenta sin bloquear.

```bash
cd backend && EXPOSE_ACCOUNT_LINKS=true npm run dev          # en otra terminal: la colección entera
npx newman run postman/MedCita.postman_collection.json -e postman/MedCita.postman_environment.json
npx newman run postman/MedCita.postman_collection.json -e postman/MedCita.postman_environment.json --folder "S9-08 - Límites de intentos persistentes (POST /auth/login)"
```

> **Antes, reiniciar el backend limpiaba los límites; ahora no.** Dos corridas seguidas gastan el límite por IP y la segunda falla con `429`. Entre una y otra corre **`npm run limits:reset`** (o vuelve a sembrar con `npx prisma db seed`, que también los borra).

## 3. Prueba manual: el bloqueo sobrevive a un reinicio

Con el backend corriendo en local (`npm run dev`) y la base sembrada:

```bash
login() { curl -s -o /dev/null -w "%{http_code} " -X POST localhost:5000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"prueba.bloqueo@example.com","password":"incorrecta"}'; }
for i in 1 2 3 4 5 6; do login; done; echo     # 401 401 401 401 401 429
```

1. Detén el backend (Ctrl+C) y vuelve a arrancarlo.
2. `login; echo` → debe seguir en **429** (antes del cambio volvía a dar 401).
3. Para seguir probando sin esperar los 15 minutos: `npm run limits:reset`.

También se ve en la pantalla de login: tras 5 intentos fallidos con la misma cuenta aparece «Too many failed login attempts. Please try again in 15 minutes.» y sigue apareciendo después de reiniciar.

## 4. Prueba manual: las alertas de punta a punta (envía correos de verdad)

Sirve para comprobar el proveedor de correo, los destinatarios y el contenido. **Usa una base de prueba aparte** (no la de desarrollo) y deja la variable apuntando solo a tus correos.

**a) Preparación (una vez).** En `backend/.env`, con los correos de los desarrolladores que recibirán el aviso:

```
ERROR_ALERT_EMAILS=tu.correo@kodffe.com,otro.dev@kodffe.com
```

`npm run alerts:test` manda un aviso de **ejemplo** (con un consultorio y una línea de código inventados). Debe imprimir `OK -> tu.correo@kodffe.com (brevo)` y llegar a la bandeja. Si no, ve a la sección 6.

**b) Un error real.**

```bash
# Una base de prueba aparte y el esquema al día
docker run -d --name medcita-alertas --network host -e POSTGRES_PASSWORD=test -e POSTGRES_DB=medcita_alertas postgres:15-alpine -c port=5434
cd backend
export DATABASE_URL='postgresql://postgres:test@127.0.0.1:5434/medcita_alertas?schema=public'
npx prisma migrate deploy && npx prisma db seed
# Sin citas, para que el recordatorio de cada hora no escriba a nadie, y sin WhatsApp
docker exec medcita-alertas psql -U postgres -p 5434 -d medcita_alertas -c 'DELETE FROM "Appointment"'
TWILIO_ACCOUNT_SID= TWILIO_AUTH_TOKEN= META_WHATSAPP_TOKEN= META_WHATSAPP_PHONE_NUMBER_ID= node src/server.js
```

En otra terminal (con el mismo `DATABASE_URL`), provoca un 500 quitándole una columna a la base y vuelve a ponerla:

```bash
TOKEN=$(curl -s -X POST localhost:5000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@medcita.ec","password":"admin1234"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
docker exec medcita-alertas psql -U postgres -p 5434 -d medcita_alertas -c 'ALTER TABLE "Patient" RENAME COLUMN "cedula" TO "cedula_old"'
curl -i -H "Authorization: Bearer $TOKEN" -H 'Origin: http://localhost:5173' localhost:5000/api/patients      # 500, con la cabecera X-Request-Id
docker exec medcita-alertas psql -U postgres -p 5434 -d medcita_alertas -c 'ALTER TABLE "Patient" RENAME COLUMN "cedula_old" TO "cedula"'
```

**c) Qué debe pasar.** A cada dirección de `ERROR_ALERT_EMAILS` llega, en unos segundos, un correo:

- Asunto: `[MedCita · Consultorio MedCita (demo)] Error 500 en GET /api/patients (src/routes/patients.js:49)`.
- Cuerpo: el consultorio (nombre, nombre corto, id), el dominio (`http://localhost:5173`), el tipo de error (`PrismaClientKnownRequestError (P2022)`), **la línea del código**, el detalle del esquema (`column: Patient.cedula`), la hora y el **id de la petición**.
- **No** debe traer el mensaje del error, ni datos de pacientes, ni la consulta (`search=…`), ni IPs.
- Un segundo error en la misma ruta y el mismo consultorio dentro de 15 minutos **no** manda otro correo (el siguiente dice cuántos se callaron).

Para ver el mensaje completo busca el id en el log del servidor: aparece delante de cada línea de error, `[request a602c1203971] List patients error: …`. En Render: *Logs* del servicio y busca ese id.

**d) Limpieza.** Ctrl+C al servidor y `docker rm -f medcita-alertas`.

## 5. Qué mirar en las pantallas

Nada cambia en la interfaz salvo que, tras un reinicio, un bloqueo de login sigue mostrándose (sección 3). Los intentos fallidos contra una cuenta que existe siguen quedando en el Activity Log como «Failed sign-in attempt» (S8-03); una vez que el límite bloquea la cuenta ya no se registran más.

## 6. Si algo no funciona

| Síntoma | Causa y solución |
|---|---|
| `alerts:test` dice `[BREVO EMAIL ERROR] 401` y Brevo manda un correo «Verify a new IP» | Brevo solo acepta su API desde **IPs autorizadas**. Pulsa «Yes, authorize the new IP address» en ese correo, o añade la IP en app.brevo.com → *Security → Authorised IPs*. En producción hay que autorizar las **IPs de salida de Render** de la región del servicio (o desactivar la restricción) |
| `alerts:test` además dice `SendGrid … Unauthorized` | La clave de SendGrid del `.env` no es válida. Solo es el respaldo; con Brevo funcionando no importa |
| `ERROR_ALERT_EMAILS has no valid address` | La variable está vacía o sin direcciones válidas (separadas por comas, sin espacios dentro de una dirección) |
| `alerts:test` dice `simulated` | No hay ningún proveedor de correo configurado: solo se imprimió, no se envió nada |
| Hubo un 500 y no llegó correo | (1) `ERROR_ALERT_EMAILS` no está definida en ese entorno; (2) ya salió un aviso de esa ruta y consultorio hace menos de 15 minutos, o ya salieron 10 en la hora; (3) la respuesta fue 4xx o `/api/health`, que no avisan; (4) revisa el log: `Could not send the error alert:` o `[BREVO EMAIL ERROR]` |
| El correo dice «No se pudo determinar la línea del código» | El error nació fuera del código de MedCita (una librería) y su pila no pasa por `backend/src`. Busca el id de la petición en los logs |
| El correo dice «La ruta atendió el error sin dejar rastro» | La ruta respondió 500 sin registrar un error con `console.error`. Es raro: revisa esa ruta |
| «Consultorio: no identificado» | La petición no tenía sesión (login, alta, recuperación de contraseña). Es lo esperado |
| Quedé bloqueado por probar el login | Espera la ventana (15 minutos a 1 hora) o `npm run limits:reset` (en producción: `RATE_LIMIT_RESET_HOST=<host de Neon> npm run limits:reset`) |
| Postman da `429` en la segunda corrida | Corre `npm run limits:reset` entre corridas (sección 2) |
| `limits:reset` se niega a correr | La base no es local. Es a propósito: borrar los límites en producción le daría intentos nuevos a quien adivina contraseñas |
