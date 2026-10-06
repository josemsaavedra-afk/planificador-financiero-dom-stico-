# Staging independiente de DOMUS 3.0

Estado: preparado para una publicación estática posterior autorizada. **No desplegado.** Se conserva **3.0.0-alpha.19 / build 30019**, desde `0c98701e88dd6ebccbaa0daaafbd5dd226b1ae80`, rama exclusiva `domus-3.0`. No se crea Alpha 20 ni se activa persistencia remota.

## Qué se publica y qué funciona inicialmente

El build portable genera `dist/domus-3/`. Se publica **dist como raíz**, conservando la carpeta `domus-3`. Entrada canónica: **ORIGEN_HTTPS_DEL_STAGING + /domus-3/index.html**. El origen aún no se ha elegido; no existe una URL de despliegue fijada en código.

El paquete inicial arranca sin Supabase: muestra el aviso de backend sin configurar, desactiva Auth y permite comprobar carga, assets, manifest, instalación y shell offline. No permite entrar con cuentas ni demuestra operaciones financieras reales. No es RC1 ni un staging funcional con backend. OCR/PDF usa recursos externos de jsDelivr; esas funciones no tienen garantía offline.

No se publican el repositorio completo, HTML 2.x, SQL, tests, `server/`, node_modules, archivos de entorno ni credenciales. Los adaptadores de servidor Alpha 19 **no se despliegan** en este hosting estático. La salida actual contiene 31 archivos comprobados por inventario.

## Requisitos

- Proyecto de hosting **nuevo e independiente**; origen HTTPS distinto del de DOMUS 2.5.8. No reutilizar su proyecto, dominio, alias, despliegue ni credenciales.
- Rama de origen `domus-3.0`; comprobar SHA y árbol limpio antes de publicar. No hacer merge a main para desplegar.
- Node.js 24.x y pnpm compatible con lockfile v9. Instalar también devDependencies: el SDK que empaqueta el build está fijado allí.
- Dominio/alias estable propio de staging; evitar URLs de preview efímeras para instalar PWA o probar enlaces Auth. Debe ser accesible desde iPhone/Android por HTTPS válido. Si existe protección de acceso del hosting, comprobar que permite descargar manifest/SW/assets en esos dispositivos y al abrir desde el icono; no relajar la protección de otros proyectos.
- Usuarios y datos ficticios si posteriormente se autoriza un backend aislado. El staging inicial no necesita cuentas, base de datos, API ni variables de entorno.

## Build y hosting portable

Desde la raíz del checkout de `domus-3.0`:

```sh
pnpm install --frozen-lockfile --ignore-scripts --prod=false
pnpm test
pnpm run build
pnpm run check
pnpm run audit:security
```

Para otro proveedor estático, subir posteriormente el contenido de `dist/` como una publicación atómica e implementar este contrato:

| Ajuste | Valor |
|---|---|
| Directorio público | `dist` (NO `dist/domus-3`) |
| Documento | `/domus-3/index.html` |
| Redirecciones temporales | `/`, `/domus-3` y `/domus-3/` → `/domus-3/index.html` |
| URLs limpias | Desactivadas: conservar `.html` |
| Fallback SPA | Ninguno: vistas internas del documento; rutas/recursos desconocidos deben responder 404 |
| Cache-Control en `/domus-3/*` | `no-cache, max-age=0, must-revalidate` |
| X-Content-Type-Options | `nosniff` |
| MIME HTML / JS / JSON / PNG | `text/html`, `application/javascript` o `text/javascript`, `application/json`, `image/png` |
| MIME manifest | `application/manifest+json; charset=utf-8` |
| MIME service worker | `application/javascript; charset=utf-8` |
| Scope permitido del worker | Directorio natural `/domus-3/`; NO enviar `Service-Worker-Allowed: /` |

Las redirecciones conservan query; el navegador conserva el fragmento del enlace Auth. Una vez cargado el documento canónico, signup/recuperación generan la URL sin query ni fragmento. No redirigir HTML hacia una página de login del hosting que pierda dichos parámetros. No convertir errores de assets/API en una respuesta HTML 200.

La caché HTTP revalida; la caché offline del worker sigue siendo explícita por build. Una publicación futura que cambie código o `config.js` en un origen ya instalado necesitará una nueva identidad de build aprobada para actualizar el precache. **Esta preparación no cambia código/config runtime ni build** y está destinada a un origen nuevo.

## Vercel, preparado pero sin ejecutar

`vercel.json` contiene únicamente preset estático (`framework: null`), instalación/build/salida, redirecciones, headers y apagado de despliegues Git automáticos. No crea proyecto ni despliegue y no contiene dominio, variables, funciones o secretos.

Cuando se autorice publicar:

1. Crear o seleccionar exclusivamente un **proyecto nuevo de staging**; nunca vincular este checkout al proyecto de 2.5.8.
2. Raíz del proyecto: raíz del repositorio; Framework Preset: **Other**; Node 24.x. La instalación y build se toman de `vercel.json`; salida `dist`. No establecer `NODE_ENV` para omitir devDependencies.
3. Seleccionar expresamente `domus-3.0` y el SHA revisado como origen del despliegue. Si el panel denomina una rama “Production Branch”, usar `domus-3.0` solamente en **este proyecto independiente de staging**; no modificar la rama/configuración del proyecto real de producción.
4. La importación/publicación inicial o un despliegue manual se realizan solo tras autorización. `git.deploymentEnabled: false` desactiva despliegues automáticos de commits; un push de preparación no es una orden de publicación. No añadir workflow, hook ni tarea que ejecute deploy. Si posteriormente se desean despliegues Git automáticos, autorizar por separado el cambio y limitarlo a `domus-3.0` en este proyecto.
5. Asignar el dominio/alias HTTPS estable del staging; comprobar el contrato HTTP de la tabla y la lista de aceptación inferior. No reasignar alias ni DNS de 2.5.8.

Referencias del proveedor: [configuración estática](https://vercel.com/docs/project-configuration/vercel-json), [desactivar despliegues Git](https://vercel.com/docs/project-configuration/git-configuration#turning-off-all-automatic-deployments). El equivalente portable es publicar `dist` y reproducir los mismos headers/rutas; DOMUS no importa SDKs de hosting.

## Configuración pública y persistencia OFF

No hay variables de entorno obligatorias. El build actual **no sustituye variables de entorno en config.js**. No introducir supuestos nombres de variables esperando que activen Auth.

El archivo público `config.js` conserva:

```js
window.DOMUS_CONFIG = window.DOMUS_CONFIG || Object.freeze({
  supabaseUrl: '',
  supabasePublishableKey: '',
  treasuryPersistence: false
});
```

No proporcionar URL/clave de producción, tokens, contraseñas, conexión SQL ni claves secretas/privilegiadas. No activar el flag, no inyectar un backend mediante `configurePersistence` y no montar la API de Tesorería. El hosting inicial no necesita configurar Supabase en absoluto.

En un trabajo futuro autorizado se podrá generar un `config.js` público usando **solo** la URL HTTPS del proyecto Supabase aislado y su clave pública publishable (`sb_publishable_…`), conservando `treasuryPersistence: false`. Es información visible, no un secreto. Validar el artefacto y su actualización de caché antes de publicar. No modificar ahora el archivo ni mezclar esas credenciales con el proyecto original.

El flag apaga el nuevo contrato de Tesorería, no todos los módulos heredados. Por eso, habilitar Auth posteriormente exige un backend base aislado con esquema, RLS y storage auditados; un proyecto Auth vacío no basta. El fixture SQL es solo de pruebas, no una migración completa. No aplicar automáticamente propuestas SQL desde el build o el hosting.

## Auth y recuperación posteriores

Una vez elegido el origen real, configurar **solo en Supabase Auth del proyecto aislado**:

- Site URL: `ORIGEN_HTTPS_DEL_STAGING/domus-3/index.html`.
- Redirect URLs: esa misma URL exacta, sin comodines globales, `?source=pwa` ni fragmentos.
- Plantillas y proveedor de correo propios del entorno aislado, cuando se autoricen pruebas con correos ficticios/controlados.

`ORIGEN_HTTPS_DEL_STAGING` es un marcador que se sustituirá por el origen elegido, sin barra final; no es una URL que se deba registrar literalmente. No añadir localhost ni previews antiguos a la configuración de este staging.

Signup y recuperación ya derivan el redirect del origen/ruta actual y descartan query/hash y destinos introducidos por usuario. `PASSWORD_RECOVERY` vuelve al mismo documento; cambia la contraseña del mismo usuario y mantiene su hogar. No se crea otra cuenta para recuperar una contraseña. Validar entrega, caducidad y consumo de enlaces más adelante; **esta preparación no envía correos ni cambia Auth**.

## PWA y aislamiento

- Manifest propio: nombre **DOMUS 3.0 · Tesorería**, id/scope `./`, inicio `./index.html?source=pwa`, iconos propios.
- Worker servido desde `/domus-3/sw.js`, registrado con scope `/domus-3/`; rechaza instalación fuera de ese directorio.
- Cachés `domus3:/domus-3:<build>`; limpia solo su prefijo. Sesión y almacenamiento usan prefijos DOMUS 3 y contexto de usuario/hogar.
- El origen distinto impide que un worker legacy de scope raíz controle DOMUS 3.0. No basta una subcarpeta en el origen de 2.5.8 para garantizar esa separación.

### iPhone

1. Abrir el documento canónico del staging en **Safari**, modo normal, con HTTPS válido. Comprobar nombre, aviso de backend sin configurar y ausencia de redirecciones a 2.5.8.
2. Compartir → Añadir a pantalla de inicio (según versión de iOS, activar “Abrir como app web”). Verificar icono/nombre DOMUS 3.
3. Abrir desde el icono, girar portrait/landscape, comprobar tamaño 390 px aproximado, zoom/textos y desplazamiento de tablas sin desbordamiento global.
4. Tras una primera carga online completa, cerrar y reabrir offline: debe abrir el shell, no simular login ni persistencia. Volver online y refrescar.
5. Con backend aislado autorizado posteriormente: login/recuperación y navegación; abrir enlace de recuperación en Safari y desde PWA, comprobando mismo origen/usuario/hogar.

### Android

1. Abrir la URL canónica en **Chrome**, modo normal y HTTPS; comprobar aviso sin backend.
2. Menú → Instalar aplicación/Añadir a pantalla de inicio según dispositivo. Abrir desde el icono y comprobar nombre DOMUS 3 y modo independiente.
3. Repetir portrait/landscape, refresh, cierre/reapertura y shell offline/online. Con backend autorizado, repetir Auth y recuperación.

Las 28 pruebas de navegador usan Edge headless con fixtures; no certifican Safari/iPhone ni Android físicos. Las pruebas de dispositivo y headers del host real se hacen después de una publicación autorizada, no se declaran realizadas ahora.

## Checklist de aceptación tras publicar

- [ ] Proyecto, origen y alias exclusivos; fuente `domus-3.0` y SHA esperado; Alpha 19/build 30019.
- [ ] Raíz y `/domus-3/` llegan a `/domus-3/index.html`; refresh funciona; ruta inexistente devuelve 404.
- [ ] Manifest, SW, SDK, módulos e iconos responden 200 con MIME correcto; no se sirve HTML como JS.
- [ ] HTML/config/asset-manifest/SW revalidan; sin headers que amplíen scope a `/`.
- [ ] En el paquete no aparecen rutas Windows, loopback ni previews antiguos. Configuración vacía y flag false; sin llamadas a Supabase ni escrituras remotas en arranque inicial.
- [ ] PWA DOMUS 3 instalable en ambos dispositivos; scope/start_url correctos; shell offline tras cargar online.
- [ ] DOMUS 2.5.8 sigue en su origen, icono, worker y almacenamiento originales; no se desinstala ni se limpia para probar DOMUS 3.
- [ ] Inspección remota de navegador: registro SW solo `/domus-3/`, caches con prefijo `domus3:`, sin datos de 2.5.8.
- [ ] No activar Auth hasta disponer de proyecto aislado/esquema/RLS; después allowlist exacta y recuperación del mismo usuario/hogar.
- [ ] Anotar URL, SHA, dispositivos/versiones y resultados reales; no confundir preparación del repositorio con certificación de RC1.

## Retirar completamente el staging

1. Conservar antes los informes/borradores ficticios necesarios y anotar cualquier operación pendiente: desinstalar puede perder almacenamiento local.
2. Desactivar solo las publicaciones del proyecto de staging; retirar su alias/dominio y sus despliegues/proyecto cuando se autorice. No tocar DNS, proyectos ni ramas de producción.
3. En cada dispositivo, quitar la PWA DOMUS 3 y borrar los datos de sitio **solo del origen de staging**. La copia offline puede sobrevivir a retirar el hosting; borrar sus datos elimina SW, caches, IndexedDB y sesión. No usar una limpieza global ni borrar el origen de 2.5.8.
4. Si se configuró Auth aislado, retirar la URL de staging de su allowlist/Site URL y revocar únicamente sesiones de pruebas según política; retirar ese backend por separado tras comprobar que no lo usa otro entorno. Nunca actuar sobre Supabase producción.
5. Confirmar que la URL de staging ya no sirve la aplicación, el icono/offline local se ha retirado y 2.5.8 sigue funcionando.

## Validación de esta preparación

Suite Node completa (incluye SQL PGlite aislado), `test:browser`, `test:runtime:browser`, build, check, audit:security y `git diff --check`. Tres pruebas nuevas verifican configuración de hosting, MIME/caché/scope y ausencia de dependencias runtime de loopback/Windows/previews. PostgreSQL multiconexión sigue pendiente de un entorno autorizado con binarios; no es necesario para el staging estático sin backend. No se ejecuta contra producción.

Resultado de esta preparación (2026-09-21): **171/171 pruebas Node**, incluidas **52/52 SQL aisladas**; **28/28 escenarios de navegador** (20 de regresión/Auth/PWA/responsive y 8 de persistencia aislada). Build de 31 archivos; sintaxis de 59 JS y un inline; seguridad de 28 archivos activos y diff correctos. Sin cambios en runtime, versión ni build. No se publicaron servicios ni se realizaron pruebas en dispositivos físicos.

Guías de instalación del fabricante: [Safari/iPhone](https://support.apple.com/guide/iphone/bookmark-a-website-iph42ab2f3a7/ios), [aplicaciones web en Chrome/Android](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en).
