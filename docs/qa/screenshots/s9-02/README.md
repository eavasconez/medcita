# S9-02 — Capturas ANTES / DESPUÉS

Cada imagen compara la aplicación en `develop` (4a17583, ANTES) con la rama S9-02 (DESPUÉS), con los mismos datos de demostración y las mismas tres citas (María Andrade, Carlos Pérez y Lucía Torres), el jueves 22-oct-2026 a las 10:46. En DESPUÉS, el servidor de la prueba tiene configurados el webhook y la plantilla con botones. Los mensajes son las cargas reales que la aplicación entregó a los proveedores (Meta y Brevo) en una prueba local: no se envió nada a ningún teléfono ni a ningún correo. Los toques de los pacientes se simularon con `npm run whatsapp:reply`, que firma la llamada como lo hace Meta; **todavía no se probó con Meta de verdad**, y el aspecto del teléfono de `R1` es una maqueta.

| Imagen | Qué muestra |
|---|---|
| `R1-recordatorio-con-botones.png` | El recordatorio de WhatsApp de María: antes solo informa; ahora lleva «Confirmo», «Cancelar» y «Cambiar hora», y la respuesta que recibe al confirmar |
| `R2-ajustes-vista-previa.png` | Settings → Reminders: la vista previa muestra los tres botones y qué hace cada uno |
| `R3-cita-confirmada-por-el-paciente.png` | La cita de María en el Dashboard: pasa sola de «Pending» a «Confirmed», y el historial cuenta lo que hizo el paciente |
| `R4-cambiar-hora.png` | La cita de Carlos tras tocar «Cambiar hora»: no se mueve sola, y el historial anota la solicitud y el aviso a la secretaría |
| `R5-registro-y-aviso-a-la-secretaria.png` | El Activity Log con «Patient (WhatsApp)» y el correo que recibe el administrador por «Cambiar hora» |
