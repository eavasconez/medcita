# S5-04 — Plan de onboarding y feedback para médicos piloto

> No fue posible ejecutar onboarding real con médicos piloto en esta ronda (ver #57, #58). Este documento deja listo el guion de sesión y la plantilla completa del formulario de feedback, para ejecutarlo apenas haya un candidato real confirmado — sin tener que improvisar en el momento. Fecha: 2026-07-24.

## 1. Checklist de preparación (antes de la sesión)

- [ ] Confirmar fecha/hora con el médico (Zoom o presencial) — bloquear ~40 min.
- [ ] Crear su cuenta en la app (`Manage Doctors` como admin, o que se registre él mismo en `/register`) con su especialidad real.
- [ ] Confirmar que tiene WhatsApp activo en el número que va a usar — la demo incluye una notificación real.
- [ ] Tener a mano la URL de producción (`https://medcita-frontend.onrender.com` o el dominio final).
- [ ] Tener a mano el link del formulario de feedback (sección 4).

## 2. Guion de la sesión (~35-40 min)

| Paso | Tiempo | Qué hacer |
|---|---|---|
| 1. Bienvenida | 2 min | Agradecer, explicar que es una versión piloto y que su feedback define qué se prioriza antes de un lanzamiento más amplio. |
| 2. Contexto | 3 min | Qué es MedCita en una frase (agenda + recordatorios automáticos por WhatsApp/Email para reducir inasistencias), sin tecnicismos. |
| 3. Demo guiada — login y calendario | 5 min | Entrar con su cuenta, mostrar su calendario (vacío o con 1-2 citas de ejemplo), explicar la leyenda de colores (confirmada/agendada/pendiente). |
| 4. Demo guiada — agendar una cita | 5 min | El presentador agenda 1 cita de ejemplo con un paciente ficticio, mostrando el flujo completo (buscar/crear paciente → elegir horario → confirmar). |
| 5. Demo guiada — disponibilidad | 3 min | Mostrar la pantalla de "Availability" y cómo ajustar su horario semanal. |
| 6. **Práctica guiada (el médico solo)** | 10 min | El médico agenda **una cita real** por su cuenta, con su propio número de WhatsApp como "paciente" de prueba, para que reciba la notificación en vivo. El presentador solo observa, sin tocar el mouse/teclado. |
| 7. Confirmar notificación | 2 min | Esperar a que le llegue el WhatsApp/Email real y confirmarlo en voz alta — este es el momento clave de la demo. |
| 8. Cierre + feedback | 5-10 min | Agradecer, compartir el link del formulario (sección 4) y pedir que lo complete ahí mismo si es posible. |

## 3. Criterios de éxito por sesión

- [ ] El médico completa el login sin ayuda (usando la contraseña que se le compartió).
- [ ] El médico agenda **al menos 1 cita real por su cuenta**, sin que se le indique cada clic paso a paso (paso 6 del guion).
- [ ] El médico confirma haber recibido la notificación real (WhatsApp o Email) de esa cita.
- [ ] El médico completa el formulario de feedback antes de terminar la sesión.

Si alguno de estos 3 no se cumple, es una señal de que hay fricción real en el producto — anotar en qué paso exacto se trabó, no solo "no funcionó".

## 4. Formulario de feedback (plantilla lista para Google Forms)

Copiar y pegar directamente en [forms.google.com](https://forms.google.com) al crear el form real (ver sección 5).

### Sección 1 — Datos generales
1. Nombre completo
2. Especialidad
3. ¿Actualmente usas algún sistema para agendar tus citas? (Opción múltiple: Cuaderno/papel · WhatsApp manual · Excel · Otro software · Ninguno)

### Sección 2 — NPS
4. En una escala del 0 al 10, ¿qué tan probable es que recomiendes MedCita a un colega médico? *(escala lineal 0-10)*

### Sección 3 — Usabilidad (escala 1-5, "Muy en desacuerdo" a "Muy de acuerdo")
5. Fue fácil aprender a usar la app en esta primera sesión.
6. Encontré rápido lo que estaba buscando (agendar, ver mi calendario, cambiar disponibilidad).
7. Confío en que mis citas y las de mis pacientes no se van a perder o duplicar.
8. La notificación automática por WhatsApp/Email le da valor real a mi trabajo (menos inasistencias, menos llamadas de recordatorio).
9. Me sentiría cómodo usando esto todos los días con mis pacientes reales.

### Sección 4 — Preguntas abiertas
10. ¿Qué fue lo que más te gustó de la demo?
11. ¿Qué parte te costó más entender o usar?
12. ¿Qué le falta a MedCita para que lo uses en tu consultorio mañana mismo?
13. Cualquier otro comentario o sugerencia.

### Sección 5 — Intención de pago (KPI de validación del plan original)
14. Si MedCita costara entre $15 y $30 al mes, ¿lo pagarías para tu consultorio? (Sí, definitivamente · Probablemente sí · No estoy seguro · Probablemente no · No)

## 5. Cómo crear el Google Form real (cuando haya un piloto confirmado)

1. Ir a [forms.google.com](https://forms.google.com) → "Formulario en blanco".
2. Título: "MedCita — Feedback de piloto".
3. Copiar cada pregunta de la sección 4 de este documento:
   - Preguntas 1-3, 10-14 → tipo "Respuesta corta" o "Opción múltiple" según corresponda.
   - Pregunta 4 (NPS) → tipo "Escala lineal", de 0 a 10.
   - Preguntas 5-9 (usabilidad) → tipo "Escala lineal", de 1 a 5, con etiquetas "Muy en desacuerdo" / "Muy de acuerdo", o usar el tipo "Cuadrícula de varias opciones" para agruparlas en una sola pantalla.
4. Activar "Recopilar direcciones de correo electrónico" si se quiere poder contactar de vuelta a cada médico piloto.
5. Compartir → copiar el link corto y agregarlo al guion de la sección 2 (paso 8), y a este documento una vez creado.

## 6. Métrica global del piloto (referencia del plan original)

El plan original definía como KPI de validación: **5 médicos confirmando intención de pago** (pregunta 14). Con 3 médicos piloto disponibles en esta fase, la meta ajustada realista es: **3 de 3 respondiendo "Sí, definitivamente" o "Probablemente sí"** en la pregunta 14, antes de considerar el piloto exitoso.
