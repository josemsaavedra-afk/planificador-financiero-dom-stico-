# Preparación de staging DOMUS 3.0 (sin despliegue)

Alpha 17 no configura ni publica infraestructura. Estas instrucciones son para una ejecución posterior autorizada, con usuarios/datos ficticios y un proyecto Auth/base aislado. Nunca reutilizar el proyecto de producción para comprobarlas.

## Paquete y origen

1. Elegir un origen HTTPS exclusivo de DOMUS 3.0; conservar el subdirectorio `/domus-3/`. Ejemplo de forma: `https://staging-domus.example/domus-3/index.html`. No sustituir la raíz de 2.5.8 ni instalar un worker en su scope.
2. Instalar dependencias con `pnpm install --frozen-lockfile --ignore-scripts`, ejecutar `pnpm test`, `pnpm run build`, `pnpm run check` y `pnpm run audit:security`. Los ensayos de navegador requieren Edge local en Windows y el commit Alpha 16 disponible en Git.
3. Publicar en el futuro únicamente el contenido generado bajo `dist/`, manteniendo la carpeta `domus-3`. No publicar el repositorio, HTML históricos, SQL, pruebas, node_modules ni archivos de entorno. El build actual contiene 25 archivos y el inventario se comprueba automáticamente.
4. Servir `sw.js`, `asset-manifest.js`, `config.js`, HTML y manifest sin caché HTTP persistente; los recursos del shell tienen caché del worker por build. Entregar MIME JavaScript, JSON/manifest y PNG correctos. Redirigir `/domus-3/` a `index.html` o servirlo como documento índice. La aplicación usa vistas internas, no requiere fallback de rutas SPA desconocidas.
5. Subir un paquete coherente de forma atómica; incrementar build cuando cambien código o configuración pública. No servir `Service-Worker-Allowed: /`. Verificar scope `/domus-3/`, nombre DOMUS 3 e identidad relativa del manifest. El origen separado evita interferencias de un worker 2.5.8 de scope raíz.

## Configuración pública y Auth

El archivo fuente `config.js` se distribuye vacío de backend. Con ese valor el acceso muestra un mensaje de configuración, desactiva los botones Auth y no crea cliente Supabase. No hay fallback al antiguo proyecto de producción.

Preparar, exclusivamente para el proyecto aislado, este archivo público antes de generar el paquete:

```js
window.DOMUS_CONFIG = Object.freeze({
  supabaseUrl: 'https://PROYECTO-AISLADO.supabase.co',
  supabasePublishableKey: 'sb_publishable_REEMPLAZAR_POR_CLAVE_PUBLICA_AISLADA',
  treasuryPersistence: false
});
```

Los valores anteriores son marcadores, no credenciales utilizables. Solo se admiten URL HTTPS sin credenciales, query/hash ni subruta y clave con formato publishable; no colocar claves secretas ni claves privilegiadas. La configuración es visible para cualquiera: la seguridad depende de Auth/RLS en el backend. No copiar una sesión, token, contraseña ni .env real al paquete. El audit de la rama exige ausencia de URL Supabase fija en el artefacto fuente por defecto; personalizar staging será un paso posterior revisado.

En Auth del proyecto aislado, aprobar el origen elegido y configurar exactamente la URL del documento en Site URL/redirect allowlist según corresponda, por ejemplo `https://staging-domus.example/domus-3/index.html`, sin comodines globales. Signup y recuperación usan el origen/ruta del documento actual; descartan query/hash y no aceptan `next`/`redirect_to` de entradas de usuario. Las plantillas de confirmación/recuperación y el proveedor de correo deben pertenecer a staging. Verificar entrega, caducidad, consumo de enlace y cambio de contraseña con cuentas ficticias; nada de esto se ejecutó en Alpha 17.

El backend base requiere las tablas/funciones de la aplicación heredada con RLS correctas; el fixture de tests NO es una migración completa de esa aplicación. Preparar y auditar ese esquema aislado antes de activar login en staging. Comprobar especialmente membership, cuentas, series, estados, documentos y storage. No basta con crear un proyecto Auth vacío.

## Persistencia de Tesorería

`treasuryPersistence` debe permanecer **false**. El flag controla el nuevo contrato de las tablas de Tesorería, no sustituye las reglas de los módulos heredados. El modo por defecto conserva borradores/checkpoints y revisiones locales; los informes declaran que no están persistidos.

La interfaz actual no incorpora transporte remoto del nuevo contrato. Incluso con flag `true`, sin backend explícito se muestra **bloqueado** y no se crean escrituras por autodetectar Supabase. `createTreasuryPersistence` acepta un backend explícito y comprueba contexto, kill switch y timeout. `createSqlTreasuryBackend` define operaciones SQL transaccionales para un servidor autenticado; no es un cliente SQL para conectar desde el navegador ni una RPC ya desplegada.

Antes de conectar UI → servidor se necesita una API/RPC transaccional con actor derivado de la sesión validada por el servidor, nunca de los ids recibidos. Debe mantener las garantías probadas en PGlite: importación completa o rollback, identidad de reintentos, confirmaciones inmutables, revocación auditable y conflictos conservados. Faltan outbox/journal durable, recuperación de revisiones entre cierres y resolución explícita de conflictos de la cola heredada. No enviar la cola genérica directamente a las cuatro tablas nuevas.

La propuesta de esquema vigente sigue siendo `alpha16_prerc_up.sql`, únicamente para una instalación nueva previamente revisada. No ejecutarla automáticamente por hacer build, iniciar el cliente o activar un flag. El rollback solo admite tablas vacías. Cualquier migración de producción será otro trabajo con autorización específica, copia y recuperación verificadas.

## PostgreSQL real: comandos pendientes

No se instalaron binarios ni contenedores en Alpha 17. Con `initdb`, `pg_ctl` y `psql` ya disponibles:

```sh
pnpm run test:postgres
```

El harness crea/detiene/elimina solamente su clúster temporal propio en loopback. Para un clúster PostgreSQL aislado ya existente, prístino y sin otras bases de aplicación, basta `psql` y una base **vacía** llamada `domus_test_*`. Ejemplo PowerShell con credenciales ficticias de ese entorno:

```powershell
$env:DATABASE_URL = 'postgresql://fixture:CLAVE_FICTICIA@127.0.0.1:55432/domus_test_alpha17'
$env:DOMUS_TEST_DATABASE = 'domus_test_alpha17'
pnpm run test:postgres
```

Se rechazan hosts externos, bases fuera del prefijo, query/hash, confirmación ausente, tablas existentes, roles Auth preexistentes y clústeres con otras bases de aplicación. Nunca introducir una URL real. En modo DATABASE_URL no elimina el clúster ni sus datos: deja los fixtures para inspección y no admite otra ejecución sobre la base ya poblada. Requiere privilegios locales de fixture para crear roles/esquemas, no una clave Supabase privilegiada.

El harness prepara seis carreras con conexiones independientes y observación de bloqueos, más integridad, rollback, identidad, timestamps y lecturas concurrentes entre hogares. En esta máquina solo se validó su sintaxis, sus guardas y el fallo previo `initdb ENOENT`. **Concurrencia real sigue PENDIENTE.**

## Aceptación antes de RC

- Auth/correo real aislado, pertenencia a cero/uno/dos hogares, revocación y limpieza del cliente.
- API transaccional aislada y pruebas multiconexión; cierre a mitad de import/sync y reintento con identidades conservadas.
- Instalación y actualización física en Safari/iPhone y Chrome/Android; apertura desde icono, portrait/landscape, offline/online y almacenamiento bajo presión.
- Verificar coexistencia con 2.5.8 sin alterar su origen, SW, cachés ni datos. El ensayo local conserva cachés legacy ficticias, no certifica todas las versiones desplegadas.
- Aprobar configuración/URL y procedimiento de despliegue de staging. No hay staging publicado por esta sesión.
