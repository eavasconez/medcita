# MedCita: hoja de ruta después del Sprint 8

Estado al 21-oct-2026. Documento de planificación: los tickets de abajo **todavía no existen en GitHub**; se crean cuando apruebes cada sprint.

## 1. Resumen

**Recomendación:** el Sprint 9 cierra el ciclo de la cita (confirmar desde WhatsApp, recordatorios y agenda configurables) porque es lo que hoy vende MedCita y no toca datos clínicos. Mientras tanto corren en paralelo, fuera del código, la revisión legal y la puesta en marcha del staging. La historia clínica (Sprint 10) **no arranca hasta que ambas estén listas**.

```
Sprint 9            Sprint 10             Sprint 11            Sprint 12
Cerrar el ciclo  →  Ficha del paciente →  Documentos,      →  Listo para
de la cita          e historia clínica    recetas, archivos    vender
                         ▲                     ▲
         Puerta A: abogado revisó      Puerta B: bucket privado
         docs/legal + staging activo   verificado con storage:check
```

### Cómo se ordenó

1. **Valor visible ya** para médicos y secretarias (menos ausentismo, agenda que se ajusta a cada consultorio).
2. **Lo que desbloquea lo clínico** (ficha, notas, permisos) solo cuando la base legal esté aprobada.
3. **Lo comercial** (planes, cobro, reserva en línea) cuando el producto ya justifique cobrar.
4. Cada ticket cabe en una rama y un PR revisable. Tamaños: **S** (un día o menos), **M** (2 a 3 días), **L** (una semana), **XL** (más de una semana: hay que partirlo).

### Reglas que se mantienen en todos los tickets

- Rama desde `develop`, commits en inglés, PR en español con `Closes #N`.
- Capturas ANTES/DESPUÉS en `docs/qa/screenshots/<ticket>/`.
- Pruebas automáticas (incluido el aislamiento entre consultorios) y carpeta nueva en Postman.
- **Todo ticket que cambie el esquema pasa por staging antes de `main`**, con respaldo de Neon.
- Un cambio nunca se fusiona a `main` sin la lista de verificación de producción de `docs/DEPLOY.md`.

## 2. Dónde estamos y qué arrastramos

El Sprint 8 dejó: varios consultorios con datos separados (S8-01), alta e invitaciones por correo (S8-02), registro de actividad (S8-03), historial de mensajes con aviso de fallos (S8-04), estados de la consulta y ausentismo (S8-05), guía de staging y almacenamiento privado (S8-06) y borradores legales con consentimiento versionado y exportación de datos del paciente (S8-07, PR #111).

### Pendientes que no son tickets de código

| Pendiente | Quién | Por qué importa |
|---|---|---|
| Revisión legal de `docs/legal/` | Abogado | Sin ella no se guardan datos de salud reales (Puerta A) |
| Crear staging (rama de Neon, dos servicios de Render) | Tú | Es donde se prueban las migraciones antes de producción |
| Crear el bucket privado y correr `npm run storage:check` | Tú | Puerta B, necesaria para documentos y adjuntos |
| Brevo funcionando en producción | Tú | Sin correo no hay altas ni invitaciones |
| Aprobación de las plantillas de WhatsApp en Meta (y de las nuevas con botones) | Meta | Sin ella los recordatorios reales no salen |
| Pasar de planes gratuitos a pagos (Render y Neon) | Tú | La instancia gratuita se duerme y no hay respaldos serios |

### Deuda técnica conocida

- `AuditLog` y `NotificationLog` crecen sin límite y sin política de retención.
- Los límites de intentos viven en memoria: se reinician con cada despliegue y no sirven con más de una instancia.
- `Clinic.timezone` existe pero no se usa; todo sigue con `CLINIC_UTC_OFFSET_MINUTES`. El 21-oct un horario de «hoy» desapareció por esa diferencia.
- La aceptación de los términos de uso no se registra.
- Los errores del servidor solo se ven en los logs de Render, sin alertas.

---

## 3. Sprint 9: cerrar el ciclo de la cita

**Objetivo:** que el consultorio vea bajar sus ausencias y que la agenda se adapte a cómo trabaja. No toca datos clínicos, así que no espera al abogado.

| # | Ticket | Tamaño | Depende de |
|---|---|---|---|
| S9-01 | Zona horaria por consultorio | M | — |
| S9-02 | Confirmar, cancelar o reprogramar desde el recordatorio de WhatsApp | L | S9-01, plantillas de Meta |
| S9-03 | Recordatorios configurables por consultorio | M | S9-01 |
| S9-04 | Tipos de cita y duración | M | — |
| S9-05 | Bloqueos de agenda (vacaciones, feriados, ausencias) | M | S9-04 |
| S9-06 | Reportes de asistencia por rango y exportables | S | — |

### S9-01: Zona horaria por consultorio
- Usar `Clinic.timezone` en lugar de la variable de entorno global: horarios disponibles, recordatorios, «hoy», citas sin cerrar y reportes.
- Cubrir Galápagos (UTC-6) y un consultorio fuera de Ecuador como caso de prueba, con la suite corriendo en UTC.
- Pantalla en Settings para que el administrador elija la zona.
- **Entregable:** dos consultorios en zonas distintas ven sus horarios y recordatorios en su hora local.

### S9-02: Confirmar, cancelar o reprogramar desde WhatsApp
- Plantilla nueva en Meta con botones de respuesta rápida («Confirmo», «Cancelar», «Cambiar hora»); es la mejora que más baja el ausentismo.
- Webhook de Meta con verificación de la firma (`X-Hub-Signature-256`) y asociación de la respuesta con la cita correcta, solo dentro del consultorio de esa cita.
- «Confirmo» pasa la cita a `confirmed`; «Cancelar» la cancela y libera el horario; «Cambiar hora» avisa a la secretaría. Todo queda en el historial de mensajes y en la auditoría.
- Respuestas que no se entienden, repetidas o de números desconocidos: se registran y no cambian nada.
- **Entregable:** un paciente confirma o cancela con un toque y la agenda se actualiza sola.
- **Riesgo:** necesita aprobación de Meta; hasta entonces se prueba con el número de pruebas.

### S9-03: Recordatorios configurables
- Por consultorio: activar o apagar, anticipación (48 h, 24 h, 2 h), un segundo recordatorio opcional y canales (WhatsApp, correo).
- El texto sigue siendo la plantilla aprobada por Meta; lo editable son las variables (nombre del consultorio, dirección, indicaciones).
- El proceso de recordatorios lee la configuración de cada consultorio.
- **Entregable:** cada consultorio decide cuándo y cómo se recuerda a sus pacientes.

### S9-04: Tipos de cita y duración
- Modelo de tipos (nombre, duración, color): «Primera vez 40 min», «Control 20 min».
- Los horarios disponibles y el calendario respetan la duración; un tipo por defecto de 30 minutos conserva lo actual.
- Migración con datos existentes probada, como en S8-01.
- **Entregable:** el médico agenda consultas de distinta duración sin que se pisen.

### S9-05: Bloqueos de agenda
- Bloquear por médico o por consultorio una fecha o un rango (vacaciones, congreso, feriado) con motivo.
- Los horarios bloqueados no se ofrecen; al crear un bloqueo sobre citas existentes se avisa y se listan para reprogramarlas.
- Feriados nacionales de Ecuador como atajo, editables.
- **Entregable:** nadie agenda en un día en que el médico no atiende.

### S9-06: Reportes de asistencia por rango y exportables
- Filtro por fechas y médico en Reportes, tasa de ausentismo por médico y por tipo de cita, y exportar a CSV.
- **Entregable:** el administrador lleva el ausentismo a una reunión o a una hoja de cálculo.

### Complementarios del Sprint 9 (técnicos, entran si hay espacio)

| # | Ticket | Tamaño | Qué resuelve |
|---|---|---|---|
| S9-07 | Retención y limpieza de registros | S | Política y tarea periódica para `AuditLog` y `NotificationLog`; el plazo lo confirma el abogado |
| S9-08 | Límites de intentos persistentes y alertas de errores | M | Que los límites sobrevivan a un despliegue y que un error 500 avise por correo o chat |
| S9-09 | Infraestructura de producción | M | Planes pagos, respaldos con restauración probada, monitoreo; es requisito antes de cobrar |
| S9-10 | Aceptación de términos registrada | S | Guardar versión y fecha al registrarse o aceptar una invitación; depende del abogado |

---

## 4. Sprint 10: ficha del paciente y primera historia clínica

**Puerta A (obligatoria):** el abogado revisó `docs/legal/`, se completaron los `[PENDIENTE]`, `LEGAL_REVIEWED = true`, y existe un staging para probar las migraciones. **Sin eso no se empieza.**

**Objetivo:** que el médico registre una consulta completa de forma segura.

| # | Ticket | Tamaño | Depende de |
|---|---|---|---|
| S10-01 | Permisos clínicos por rol | M | Puerta A |
| S10-02 | Ficha del paciente ampliada | M | S10-01 |
| S10-03 | Antecedentes y alergias | M | S10-02 |
| S10-04 | Nota de consulta (SOAP) | L | S10-01, S10-02 |
| S10-05 | Diagnósticos CIE-10 en español | M | S10-04 |
| S10-06 | Signos vitales y medidas | M | S10-04 |
| S10-07 | Línea de tiempo del paciente y exportación clínica | M | S10-04 a S10-06 |

### S10-01: Permisos clínicos por rol
- Quién puede ver y escribir datos clínicos: el médico tratante y quien el consultorio autorice; la secretaría **no** ve notas ni diagnósticos.
- Activar el tipo `read` de la auditoría: cada lectura de datos clínicos queda registrada con quién, cuándo y de qué paciente, para cualquier rol.
- Pruebas de acceso cruzado entre roles y entre consultorios en cada ruta nueva.
- **Entregable:** una regla clara y comprobada de quién ve qué, antes de que exista el primer dato clínico.

### S10-02: Ficha del paciente ampliada
- Fecha de nacimiento (con edad calculada), sexo, dirección, ocupación, contacto de emergencia, seguro médico y, para menores, representante legal (cierra la duda del consentimiento de menores).
- Pantalla de ficha con los datos y las citas del paciente en un solo lugar.
- **Entregable:** una ficha completa y editable, con cada cambio auditado.

### S10-03: Antecedentes y alergias
- Antecedentes personales, familiares, quirúrgicos y hábitos; alergias y medicación crónica con aviso destacado en la ficha y en la consulta.
- **Entregable:** el médico ve alergias y antecedentes antes de recetar.

### S10-04: Nota de consulta (SOAP)
- Una nota por cita con Subjetivo, Objetivo, Análisis y Plan; borrador con autoguardado y botón de **cerrar**.
- Una nota cerrada no se edita: las correcciones son una **adenda** con fecha y autor, para que el historial sea confiable.
- Plantillas por especialidad (medicina general, pediatría).
- **Entregable:** el médico documenta la consulta dentro de MedCita, y queda trazado quién la escribió y quién la leyó.

### S10-05: Diagnósticos CIE-10 en español
- Catálogo con búsqueda por código o por nombre, vinculado a la nota. Hay que confirmar la fuente oficial y su licencia de uso antes de cargarlo.
- **Entregable:** diagnósticos codificados y buscables.

### S10-06: Signos vitales y medidas
- Peso, talla, IMC, presión, frecuencia cardíaca y respiratoria, temperatura y saturación, con histórico y gráficas por paciente.
- **Entregable:** la evolución de un paciente se ve de un vistazo.

### S10-07: Línea de tiempo del paciente y exportación clínica
- Citas, notas, diagnósticos, vitales y consentimientos en orden cronológico.
- La exportación de datos del paciente (S8-07) incluye lo clínico y puede descargarse también como PDF.
- **Entregable:** el consultorio responde a un paciente que pide su historia con un archivo completo.

---

## 5. Sprint 11: documentos, recetas y archivos

**Puerta B:** el bucket privado está creado y `npm run storage:check` pasa con los cuatro «OK», en producción y en staging.

**Objetivo:** que lo que el médico entrega al paciente salga de MedCita.

| # | Ticket | Tamaño | Depende de |
|---|---|---|---|
| S11-01 | Membrete, sello y datos profesionales del médico | M | Sprint 10 |
| S11-02 | Recetas en PDF | L | S11-01, S10-05 |
| S11-03 | Certificados médicos | M | S11-01 |
| S11-04 | Órdenes de exámenes e imágenes | M | S11-01 |
| S11-05 | Adjuntos y resultados de exámenes | L | Puerta B, S10-01 |
| S11-06 | Consentimiento informado por procedimiento con firma en pantalla | L | S11-05 |

- **S11-01.** Logo del consultorio, registro profesional del médico, firma y sello escaneados; son la base de todos los PDF.
- **S11-02.** Medicamentos con dosis y duración, número correlativo, código QR de verificación y PDF. Define si se parte de un catálogo de medicamentos o de texto libre.
- **S11-03.** Plantillas de certificado (reposo, asistencia, salud) con numeración.
- **S11-04.** Orden impresa o enviada por WhatsApp, sin resultados todavía.
- **S11-05.** Subir PDF o imagen con URL firmada, tipo y tamaño limitados, visor, permisos clínicos y auditoría de cada lectura. Valorar un análisis antivirus.
- **S11-06.** Formularios de consentimiento por procedimiento, firma del paciente en tableta o celular, versión del texto y copia en PDF dentro de su ficha.
- **Decisión pendiente:** firma electrónica con validez legal en Ecuador (certificado de entidad acreditada) frente a firma manuscrita escaneada; cambia el alcance de S11-02 y S11-03.

---

## 6. Sprint 12: listo para vender

**Objetivo:** que un consultorio nuevo pueda contratar, empezar solo y pagar, y que tú puedas operar la plataforma.

| # | Ticket | Tamaño | Depende de |
|---|---|---|---|
| S12-01 | Planes, prueba gratuita y cobro | XL (partir en 2) | Decisión de precios y pasarela |
| S12-02 | Onboarding guiado | M | — |
| S12-03 | Importación de pacientes desde Excel o CSV | M | — |
| S12-04 | Reserva en línea para pacientes | L | S9-04, S9-05 |
| S12-05 | Panel del operador de la plataforma | M | S12-01 |
| S12-06 | Verificación en dos pasos y sesiones | M | — |
| S12-07 | Baja del consultorio y entrega de sus datos | M | Abogado |

- **S12-01.** Plan con límites (médicos, mensajes por mes), prueba de 14 días, suscripción mensual con una pasarela que opere en Ecuador, estado de la cuenta y bloqueo suave por impago (solo lectura, nunca perder datos). Partirlo: primero modelo de planes y límites, después el cobro.
- **S12-02.** Asistente de primer uso: horarios, médicos, mensaje de prueba y primera cita.
- **S12-03.** Cargar el listado de pacientes de un consultorio que migra desde otro sistema, con vista previa y reporte de errores, respetando teléfono y cédula únicos por consultorio.
- **S12-04.** Enlace público por médico o consultorio con los horarios libres, protección contra abuso, confirmación por WhatsApp y consentimiento al reservar.
- **S12-05.** Consultorios, uso, mensajes enviados (que cuestan), estado de pago y ayuda a soporte con acceso auditado.
- **S12-06.** Verificación en dos pasos (TOTP) para administradores y médicos, y lista de sesiones activas.
- **S12-07.** Exportación completa del consultorio y borrado programado respetando los plazos de conservación.

---

## 7. Más adelante (sin fecha)

Candidatos a entrar cuando haya clientes que los pidan:

| Candidato | Por qué podría valer la pena |
|---|---|
| Facturación electrónica con el SRI | Muchos consultorios facturan por separado; es complejo y de alto valor |
| Portal del paciente (citas, recetas, resultados) | Reduce llamadas al consultorio |
| Teleconsulta por video | Útil, pero compite con herramientas gratuitas |
| Bandeja de WhatsApp bidireccional | Conversar con pacientes desde MedCita, no solo notificar |
| Recordatorios de control y seguimiento («volver en 3 meses») | Retención de pacientes |
| Encuesta de satisfacción tras la consulta | Mide calidad y alimenta reseñas |
| Asistente con IA: dictado a nota SOAP y resumen del historial | Ahorra tiempo; exige revisar privacidad y proveedor |
| Pediatría (curvas de crecimiento, vacunas) y odontograma | Nichos con mucha demanda |
| Multi-sede y roles finos | Para clínicas con varias sedes |
| App móvil o PWA con uso sin conexión | Consultas en zonas con mala señal |
| Integraciones (laboratorios, calendarios, contabilidad) y API pública | Ecosistema |
| Inventario y farmacia | Solo si hay clientes con dispensación |

---

## 8. Decisiones y riesgos que dependen de ti o de terceros

| Decisión o riesgo | De quién | Cuándo hace falta | Qué pasa si se retrasa |
|---|---|---|---|
| Abogado: revisar `docs/legal/` y responder `puntos-para-el-abogado.md` | Tú / abogado | Antes del Sprint 10 | No se puede guardar nada clínico |
| Crear staging y bucket y verificarlos | Tú | Antes de S9-01 (staging) y del Sprint 11 (bucket) | Las migraciones se prueban en producción, que es lo que falló el 20 y 21-oct |
| Aprobación de plantillas de Meta con botones | Meta | Antes de S9-02 | S9-02 queda en pruebas |
| A quién se vende primero (consultorios pequeños, clínicas, una especialidad) | Tú | Antes del Sprint 12 | Cambia el orden de S12 |
| Modelo de precios y pasarela de pago en Ecuador | Tú | Antes de S12-01 | El cobro no arranca |
| Fuente y licencia del catálogo CIE-10 | Tú / abogado | Antes de S10-05 | No hay diagnósticos codificados |
| Firma electrónica con validez legal o escaneada | Tú / abogado | Antes de S11-02 | Cambia el alcance de recetas y certificados |
| Plan pago de Render y Neon | Tú | Antes de cobrar | Instancia que se duerme y sin respaldos serios |
| Plazos de retención de la historia clínica y de los registros | Abogado | Antes de S9-07 y S10 | Se guarda de más o se borra de menos |

### Riesgos principales

1. **Aprobaciones externas (Meta, abogado):** son lo único que puede frenar el Sprint 9 y el 10 sin que el código tenga la culpa. Pídelas ya.
2. **Migraciones sobre datos reales:** S9-04 (tipos de cita) y todo el Sprint 10 cambian el esquema; staging y respaldo de Neon son obligatorios.
3. **Datos de salud:** desde el Sprint 10 una filtración es un incidente grave. La verificación en dos pasos (S12-06) y el procedimiento de brechas pasan de «conveniente» a «necesario» antes de tener pacientes reales; si se adelanta el uso real, adelanta S12-06 al Sprint 10.
4. **Costos de mensajes:** cada recordatorio y cada respuesta por WhatsApp tiene costo; S9-03 y S12-05 deben mostrar el consumo.

### Qué te pido para seguir

1. ¿Apruebas el Sprint 9 tal cual (S9-01 a S9-06) para crear los tickets en GitHub, y cuáles de los complementarios S9-07 a S9-10 entran?
2. ¿Quién es el primer cliente objetivo? Con eso decido si S12-03 (importar pacientes) sube de prioridad.
3. ¿Cuándo tendrás el staging y el bucket? Marca el ritmo del Sprint 10.
