# Alpha 17 · RC readiness

Versión `3.0.0-alpha.17`, build `30017`. Fecha: 2026-09-20. **Sigue siendo Alpha; no se declara RC1.**

## Estado inicial y verificación

Rama exclusiva `domus-3.0`, HEAD/origin `df73b401c269b81962c621d4c74df88318d454dd`, árbol limpio, confirmado mediante fetch. Antes de modificar código se ejecutaron las **103 pruebas Node**, build/check y los **12 escenarios de navegador** de Alpha 16, todos correctos.

Resultado final:

- **120/120 pruebas Node**, cero fallos, canceladas u omitidas.
- Incluyen **35/35 pruebas con SQL PGlite aislado**: 28 de RLS/integridad y siete del nuevo ciclo transaccional de persistencia. No son PostgreSQL real multiconexión.
- **20/20 escenarios de navegador** con SDK real y HTTP ficticio: los doce anteriores; Android grande y landscape; XSS; doble apertura de recuperación; signup/confirmación; variantes de membership; backend no configurado; token inválido. Cada escenario contiene varias comprobaciones, no equivale a un dispositivo físico certificado.
- Build de **25 archivos**. Sintaxis de **42 archivos JS y un script inline**, JSON/versionado/rutas/inventario correctos. `git diff --check` y `pnpm run audit:security` correctos. No hay lint/typecheck adicional configurado.
- El intento de PostgreSQL real termina en preflight `initdb ENOENT`, sin crear clúster ni ejecutar SQL. No se instala software.

Reproducción: `pnpm test`, `pnpm run build`, `pnpm run check`, `pnpm run audit:security`, `pnpm run test:browser`. La prueba de actualización requiere el commit Alpha 16 disponible en el repositorio Git local. No usar el entorno productivo para completar las pruebas.

## Cambios y fallos corregidos

### Configuración y apagado de persistencia

Se retira del HTML activo la URL/clave pública fija del proyecto anterior. `config.js` queda sin backend; no se crea cliente ni se permite iniciar Auth hasta configurar explícitamente uno aislado. La validación rechaza claves no publishable, URL no HTTPS, credenciales, query y fragmentos. Los archivos históricos no se modifican y no forman parte del build.

El nuevo puerto `createTreasuryPersistence` no descubre Supabase ni utiliza variables globales para activar escrituras. Solo `enabled === true` con backend explícito permite operar; sin configuración permanece local y sin adaptador permanece bloqueado. La UI declara el modo local/bloqueado. Se comprueban contexto de usuario/hogar, kill switch, respuesta obsoleta y timeout. Un timeout indica resultado desconocido: no prueba que el servidor haya hecho rollback. Cambiar el flag no puede deshacer una transacción ya confirmada.

La interfaz actual **no conecta este puerto a un transporte remoto**. Configurar Auth no activa las cuatro tablas nuevas de Tesorería. Las funciones heredadas de edición tienen su propio contrato; el flag de Tesorería no es un sustituto de su RLS. Con el paquete sin configurar tampoco existe cliente para esas funciones.

### Persistencia aislada y recuperación

`sql-persistence.js` es un adaptador SQL que exige una transacción ya autenticada en el servidor. No contiene cliente HTTP ni claves; no debe conectarse desde el navegador a SQL. Las pruebas inyectan PGlite con `authenticated`, sin propiedad de tablas ni BYPASSRLS, y actor de fixture fijado por el backend, independiente del payload.

El recorrido probado usa el parser y matching/review reales: CSV → importación atómica → líneas → propuesta/revisión → confirmación → lectura → revocación con auditoría. Comprueba checkpoints, duplicados/reimportación, dos líneas idénticas con ordinal distinto, rollback a mitad de importación, reintento, pérdida de respuesta después del commit y reconstrucción del puerto. Una identidad de confirmación repetida devuelve el mismo resultado solo si el contenido coincide y sigue confirmado; no resucita una revocación. La revocación repetida con otro motivo se rechaza. Los movimientos originales permanecen iguales.

Se corrigieron dos problemas encontrados por estos ensayos: normalizar una fecha SQL devuelta como Date al comparar reintentos, y evitar `SELECT FOR UPDATE` sobre historial revocado, porque la política UPDATE solo permite filas confirmadas. La revocación ahora consulta el historial bajo SELECT, actualiza de forma condicionada y comprueba el resultado ganador. Las carreras de este patrón aún requieren PostgreSQL multiconexión.

La cola heredada ya conservaba conflictos desde Alpha 16. Ahora una lectura fallida de IndexedDB no se convierte en cola vacía “sincronizada”; snapshots incompletos o cruzados se rechazan. Las lecturas concurrentes de refresh tienen generación: una respuesta antigua del mismo hogar no reemplaza otra más reciente. Al observar pérdida de membership se vacían el estado del hogar, Tesorería y su snapshot para impedir restaurarlo después como si siguiera autorizado. No se borra la cola pendiente ni historial del backend.

**Persistencia aislada global: PARCIAL.** El contrato SQL se ejecuta realmente en PGlite, pero no hay todavía UI → API/RPC aislada ni outbox/journal durable de las operaciones nuevas. El ensayo de cola tras revocación usa un borrador en memoria conservado explícitamente. No demuestra recuperación de una cola bancaria persistida después de cerrar el navegador. Cerrar una revisión local sigue perdiendo estado no descargado; la UI lo declara local y nunca lo presenta como confirmación remota.

### Auth, PWA y perfiles

Auth queda **validado contractualmente**, usando SDK real con endpoints interceptados: signup sin sesión hasta confirmar, confirmación, login/error, restauración, logout local, recuperación, updateUser, cancelación, enlace caducado, token rechazado, doble apertura y hogares cero/uno/dos. Cambiar/retirar membership limpia el estado observado; las pruebas de RLS comprueban rechazo posterior. No se crea una segunda cuenta en recuperación. El servidor ficticio NO certifica firma, consumo único del token, SMTP ni políticas reales de Auth.

Los redirects se centralizan en el origen/ruta del documento actual y descartan parámetros/fragmentos; se prueba una URL HTTPS pública ficticia, sin depender de loopback. La guía [STAGING-3.0](STAGING-3.0.md) define configuración permitida y allowlist futura.

PWA: el servidor de prueba obtiene los archivos de Alpha 16 directamente del commit y los sirve en loopback; el SDK conserva su versión fijada. Instala ese shell, lo abre offline y comprueba APP_BUILD 30016. Después sirve Alpha 17 y verifica build 30017, limpieza de cachés propias antiguas, conservación de localStorage/IndexedDB ficticios, legacy caches intactas, actualización posterior fallida sin sustituir al activo, start_url, vuelta online y ausencia de pantalla vacía. Todos los endpoints Auth/API, incluidos los que usa el HTML histórico de Alpha 16, están interceptados: no se consulta producción.

Perfiles: 390×844 (iPhone por tamaño), 360×800 y 412×915 (Android por tamaño), 768×1024, 1440×900 y 844×390 horizontal, manteniendo también la comprobación de 1280 px. Auth/recuperación y vistas recorridas sin overflow global; tablas desplazan dentro de sus tarjetas. Motor Edge headless, no Safari/WebKit ni hardware Android. Permanecen pendientes instalación real desde icono, límites de almacenamiento y navegación física.

## Seguridad y auditoría de apariciones

`audit:security` revisa 19 archivos del runtime activo y rechaza patrones de clave privada, clave secreta, rol privilegiado, URL Supabase fija y console.log. Emite rutas/líneas, nunca valores de tokens. Clasifica también apariciones del repositorio completo:

| Grupo | Resultado y tratamiento |
|---|---|
| Runtime | Sin secretos/credenciales privadas detectados por los patrones. Las únicas URL externas fijas restantes son OCR/PDF de jsDelivr; no son Auth ni backend. Sus funciones siguen fuera de la certificación offline. |
| Logs | Se eliminan objetos de error de los avisos de copia local, sync y SW para no volcar respuestas/datos sensibles. Se conservan mensajes genéricos de diagnóstico. |
| Tests/harness | Loopback, dominios `.invalid`, contraseñas y tokens ficticios, console.log de resultados y patrones de detección son deliberados. No se copian al paquete. |
| Históricos 2.x | Conservan sus referencias originales por la prohibición de modificarlos; fuera del build de DOMUS 3.0. No se hizo una rotación ni auditoría completa de historial Git. |
| Documentación | URLs/credenciales de ejemplo, comandos de validación y limitaciones. No son configuración operativa. |
| TODO/FIXME/TEMP/DEBUG | No se encontraron pendientes de esos marcadores en el runtime activo; las limitaciones reales siguen documentadas, no se ocultan quitando comentarios. |

Pruebas negativas: concepto malicioso de movimiento y CSV con `<img onerror>` permanece como texto; no crea imagen ni ejecuta script. SQL parametrizado y RLS rechazan hogar/cuenta/serie/ocurrencia manipulados, actor falso, replay incompatible, duplicación y alteración de auditoría. Los exports de Tesorería son JSON, no CSV de hoja de cálculo: **formula injection al exportar CSV: NO APLICA** al flujo actual. No se añade exportador CSV.

Estos checks no son un pentest completo ni una prueba de ausencia absoluta de secretos. No se hizo pentesting ni consultas a producción.

## PostgreSQL real

No se encontraron PostgreSQL/psql/pg_ctl/initdb, Docker, Podman ni nerdctl en PATH, ni una instalación estándar en Program Files. No se instaló nada; se conserva el diagnóstico previo de WSL no instalado. **PENDIENTE**, no se equipara PGlite con conexiones PostgreSQL independientes.

Se amplía el harness con seis carreras (checkpoint duplicado, misma línea, misma ocurrencia, confirmación frente a revocación, revocación repetida e importación duplicada), observación de bloqueos, rollback de transacción fallida, líneas idénticas, integridad, lecturas concurrentes por hogar y auditoría. Admite clúster temporal propio o `DATABASE_URL` local de base vacía explícitamente confirmada; valida el destino antes de cualquier conexión. Guardas de destino probadas con dos tests. Requisitos y comandos exactos en STAGING-3.0. **El harness no ha ejecutado esas carreras en esta máquina; su resultado sigue sin certificar.**

## Matriz de preparación

Las etiquetas indican el alcance de evidencia, no aprobación global de RC.

| Área | Estado | Evidencia / pendiente |
|---|---|---|
| Core | VALIDADO EN ENTORNO AISLADO | Regresión lógica y UI recorrida; no todos los módulos heredados. |
| Auth | VALIDADO EN ENTORNO AISLADO | SDK real + mocks contractuales; correo/token real PENDIENTE DE STAGING. |
| Household isolation | VALIDADO EN ENTORNO AISLADO | RLS y fixtures dos hogares/cinco usuarios; configuración real PENDIENTE DE STAGING. |
| Treasury | VALIDADO EN ENTORNO AISLADO | Borradores, checkpoints, historial, stale y paginación; wiring remoto pendiente. |
| CSV | VALIDADO | Contratos puros estrictos, multiline, decimales, ordinales y límites; XSS aislado. |
| Persistence | VALIDADO EN ENTORNO AISLADO | Solo contrato SQL/transacciones PGlite; resultado global PARCIAL, API/outbox pendientes. |
| Reconciliation | VALIDADO EN ENTORNO AISLADO | Identidad, replay y auditoría; concurrencia real PENDIENTE DE STAGING. |
| Concurrency | PENDIENTE DE STAGING | O PostgreSQL local real con binarios disponibles; harness sin ejecución real. |
| Offline | VALIDADO EN ENTORNO AISLADO | Shell, namespace, fallos y conservación; journal bancario durable pendiente. |
| PWA | PENDIENTE DE DISPOSITIVO FÍSICO | Ciclo Alpha 16→17 probado en Edge aislado; instalación física no certificada. |
| Responsive | PENDIENTE DE DISPOSITIVO FÍSICO | Seis viewports/landscape comprobados, hardware/motores nativos pendientes. |
| Security | VALIDADO EN ENTORNO AISLADO | Casos negativos concretos y gate estático; RLS desplegada y pentest no certificados. |
| Recovery | VALIDADO EN ENTORNO AISLADO | Rollback/reintentos/respuestas perdidas; cierre real con outbox pendiente. |
| Staging | PENDIENTE DE AUTORIZACIÓN | Guía preparada; no provisionado ni desplegado. |
| Production migration | PENDIENTE DE AUTORIZACIÓN | Solo propuesta Alpha 16; ningún SQL aplicado a producción. |
| Export CSV/formulas | NO APLICA | Exportación actual JSON. |

## Respuesta objetiva sobre RC1

**¿Hay bloqueantes de CÓDIGO? Sí.** API/RPC transaccional autenticada e integración explícita con UI, incluido control de versión del movimiento entre revisión y commit; journal/outbox durable, restauración de revisiones y resolución de conflictos de la cola heredada; pruebas de extremo a extremo de ese transporte ante caída/revocación. La ausencia de esas piezas no se resuelve poniendo el flag en true.

**¿Hay bloqueantes de INFRAESTRUCTURA? Sí.** PostgreSQL multiconexión real, backend/Auth aislado equivalente, esquema base y políticas contrastados, correo de pruebas y origen HTTPS independiente aprobado. Ninguno justifica usar producción.

**¿Hay pruebas exclusivas de staging/dispositivo? Sí.** Entrega y consumo real de correo/token, endpoints/RLS/RPC desplegados, instalación/actualización física iPhone/Android, coexistencia efectiva con 2.5.8 y comportamiento de almacenamiento offline bajo presión.

Main, DOMUS 2.5.8 y Supabase producción permanecen intactos. No hubo deploy, migración real, usuarios/correos reales, credenciales privadas ni cambios de datos reales. Solo código, pruebas y documentación en `domus-3.0`.
