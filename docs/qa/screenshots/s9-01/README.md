# S9-01 — Capturas ANTES / DESPUÉS

Cada imagen compara la aplicación en `develop` (5663ba0, ANTES) con la rama S9-01 (DESPUÉS), con los mismos datos de demostración: «Clínica Vida (demo)», un consultorio en Galápagos (`Pacific/Galapagos`, UTC-6), y un reloj fijado en el miércoles 21-oct a las 09:40 hora de Galápagos (15:40 UTC) en las dos versiones. Los mensajes de WhatsApp son la carga real que la aplicación entregó a Meta (no se envió nada).

| Imagen | Qué muestra |
|---|---|
| `R1-settings-zona-horaria.png` | Settings: el administrador ve y cambia la zona horaria del consultorio |
| `R2-horarios-libres-de-hoy.png` | Nueva cita: los horarios de hoy se descuentan con la hora del consultorio (ANTES se perdían el 10:00 y el 10:30) |
| `R3-recordatorio-a-su-hora.png` | Recordatorio de WhatsApp: ANTES salía una hora antes de tiempo; DESPUÉS espera a que falten 24 h |
