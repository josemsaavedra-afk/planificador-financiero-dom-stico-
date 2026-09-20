# Alpha 19 · Adaptadores de servidor

Versión `3.0.0-alpha.19`, build `30019`. Continuación desde Alpha 18 `a7c280a2353553bf297db9ba5070117a3fccc80a`, rama `domus-3.0`, árbol inicial limpio y remoto comprobado con fetch. Sin despliegue ni activación de persistencia real.

## Cambios

Se implementan los proveedores que Alpha 18 dejaba como funciones inyectadas:

- `server/treasury-http.js`: handler estándar Fetch `Request → Response`, POST en ruta y origen explícitos, JSON limitado a 8 MiB y diez segundos de lectura, validación del sobre, códigos HTTP, errores públicos y respuestas `no-store`. Comprueba el flag antes de autenticar o consultar SQL. No acepta orígenes cruzados ni métodos alternativos.
- `createAuthVerifier`: exige Bearer explícito y llama a `auth.getUser(token)` del cliente Supabase configurado por el host. No usa cookies, `getSession`, metadatos editables ni el actor aportado en el body como prueba de autenticación. Rechaza usuarios anónimos, errores y tiempos agotados; devuelve solamente el UUID verificado.
- `server/treasury-postgres.js`: proveedor compatible con un pool node-postgres. Reserva una conexión para toda la transacción, fija rol local sin superusuario/BYPASSRLS, actor parametrizado local, timeout de sentencia y bloqueo; hace commit o rollback y devuelve la conexión exactamente una vez. Si el rollback falla descarta la conexión. Perder la conexión durante COMMIT produce resultado desconocido reintentable con la identidad estable del outbox.
- `server/treasury-service.js`: composición explícita de HTTP, Auth y transacción; OFF por defecto. Importar o construir estos módulos no crea listeners, conexiones, proyectos ni despliegues.

Los módulos de servidor quedan fuera del paquete estático/PWA. Sintaxis y auditoría de seguridad ahora también revisan `server/`. No se añaden dependencias, credenciales, migraciones ni cambios de esquema.

## Contrato del host futuro

El host debe proporcionar un cliente Auth de su proyecto **aislado**, sin persistencia ni refresco de sesión en servidor, y un pool PostgreSQL compatible con `connect/query/release`. Debe configurar tamaño máximo y timeout de adquisición del pool, TLS y la identidad SQL permitida. El proveedor verifica el rol efectivo después de `SET LOCAL ROLE`; no concede permisos ni prepara el esquema.

La entrada es `createTreasuryService({enabled, origin, authClient, pool})`. El resultado es un handler Fetch para montar en `/domus-3/api/treasury`. No se elige ni se publica un host en esta sesión. `origin` debe ser HTTPS y coincidir con el origen público; detrás de un proxy el host debe construir la Request desde su configuración confiable, sin aceptar encabezados reenviados arbitrarios como autoridad.

El handler conserva el contrato `{actorId, householdId, operation}` / `{value}` o `{error}` de Alpha 18. `actorId` debe coincidir con la identidad verificada. El hogar se autoriza de nuevo mediante RLS; un token válido no otorga acceso a cualquier hogar. Ninguna identidad SQL del body determina el rol o `auth.uid()`.

Las claves/configuración y la instalación del driver del host no forman parte del bundle del navegador. El proveedor se prueba con un puerto compatible sobre PGlite y con fallos de conexión simulados; **no se afirma conexión a PostgreSQL real ni prueba del protocolo de red del driver**.

## Verificación

- **168/168 pruebas Node**, sin omisiones: las 154 anteriores y catorce nuevas.
- **52 SQL aisladas incluidas**: las 48 anteriores y cuatro recorridos handler → Auth ficticio → proveedor transaccional → RLS/SQL PGlite.
- **28/28 escenarios de navegador** conservados: veinte de Auth/PWA/responsive y ocho de outbox/UI/SQL ficticio. Actualización PWA Alpha 18 → Alpha 19.
- **31 archivos** de paquete estático; **58 JS + un inline** comprobados. Auditoría de **28 archivos activos**, incluido servidor. Build y diff correctos.

Las pruebas nuevas cubren: SDK Auth real con fetch interceptado, token enviado explícitamente, rechazo de identidad ausente/ambigua/anónima, error y timeout de Auth, OFF sin llamadas, métodos/orígenes/rutas, JSON malformado, tamaño sin Content-Length, stream detenido, rollback, descarte de conexión, pérdida durante COMMIT, replay, contexto LOCAL, cambio de actor en conexión reutilizada y pérdida de membresía. Todos los usuarios y datos son ficticios.

Reproducción: `pnpm test`, `pnpm run build`, `pnpm run check`, `pnpm run audit:security`, `pnpm run test:browser`, `pnpm run test:runtime:browser`. No se eliminan ni relajan pruebas previas.

## Evidencia y límites para RC1

Los adaptadores HTTP/Auth/pool pendientes en Alpha 18 están ahora implementados y validados contractualmente. La selección/montaje del host, configuración del pool y cliente Auth y contraste con su esquema continúan pendientes. **No hay endpoint publicado ni RC1.**

Siguen pendientes PostgreSQL multiconexión real, staging HTTPS autorizado, verificación de tokens y correos contra Auth aislado y dispositivos Safari/iPhone/Android físicos. El SDK de las pruebas recibe respuestas interceptadas: no demuestra firma JWT real, revocación inmediata de sesiones ni entrega de correo. Antes de activar escrituras financieras debe verificarse la política efectiva de sesiones; `getUser` no se presenta como garantía de invalidación instantánea de todo access token al cerrar sesión.

Los límites de tamaño HTTP pueden rechazar un CSV cuyo JSON escapado exceda 8 MiB aunque su fichero sea menor de 5 MiB. Se rechaza antes de SQL y la operación local permanece disponible; nunca se trunca el extracto. Los límites del pool/servidor y la protección frente a abuso deben configurarse y verificarse en el host aislado.

`main`, DOMUS 2.5.8 y producción permanecen intactos. No se ha conectado un proyecto Supabase real ni usado datos/usuarios/correos reales. Flag remoto OFF, configuración pública vacía.

Referencias primarias consultadas para el contrato: [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser), [changelog de Supabase](https://supabase.com/changelog), [transacciones node-postgres](https://node-postgres.com/features/transactions). El índice Markdown del changelog no era legible por el navegador de documentación; se consultó su versión HTML. La integración usa las dependencias fijadas existentes, sin actualización de SDK.
