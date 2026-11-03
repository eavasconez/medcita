# Política de privacidad

**Última actualización: noviembre de 2026 · Versión 2026-11-v1**

MedCita es una plataforma de agenda médica para consultorios y clínicas de Ecuador. Este documento explica qué datos personales trata, para qué, con quién los comparte y qué puedes hacer con ellos.

## 1. Quién es quién

- **El consultorio** que te atiende es el **responsable del tratamiento** de los datos de sus pacientes: decide qué datos pide y para qué. Para ejercer tus derechos como paciente, dirígete a él.
- **MedCita** es el **encargado del tratamiento**: guarda y procesa esos datos por cuenta del consultorio, siguiendo sus instrucciones, y no los usa para fines propios.
- Respecto de **las cuentas del personal** (médicos, secretarias y administradores), el responsable es MedCita.
- Datos del responsable de MedCita: **{{empresa.razon_social}}**, RUC {{empresa.ruc}}, domicilio {{empresa.domicilio}}, correo {{empresa.correo_privacidad}}, teléfono {{empresa.telefono}}.

## 2. Qué datos tratamos

- **De los pacientes:** nombre, número de cédula (opcional), teléfono, correo (opcional), las citas (fecha, hora, estado y las notas de reserva que registre el consultorio) y el registro de su consentimiento. Además, si el consultorio los registra: fecha de nacimiento, sexo, dirección, ocupación, contacto de emergencia, seguro médico y, para menores de edad, los datos de su representante legal.
- **De la atención de salud** (historia clínica, si el consultorio la usa): antecedentes, alergias y medicación habitual, las notas de cada consulta y sus correcciones, los diagnósticos y los signos vitales (peso, talla, presión arterial, frecuencias, temperatura, saturación). **Son datos de salud, que la ley considera una categoría especial.** Solo los ven los médicos y administradores del consultorio, no la secretaría.
- **Del personal del consultorio:** nombre, correo, rol, contraseña (guardada de forma irreversible, nunca en texto claro) y el registro de sus acciones en la aplicación (inicios de sesión, desde qué dirección IP y navegador, qué hizo con citas, pacientes y cuentas y, en la historia clínica, qué paciente consultó o cambió y cuándo; nunca el contenido).
- **De los mensajes:** que se envió una confirmación o un recordatorio, por qué canal y si salió bien. **No guardamos el texto del mensaje** ni la dirección completa: el destino se guarda parcialmente oculto.

## 3. Para qué los usamos

- Agendar citas y enviar confirmaciones y recordatorios por WhatsApp y correo.
- Que el consultorio atienda y lleve el registro de su atención.
- Mantener la seguridad del servicio y detectar accesos indebidos.
- Atender las solicitudes de los titulares de los datos.

No usamos los datos para publicidad ni los vendemos. **No tomamos decisiones automatizadas** ni elaboramos perfiles de las personas con ellos.

## 3.1. De dónde vienen los datos y qué pasa si no se entregan

- Los datos de los pacientes **los registra el consultorio** (o el propio paciente al reservar una cita): MedCita no los pide directamente al paciente por otros medios. Los datos del personal los da cada persona al crear su cuenta.
- Dar los datos es voluntario, pero **sin los datos mínimos** (nombre y un teléfono o correo) el consultorio no puede agendar la cita ni avisarte de ella, y sin el consentimiento para los datos de salud no puede registrar tu historia clínica en MedCita.

## 4. Base de la que partimos

- Para los datos de salud de los pacientes, el **consentimiento** del paciente, que el consultorio registra en MedCita con la versión del texto que se le mostró, la fecha y quién lo obtuvo. Se puede retirar en cualquier momento.
- Para las cuentas del personal, la relación contractual con el consultorio.

[PENDIENTE de revisión legal: confirmar las bases de legitimación aplicables a cada tratamiento.]

## 5. Con quién se comparten (proveedores)

MedCita usa proveedores tecnológicos para operar. Procesan datos por cuenta nuestra y no pueden usarlos para fines propios:

- **Railway y Render**: alojamiento del servidor de la aplicación (Estados Unidos). Mientras dura la migración de uno a otro, el servicio puede estar en cualquiera de los dos.
- **Neon**: base de datos donde se guarda la información (Estados Unidos).
- **Meta (WhatsApp Business)**: envío de confirmaciones y recordatorios por WhatsApp.
- **Brevo**: envío de correos (invitaciones, recuperación de contraseña, avisos). [PENDIENTE: confirmar ubicación.]
- **SendGrid y Twilio**: respaldo de correo y de WhatsApp, solo si están activados.
- **Almacenamiento de archivos**: proveedor compatible con S3, que se activará cuando existan documentos clínicos. [PENDIENTE: proveedor y región.]

No compartimos datos con otros terceros salvo que una autoridad competente lo exija.

## 6. Transferencia fuera de Ecuador

Parte de estos proveedores tiene sus servidores fuera de Ecuador, principalmente en Estados Unidos. [PENDIENTE de revisión legal: garantías adecuadas para la transferencia internacional de datos de salud.]

## 7. Cuánto tiempo los conservamos

- Los datos de la atención de salud, el tiempo que exija la normativa de conservación de la historia clínica. [PENDIENTE de revisión legal: plazo aplicable.]
- Las cuentas del personal, mientras el consultorio esté activo.
- El registro de actividad de la aplicación, el tiempo necesario para la seguridad y el cumplimiento. [PENDIENTE: plazo.]

## 8. Cómo los protegemos

- Las contraseñas se guardan con cifrado irreversible; los enlaces de un solo uso (alta, invitación, recuperación) se guardan como huella y vencen.
- Cada consultorio solo ve sus propios datos: la aplicación filtra todo por consultorio y la base de datos rechaza enlazar datos de consultorios distintos.
- Las conexiones viajan cifradas (HTTPS) y los accesos con sesión caducan.
- Se registra quién inicia sesión, qué cambia el personal administrativo en citas, pacientes y cuentas, quién exporta los datos de un paciente y quién lee o cambia su historia clínica (sin copiar su contenido).
- La historia clínica solo es accesible para médicos y administradores, y la aplicación vuelve a comprobar su rol en cada consulta.
- Hay un procedimiento escrito para actuar ante una vulneración de seguridad, que incluye avisar a la autoridad y a los afectados en el plazo que fija la ley.

Ningún sistema es infalible: si ocurriera un incidente que afecte tus datos, te lo comunicaremos.

## 9. Tus derechos

Como titular de tus datos puedes pedir, al consultorio que te atiende:

- **Acceso**: saber qué datos tiene sobre ti y recibir una copia.
- **Rectificación y actualización**: corregir datos inexactos o desactualizados.
- **Eliminación** (cómo pedirla: {{empresa.sitio}}/data-deletion): que se borren, cuando proceda; los datos que la ley obliga a conservar (como la historia clínica) no pueden borrarse antes de su plazo.
- **Oposición** a un tratamiento y **suspensión** del tratamiento, cuando proceda.
- **Portabilidad**: recibir tus datos en un formato que se pueda reutilizar.
- **Retirar tu consentimiento** en cualquier momento, sin que afecte tu atención de salud.

Si sientes que no se respetaron tus derechos, puedes reclamar ante la **Superintendencia de Protección de Datos Personales**.

## 10. WhatsApp y correo

- **Solo mensajes de la cita.** Enviamos por WhatsApp y por correo la confirmación y el recordatorio de una cita: nombre del paciente, fecha, hora, médico y, si el consultorio lo configura, la dirección. **Nunca enviamos diagnósticos, resultados, recetas ni datos clínicos**, y no pedimos datos sensibles por esos canales.
- **Permiso previo.** El consultorio solo debe escribir a quien le dio su número y su consentimiento. El paciente puede responder al recordatorio con los botones «Confirmo», «Cancelar» o «Cambiar hora»; un mensaje de texto libre no se interpreta ni se guarda.
- **Dejar de recibir mensajes.** Pídelo al consultorio o escribe a {{empresa.correo_privacidad}}: dejarán de agendarte mensajes. Hoy no hay un comando automático para darse de baja desde el chat.
- WhatsApp es un servicio de Meta, que trata los mensajes según sus propias condiciones. MedCita no recibe datos de tu perfil de WhatsApp: solo el número que el consultorio registró.

## 11. Almacenamiento en tu navegador

MedCita **no usa cookies de seguimiento, ni publicidad, ni herramientas de analítica**. Para el personal que inicia sesión, la aplicación guarda en el almacenamiento local del navegador lo necesario para funcionar: la sesión (que caduca), los datos básicos del usuario y, por cuenta y consultorio, los últimos pacientes abiertos (solo identificador y nombre). Todo se borra al cerrar sesión. Las páginas públicas, como esta, no guardan nada.

## 12. Menores de edad

[PENDIENTE de revisión legal: tratamiento de datos de niños y adolescentes y quién da el consentimiento por ellos.]

## 13. Cambios en esta política

Si cambia, publicaremos aquí la versión nueva con su fecha. Si el cambio afecta al consentimiento de los pacientes, el consultorio volverá a pedirlo.

## 14. Contacto

Para asuntos de privacidad: **{{empresa.correo_privacidad}}** ({{empresa.razon_social}}, {{empresa.domicilio}}). Más datos en {{empresa.sitio}}/contact. Para pedir que se eliminen tus datos, mira las instrucciones en {{empresa.sitio}}/data-deletion.

[PENDIENTE de revisión legal: si corresponde designar un delegado de protección de datos.]
