# Guía de configuración: WhatsApp con Meta Cloud API

Guía completa, paso a paso, para que el equipo configure el envío de WhatsApp de MedCita (confirmación de cita y recordatorio de 24 h) con **sus propias cuentas de Meta**. Se escribió a partir de la configuración real hecha en el ticket S7-06 (#75), con los tropiezos incluidos.

- **Qué resuelve.** MedCita inicia la conversación con el paciente, y Meta solo permite eso con **plantillas aprobadas**. El texto libre únicamente se entrega dentro de las 24 h posteriores a que el paciente escribió. El código ya envía ambos mensajes como plantilla; esta guía cubre lo que se hace **fuera del código**.
- **Referencia técnica.** [DEPLOY.md, sección 7](DEPLOY.md): variables de entorno y tabla de errores. Si algo difiere entre los dos documentos, manda el que se haya actualizado después; los textos de las plantillas están en ambos y un test comprueba que coincidan con el código.
- **Sin Meta no se rompe nada.** Si no hay credenciales de Meta, el backend usa Twilio y, si tampoco hay, el modo mock (solo registra en el log). Para decidir entre Meta y Twilio, con la tabla comparativa y cómo cambiar de uno a otro, ver [DEPLOY.md, sección 7.0](DEPLOY.md). Esta guía es solo para quien elige **Meta**.
- **Estado verificado (21-oct-2026).** Con esta configuración, una cita agendada desde el sitio desplegado envió la plantilla `cita_confirmada` y llegó al teléfono de prueba. Evidencia en [`qa/S7-12-production-evidence.md`](qa/S7-12-production-evidence.md).
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

MedCita usa dos plantillas. **Se crean desde el principio en español**, y se crean **ahora** porque la revisión de Meta es la parte más lenta.

### Cómo abrir el creador de plantillas

Hay dos rutas, equivalentes:

- **Desde el panel de la app:** caso de uso de WhatsApp → **Plantillas de mensajes** (*Message templates*) → **Crear plantilla**.
- **Desde WhatsApp Manager:** [business.facebook.com/wa/manage/message-templates](https://business.facebook.com/wa/manage/message-templates/) (o el menú de herramientas del negocio → **Administrador de WhatsApp** → **Plantillas de mensajes**). Si Meta te pide elegir la cuenta, selecciona la de prueba.

### Datos comunes a las dos plantillas

| Campo | Valor |
|---|---|
| **Categoría** (*Category*) | **Utilidad** (*Utility*) |
| **Idioma** (*Language*) | **Español** (código `es`). No «Español (México)» ni «Inglés». |
| Encabezado, pie y botones | Ninguno |
| Tipo de variable | Número (`{{1}}`, `{{2}}`…), no nombre |

### Plantilla 1: confirmación de cita

Nombre: `cita_confirmada`

Cuerpo (se pega tal cual):

```
MedCita: Hola {{1}}, tu cita con {{2}} ha sido agendada para el {{3}} a las {{4}}. ¡Te esperamos!
```

Ejemplos de las variables (Meta los pide para revisar): `{{1}}` María Andrade · `{{2}}` Dr. Santiago Pérez · `{{3}}` 2026-10-21 · `{{4}}` 10:00

### Plantilla 2: recordatorio de 24 h

Nombre: `recordatorio_cita`

Cuerpo (se pega tal cual):

```
Recordatorio MedCita: Hola {{1}}, tienes una cita {{2}} a las {{3}} con {{4}}. Si no puedes asistir, avísanos con anticipación para liberar el horario. ¡Gracias!
```

Ejemplos de las variables: `{{1}}` María Andrade · `{{2}}` mañana 2026-10-21 · `{{3}}` 10:00 · `{{4}}` Dr. Santiago Pérez

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
| igual (opcionales) | `META_WHATSAPP_TEMPLATE_CONFIRMATION`, `META_WHATSAPP_TEMPLATE_REMINDER`, `META_WHATSAPP_TEMPLATE_LANGUAGE` | Solo si usaste otros nombres de plantilla o idioma. Por defecto: `cita_confirmada`, `recordatorio_cita` y `es`. |

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
| Los envíos fallan y no llega nada en producción | El backend **no** cae a Twilio cuando Meta responde con error | Revisar los logs del backend: guardan el código de Meta y una pista, sin el número completo |
