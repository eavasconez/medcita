# 🩺 Guía Maestra para la Demo de MedCita

Este manual contiene los pasos exactos para realizar una demostración de la plataforma MedCita. Está actualizado al cierre del Sprint 7 (21-oct-2026): el menú y los botones de la app están en inglés, y los mensajes que reciben los pacientes (WhatsApp y correo) están en español.

## 🔐 Credenciales de Acceso

| Rol | Email | Password |
| :--- | :--- | :--- |
| **Administrador** | `admin@medcita.ec` | `admin1234` |
| **Doctor Demo** | `demo@medcita.ec` | `demo1234` |

> En producción cambia estas contraseñas antes de cargar pacientes reales: están en un repositorio público. Se cambian en **Settings → Update Password**.

**Sitio:** https://medcita-frontend.onrender.com (el servidor gratuito se duerme tras 15 minutos: la primera carga puede tardar ~50 s; abre la página un minuto antes de la demo).

## ✅ Antes de la demo

- **WhatsApp:** hoy usa el **número de prueba de Meta**, que solo entrega a **5 destinatarios registrados** en el panel de Meta. Si quieres mostrar la llegada del mensaje, tu teléfono debe estar en esa lista (guía: `docs/WHATSAPP_META_SETUP.md`, paso 4). Un paciente que no esté en la lista no recibirá nada.
- Usa como paciente de la demo a alguien cuyo número sí esté en la lista (en el seed, *Ricardo Andrade*).
- El correo llega al email que pongas en el paciente: usa uno al que tengas acceso.
- Al terminar, **cancela las citas de prueba** (calendario → clic en la cita → *Cancel*).

---

## 🚀 Guía de la Demostración (Paso a Paso)

### 1. Gestión Administrativa (Como Admin)
1. Inicia sesión con las credenciales de **Administrador**.
2. Abre **Manage Doctors** en la barra lateral: aquí el administrador crea usuarios (médicos, secretarias, otros administradores), los edita o los elimina.
3. Abre **Analytics** para mostrar las citas por médico y la distribución de carga.
4. Cada cambio que hacen administradores y secretarias queda en un **registro de auditoría** (tabla `AuditLog`). Hoy se consulta por API (`GET /api/admin/audit-log`, solo administradores) y aún no tiene pantalla.

### 2. Gestión Médica (Como Doctor)
1. Cierra sesión (**Sign Out**) y entra con las credenciales del **Doctor Demo**.
2. Muestra **My Schedule**: los indicadores (citas, pacientes, efectividad) y el calendario en vistas **Month, Week, Day y Agenda**. Las citas se bloquean si están fuera del horario laboral o en el pasado.
3. Abre **Availability** para mostrar cómo el doctor define su propia jornada.
4. Abre **Settings**: perfil del médico y **Update Password**. Al cambiar la contraseña, las sesiones abiertas antes dejan de valer.

### 3. Registro de Pacientes
1. Ve a **Patients**.
2. Pulsa **New Patient** y completa nombre y WhatsApp. La cédula y el correo son **opcionales**.
3. Guarda: el paciente aparece en el directorio con su contador de citas en cero. Con el lápiz se edita; el basurero solo funciona para pacientes **sin ninguna cita**.

### 4. Agendamiento y Notificaciones (WhatsApp + Correo)
1. Vuelve a **My Schedule** y pulsa **New Appointment**.
2. Elige el paciente (busca o crea uno), la fecha y un horario libre, y pulsa **Confirm Appointment**. Debe salir el aviso «Appointment scheduled! Notifications are being sent.»
3. **Punto clave:** el backend responde enseguida y envía, en segundo plano:
   - Una **confirmación por WhatsApp** con una plantilla aprobada de Meta (`cita_confirmada`). Llega aunque el paciente nunca le haya escrito al número.
   - Un **correo de confirmación** (Brevo), si el paciente tiene correo.
   - El **recordatorio automático** se envía una sola vez cuando faltan menos de 24 horas (corre cada hora).
4. Abre la cita en el calendario: queda *Pending*; **Confirm Appointment** la pasa a *Confirmed* y **Cancel** la cancela (el navegador pide confirmar).

### 5. Si el médico olvida la contraseña
En la pantalla de login, **Forgot password**: llega un correo con un enlace de un solo uso que vale 60 minutos.

---

## 🛠️ Notas Técnicas
- **Base de Datos:** PostgreSQL con Prisma ORM y migraciones versionadas.
- **Validación:** el sistema impide citas duplicadas en el mismo horario, también al mover una cita.
- **WhatsApp:** Meta Cloud API con plantillas aprobadas. Twilio queda como alternativa para desarrollo; cómo elegir entre ambos está en `docs/DEPLOY.md`, sección 7.0.
- **Seguridad:** límite de intentos de login, sesiones que se invalidan al cambiar la contraseña y registro de auditoría.
- **UI:** Tailwind CSS, responsiva (también en móvil).
- **Evidencia de que todo funciona en producción:** `docs/qa/S7-12-production-evidence.md`.

---
*Desarrollado para el éxito de MedCita Ecuador.*
