# Procedimiento ante una vulneración de seguridad de datos

> BORRADOR sin revisión legal. Interno.

Una **vulneración** (brecha) es cualquier hecho que expone, pierde, altera o destruye datos personales sin autorización: una base filtrada, una cuenta tomada, un archivo enviado a quien no debía, un servicio configurado como público, un dispositivo perdido con sesión abierta.

## Plazos que no se pueden perder

Según la LOPDP, el responsable debe notificar la vulneración a la **Superintendencia de Protección de Datos Personales** y, cuando haya riesgo para las personas, a los **afectados**, **tan pronto como sea posible y a más tardar en 5 días (término)** desde que se produce o se conoce, salvo que sea improbable que implique riesgo para los derechos de las personas. Si quien detecta la falla es el **encargado** (MedCita), debe avisar al **responsable (el consultorio) a más tardar en 2 días**. [PENDIENTE de revisión legal: confirmar cómo se cuentan los plazos, el contenido exacto de la notificación y los canales de la Superintendencia.]

> Como MedCita es el encargado de los datos de los pacientes, **la regla interna es avisar al consultorio afectado el mismo día** en que se confirma un incidente, sin esperar a entender todo.

## Pasos

1. **Detectar y anotar la hora.** Quién lo vio, cómo y desde cuándo (los logs de Render y la pantalla Activity Log ayudan).
2. **Contener.** Lo primero es parar el daño: cambiar o revocar credenciales y llaves (`JWT_SECRET` invalida todas las sesiones; las llaves de Neon, Brevo, Meta y del bucket se rotan en sus paneles), cerrar el acceso público de lo que se haya abierto, suspender la cuenta comprometida.
3. **Evaluar.** ¿Qué datos? ¿De cuántas personas y de qué consultorios? ¿Hay datos de salud? ¿Estaban cifrados o eran legibles? ¿Hay riesgo para los derechos de las personas (suplantación, discriminación, daño a la reputación)? Lo que se sabe de cada consultorio se obtiene de su Activity Log y de la base.
4. **Avisar al consultorio** afectado (≤ 2 días; el mismo día es la meta), con lo que se sabe y lo que se está haciendo.
5. **Notificar a la Superintendencia** y, si hay riesgo, **a los afectados** (≤ 5 días), a través del responsable. Contenido mínimo: qué pasó, cuándo, qué datos y a cuántas personas, qué riesgo hay, qué se hizo y qué pueden hacer ellas, y un contacto.
6. **Corregir y aprender.** Arreglar la causa, probar que quedó arreglada y escribir lo aprendido.
7. **Guardar el registro del incidente**, aunque no haya habido que notificar: fecha, descripción, datos afectados, decisión sobre notificar y por qué, y acciones.

## Plantilla del registro del incidente

| Campo | Contenido |
|---|---|
| Fecha y hora en que se supo / en que ocurrió | |
| Quién lo detectó y cómo | |
| Qué pasó | |
| Datos afectados (¿de salud?) y cuántas personas | |
| Consultorios afectados | |
| Contención aplicada y hora | |
| Se avisó al consultorio (cuándo y a quién) | |
| ¿Hay riesgo para las personas? Por qué | |
| Se notificó a la Superintendencia (cuándo) / a los afectados (cuándo) | |
| Causa raíz y corrección | |

## Con qué cuenta hoy

- Cada acceso y cambio del personal administrativo queda en Activity Log (con IP y navegador), y cada exportación de datos de un paciente.
- Los envíos de mensajes quedan en el historial de la cita.
- Las contraseñas están cifradas y los enlaces de un solo uso se guardan como huella.
- Neon permite recuperar la base a un punto anterior; Render conserva los logs de la aplicación un tiempo limitado.

**Lo que falta:** un responsable de seguridad designado con nombre y teléfono, y el contacto de la Superintendencia. [PENDIENTE]
