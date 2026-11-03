# S11-01 — Capturas ANTES / DESPUÉS

Cada imagen compara la aplicación en `develop` (34cef73, ANTES) con la rama S11-01 (DESPUÉS), con los mismos datos de demostración. Las de «móvil» son de 390 × 844 y las de «escritorio» de 1280 × 800. Para las capturas se usó un almacenamiento S3 en memoria local (el bucket real todavía no existe: MedCita está en versión de prueba). Las imágenes de ejemplo (logo, firma y sello) se dibujaron para la prueba.

| Imagen | Qué muestra |
|---|---|
| `R1-ANTES-escritorio-ajustes-medico.png` / `R1-DESPUES-…` | Settings de un médico: antes no había dónde guardar el registro profesional ni la firma; ahora la tarjeta «Documents letterhead» |
| `R2-DESPUES-escritorio-medico-firma-y-sello.png` | La tarjeta con los datos guardados, la firma y el sello subidos, y el aviso de que una imagen de más de 500 KB se rechaza |
| `R3-ANTES-escritorio-ajustes-admin.png` / `R3-DESPUES-…` | Settings de un admin: la misma tarjeta, con la sección del consultorio |
| `R3b-DESPUES-escritorio-admin-datos-del-consultorio.png` | La sección del consultorio (dirección, teléfono, correo) y el logo |
| `R4-DESPUES-pdf-vista-previa.png` | La hoja de ejemplo de «Preview letterhead»: logo y consultorio, el médico con su registro, sello y firma al cierre, fecha y página al pie |
| `R5-DESPUES-escritorio-ajustes-secretaria.png` | La secretaría: Settings sin la tarjeta (no emite documentos) |
| `R6-DESPUES-movil-ajustes-medico.png` | Móvil: la tarjeta en una columna, sin desplazamiento horizontal |
| `R7-DESPUES-escritorio-registro-de-actividad.png` | Activity Log: «Uploaded the seal image», sin el contenido de la imagen |
| `R8-DESPUES-escritorio-sin-almacenamiento.png` | Sin bucket configurado: el aviso «File storage not set up», la subida de imágenes desactivada y los datos de texto editables |
