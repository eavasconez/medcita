# S9-08 — Capturas ANTES / DESPUÉS

Cada imagen compara la aplicación en `develop` (64d04ce, ANTES) con la rama S9-08 (DESPUÉS), con los mismos datos de demostración, en una prueba local. El correo de alerta es la carga real que la aplicación entregó al proveedor de correo (no se envió nada); la cabecera «Para / Asunto» sale de esa misma carga.

| Imagen | Qué muestra |
|---|---|
| `R1-bloqueo-sobrevive-al-reinicio.png` | Tras 5 intentos fallidos de login el sexto queda bloqueado. Al reiniciar el servidor, ANTES el bloqueo desaparecía; DESPUÉS sigue |
| `R2-alerta-de-error-500.png` | Un error 500 provocado a propósito (a la base le falta una columna). ANTES nadie lo sabía fuera de los logs; DESPUÉS llega un aviso por correo con la ruta, el consultorio, el dominio y el archivo y la línea exacta del código, sin datos de pacientes |
