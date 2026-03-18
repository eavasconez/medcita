# 🩺 Guía Maestra para la Demo de MedCita

Este manual contiene los pasos exactos para realizar una demostración impecable de la plataforma MedCita MVP Beta.

## 🔐 Credenciales de Acceso

| Rol | Email | Password |
| :--- | :--- | :--- |
| **Administrador** | `admin@medcita.ec` | `admin1234` |
| **Doctor Demo** | `demo@medcita.ec` | `demo1234` |

---

## 🚀 Guía de la Demostración (Paso a Paso)

### 1. Gestión Administrativa (Como Admin)
1. Inicia sesión con las credenciales de **Administrador**.
2. Dirígete a la pestaña **"Gestión Médicos"** en la barra lateral.
3. Explica que desde aquí el administrador puede crear nuevos doctores, editarlos o incluso ascender a otros a Admin.
4. Crea un nuevo médico de prueba para mostrar la velocidad del sistema.

### 2. Gestión Médica (Como Doctor)
1. Cierra sesión y entra con las credenciales del **Doctor Demo**.
2. Muestra el **Dashboard con el Calendario**. Explica que las citas se bloquean si están fuera del horario laboral configurado.
3. Dirígete a **"Horarios"** para mostrar cómo el doctor define su propia jornada.

### 3. Registro de Pacientes (Proceso Corregido)
1. Ve a la pestaña **"Pacientes"**.
2. Haz clic en **"Nuevo Paciente"**.
3. Completa los datos incluyendo la **Cédula** (campo obligatorio ahora).
4. Guarda y muestra cómo el paciente aparece instantáneamente en el directorio con su contador de citas en cero.

### 4. Agendamiento y Notificación WhatsApp
1. Vuelve al **Dashboard**.
2. Agendar una cita para el paciente que acabas de crear.
3. **Punto clave:** Al confirmar, explica que el backend procesa la solicitud, enviando:
   - Una confirmación inmediata por la API de Twilio.
   - Programando el recordatorio automático para 24h antes.
4. Muestra la consola del backend (o el bot de Twilio en tu cel) para verificar el envío.

---

## 🛠️ Notas Técnicas
- **Base de Datos:** PostgreSQL con Prisma ORM (Conectividad robusta).
- **Validación:** El sistema impide citas duplicadas en el mismo horario.
- **WhatsApp:** Integración real con Twilio API.
- **UI:** Diseñado con Tailwind CSS para una experiencia premium y responsiva.

---
*Desarrollado para el éxito de MedCita Ecuador.*
