# Documentos legales de MedCita (S8-07)

> **Estado: BORRADOR escrito por el equipo técnico. Ningún documento de esta carpeta ha sido revisado por un abogado.** No se debe pedir a pacientes reales que firmen ni aceptar datos de salud reales hasta que lo haya hecho (ver `puntos-para-el-abogado.md`). No es asesoría legal.

Marco de referencia: la **Ley Orgánica de Protección de Datos Personales (LOPDP) de Ecuador**, su reglamento y la **Superintendencia de Protección de Datos Personales**. Los datos de salud son una categoría especial y exigen más cuidado que un dato común.

## Qué hay aquí

| Documento | Para quién | Dónde se usa |
|---|---|---|
| [`politica-de-privacidad.md`](politica-de-privacidad.md) | Quien use MedCita y los pacientes | Pública en la app: `/privacy` |
| [`terminos-de-uso.md`](terminos-de-uso.md) | Los consultorios que usan MedCita | Pública en la app: `/terms` |
| [`consentimiento-datos-salud.md`](consentimiento-datos-salud.md) | El paciente (se imprime o se muestra en pantalla) | Su texto sale de `backend/src/legal/healthDataConsent.js`; en Pacientes → «Consent» |
| [`procedimiento-derechos-de-titulares.md`](procedimiento-derechos-de-titulares.md) | El consultorio, cuando un paciente pide sus datos | Interno; la exportación es `GET /api/patients/:id/export` |
| [`procedimiento-brechas.md`](procedimiento-brechas.md) | El equipo, ante un incidente de seguridad | Interno |
| [`puntos-para-el-abogado.md`](puntos-para-el-abogado.md) | El abogado que lo revise | Lista de lo que NO se pudo decidir desde la técnica |

## Cómo se conectan con la aplicación

- **Texto único.** La política y los términos se muestran en la app desde estos mismos archivos: editar el `.md` cambia lo que se ve en `/privacy` y `/terms` en el siguiente despliegue. Mientras la bandera `LEGAL_REVIEWED` de `frontend/src/config/legal.js` sea `false`, ambas pantallas muestran un aviso de «borrador pendiente de revisión legal». **Cuando el abogado apruebe, se cambia a `true`.**
- **Ojo al desplegar.** El frontend lee estos archivos al *compilarse*. Render, con *Root Directory* `frontend`, puede no volver a desplegar el sitio si solo cambió `docs/legal/`: en el Static Site, *Settings → Build Filters*, agrega `docs/legal/**` a las rutas que disparan un despliegue (o lanza un *Manual Deploy*).
- **Consentimiento con versión.** Cada consentimiento guarda la versión del texto que el paciente leyó (`2026-10-v1`). Si el texto cambia, se cambia la versión en `healthDataConsent.js` y, en `consentimiento-datos-salud.md`, la misma línea: los pacientes que aceptaron la versión anterior aparecen como «desactualizados» en la app, sin perder su registro. Una prueba (`backend/tests/legalDocs.test.js`) falla si el `.md` y el código dicen cosas distintas.
- **Lo que se registra de cada consentimiento:** versión del texto, si se dio o se retiró, cómo se obtuvo (firmado en papel, verbal, electrónico u otro), fecha, y quién lo registró. Nunca se edita ni se borra: retirar el consentimiento es una fila nueva.
