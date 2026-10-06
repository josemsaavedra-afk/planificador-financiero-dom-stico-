# Alpha 15 · PWA, recuperación y móvil

Versión `3.0.0-alpha.15`, build `30015`. Rama exclusiva `domus-3.0`.

## Estado recuperado

El fetch confirmó HEAD y origin/domus-3.0 en `4bc97cd3ec9ba2d0d2d480630322172f4cd3c087` (Alpha 14). Se conservaron los cambios locales nuevos de PWA, SDK, recuperación, estilos, scripts y pruebas; no estaban incorporados al remoto. La suite inicial, incluidos esos cambios pendientes, pasó **89/89** pruebas. No se hizo reset, checkout, merge ni rebase.

## Cambios

- Build explícito en `dist/domus-3/`, con Supabase JS **2.116.0** fijado en lockfile y copiado al paquete. El HTML fuente requiere este build para disponer del SDK local. No se copian HTML históricos, SQL ni dependencias de desarrollo completas.
- Manifest con identidad y rutas relativas al directorio propio: `id` y `scope` `./`, inicio `./index.html?source=pwa`, nombre DOMUS 3. Los iconos se copian bajo ese mismo directorio; no usan rutas absolutas ni recursos de la instalación antigua. Se conserva su imagen actual.
- Service worker limitado a `/domus-3/` (también bajo un prefijo), caché `domus3:<ruta>:<build>` y lista explícita de recursos. Solo elimina cachés de su propio namespace. No cachea API, documentos privados ni URLs de tokens. La instalación necesita completar el precache antes de activar. SDK y módulos de Tesorería disponibles offline.
- Sesión Auth con clave propia por ruta; IndexedDB propio por ruta y usuario. La cola filtra usuario y hogar, conserva operaciones de otros contextos y evita aplicar localmente una operación después de cambiar de contexto. Cerrar sesión usa alcance `local` para no cerrar otras sesiones de la cuenta.
- Recuperación con el contrato real del SDK, sin simular `PASSWORD_RECOVERY` manualmente: vuelta mediante documento nuevo con fragmento de recuperación y peticiones Auth interceptadas. Una navegación al mismo documento cambiando solo el fragmento no reproduce la apertura del correo.
- Corregida una carrera real: una carga de membresía pendiente podía ocultar el formulario después de `PASSWORD_RECOVERY`. Se protege el formulario, la identidad, los envíos duplicados, el reintento y la limpieza de contraseñas/estado. Se limpia la URL y la solicitud no expone mensajes internos sobre existencia de cuentas.
- Diseño a 390 px: columnas que pueden encogerse, formularios apilados y tablas con desplazamiento dentro de su tarjeta, sin eliminar columnas. Contenedores de tablas accesibles mediante teclado.
- Corrección adicional de Alpha 14: **la consulta de estados seguía sin paginar**, aunque su documentación afirmaba lo contrario. Ahora pagina con orden estable por serie/fecha; la prueba de navegador comprueba **1.201 estados** con límite API simulado de 1.000. Las respuestas pendientes no se publican si cambia usuario u hogar.

## Verificación

- **95/95 pruebas Node**, cero fallos, canceladas u omitidas. Incluyen **23 pruebas SQL** PGlite aisladas, regresión CSV, líneas idénticas por ordinal, checkpoints, revisiones/stale, carga histórica, hogares, lecturas CSV obsoletas, auditoría, revocaciones y duplicados. Se añaden seis pruebas funcionales de recuperación y tres de PWA respecto a las 86 de Alpha 14.
- **4/4 escenarios de navegador** con Playwright y Edge headless: (1) solicitud y recuperación usando SDK real, mismo usuario/hogar, discrepancia de contraseñas, checkpoints/descarga, revisión retenida, 1.201 estados y vistas 390/1280 px; (2) IndexedDB real con aislamiento usuario/hogar y conservación de la cola; (3) worker propio, conservación de cachés legacy y recarga offline; (4) enlace caducado sin actualización de usuario.
- Todo HTTP de Supabase se intercepta con datos ficticios; WebSocket bloqueado. Las mutaciones permitidas por el mock son solicitud de recuperación y cambio de contraseña. Cualquier otra mutación falla la prueba: no se crea usuario, hogar ni membresía.
- Build, comprobación de sintaxis JS e inline, JSON y `git diff --check`. Capturas locales en `artifacts/treasury-390.png` y `artifacts/treasury-desktop.png`, excluidas de Git.

Reproducir con Node y pnpm disponibles:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm run build
pnpm run test:browser
```

La prueba usa Edge instalado en Windows; fuera de Windows requiere Chromium de Playwright previamente disponible. El servidor de pruebas es local y efímero. No abrir el paquete contra el backend real para sustituir estas pruebas.

## Pendientes para Alpha 16 / RC

1. Instalación y actualización en dispositivos físicos iPhone/Safari y Android/Chrome. Emular 390 px en Edge no valida WebKit ni instalación nativa. Probar también dos versiones sucesivas y fallos de descarga durante actualización.
2. Aprobar un alojamiento independiente y HTTPS. Servir `dist/` conservando `/domus-3/`; **no publicar el contenido de `dist/domus-3/` en la raíz de DOMUS 2.5.8**. Preferir un origen separado: un worker antiguo con scope `/` podría interceptar la primera navegación al subdirectorio antes de que se instale el nuevo. No se ha modificado ese worker de producción.
3. Validar redirect allowlist, plantilla y entrega de correo con usuarios ficticios en Supabase aislado; comprobar sesión del enlace, caducidad y contraseña nueva contra Auth real. El mock demuestra integración del SDK y conservación de identidad/membresía, no entrega SMTP ni validación criptográfica del servidor.
4. Persistencia de Tesorería sigue desactivada. Alpha 13 continúa como **propuesta para instalación nueva**, no actualización automática de un esquema existente. Auditar esquema/RLS de tablas padre, políticas e índices antes de diseñar activación y migración autorizadas.
5. PGlite usa una conexión: solicitudes simultáneas se encolan. Falta PostgreSQL/Supabase aislado multiconexión para demostrar bloqueos, carreras de confirmación/revocación, cambios de membresía y consistencia transaccional. La paginación por offset tampoco ofrece un snapshot transaccional entre páginas.
6. Revisiones y checkpoints siguen siendo de pestaña; descargar informes para conservarlos. El shell offline no implica persistencia de conciliaciones. Completar recuperación de conflictos de la cola heredada (incluidos duplicados) y pruebas de revocación de acceso mientras hay cambios offline antes de habilitar servicio.
7. OCR/PDF dependen de recursos externos y no se certifican offline; en estas pruebas se sustituyen sus scripts por respuestas vacías. No se certifica compatibilidad completa de todos los módulos heredados.

## Producción

No se ejecutaron migraciones, consultas ni escrituras en Supabase de producción; no se enviaron correos reales ni se alteraron usuarios. No se desplegó ningún artefacto ni se modificó `main` o DOMUS 2.5.8 de producción. Los SQL existentes permanecen sin cambios bajo `database/proposals/`. Alpha 15 **no es todavía una Release Candidate**.
