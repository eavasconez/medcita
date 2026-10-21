# Lo que debe validar un abogado antes de usar MedCita con datos de salud reales

> Escrito por el equipo técnico. **No es asesoría legal**: son las preguntas que la técnica no puede responder y lo que el producto hace hoy, para que la revisión sea rápida. Marcado como `[verificar]` lo que el equipo cree pero no confirmó en la norma.

## 0. Qué hace MedCita con los datos (resumen para quien revisa)

- Pacientes de cada consultorio: nombre, cédula (opcional), teléfono, correo (opcional), citas con notas libres que escribe el personal (pueden contener datos de salud) y el registro del consentimiento.
- Envía confirmaciones y recordatorios por WhatsApp (Meta) y correo (Brevo, con SendGrid y Twilio de respaldo). No guarda el texto de los mensajes ni la dirección completa.
- Servidor en Render y base en Neon (Estados Unidos `[verificar la región exacta]`). Archivos clínicos: aún no se suben; el almacenamiento (bucket S3) está listo pero vacío.
- Todavía **no hay historia clínica** (notas de evolución, diagnósticos, recetas): está planificada para después de esta revisión.

## 1. Preguntas que el abogado debe responder

### 1.1 Conservación de la historia clínica
- ¿Qué **plazo mínimo** exige la normativa del Ministerio de Salud Pública para conservar la historia clínica y desde cuándo corre (última atención, muerte, mayoría de edad)? El equipo **no pudo confirmarlo** en fuentes oficiales y no quiere inventarlo: `[verificar]` el manual de manejo de historias clínicas del MSP vigente.
- ¿Qué se hace **al vencer el plazo**: borrar, anonimizar o archivar? ¿Y qué pasa con los datos de citas que no son historia clínica (teléfono, correo)?
- ¿Cómo se concilia el **derecho de eliminación** con esa obligación de conservar? Hoy MedCita **no deja borrar** un paciente con citas.
- ¿Quién conserva la historia si un **consultorio se da de baja** de MedCita y cómo se la entregamos?

### 1.2 Transferencia internacional de datos
- Neon y Render (y Meta, SendGrid, Twilio) tratan datos **fuera de Ecuador**. ¿Qué **garantías** exige la LOPDP para transferir datos de salud: país con nivel adecuado, cláusulas contractuales, consentimiento específico? ¿Basta con el texto actual del consentimiento («servidores fuera de Ecuador»)?
- ¿Conviene **contratar región** más cercana o con acuerdos de protección (por ejemplo, otra región de Neon) y qué contratos de encargo hay que firmar con cada proveedor (acuerdos de tratamiento de datos)?

### 1.3 Roles
- ¿Es correcto que el **consultorio sea responsable** y **MedCita encargado**, y MedCita responsable solo de las cuentas del personal? ¿Hace falta un **contrato de encargo** entre MedCita y cada consultorio (los términos de uso hacen de eso o se necesita uno aparte)?
- ¿Hay que **designar un delegado de protección de datos** (por el tratamiento de datos de salud a escala) y quién puede serlo?
- ¿Hay que **inscribirse o registrar** algo ante la Superintendencia de Protección de Datos Personales, o llevar un registro de actividades de tratamiento? ¿Cuál `[verificar]`?

### 1.4 Base legal y consentimiento
- ¿El **consentimiento** es la base adecuada para los datos de salud o aplica otra (atención de salud, obligación legal)? ¿Debe ser **por escrito**, **por cada finalidad**, **separado** de otros textos?
- ¿Es válido el **consentimiento verbal** y el registrado por el personal (hoy se ofrecen «firmado en papel», «verbal», «electrónico» y «otro»)? ¿Qué evidencia hay que guardar de cada uno (la firma en papel hoy no se escanea ni se sube)?
- ¿Se puede **agendar una cita sin consentimiento**? Hoy MedCita lo permite y solo muestra el estado en Pacientes. ¿Hay que **bloquear** hasta tenerlo?
- Los **recordatorios por WhatsApp y correo**: ¿requieren su propio consentimiento o aviso (comunicaciones comerciales vs. transaccionales)?
- **Menores de edad e incapaces**: ¿quién consiente por ellos y cómo se registra? Hoy no se distingue.

### 1.5 Contenido de los documentos
- Revisar y completar los marcados `[PENDIENTE]` en `politica-de-privacidad.md` (razón social, RUC, domicilio, contacto, delegado), `terminos-de-uso.md` (precio, responsabilidad, jurisdicción, nivel de servicio, qué pasa con los datos tras la baja) y `consentimiento-datos-salud.md`.
- ¿Debe el **personal aceptar los términos de forma registrada** al crear su cuenta o aceptar la invitación? Hoy se muestran como enlace, **sin registrar la aceptación**.
- Plazos de respuesta a los derechos de los titulares y contenido de la **notificación de brechas** (`procedimiento-derechos-de-titulares.md`, `procedimiento-brechas.md`). El plazo de **5 días (término)** para notificar a la Superintendencia y a los afectados, y de **2 días** del encargado al responsable, sale de lo que el equipo leyó en el texto de la ley `[verificar la cuenta del término y la redacción exacta]`.

### 1.6 Otros
- Retención del **registro de actividad** (Activity Log) y del historial de mensajes: hoy no se purgan nunca. ¿Qué plazo?
- Los **respaldos** de Neon (ramas y retroceso en el tiempo) contienen datos que «ya se borraron»: ¿cómo afecta al derecho de eliminación?
- Uso de **datos de pruebas**: staging se llena con datos ficticios; ¿alguna restricción más?

## 2. Qué ya hace el producto (para que no se vuelva a discutir)

| Tema | Estado |
|---|---|
| Consentimiento de datos de salud con versión, fecha, método y quién lo registró; historial que no se edita; retiro como evento nuevo | Hecho (Pacientes → «Consent») |
| Aviso de pacientes con consentimiento pendiente, retirado o desactualizado | Hecho (etiqueta en Pacientes) |
| Exportación de todos los datos de un paciente (acceso y portabilidad), solo administradores, con registro de auditoría | Hecho (`GET /api/patients/:id/export`) |
| Registro de quién entra y quién cambia qué (administración), IP y navegador | Hecho (S8-03) |
| Separación de datos entre consultorios, garantizada por la base de datos | Hecho (S8-01) |
| Contraseñas cifradas; enlaces de un solo uso guardados como huella | Hecho |
| Historial de mensajes sin su texto y con el destino parcialmente oculto | Hecho (S8-04) |
| Almacenamiento privado con URLs firmadas de 5 minutos | Listo, sin uso (S8-06) |
| Política de privacidad y términos públicos (`/privacy`, `/terms`) con aviso de borrador | Hecho; **falta la aprobación legal** |

## 3. Lo que NO está y conviene decidir

- Cifrado de datos **a nivel de campo** (hoy lo que protege es el cifrado en tránsito y el del proveedor de base de datos `[verificar]`).
- Autenticación en dos pasos para el personal.
- Un registro de solicitudes de titulares dentro de la aplicación.
- Borrado/anonimización automática al vencer plazos.
- Aceptación registrada de términos.

## 4. Cómo cerrar este ticket de verdad

1. El abogado responde la sección 1 y corrige los tres documentos.
2. Se actualizan los textos (si cambia el del consentimiento, **se sube la versión**: `backend/src/legal/healthDataConsent.js` y `consentimiento-datos-salud.md`).
3. Se pone `LEGAL_REVIEWED = true` en `frontend/src/config/legal.js` para quitar el aviso de borrador.
4. Recién entonces: pacientes reales y datos de salud reales.
