# Procedimiento: un paciente pide sus datos (derechos de los titulares)

> BORRADOR sin revisión legal. Para uso interno del consultorio y del equipo de MedCita.

Un paciente puede pedir **acceso** a sus datos, su **rectificación**, su **eliminación**, **oponerse** a un tratamiento, su **suspensión** o su **portabilidad**, y retirar su consentimiento. La solicitud se hace **al consultorio** (el responsable); MedCita le da las herramientas y, si el consultorio se lo pide, ayuda a atenderla.

**Plazo de respuesta.** [PENDIENTE de revisión legal: plazo que fija la LOPDP y su reglamento para responder a cada derecho.] Mientras tanto, la regla interna es **responder lo antes posible y dejar anotada la fecha de recepción de la solicitud**.

## Paso a paso

1. **Recibir la solicitud** (en persona, por escrito, por correo o por WhatsApp) y anotar la fecha.
2. **Comprobar quién la hace.** Debe ser el paciente o su representante legal. Pide la cédula y compárala con la del registro; si hay duda, no entregues nada y pide más pruebas. Los datos de salud no se dan por teléfono a alguien que no se pueda identificar.
3. **Atenderla según el derecho:**

| Derecho | Cómo se atiende en MedCita |
|---|---|
| **Acceso** y **portabilidad** | Un administrador abre Pacientes → el paciente → **«Export PDF»** (un documento en español para leer y entregar) o el icono de descarga de JSON (para portabilidad). Incluye sus datos y ficha, citas (con las notas de reserva), mensajes enviados (sin su texto), el historial de consentimientos y **toda su historia clínica**: antecedentes, alergias, medicación, notas de consulta con sus diagnósticos y adendas, y signos vitales. Se entrega en persona o por un canal seguro. **Cada exportación queda en Activity Log** («Exported a patient's data», con quién y cuándo) |
| **Rectificación** | Pacientes → abrir la ficha → «Edit record». Los cambios del personal administrativo quedan en Activity Log. Una **nota de consulta cerrada no se edita**: el médico agrega una **adenda** con la corrección (queda con su fecha y su autor); un signo vital tomado por error se **anula** y se registra uno nuevo |
| **Retirar el consentimiento** | Pacientes → «Consent» → «Withdraw consent». Es una fila nueva en el historial; la anterior no se borra. El retiro no afecta la atención ni lo ya tratado |
| **Eliminación** | Un paciente **sin citas ni datos clínicos** se puede borrar (Pacientes → borrar). Uno **con citas, notas, alergias, antecedentes o signos vitales** no: son parte del registro de la atención y deben conservarse el plazo legal. [PENDIENTE de revisión legal: cuándo procede borrar o anonimizar, y qué hacer al vencer el plazo de conservación] |
| **Oposición** / **suspensión** | Se anota la solicitud y el consultorio decide si procede. Hoy MedCita no tiene un interruptor por paciente: lo más cercano es no agendarle mensajes. [PENDIENTE: definir si hace falta] |

4. **Responder por escrito** al paciente, dentro del plazo, diciendo qué se hizo o por qué no procede (por ejemplo, datos que la ley obliga a conservar).
5. **Guardar la evidencia**: la solicitud, la fecha, la respuesta y quién la atendió.

## Si el paciente reclama

Puede acudir a la **Superintendencia de Protección de Datos Personales**. Conserva toda la evidencia anterior.

## Lo que MedCita aún no tiene (a propósito, queda para tickets futuros)

- Un botón de «eliminar todos los datos de un paciente» (por la conservación obligatoria de la historia clínica).
- Un registro de solicitudes de titulares dentro de la aplicación.
- Borrar o anonimizar datos clínicos al vencer el plazo de conservación (hoy no se puede borrar una nota cerrada ni un signo vital).
