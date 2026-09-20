# Alpha 18 · Persistence runtime

Versión `3.0.0-alpha.18`, build `30018`. Fecha: 2026-09-20. Rama exclusiva `domus-3.0`. **No es RC1 ni una autorización de puesta en servicio. Persistencia remota real desactivada.**

Punto de partida verificado mediante fetch: HEAD/origin `76f760dcde03f9e6da737c335e50a2372056988e`, árbol limpio. Antes de editar: 120/120 Node, 35 SQL incluidas, 20 escenarios de navegador, build, sintaxis y seguridad Alpha 17 correctos.

## Arquitectura y API

La UI solo prepara comandos de dominio. No escribe tablas ni descubre un cliente Supabase. Capas:

1. `persistence-panel.js`: presentación, preparación explícita, doble envío, revisión de conflictos e historial.
2. `persistence-runtime.js`: API, contexto, outbox, leases, retries y recibos locales.
3. `outbox-store.js`: transacciones IndexedDB atómicas; interfaz `list/get/update` inyectable para pruebas.
4. `persistence-transport.js`: transporte opcional HTTPS del mismo origen. Obtiene token al enviar; no lo almacena ni sigue redirecciones.
5. `transactional-backend.js`: handler autenticado y adaptador SQL transaccional. Reutiliza el contrato de dominio SQL Alpha 17 dentro de la MISMA transacción que el recibo.
6. Propuesta aditiva `database/proposals/alpha18_runtime_up.sql`, aplicada en pruebas solo después de `alpha16_prerc_up.sql` sobre fixtures efímeros.

| API | Semántica |
|---|---|
| `createImport` | Prepara CSV completo; importación y todas sus líneas se confirman atómicamente. Equivale a createImport + appendStatementLines dentro de una transacción. No se ofrece append parcial a una importación cerrada. |
| `createCheckpoint` | Prepara saldo fechado inmutable. Un saldo diferente para la misma cuenta/fecha no sobrescribe el anterior. |
| `confirmReconciliation` | Exige identidad, cuenta, línea, serie, ocurrencia y versión de la revisión. No modifica el movimiento ni necesita una segunda marca de estado en la línea. La conciliación es la única fuente de ese vínculo. |
| `revokeReconciliation` | Exige motivo y versión; conserva confirmación original y añade auditoría de revocación. |
| `loadTreasuryState` | Lee imports, líneas, saldos, conciliaciones y revisiones de fuentes del hogar autorizado. Fechas serializadas consistentemente como JSON. |
| `syncPendingOperations` | Procesa únicamente comandos del usuario y hogar activos; comparte ejecución en la misma instancia y leases entre instancias. |
| `retryOperation` | Acción explícita sobre fallo temporal o autorización recuperada; mantiene identidad y registra ronda. Nunca reintenta/rebasa conflictos. |
| `acknowledgeConflict` | Archiva la propuesta rechazando cualquier sobrescritura del servidor; conserva propuesta y evidencia. |

Crear un comando significa **guardado local durable**, no confirmación remota. La UI mantiene ambos conceptos separados. Las revisiones CSV aún no preparadas y el cálculo de saldos locales siguen siendo borradores de pestaña; los comandos ya preparados sobreviven al cierre. El historial muestra saldos/imports persistidos sin reemplazar automáticamente el saldo local de cálculo.

## Atomicidad e idempotencia del servidor

Cada escritura lleva UUID estable como `id`/`idempotencyKey`. El cliente conserva ese UUID antes de enviar. El servidor valida otra vez payload, sesión, hogar y relaciones. Adquiere un advisory lock transaccional por hogar y busca un recibo por **actor + hogar + identidad**:

- Mismo request canónico: devuelve el recibo anterior, aunque el cliente no recibiera la primera respuesta.
- Identidad reutilizada con contenido distinto: `DUPLICATE_OPERATION`, sin modificación.
- Ausencia de recibo: ejecuta dominio e inserta recibo inmutable en una sola transacción.
- Fallo de una línea, confirmación, revocación o inserción del recibo: rollback completo. No queda una entidad sin su recibo.

El recibo de una confirmación es evidencia histórica. Si después hubo revocación, repetir la solicitud original recupera su recibo, **no resucita la conciliación**. `loadTreasuryState` ofrece el estado actual. El panel consulta historial tras sincronizar.

Dos CSV con contenido idéntico conservan la identidad de importación; dos líneas idénticas dentro de un CSV conservan ordinal e identidad distintos. Las restricciones SQL de cuenta/fecha, ordinal y conciliación activa siguen vigentes.

## Versionado y concurrencia

La propuesta añade `treasury_revision` a series, estados de ocurrencia y conciliaciones. Una secuencia del servidor asigna revisiones a inserciones y actualizaciones: no se pueden restaurar versiones enviando un número antiguo; borrar/reinsertar una fuente tampoco recupera la revisión anterior. Los gaps por rollback son deliberados.

Una confirmación lleva `{series, occurrence, lineHash}` capturados al confirmar manualmente una revisión con historial cargado. Una revocación lleva la revisión de la conciliación. El backend compara antes de escribir. Los triggers de modificación/borrado de fuentes toman el mismo lock del hogar que la API, cerrando la carrera entre comprobación y escritura. Los conflictos conservan estado remoto para revisión. Un deadlock/serialization failure es reintentable con la misma identidad.

No existe last-write-wins. El reintento determinista se limita a recuperar un recibo idéntico. Cambiar la base de un conflicto requiere revisar y crear una nueva propuesta; no se recicla el comando rechazado.

**Límite de evidencia:** PGlite ejecuta SQL real, pero no demuestra carreras entre conexiones PostgreSQL independientes. El harness prepara ocho carreras (seis anteriores, edición de fuente frente a lock runtime y colisión de recibos). Su preflight sigue fallando por `initdb ENOENT`; no se instaló PostgreSQL ni se ejecutó SQL remoto.

## Cola durable, recuperación y retries

IndexedDB independiente: `domus3-treasury-outbox:<scope DOMUS 3>`. Registra UUID, tipo, payload permitido, actor/hogar, creación, intentos, estado, causa pública, revisión base, clave idempotente, lease y recibo. No almacena tokens, claves, contraseñas ni perfiles. Los payloads con campos de auditoría o campos desconocidos se rechazan antes de encolar y en servidor.

Estados: `pending`, `syncing`, `confirmed`, `conflict`, `retryable_error`, `permanent_error`. La adquisición de lease y el incremento de intentos son una sola transacción IndexedDB. Un lease vigente de otra instancia no se roba; uno huérfano puede recuperarse al caducar (al menos 60 segundos y el doble del timeout). Agotar intentos no deja `syncing` eterno.

Timeout de envío: 15 segundos. Backoff exponencial desde un segundo, techo cinco minutos, cinco intentos por ronda. **No hay bucle/timer de red en segundo plano:** cada acción de sincronización procesa operaciones elegibles. El usuario puede iniciar una nueva ronda explícita sobre errores temporales conservando la clave. Un timeout es resultado desconocido, no prueba de rollback.

| Caso | Tratamiento |
|---|---|
| Offline/timeout/5xx/408/429/conexión perdida | Reintentable; conserva identidad y payload. |
| Autorización | Error permanente sin retry automático; reintento explícito tras recuperar la misma identidad. |
| Payload/integridad | Error permanente. No se reenvía automáticamente. |
| Versión, hogar, cuenta, fuente, duplicado lógico | Conflicto conservado, no rebase ni envío automático. |

Casos probados: cierre antes del primer envío; commit de servidor con respuesta perdida; navegador cerrado con `syncing`; recuperación del lease después de tiempo simulado; conflicto conservado tras reiniciar Edge. El perfil temporal del navegador se cierra y abre realmente, sin exportar/importar el contenido de IndexedDB. La prueba de lease avanza el reloj de la instancia de recuperación, no altera la fila persistida.

Cambiar hogar, logout o login distinto no elimina pendientes ni los atribuye a otro actor. Una respuesta tardía se conserva para su propietario original y no se muestra en la sesión nueva. El handler compara el actor esperado con la sesión **verificada por el servidor**, por lo que cambiar de token entre preparación y envío tampoco reasigna el comando.

IndexedDB no garantiza permanencia frente a limpieza manual del navegador, modo privado, cuotas o expulsión del sistema. No se promete recuperación después de borrar deliberadamente su almacenamiento. Un fallo de almacenamiento impide enviar una operación que aún no se ha conservado.

## Conflictos y seguridad

Tipos públicos: `ALREADY_CONFIRMED`, `ALREADY_REVOKED`, `STALE_VERSION`, `HOUSEHOLD_MISMATCH`, `ACCOUNT_MISMATCH`, `OCCURRENCE_CONFLICT`, `DUPLICATE_OPERATION`, `SOURCE_CHANGED`, `BACKEND_UNAVAILABLE`, más autorización, validación, integridad, almacenamiento y flag desactivado. La UI muestra explicaciones y propuestas/respuestas escapadas, no SQL ni mensajes internos.

`domus_treasury_executor` es un rol de servidor **NOLOGIN, NOSUPERUSER, NOBYPASSRLS**, con herencia de los permisos limitados de `authenticated`. No es dueño de las tablas base ni una función SECURITY DEFINER. No se concede a `authenticated`. Solo este ejecutor tiene SELECT/INSERT en recibos, bajo RLS por actor/hogar; no dispone de UPDATE/DELETE de recibos. Un navegador autenticado no puede leerlos ni fabricarlos.

El proveedor de transacciones debe verificar la sesión antes de fijar `auth.uid()` y el rol local. Nunca puede usar `actorId` del body como autoridad: ese campo es una condición de coincidencia, no una credencial. Todas las consultas llevan parámetros. Fechas y autores autoritativos proceden de los triggers del servidor. Las propuestas no alteran las políticas Alpha 16 ni permiten borrar historia.

Rollback Alpha 18 solo admite instalación vacía sin recibos, entidades de Tesorería ni revisiones avanzadas de fuentes; después se podría evaluar el rollback Alpha 16. No se ejecutó ninguno fuera de PGlite ficticio.

## Activación consciente e integración futura

El paquete conserva `treasuryPersistence:false`, URL y clave públicas vacías. `true` como texto no activa nada. Sin flag booleano verdadero y backend inyectado, no hay escrituras ni autodetección. Configurar Auth no configura esta API.

En un futuro host aislado se debe montar `createTreasuryRequestHandler` con autenticación verificada y proveedor transaccional PostgreSQL. Su body es `{actorId, householdId, operation}`; el transporte espera `{value}` o `{error:{code,details}}` y códigos HTTP adecuados. El runtime cliente se conecta mediante `DOMUSTreasury3.configurePersistence(backend)`, una sola vez por sesión, únicamente después de la activación explícita. `createTreasuryTransport` implementa el cliente HTTPS; no se configura ningún endpoint en este commit.

No se entrega ni se afirma desplegado un endpoint real, verificador JWT del host, pool PostgreSQL o proyecto Supabase aislado. Esos proveedores son dependencias explícitas; las pruebas inyectan identidades y transacciones ficticias. Montarlos y probarlos contra el esquema real de staging es el **trabajo de integración de código pendiente** antes de activar la función. No se oculta bajo la etiqueta de “solo infraestructura”.

## Verificación y matriz RC

Resultado: **154/154 pruebas Node**, incluidas **48 SQL aisladas** (28 RLS anteriores, siete de persistencia Alpha 17, trece del runtime). **28/28 escenarios de navegador**: veinte de regresión y ocho de persistencia. PWA prueba archivos Alpha 17 → Alpha 18, conservación de almacenamiento, offline y actualización fallida. Auth usa SDK real con HTTP interceptado; no correos ni usuarios reales. Edge headless incluye 390 px, otros perfiles y checks de overflow; no certifica Safari/iPhone físico.

Build de 31 archivos; check de 53 JS + un inline; seguridad de 25 archivos activos; `git diff --check`. No se han eliminado ni relajado pruebas anteriores. Los nuevos ensayos encontraron y corrigieron la serialización inconsistente Date/JSON de lectura y la necesidad de guardar la revisión al decidir, no al enviar.

Reproducción local: `pnpm test`, `pnpm run build`, `pnpm run check`, `pnpm run audit:security`, `pnpm run test:browser`, `pnpm run test:runtime:browser`. El navegador PWA requiere el commit Alpha 17 disponible localmente. `pnpm run test:postgres` queda pendiente de binarios/entorno aislado autorizados.

| Área | Estado y alcance |
|---|---|
| API transaccional | VALIDADA con SQL aislado y recorrido UI → adaptador → SQL. PARCIAL como servicio alojado. |
| Idempotencia | VALIDADA aislada, incluidos import/checkpoint/confirm/revoke y respuesta perdida. |
| Concurrencia optimista | VALIDADA contractualmente en SQL; carreras PostgreSQL multiconexión PENDIENTES. |
| Cola durable | VALIDADA en IndexedDB real con reinicio de navegador. |
| Crash recovery | VALIDADA con commit/respuesta perdida, lease huérfano y reloj controlado. |
| Conflictos | VALIDADOS, preservación y revisión humana sin sobrescritura. |
| RC1 | NO DECLARADA. |

Los tres mecanismos de código ausentes en Alpha 17 están implementados y probados en aislamiento. **Código pendiente para una RC operativa:** montaje del endpoint en el host elegido, integración del verificador de sesión y proveedor SQL transaccional real, y contraste/adaptación de esquema base. Los cálculos locales y la cola heredada continúan separados del nuevo outbox; no se presenta un comando pendiente como saldo remoto confirmado.

**Infraestructura/validación pendiente:** PostgreSQL real multiconexión, staging HTTPS autorizado, Auth y correo aislados de extremo a extremo, esquema/RLS efectivos y dispositivos Safari/iPhone/Android físicos con instalación, actualización y presión de almacenamiento. No hubo despliegue, migración productiva, datos reales, main ni cambios de DOMUS 2.5.8.
