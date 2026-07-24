# S6-02 — Video demo del sistema en producción

> Grabación real de pantalla contra `https://medcita-frontend.onrender.com` (no un mockup ni un ambiente local), generada como material base — sin narración ni edición, eso requiere Loom y la voz del equipo, algo fuera de lo que se puede automatizar desde acá. Fecha: 2026-07-24.

## Archivo

[`media/s6-02-demo-raw.webm`](media/s6-02-demo-raw.webm) — ~20 segundos, 1600×900, sin audio.

## Qué muestra (en orden)

1. Login real como `demo@medcita.ec` (Dr. Santiago Pérez).
2. Dashboard / calendario semanal.
3. Modal "New Appointment" → paso 1 ("Who are we seeing?") con búsqueda de paciente existente.
4. Página "My Patients" — directorio de pacientes.
5. Página "Availability" — configuración de horario.

## Cómo usarlo

Importar este archivo a Loom (o a cualquier editor), agregar narración siguiendo el guión de `docs/qa/S6-01-demo-script.md` (sección 3, "Live demo"), y recortar/acelerar donde haga falta — esta grabación es intencionalmente cruda, sin cortes.

## ⚠️ Antes de compartir externamente

El clip de la página "My Patients" (paso 4) muestra el directorio completo de pacientes de demo, incluyendo el paciente **"Ricardo Andrade"**, cuyo número de teléfono en los datos de demo coincide con un número real (ver `docs/qa/S5-03-production-validation.md`, sección 5). Recomendado **recortar ese segmento** antes de usar el video con alguien fuera del equipo, o grabar de nuevo esa página específica cuando se disponga de datos de demo con números completamente ficticios.

## Por qué no se grabó la notificación real llegando

A diferencia de la validación de S5-03, este video no espera a que llegue una notificación real de WhatsApp/Email — hacerlo habría requerido usar un número de teléfono real de nuevo (con el mismo riesgo de colisión con datos de demo) solo para una grabación que de todas formas se va a re-narrar y editar. El guión de S6-01 sí indica hacerlo en vivo, con el médico presente, durante la demo real.
