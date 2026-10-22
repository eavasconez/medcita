# Guía de configuración: WhatsApp con Meta Cloud API

Guía completa, paso a paso, para que el equipo configure el envío de WhatsApp de MedCita (confirmación de cita y recordatorio de 24 h) con **sus propias cuentas de Meta**. Se escribió a partir de la configuración real hecha en el ticket S7-06 (#75), con los tropiezos incluidos.

- **Qué resuelve.** MedCita inicia la conversación con el paciente, y Meta solo permite eso con **plantillas aprobadas**. El texto libre únicamente se entrega dentro de las 24 h posteriores a que el paciente escribió. El código ya envía ambos mensajes como plantilla; esta guía cubre lo que se hace **fuera del código**.
- **Referencia técnica.** [DEPLOY.md, sección 7](DEPLOY.md): variables de entorno y tabla de errores. Si algo difiere entre los dos documentos, manda el que se haya actualizado después; los textos de las plantillas están en ambos y un test comprueba que coincidan con el código.
- **Sin Meta no se rompe nada.** Si no hay credenciales de Meta, el backend usa Twilio y, si tampoco hay, el modo mock (solo registra en el log). Para decidir entre Meta y Twilio, con la tabla comparativa y cómo cambiar de uno a otro, ver [DEPLOY.md, sección 7.0](DEPLOY.md). Esta guía es solo para quien elige **Meta**.
- **Estado verificado (21-oct-2026).** Con esta configuración, una cita agendada desde el sitio desplegado envió la plantilla `cita_confirmada` y llegó al teléfono de prueba. Evidencia en [`qa/S7-12-production-evidence.md`](qa/S7-12-production-evidence.md).
- **Respuestas con botones (S9-02).** El recordatorio puede llevar tres botones («Confirmo», «Cancelar», «Cambiar hora») y la agenda se actualiza sola. Es opcional y se activa al final: plantillas 4 y 5 (paso 5) y el webhook (paso 12). **Todavía no se probó con Meta de verdad**: la lista de comprobación del paso 12 es lo que falta.
- **Nombres de menús.** Meta los cambia con frecuencia y los traduce de forma distinta según el idioma de la cuenta. Aquí van en español con el nombre en inglés entre paréntesis. Si no encuentras uno, búscalo por su nombre en el buscador del panel.

## Índice

0. [Resumen y requisitos](#0-resumen-y-requisitos)
1. [Cuenta de Facebook y registro como desarrollador](#1-cuenta-de-facebook-y-registro-como-desarrollador)
2. [Crear la app](#2-crear-la-app)
3. [Número de prueba y datos de la API](#3-número-de-prueba-y-datos-de-la-api)
4. [Agregar los números que recibirán mensajes de prueba](#4-agregar-los-números-que-recibirán-mensajes-de-prueba)
5. [Crear las plantillas](#5-crear-las-plantillas)
6. [Token temporal](#6-token-temporal-solo-para-probar-de-inmediato)
7. [Token de usuario del sistema](#7-token-de-usuario-del-sistema-el-que-va-en-render)
8. [Variables de entorno](#8-variables-de-entorno)
9. [Comprobar que funciona](#9-comprobar-que-funciona)
10. [Pasar a un número real](#10-pasar-a-un-número-real-producción)
11. [Problemas frecuentes](#11-problemas-frecuentes)
12. [Respuestas con botones (webhook)](#12-respuestas-con-botones-webhook)

---

## 0. Resumen y requisitos

El orden importa: las plantillas tardan en aprobarse, así que se crean **lo antes posible** y mientras tanto se configura el resto.

| # | Qué se hace | Dónde | Tiempo aprox. |
|---|---|---|---|
| 1 | Cuenta de Facebook y registro de desarrollador | Facebook / developers.facebook.com | 10 min |
| 2 | Crear la app y el portfolio comercial | developers.facebook.com | 10 min |
| 3 | Anotar el Phone Number ID y el WABA | Configuración de la API | 2 min |
| 4 | Agregar testers | Configuración de la API | 5 min |
| 5 | Crear y enviar a revisión las 2 plantillas | WhatsApp Manager | 15 min + **espera de Meta (minutos a 24 h)** |
| 6–7 | Generar el token | Panel de la app / Configuración del negocio | 10 min |
| 8 | Variables de entorno | Render y `backend/.env` | 5 min |
| 9 | Probar | Terminal | 5 min |

**Qué necesitas antes de empezar**

| Necesitas | Detalle |
|---|---|
| Una cuenta de Facebook personal | Será la dueña de la app y del portfolio comercial. Conviene que sea de una persona que se quedará en el equipo. |
| Un teléfono con WhatsApp por cada tester | Máximo 5 con el número de prueba. |
| Acceso a las variables de entorno de Render | Para pegar el token y el Phone Number ID. |
| Una terminal con `curl` y, para el paso 9, el repo clonado | Con `npm install` hecho en `backend/`. |

**Hoja de datos.** Anótalos a medida que avanzas. Ninguno es secreto salvo el token.

| Dato | Dónde se obtiene | Para qué sirve |
|---|---|---|
| ID de la app | Panel de developers, arriba a la izquierda | Asignar el token |
| WhatsApp Business Account ID (**WABA**) | Configuración de la API (paso 3) | Consultar plantillas |
| **Phone Number ID** | Configuración de la API (paso 3). No es el teléfono. | `META_WHATSAPP_PHONE_NUMBER_ID` |
| **Token** | Paso 6 o 7 | `META_WHATSAPP_TOKEN` (**secreto**) |

---

## 1. Cuenta de Facebook y registro como desarrollador

1. Entra a [developers.facebook.com](https://developers.facebook.com) e inicia sesión con la cuenta de Facebook del equipo. Si no tiene una, créala en facebook.com antes.
2. Pulsa **Comenzar** (*Get started*). Meta te pide aceptar las condiciones de la plataforma y verificar tu número de teléfono o correo.
3. Cuando termine, el sitio te lleva al panel con la lista de tus apps, vacía por ahora.

> Si el formulario de registro se queda cargando sin avanzar, prueba en otro navegador o en ventana privada, sin extensiones, y revisa que la cuenta de Facebook tenga el correo verificado.

## 2. Crear la app

1. En el panel, **Mis apps → Crear app** (*My Apps → Create app*).
2. Escribe el nombre (por ejemplo `MedCita`) y el correo de contacto, y continúa.
3. En la selección de **casos de uso** (*use cases*), elige el de **WhatsApp**: «Conectarse con clientes a través de WhatsApp» (*Connect with customers through WhatsApp*). Si la lista no muestra el tipo «Business» o no ves WhatsApp, revisa que la cuenta ya esté registrada como desarrolladora (paso 1) y abre «Otros» o «Ver más».
4. En **¿Qué portfolio comercial quieres conectar?** (*business portfolio*), elige uno existente o crea uno nuevo (por ejemplo `MedCita`). **La app debe quedar conectada a un portfolio**: sin eso no aparecen después los permisos del token (paso 7).
5. Revisa el **Resumen** y pulsa **Crear app**.
6. Meta abre el panel de la app. En el menú izquierdo entra a **Casos de uso → Personalizar** (*Customize*) en el caso de WhatsApp. Si pide aceptar permisos (`whatsapp_business_messaging`, `whatsapp_business_management`), acéptalos.

## 3. Número de prueba y datos de la API

1. Dentro del caso de uso de WhatsApp, abre **Configuración de la API** (*API Setup*). Meta ya creó una cuenta de WhatsApp Business de prueba con un **número de prueba gratuito**.
2. En **Paso 1. Pruébalo** (*Step 1: Send and receive messages*) verás:
   - el **teléfono de prueba** (el número desde el que enviará MedCita);
   - el **Phone Number ID**: un número largo. **Anótalo.** No es el teléfono;
   - el **WhatsApp Business Account ID** (WABA): otro número largo. **Anótalo.**
3. Cuando te pida conectar o elegir cuentas de WhatsApp (un diálogo de Facebook), selecciona la cuenta **Test WhatsApp Business Account** y su número, y confirma. Aparece «<tu nombre> se conectó a MedCita».

## 4. Agregar los números que recibirán mensajes de prueba

Con el número de prueba, **solo reciben mensajes los números que estén en esta lista**; para cualquier otro Meta responde con el error 131030.

1. En **Configuración de la API**, en el campo **Para** (*To*), abre el desplegable y pulsa **Administrar lista de números de teléfono** (*Manage phone number list*).
2. **Agregar número** con el código de país, por ejemplo `+593 98…`.
3. Meta envía un **código de verificación por WhatsApp** a ese número. Escríbelo en el diálogo.
4. Repite para cada tester (máximo 5). Deben aparecer como **verificados**.

Para comprobar que la configuración básica funciona, en el mismo **Paso 1. Pruébalo** pulsa **Enviar mensaje** (*Send message*): llega la plantilla `hello_world` («Hello World») al tester.

## 5. Crear las plantillas

MedCita usa dos plantillas obligatorias (1 y 2) y tres opcionales (3, 4 y 5). **Se crean desde el principio en español**, y se crean **ahora** porque la revisión de Meta es la parte más lenta.

### Cómo abrir el creador de plantillas

Hay dos rutas, equivalentes:

- **Desde el panel de la app:** caso de uso de WhatsApp → **Plantillas de mensajes** (*Message templates*) → **Crear plantilla**.
- **Desde WhatsApp Manager:** [business.facebook.com/wa/manage/message-templates](https://business.facebook.com/wa/manage/message-templates/) (o el menú de herramientas del negocio → **Administrador de WhatsApp** → **Plantillas de mensajes**). Si Meta te pide elegir la cuenta, selecciona la de prueba.

### Datos comunes a todas las plantillas

| Campo | Valor |
|---|---|
| **Categoría** (*Category*) | **Utilidad** (*Utility*) |
| **Idioma** (*Language*) | **Español** (código `es`). No «Español (México)» ni «Inglés». |
| Encabezado y pie | Ninguno |
| Botones | Ninguno, salvo en las plantillas 4 y 5 (tres botones de **Respuesta rápida**, ver abajo) |
| Tipo de variable | Número (`{{1}}`, `{{2}}`…), no nombre |

### Plantilla 1: confirmación de cita

Nombre: `cita_confirmada`

Cuerpo (se pega tal cual):

```
MedCita: Hola {{1}}, tu cita con {{2}} ha sido agendada para el {{3}} a las {{4}}. ¡Te esperamos!
```

Ejemplos de las variables (Meta los pide para revisar): `{{1}}` María Andrade · `{{2}}` Dr. Santiago Pérez · `{{3}}` 2026-10-21 · `{{4}}` 10:00

### Plantilla 2: recordatorio

Nombre: `recordatorio_cita`

Cuerpo (se pega tal cual):

```
Recordatorio MedCita: Hola {{1}}, tienes una cita {{2}} a las {{3}} con {{4}}. Si no puedes asistir, avísanos con anticipación para liberar el horario. ¡Gracias!
```

Ejemplos de las variables: `{{1}}` María Andrade · `{{2}}` mañana 2026-10-21 · `{{3}}` 10:00 · `{{4}}` Dr. Santiago Pérez

### Plantilla 3 (opcional): recordatorio con la dirección y las indicaciones

Nombre: `recordatorio_cita_consultorio`

Cuerpo (se pega tal cual):

```
Recordatorio de {{1}}: Hola {{2}}, tienes una cita {{3}} a las {{4}} con {{5}}. Dónde y cómo llegar: {{6}}. Si no puedes asistir, avísanos con anticipación para liberar el horario. ¡Gracias!
```

Ejemplos de las variables: `{{1}}` Consultorio MedCita · `{{2}}` María Andrade · `{{3}}` mañana 2026-10-21 · `{{4}}` 10:00 · `{{5}}` Dr. Santiago Pérez · `{{6}}` Av. Amazonas N34-12, Quito. Llegar 10 minutos antes y traer la cédula

La usan los consultorios que escribieron una dirección o indicaciones en **Settings → Reminders**. No se usa hasta que esté aprobada **y** definas `META_WHATSAPP_TEMPLATE_REMINDER_DETAILED=recordatorio_cita_consultorio` en Render; mientras tanto se envía la plantilla 2 y la dirección va solo por correo. Tiene 6 variables, así que Meta puede rechazarla por «demasiadas variables»: si pasa, acorta lo que va en `{{6}}` o alarga el texto (y cambia el mismo texto en `whatsappTemplates.js`).

### Plantillas 4 y 5 (opcionales): el recordatorio con botones

Son el recordatorio sencillo y el recordatorio con dirección, **más tres botones** para que el paciente confirme, cancele o pida otro horario con un toque. No las crees hasta tener claro el paso 12: se usan solo cuando el webhook ya funciona.

Plantilla 4. Nombre: `recordatorio_cita_botones`

```
Recordatorio MedCita: Hola {{1}}, tienes una cita {{2}} a las {{3}} con {{4}}. Toca uno de los botones para confirmar, cancelar o pedir otro horario. ¡Gracias!
```

Ejemplos de las variables: los mismos de la plantilla 2.

Plantilla 5. Nombre: `recordatorio_cita_consultorio_botones`

```
Recordatorio de {{1}}: Hola {{2}}, tienes una cita {{3}} a las {{4}} con {{5}}. Dónde y cómo llegar: {{6}}. Toca uno de los botones para confirmar, cancelar o pedir otro horario. ¡Gracias!
```

Ejemplos de las variables: los mismos de la plantilla 3.

**Botones (en las dos).** En el creador, sección **Botones** (*Buttons*) → **Agregar botón**. En el panel en español, la respuesta rápida se llama **«Personalizado»** (las otras opciones son «Ir al sitio web», «Llamar a WhatsApp», «Llamar a número de teléfono» y «Compartir info. de contacto», y no sirven). Agrégalo tres veces, con estos textos exactos y en este orden: `Confirmo`, `Cancelar`, `Cambiar hora`. El orden importa: MedCita manda un identificador distinto a cada uno según su posición (0, 1 y 2). No uses botones de «Llamar» ni de enlace. Cada botón lleva, además, un identificador firmado de la cita que MedCita agrega al enviar: nada de eso se escribe en Meta.

### Pasos en el creador (para cada plantilla)

1. **Crear plantilla**. Elige la categoría **Utilidad** y pulsa continuar.
2. Escribe el **nombre** (solo minúsculas, números y guiones bajos). Elige el idioma **Español**.
3. En el cuerpo, pega el texto de arriba. Si el editor no convierte `{{1}}` en variables por sí solo, usa **Agregar variable** en cada posición, en el mismo orden.
4. En **Ejemplos de contenido** (*Sample content*), escribe un valor de ejemplo por variable.
5. Pulsa **Enviar** (*Submit*). El estado pasa a **En revisión** (*In review*).

### Lo que nos costó tiempo

1. **El idioma por defecto puede ser inglés.** Si se crea en inglés, existe una plantilla `cita_confirmada` en `en`, pero el código pide `es`, y el envío falla con el error 132001. El idioma no se puede cambiar: hay que **crear otra** en español (el mismo nombre admite varios idiomas). Las versiones en inglés no estorban.
2. **Meta rechaza plantillas con demasiadas variables para su longitud** («demasiadas variables en relación con su longitud») y no admite una variable **al principio ni al final** del texto. Por eso el recordatorio tiene 4 variables (día y fecha juntos en `{{2}}`) y cierra con una frase. No simplifiques los textos sin revisar el código.
3. **Las variables van por posición.** El código manda los valores en el orden `{{1}}…{{4}}` de arriba. Si cambias el orden o el texto, cambia también `backend/src/services/whatsappTemplates.js`, y la plantilla se vuelve a revisar.
4. **Si Meta cambia la categoría a Marketing**, el texto suena promocional. Edítalo para que sea solo informativo.
5. **La revisión es automática, pero tarda de minutos a 24 h** (en S7-06 pasó de medio día; el 19-oct-2026 las dos plantillas quedaron aprobadas en español y en inglés). Solo las plantillas **Aprobadas** se pueden enviar. No hay nada que hacer salvo esperar y recargar la pantalla; Meta también avisa por correo y en la bandeja de alertas del panel.

6. **El estado «Activa: calidad pendiente» es el de una plantilla aprobada** que todavía no tiene envíos con los que medir su calidad. No requiere ninguna acción.
7. **No pulses «Editar plantilla» mientras está en revisión:** cada edición reinicia la revisión.
8. **El recordatorio de prueba mostraba un guion** («tienes una cita - a las 10:00») porque `npm run whatsapp:test` no armaba el día y la fecha como un solo valor. Corregido en el PR #93; el envío real de recordatorios nunca tuvo ese defecto.

### Lo que pasó al registrar la plantilla 4 (22-oct-2026)

Registrada y enviada a revisión el 22-oct-2026; el resultado se anota aquí cuando Meta responda.

1. **«La plantilla contiene parámetros variables con formato incorrecto».** El cuerpo con `{{1}}` en rojo y ese error significa que el editor espera variables **con nombre** (`{{customer_name}}`) y nosotros usamos **numéricas**. Cambia el *tipo de parámetro variable* a **Número** (más arriba en el mismo formulario) y vuelve a pegar el texto; si sigue, borra el cuerpo y usa **Agregar variable** en cada posición. Al hacerlo aparece «Muestras de variables» con `{{1}}` a `{{4}}`: rellena las cuatro.
2. **El botón se llama «Personalizado»**, no «Respuesta rápida». Tras agregarlo, la sección se titula «Respuesta rápida» y la vista previa muestra los botones bajo el mensaje.
3. **Un aviso sobre el encabezado y la plantilla no se creó.** Al enviar, Meta mostró un mensaje diciendo que faltaba el encabezado y la plantilla **no quedó ni como borrador** (se comprobó marcando los 11 estados del filtro). Hay que volver a crearla. El encabezado y el pie son opcionales: se enviaron vacíos y con «Muestra de contenido multimedia: Ninguna» y a la segunda salió «En revisión». No se anotó el texto exacto del aviso; si vuelve a aparecer, cópialo aquí.
4. **La lista oculta las plantillas por filtro** (estado y «Últimos 7 días»). Para comprobar que existe una, marca todos los estados del filtro y busca por nombre.

### Ver el estado por línea de comandos

Con el token (pasos 6 o 7) y el WABA anotado. Es solo lectura, no envía nada:

```bash
curl -s -H "Authorization: Bearer $META_WHATSAPP_TOKEN" \
  "https://graph.facebook.com/v21.0/<WABA_ID>/message_templates?fields=name,language,status,rejected_reason"
```

Busca `cita_confirmada` y `recordatorio_cita` con `"language":"es"` y `"status":"APPROVED"`.

## 6. Token temporal (solo para probar de inmediato)

1. En **Configuración de la API → Paso 1. Pruébalo**, pulsa **Generar token de acceso** (*Generate access token*).
2. En el diálogo de Facebook, elige la cuenta de WhatsApp de prueba y su número, y continúa.
3. Copia el token (empieza por `EAA…`).

**Dura cerca de 1 hora**, aunque el panel diga 24 h. Al vencer, Meta responde con el **error 190** («Session has expired») y se genera otro. Sirve para comprobar el envío; **no se deja en Render**.

## 7. Token de usuario del sistema (el que va en Render)

Se crea en [business.facebook.com](https://business.facebook.com) → **Configuración del negocio** (*Business settings*), con el mismo portfolio del paso 2.

### 7.1 La app debe pertenecer al portfolio

**Cuentas → Apps**. Debe aparecer la app (por ejemplo «MedCita», «Propiedad de MedCita»). Si no está, **Agregar → Conectar un ID de app** y escribe el ID de la app.

### 7.2 Crear el usuario del sistema

1. **Usuarios → Usuarios del sistema → Agregar** (*System users → Add*).
2. Nombre `medcita-backend`, rol **Administrador** (*Admin*). Crear.

### 7.3 Asignarle la app y la cuenta de WhatsApp

1. Selecciona el usuario `medcita-backend` y pulsa **Asignar activos** (*Assign assets*).
2. En **Apps**, marca la app y activa **Acceso total → Todo**.
3. En **Cuentas de WhatsApp**, marca la cuenta (por ejemplo «Test WhatsApp Business Account») y activa **Acceso total → Todo**.
4. Comprueba que abajo diga **«2 activos seleccionados»** y pulsa el botón azul **Asignar activos**.
5. La lista «Activos asignados» a veces **aparece vacía justo después**: recarga la página (F5) y mira también la pestaña **Apps instaladas**.

### 7.4 Generar el token

1. Con el usuario seleccionado, **Generar token** (*Generate token*).
2. En **Seleccionar app**, elige la app. Si no aparece, la asignación del paso 7.3 no se guardó.
3. Si Meta ofrece **Vencimiento del token**, elige **Nunca**; si no lo ofrece, ver «Vencimiento» abajo.
4. Marca los permisos `whatsapp_business_messaging` y `whatsapp_business_management`.
5. **Generar** y **copia el token en ese momento**: Meta lo muestra **una sola vez**.

### Vencimiento

Mientras el negocio no esté verificado, Meta no ofrece la opción de no caducar y el token dura **60 días**. En S7-06 se generó con esa duración, que alcanza para pruebas. Para saber cuándo vence, consulta con el mismo token:

```bash
curl -s -H "Authorization: Bearer $META_WHATSAPP_TOKEN" \
  "https://graph.facebook.com/v21.0/debug_token?input_token=$META_WHATSAPP_TOKEN"
```

`expires_at` va en segundos Unix (`date -u -d @<valor>` lo convierte); `0` significa que no vence. `is_valid` debe ser `true`, `type` debe ser `SYSTEM_USER` y `scopes` debe incluir los dos permisos de WhatsApp. **Anota la fecha de vencimiento en el calendario del equipo**: al vencer, los envíos fallan con el error 190 y no hay respaldo automático a Twilio.

### Si sale «No hay permisos disponibles»

El asistente de Meta responde que hacen falta método de pago, verificación del negocio y modo Live. Esos requisitos son de **producción con un número real**, no de las pruebas con el número de prueba. En S7-06 el error desapareció con estos dos puntos:

- la app pertenece al portfolio (7.1);
- al usuario del sistema se le asignaron la **app y** la **cuenta de WhatsApp**, ambas con acceso total (7.3).

Si sigue igual, revisa en el panel de la app, **Casos de uso → Personalizar → Permisos y funciones**, que los dos permisos de WhatsApp estén agregados.

## 8. Variables de entorno

| Dónde | Variable | Valor |
|---|---|---|
| Render (servicio backend) y, para probar en local, `backend/.env` | `META_WHATSAPP_TOKEN` | El token del paso 7 (sin comillas ni espacios) |
| igual | `META_WHATSAPP_PHONE_NUMBER_ID` | El Phone Number ID del paso 3 |
| igual (opcionales) | `META_WHATSAPP_TEMPLATE_CONFIRMATION`, `META_WHATSAPP_TEMPLATE_REMINDER`, `META_WHATSAPP_TEMPLATE_REMINDER_DETAILED` (solo cuando la plantilla 3 esté aprobada), `META_WHATSAPP_TEMPLATE_LANGUAGE` | Solo si usaste otros nombres de plantilla o idioma. Por defecto: `cita_confirmada`, `recordatorio_cita` y `es`. |

**Respuestas con botones (S9-02), todas opcionales** (el orden de activación está en el paso 12):

| Dónde | Variable | Valor |
|---|---|---|
| Render y `backend/.env` | `META_APP_SECRET` | El *App secret* de la app (panel de la app → **Configuración de la app → Básica**, botón «Mostrar»). Es una credencial |
| igual | `META_WEBHOOK_VERIFY_TOKEN` | Un texto largo y al azar que tú inventas (por ejemplo, `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`). Lo escribes igual en el panel de Meta (paso 12) |
| igual | `META_WHATSAPP_TEMPLATE_REMINDER_BUTTONS`, `META_WHATSAPP_TEMPLATE_REMINDER_DETAILED_BUTTONS` | `recordatorio_cita_botones` y `recordatorio_cita_consultorio_botones`. **Solo cuando la plantilla esté aprobada y el webhook verificado.** Sin definir, el recordatorio sale sin botones |

En Render: servicio del backend → **Environment** → agrega las variables → guarda (se redespliega solo).

Con `META_WHATSAPP_TOKEN` y `META_WHATSAPP_PHONE_NUMBER_ID` definidos, Meta tiene prioridad sobre Twilio. Para dejar de usar Twilio, borra las variables `TWILIO_*`.

**El token es una credencial.** Nunca va en el repositorio, en un issue, en un PR ni en un chat. `backend/.env` está ignorado por git: comprueba que no aparezca en `git status` antes de hacer commit. Si se expone, revócalo (Configuración del negocio → Usuarios del sistema → **Revocar tokens**) y genera otro.

## 9. Comprobar que funciona

**1. Con una plantilla de ejemplo de Meta** (ya viene aprobada, no depende de las nuestras). Confirma el token, la lista de testers y el envío:

```bash
curl -s -X POST "https://graph.facebook.com/v21.0/$META_WHATSAPP_PHONE_NUMBER_ID/messages" \
  -H "Authorization: Bearer $META_WHATSAPP_TOKEN" -H "Content-Type: application/json" \
  -d '{"messaging_product":"whatsapp","to":"593XXXXXXXXX","type":"template","template":{"name":"hello_world","language":{"code":"en_US"}}}'
```

La respuesta trae `"message_status": "accepted"` y el mensaje «Hello World» llega al teléfono **sin que nadie le haya escrito antes al número**. El número va sin `+`.

**2. Con las plantillas de MedCita aprobadas**, desde `backend/`:

```bash
npm run whatsapp:test -- +593XXXXXXXXX             # confirmación
npm run whatsapp:test -- +593XXXXXXXXX reminder    # recordatorio
```

Debe imprimir `Provider: Meta Cloud API`, el nombre de la plantilla y `OK: Meta Cloud API accepted the message`. Si falla, el error de Meta sale en las líneas anteriores con una pista. El script lee `backend/.env`; si solo hay mock configurado, termina con error en vez de simular un envío.

**3. De punta a punta:** agenda una cita con tu número como paciente y espera el WhatsApp de confirmación. El recordatorio sale cuando faltan menos de 24 h para la cita.

> «accepted» solo significa que Meta recibió la petición. Que el mensaje llegó se comprueba en el teléfono.

## 10. Pasar a un número real (producción)

El número de prueba sirve para validar, no para pacientes (solo 5 destinatarios). Los puntos siguientes dependen de la cuenta del negocio y **no se probaron en S7-06**: confírmalos con la documentación vigente de Meta.

- [ ] **Verificación del negocio** (Configuración del negocio → Centro de seguridad). Sube los límites de envío y habilita el token sin vencimiento.
- [ ] **Número propio** que no esté activo en la app normal de WhatsApp, con su nombre visible aprobado.
- [ ] **Método de pago** en la cuenta de WhatsApp Business.
- [ ] **Plantillas aprobadas en la cuenta del número real.** Pertenecen a la cuenta de WhatsApp Business: si el número queda en otra cuenta, se registran de nuevo (paso 5).
- [ ] Actualizar `META_WHATSAPP_PHONE_NUMBER_ID` (y el token) en Render.
- [ ] **Consentimiento del paciente.** Meta pide que haya aceptado recibir mensajes del negocio. Hoy el formulario de la cita no lo pregunta ni lo guarda.
- [ ] Revisar la **tarifa vigente**. Los mensajes de *utilidad* enviados fuera de la ventana de 24 h se cobran por mensaje; Ecuador cae en «Resto de Latinoamérica». Una referencia de terceros (julio de 2026) da unos US$0,011 por mensaje, es decir, unos US$0,02 por cita con confirmación y recordatorio; no es un precio. Meta actualiza las tarifas cada trimestre: [developers.facebook.com/docs/whatsapp/pricing](https://developers.facebook.com/docs/whatsapp/pricing).

## 11. Problemas frecuentes

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| Error 190 | Token temporal vencido (1 h) o token de 60 días vencido | Generar uno nuevo (paso 6 o 7) y actualizar `META_WHATSAPP_TOKEN` |
| Error 131030 | El número no está en la lista de testers | Paso 4 |
| Error 132001 | Plantilla sin aprobar, con otro nombre o en otro idioma | Revisar estado, nombre e idioma `es` (paso 5) |
| Error 132000 / 132012 | El texto o las variables no coinciden con el código | Registrar la plantilla con el texto exacto del paso 5 |
| Error 132015 / 132016 | Plantilla pausada o deshabilitada por calidad | Editarla o crear otra |
| Error 131047 | Texto libre fuera de la ventana de 24 h | No debería pasar con plantillas: avisa si lo ves |
| La lista de activos del usuario del sistema aparece vacía | La vista no se refrescó o no se guardó | Recargar; si sigue vacía, repetir el paso 7.3 |
| «No hay permisos disponibles» al generar el token | App fuera del portfolio o sin cuenta de WhatsApp asignada | Ver el final del paso 7 |
| La plantilla se queda «En revisión» | Revisión de Meta (minutos a 24 h) | Esperar; si pasan 24 h, revisar «Acciones requeridas» en el panel |
| Se envió «aceptado» pero no llegó nada | El número no está en la lista, o el teléfono no recibió la notificación | Revisar el paso 4 y el teléfono |
| Meta dice que no pudo verificar la URL o el token del webhook | `META_WEBHOOK_VERIFY_TOKEN` distinto al del panel, sin definir o sin redesplegar; o la URL no termina en `/api/webhooks/whatsapp` | Paso 12. Una respuesta `503` de esa URL significa que falta la variable en Render |
| El paciente toca un botón y no pasa nada | El campo `messages` no está suscrito; `META_APP_SECRET` mal copiado (los logs no muestran la llamada: responde `403`); o el recordatorio ya pasó, se movió o vino de otro número | Paso 12; mira el historial de mensajes de la cita: ahí queda anotado por qué no se cambió nada |
| El recordatorio sale sin botones | Falta `META_APP_SECRET`, o la variable de la plantilla con botones, o el nombre no coincide | Paso 12 y la tabla del paso 8 |
| Los envíos fallan y no llega nada en producción | El backend **no** cae a Twilio cuando Meta responde con error | Revisar los logs del backend: guardan el código de Meta y una pista, sin el número completo |

## 12. Respuestas con botones (webhook)

Con la plantilla con botones, el paciente responde el recordatorio con un toque y MedCita actúa:

| Botón | Qué hace MedCita | Qué le dice al paciente |
|---|---|---|
| **Confirmo** | La cita pasa a *confirmed* | «…quedó confirmada. Te esperamos.» |
| **Cancelar** | La cita se cancela y el horario queda libre | «Cancelamos tu cita… Si quieres agendar otra, comunícate con el consultorio.» |
| **Cambiar hora** | La cita **no se mueve**: se avisa por correo a los administradores y secretarias del consultorio para que contacten al paciente | «Recibimos tu solicitud… Hasta entonces, tu cita sigue el…» |

La respuesta al paciente es un mensaje de texto libre, que Meta entrega porque el paciente acaba de escribir (ventana de 24 h). No se hace nada, y solo queda anotado en el historial de la cita, cuando la cita ya no admite el cambio: está cancelada o cerrada, ya pasó, se movió después del recordatorio, el toque vino de **otro número** (un recordatorio reenviado) o es un repetido. Un texto libre que escriba el paciente no se interpreta.

**Cómo funciona por dentro.** Meta llama a `POST https://<tu-backend>/api/webhooks/whatsapp` con cada mensaje que recibe el número. Esa llamada viene firmada con el *App secret* (`X-Hub-Signature-256`) y MedCita **rechaza con 403 toda llamada cuya firma no coincida**. Cada botón lleva dentro un identificador firmado de **una cita** (no el teléfono: el mismo número puede ser paciente de dos consultorios) y de su fecha y hora, así que un botón de un recordatorio viejo no actúa sobre una cita que se movió.

### Orden para activarlo

1. **Variables.** En Render pon `META_APP_SECRET` y `META_WEBHOOK_VERIFY_TOKEN` (paso 8) y espera el redespliegue.
2. **El webhook en Meta** (recorrido verificado el 22-oct-2026 en el panel en español):
   - Panel de la app → menú izquierdo **Casos de uso** → en «Conectarte con los clientes a través de WhatsApp», **Personalizar**.
   - En el menú de ese caso, bajo **Configuración básica**, **Paso 2: Configuración de producción** → bloque **Configurar webhooks**. (El «Paso 1. Pruébalo» y «Permisos y funciones» no son: no toques «Generar token» ni «Agregar» permisos.)
   - **URL de devolución de llamada** (*Callback URL*): `https://<tu-backend>.onrender.com/api/webhooks/whatsapp`
   - **Token de verificación** (*Verify token*): el mismo valor de `META_WEBHOOK_VERIFY_TOKEN`. Antes de pegarlo, compruébalo abriendo en el navegador `https://<tu-backend>.onrender.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=<TOKEN>&hub.challenge=12345`: debe mostrar solo `12345` (403: el token no coincide; 503: falta una variable en Render).
   - Deja apagado el interruptor del certificado de cliente y pulsa **Verificar y guardar**. Al guardarse, «Configurar webhooks» muestra un **tick verde**. Si dice que no pudo validar la URL, mira la tabla del paso 11.
3. **Suscribir el campo.** Más abajo, en **Campos del webhook**, todos aparecen «No suscritos». Activa **solo `messages`** (el que trae las respuestas de los botones; la lista es larga y está en orden alfabético). Meta avisa «Se suscribió correctamente al campo del webhook messages». Los demás no hacen falta. Opcional: **Probar** en esa fila → «Enviar al servidor»: Meta debe mostrar «Se probó correctamente», y MedCita responde 200 sin hacer nada (es un mensaje de ejemplo).
4. **La plantilla con botones.** Crea la 4 (y la 5, si usas direcciones) del paso 5 y espera a que quede **Aprobada**.
5. **Activarla.** En Render pon `META_WHATSAPP_TEMPLATE_REMINDER_BUTTONS` (y `…_DETAILED_BUTTONS`). Desde el **siguiente** recordatorio de cada cita sale con botones.

> **Aviso de Meta: la app sin publicar.** En esa misma pantalla, un aviso naranja dice que mientras la app esté **sin publicar** (*Publicar: Sin publicar*), solo recibirá webhooks de **prueba** enviados desde el panel, y que **no se entregarán datos de producción**, ni los de administradores, desarrolladores o evaluadores de la app. Eso significa que **un toque real de un botón puede no llegar a MedCita hasta que se publique la app** (modo *live*). La verificación y la suscripción del webhook funcionan igual. **Pendiente de comprobar** con la primera plantilla con botones aprobada; si el toque no llega, es esto. Publicar una app pide requisitos de Meta (política de privacidad, etc.) y no se ha revisado si tiene costo: confírmalo antes de decidir.

### Probar con el número de prueba

1. Agrega tu teléfono a la lista de destinatarios (paso 4) y agenda una cita **a tu nombre y con tu número en formato internacional (`+593985…`, sin el 0 inicial)** para dentro de unas 20 horas, en un consultorio de pruebas.
2. Dispara el recordatorio sin esperar la hora: como administrador, `POST /api/tasks/reminders` (con Postman o curl; si no, el cron de cada hora lo hace cuando la cita entre en la ventana).
3. En tu teléfono debe llegar el recordatorio **con tres botones**. Toca cada uno (agenda otra cita para el siguiente) y comprueba el efecto y la respuesta.
4. En la cita → **Messages** se ven las respuestas del paciente, y en **Audit log** aparece «Patient (WhatsApp)».

En local, sin Meta, el mismo flujo se prueba con `npm run whatsapp:reply -- <id de la cita> confirm` (ver [qa/S9-02-guia-de-pruebas.md](qa/S9-02-guia-de-pruebas.md)).

### Lo que NO se sabe todavía

Se verificó con llamadas simuladas, firmadas como Meta. **No se ha probado** con Meta de verdad: que acepte las plantillas con botones (puede pedir ajustes de texto, como pasó con la de 6 variables), el nombre exacto de los menús del panel y el formato final de la llamada con el número de prueba. Si algo difiere, corrige este documento.
