# S9-02 — Guía de pruebas: responder el recordatorio de WhatsApp con un toque

Para quien prueba S9-02 (en local o después de desplegar). Qué cambió: el recordatorio de WhatsApp puede llevar tres botones —**«Confirmo»**, **«Cancelar»** y **«Cambiar hora»**— y un toque actualiza la agenda solo. Meta llama a un **webhook** de MedCita, que es el primer endpoint abierto a internet sin login, así que lo primero que se prueba es que **no acepta nada que no venga firmado por Meta**. No hay migración. Para el despliegue a producción: [`docs/DEPLOY.md`](../DEPLOY.md), «Despliegue de las respuestas por WhatsApp (S9-02)»; para configurar Meta: [`docs/WHATSAPP_META_SETUP.md`](../WHATSAPP_META_SETUP.md), paso 12.

> **Lo que todavía no está probado:** con Meta de verdad (la plantilla con botones puede pedir ajustes, y el webhook se verifica en el panel de Meta). Todo lo demás —la firma, la identificación de la cita, las reglas y los registros— se prueba aquí con llamadas simuladas y firmadas como las de Meta.

## 1. Pruebas automáticas

Necesitan la base de pruebas (`docs/TECHNICAL.md`, sección 6) y corren con `TZ=UTC`:

```bash
cd backend
TEST_DATABASE_URL="postgresql://postgres:password123@localhost:5432/medcita_test?schema=public" npx jest --runInBand \
  tests/whatsappWebhook.test.js tests/reminderButtons.test.js tests/patientReplies.test.js tests/whatsappReplyScript.test.js tests/whatsapp.test.js
```

| Archivo | Qué comprueba |
|---|---|
| `whatsappWebhook.test.js` | El webhook contra la app real, firmando como Meta: la verificación (`GET`), la firma (sin firma, firma ajena, cuerpo alterado, sin `META_APP_SECRET`), los tres botones, y todo lo que **no** debe cambiar nada (cita pasada, cancelada, cerrada, movida después del recordatorio, otro número, payload inventado o con otra clave, texto libre), los repetidos de Meta, el fallo de la base (responde `500` para que Meta reenvíe), y el aislamiento entre consultorios (el mismo número en dos) |
| `reminderButtons.test.js` | El identificador firmado de los botones (se rechaza si se altera cualquier parte), las plantillas con botones, qué plantilla elige el recordatorio según lo que esté registrado y la vista previa de Settings |
| `patientReplies.test.js` | El teléfono del paciente escrito de varias formas y la decisión según el estado de la cita y la hora del consultorio |
| `whatsappReplyScript.test.js` | `npm run whatsapp:reply`, contra un servidor real |
| `whatsapp.test.js` | Que `DEPLOY.md` y `WHATSAPP_META_SETUP.md` tengan el texto exacto de **todas** las plantillas, incluidas las dos con botones |

Se corre toda la suite con `npm test`. Un fallo suelto de `patientConsent.test.js` («not.toMatch(/111/)») es una prueba inestable conocida: falla si un UUID aleatorio contiene «111»; vuelve a correrla.

## 2. Postman

Carpeta «S9-02 - Respuestas por WhatsApp (POST /webhooks/whatsapp)» (20 peticiones). Sin nada más comprueba que el webhook **rechaza** (403, o 503 si el servidor no lo tiene configurado) la verificación con un token equivocado, la llamada sin firma y la firma que no corresponde al cuerpo. Con los secretos del servidor comprueba además el camino completo: verificación correcta, un toque de otro número sin efecto, «Confirmo», el reenvío de Meta, «Cancelar» y un botón mal firmado.

```bash
cd backend
# El servidor local necesita estas dos variables en backend/.env (cualquier texto largo sirve):
#   META_APP_SECRET=...   META_WEBHOOK_VERIFY_TOKEN=...
EXPOSE_ACCOUNT_LINKS=true npm run dev

# En otra terminal. Con los mismos valores del .env (JWT_SECRET firma los botones):
npx newman run postman/MedCita.postman_collection.json -e postman/MedCita.postman_environment.json \
  --folder "S9-02 - Respuestas por WhatsApp (POST /webhooks/whatsapp)" \
  --env-var metaAppSecret="$META_APP_SECRET" --env-var jwtSecret="$JWT_SECRET" --env-var metaVerifyToken="$META_WEBHOOK_VERIFY_TOKEN"
```

Sin las tres `--env-var`, las peticiones que las necesitan se marcan «Omitida» y la carpeta pasa igual (28 aserciones; con ellas, 31). Las llamadas inválidas gastan el límite del webhook (30 cada 15 minutos por IP): entre una corrida y otra corre **`npm run limits:reset`**, como con los demás límites (S9-08).

## 3. Prueba manual en local, sin Meta

Con la base sembrada (`npx prisma db seed`) y esto en `backend/.env` (cualquier texto largo):

```
META_APP_SECRET=un-secreto-local-largo
META_WEBHOOK_VERIFY_TOKEN=otro-texto-local-largo
```

1. `npm run dev` en `backend/` y `npm run dev` en `frontend/`. Inicia sesión como `demo@medcita.ec` / `demo1234` (médico) o `admin@medcita.ec` / `admin1234`.
2. Agenda **tres citas** para mañana con tres pacientes distintos (con correo, para ver también el correo): María, Carlos y Lucía. Anota el **id** de cada una:
   ```bash
   docker exec medcita-db psql -U postgres -d medcita -c 'SELECT id, date, time, status FROM "Appointment" ORDER BY "createdAt" DESC LIMIT 3'
   ```
3. Simula lo que hace cada paciente (desde `backend/`):
   ```bash
   npm run whatsapp:reply -- <id de María> confirm
   npm run whatsapp:reply -- <id de Carlos> reschedule
   npm run whatsapp:reply -- <id de Lucía> cancel --from +593991111111   # un recordatorio reenviado: no debe cambiar nada
   npm run whatsapp:reply -- <id de Lucía> cancel                          # el toque del propio paciente
   ```
   (El botón de un recordatorio sobre un **horario anterior** —la cita se movió después— no se puede simular con el script, porque arma el botón con la hora actual de la cita: lo cubre `whatsappWebhook.test.js`.) Cada orden dice qué toque hizo y qué contestó el servidor (`200 {"received":true}`). Se niega a hablarle a un servidor que no sea local.
4. Recarga el Dashboard y comprueba lo de la tabla de abajo.

| Caso | Qué debe pasar |
|---|---|
| María toca «Confirmo» | La cita pasa a **Confirmed**. En su detalle, «Messages» dice «The patient confirmed the appointment by WhatsApp» y «Answer to the patient sent by WhatsApp» (**simulated** si no hay proveedor: no salió nada de verdad). En **Activity Log**: «Patient (WhatsApp)» → «Updated an appointment · pending_approval → confirmed» |
| María toca «Confirmo» otra vez | No cambia nada: «The patient replied by WhatsApp, nothing was changed · It was already confirmed.» |
| Carlos toca «Cambiar hora» | La cita **sigue Pending** (no se mueve sola). «Messages»: la solicitud, la respuesta y «Notice to the clinic's staff sent by email». Llega un correo a los administradores y secretarias del consultorio (con un proveedor de correo configurado; si no, queda «simulated») |
| Carlos toca «Cambiar hora» otra vez en el día | No se manda otro correo a la secretaría; sí se le contesta al paciente |
| Lucía: el toque viene de **otro número** | La cita no cambia ni se contesta a ese número; el historial anota «It came from a number that is not the patient's.» |
| Lucía toca «Cancelar» | La cita queda **cancelada** (desaparece del calendario, se ve con el filtro de canceladas) y el horario se puede volver a agendar. En Activity Log: «Cancelled an appointment · pending_approval → cancelled» |

Para ver el recordatorio **con los botones** tal como sale hacia Meta, no hace falta una cuenta de Meta: la prueba `reminderButtons.test.js` ("sends the template with buttons once it is registered…") muestra el cuerpo exacto; o corre el servidor con las variables de Meta, `META_WHATSAPP_TEMPLATE_REMINDER_BUTTONS=recordatorio_cita_botones` y una Graph API falsa (`META_GRAPH_BASE_URL`, ver `docs/TECHNICAL.md`, sección 3), y mira lo que recibe al disparar `POST /api/tasks/reminders`.

## 4. Prueba con Meta (número de prueba)

Después de configurar el webhook y de que Meta apruebe la plantilla con botones (`docs/WHATSAPP_META_SETUP.md`, paso 12): con tu teléfono como paciente, agenda una cita para dentro de unas 20 horas, dispara el recordatorio (`POST /api/tasks/reminders` como administrador) y toca cada botón. La lista completa está en `docs/DEPLOY.md`, «Checklist con el número de prueba de Meta».

## 5. Qué mirar en las pantallas

- **Settings → Reminders:** la vista previa muestra los tres botones cuando la plantilla con botones está registrada y el webhook configurado; si no, el texto sencillo de siempre.
- **Dashboard → una cita → Messages:** las respuestas del paciente (icono azul), las respuestas que le mandó MedCita y el aviso a la secretaría.
- **Activity Log:** las entradas de «Patient (WhatsApp)» (rol `PATIENT`), con el cambio de estado y sin el nombre ni el teléfono del paciente.

## 6. Si algo no funciona

| Síntoma | Qué mirar |
|---|---|
| `npm run whatsapp:reply` dice «META_APP_SECRET is not set» | Falta en `backend/.env` (el script y el servidor leen el mismo archivo) o hay que reiniciar el servidor |
| El servidor contesta `503` | Al servidor le falta `META_APP_SECRET` (o, en la verificación, `META_WEBHOOK_VERIFY_TOKEN`) |
| El servidor contesta `403 Invalid signature` | El secreto del script y el del servidor no coinciden |
| Contesta `200` pero la cita no cambia | Mira el historial de la cita: ahí queda el motivo (`It was already confirmed`, `The appointment time had passed`, `It came from a number that is not the patient's`, etc.). Si no hay ninguna fila, el botón no es de MedCita (otro `JWT_SECRET` o un payload inventado) y solo hay una línea `[WHATSAPP REPLY] ignored…` en la consola del servidor |
| `429` | Demasiadas llamadas inválidas desde tu IP: `npm run limits:reset` |
| El servidor local dice que no puede hablar con Meta al contestar | Normal sin credenciales: la respuesta queda «simulated». Con credenciales falsas, el error de Meta queda en el historial como «failed» |
