# Cuatro Padel Performance

Aplicacion web estatica para convertir rutinas de entrenamiento en un plan flexible para jugadores de padel. El usuario registra su nombre localmente, elige fecha de inicio, frecuencia semanal y enfoque de entrenamiento; despues puede consultar calendario, preview de cada rutina, progreso total y sesiones guiadas por etapas.

## Archivos principales

- `cuatro-padel-performance.html`: aplicacion web de Cuatro Padel Performance.
- `cuatro-padel-performance.css`: sistema visual y responsive.
- `cuatro-padel-performance.js`: planificador, busqueda, biblioteca, progreso local y capa didactica.
- `cuatro-firebase.js`: autenticacion con Google, sincronizacion Firestore y tickets de soporte.
- `cuatro-firebase-config.js`: placeholder local; el deploy genera la configuracion real desde GitHub Secrets.
- `performance-data.js`: datos usados por la aplicacion.
- `rutinas-limpias.md`: version limpia en Markdown.
- `rutinas-completas.json`: datos estructurados completos.
- `firestore.rules`: reglas para aislar datos bajo `users/{uid}`.

## GitHub Pages

El sitio se publica con GitHub Actions. El workflow genera el archivo de configuracion Firebase en el artefacto de Pages usando los secretos `VITE_FIREBASE_*`.

URL publica: https://tovimx.github.io/cuatro-padel-performance/
