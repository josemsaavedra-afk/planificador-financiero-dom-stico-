# Alpha 16 · PRE-RC

Fecha: 2026-09-20. Versión `3.0.0-alpha.16`, build `30016`. No es una RC ni un despliegue.

## Punto de partida y auditoría

Rama `domus-3.0`, árbol limpio, HEAD y origin verificados tras fetch en `6e6cbdce9de5369859653c705dbbb24638207983`. Suite inicial **95/95**. Se preservan las propuestas y pruebas anteriores; no se cambia main ni los HTML históricos.

Se revisaron runtime, Auth, almacenamiento offline, empaquetado PWA, SQL, pruebas y documentación. Las búsquedas de TODO/FIXME, mocks, localhost, rutas antiguas y referencias `index-258` no encontraron conexiones de pruebas en el runtime empaquetado. Los mocks residen solo en pruebas/scripts y el inventario de build los excluye. Las dependencias actuales tienen uso: SDK empaquetado, PGlite aislado y Playwright para navegador. El backend configurado en el HTML sigue siendo el existente: **no abrir este paquete contra datos reales para sustituir las pruebas aisladas**.

## Hallazgos corregidos y arquitectura

1. **Integridad posterior a la confirmación.** Las RLS validaban hogar/cuenta al insertar, pero no preservaban todas las relaciones ante cambios de cuentas o series padre. La propuesta Alpha 16 añade claves/FK compuestas que conservan esa identidad y restringen reasignaciones, incluso desde mantenimiento privilegiado. La cuenta de conciliación se deriva en servidor desde la línea/importación; no puede cambiar durante la revocación.
2. **Privilegios por defecto.** Un entorno con grants predeterminados amplios podría conservar DELETE/TRUNCATE aunque la propuesta otorgase solo permisos limitados. Se revocan explícitamente los permisos de las cuatro tablas a public/anon/authenticated antes de conceder el mínimo. Una nueva prueba prepara deliberadamente defaults amplios y comprueba su neutralización.
3. **Rollback destructivo.** El nuevo rollback se niega a eliminar tablas si existe cualquier historial de Tesorería. El ciclo instalación vacía → rollback → reinstalación se prueba; con datos se prueba rechazo y conservación. No sirve para deshacer una instalación que ya tenga uso: requerirá otro plan autorizado.
4. **Cola offline.** La respuesta 23505 se trataba como éxito y se eliminaba la operación sin comprobar equivalencia. Ahora conserva la operación y muestra el conflicto; dos sincronizaciones simultáneas comparten una única ejecución. No se resuelve un conflicto sobrescribiendo datos. Sigue pendiente una interfaz de resolución explícita y pruebas con RLS/Auth real aislado.
5. **Accesibilidad y cancelación.** Se asocian labels con campos, se anuncia el mensaje Auth, se enfoca la nueva contraseña y se añade cancelación mediante logout local. El modal de movimiento tiene semántica de diálogo, foco inicial, recorrido de Tab contenido, Escape y retorno al foco anterior. Se añade foco visible y límites de anchura a campos.
6. **Verificación reproducible.** `pnpm run check` comprueba sintaxis, JSON/versionado, ausencia de rutas locales/antiguas en runtime e inventario exacto del paquete PWA. Detecta archivos sobrantes o un build obsoleto; no los borra automáticamente.

## Contrato de persistencia

`database/proposals/alpha16_prerc_up.sql` es la propuesta consolidada para una **instalación futura nueva**, junto con `alpha16_prerc_down.sql`. Sustituye como candidata a Alpha 10/12/13. Alpha 14/15 no añadieron propuestas SQL independientes. No aplicar las propuestas consecutivamente ni usar Alpha 16 como migración incremental sobre tablas existentes.

Se conservan RLS e identidad de hogar, cuenta, importador, actor y ocurrencia; timestamps de servidor; referencias restrictivas; historial append-only; confirmación/revocación; unicidad de confirmaciones activas y fichero por hogar/cuenta/huella. Dos líneas bancarias legítimamente idénticas mantienen ordinales distintos. La propuesta no altera importes, conceptos ni fechas del movimiento original y no se conecta al runtime de escritura.

El nuevo `account_id` de conciliación lo deriva un trigger SECURITY INVOKER. No se introduce SECURITY DEFINER ni bypass de RLS. Las claves compuestas añaden restricciones en cuentas/series base: antes de cualquier aplicación futura hay que contrastar sus columnas, permisos, FK, datos existentes e índices con el esquema real autorizado. Las garantías para usuarios autenticados no pretenden impedir que un administrador reescriba arbitrariamente SQL/políticas o datos de importación con privilegios de propietario.

## Aislamiento y concurrencia

Fixture: dos hogares y cinco usuarios ficticios (incluye doble membresía y usuario sin hogar). Se prueban lecturas de cuentas/movimientos/importaciones/líneas/conciliaciones, escrituras cruzadas, autor falso, cuentas ajenas, revocación de membresía, revocaciones auditadas e integridad de padres. Tras retirar una membresía, las consultas posteriores no ven filas y las escrituras fallan; otro miembro legítimo conserva el historial.

**PostgreSQL multiconexión: PENDIENTE.** No hay `postgres`, `pg_ctl`, `psql` ni Docker en PATH, no se encontró instalación estándar PostgreSQL en Program Files y WSL informa que no está instalado. `node scripts/verify-postgres.mjs` se detuvo en el preflight con `initdb ENOENT`, antes de crear un clúster o ejecutar SQL. No se instaló infraestructura ni se usó ningún servicio externo.

El harness preparado acepta únicamente binarios locales y crea su propio clúster temporal con datos ficticios, escucha en loopback y fija sus conexiones; no acepta URL de base de datos. Está diseñado para observar esperas de bloqueo en backends independientes, probar duplicados, confirmaciones concurrentes, revocaciones, reconfirmación e integridad. Incluye timeouts y parada/limpieza del clúster propio. **Solo se comprobó su sintaxis y el preflight fallido; sus carreras NO se han ejecutado ni certificado.** Ejecutar `pnpm run test:postgres` cuando estén disponibles binarios PostgreSQL en un entorno aislado y autorizado.

PGlite sigue encolando una conexión. No demuestra carreras entre membresía/revocación/confirmación, bloqueos reales multiconexión ni aislamiento de snapshots. La paginación por offset tampoco garantiza consistencia transaccional si cambian filas entre páginas.

## Auth y PWA

El navegador usa SDK Supabase real fijado con HTTP completamente simulado y WebSocket bloqueado. Prueba login incorrecto/correcto, restauración, logout local, PASSWORD_RECOVERY, discrepancia y cambio de contraseña, enlace caducado y cancelación. Usuario y hogar se conservan; cualquier endpoint de escritura no previsto (incluido signup o cambios de memberships) hace fallar el mock. Las pruebas Node cubren error/reintento, cambio de usuario durante recuperación, doble envío, reset y respuestas asíncronas obsoletas.

El redirect se prueba también en `https://domus-fixture.invalid/domus-3/index.html`, interceptado íntegramente, sin DNS/servicio externo. El runtime usa origin/ruta actuales y no depende de localhost. No demuestra entrega de correo ni validez de un token ante Auth real.

PWA: registro limpio, scope propio, cachés legacy conservadas, actualización de build ficticio 30000 a 30016 con eliminación de caché anterior, descarga fallida del siguiente build sin perder el activo, recarga offline y apertura del `start_url` del manifest. La caché vacía del intento fallido puede permanecer hasta la siguiente activación válida; no sustituye la versión activa. En el primer ensayo la espera asíncrona no verificaba de forma fiable el estado observado: se sustituyó por lecturas explícitas y acotadas del registro/cachés antes de avanzar; no se eliminaron assertions para hacerlo pasar.

Instalación desde icono real, prompts y coexistencia con un worker 2.5.8 real NO están certificados. Se conservan las precauciones de Alpha 15: directorio `/domus-3/` propio, preferiblemente origen separado aprobado; un worker antiguo de scope raíz puede interceptar la primera visita. No se cambia ese worker.

## Responsive y pruebas exactas

- **103/103 pruebas Node**, cero fallos, omitidas o canceladas. Incluyen **28/28 SQL PGlite**: las 23 anteriores más cinco nuevas de aislamiento, pérdida de membresía, identidad de padres, rollback e imposición de grants mínimos. Tres nuevas pruebas de cola offline completan las ocho añadidas a Alpha 15.
- **12/12 escenarios de navegador**: los cuatro de Alpha 15; tres tamaños adicionales; login/error/restauración/logout; actualización PWA; actualización fallida; cancelación de recuperación; redirect HTTPS público ficticio.
- Viewports: **360×800, 390×844, 768×1024, 1440×900**, además de la comprobación desktop anterior a 1280 px. Auth y recuperación en los cuatro; dashboard, Tesorería, tablas, revisión/checkpoints y modal en la matriz ampliada. Sin overflow horizontal global en las vistas comprobadas. Se prueba teclado/foco y asociación de label del modal; no es una auditoría WCAG ni medición completa de contraste.
- Se mantienen CSV estricto/multilínea, formatos monetarios inequívocos, líneas idénticas por ordinal, fingerprints, stale/historial de revisión, 1.201 estados paginados, recurrence/month-end/leap-day, snapshots y reset por contexto.
- Build de 21 archivos; `pnpm run check`: **32 archivos JS y un script inline**, JSON/versiones/rutas/inventario correctos; `git diff --check` correcto. No hay un lint o typecheck independiente configurado.
- El HTTP 400 de credenciales incorrectas es deliberado en el escenario negativo. No hubo errores JavaScript de página en el recorrido principal. Capturas locales excluidas de Git en `artifacts/`.

Reproducción: `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm test`, `pnpm run build`, `pnpm run check`, `pnpm run test:browser`. Navegador: Edge headless instalado en Windows. Son emulaciones de tamaño, no motores iOS/Android físicos.

## Clasificación de pendientes

**Bloqueantes para RC funcional con persistencia:** PostgreSQL/Supabase aislado real y carreras multiconexión; contraste autorizado de esquema/RLS y activación transaccional de persistencia con idempotencia/importaciones recuperables; resolución de conflictos offline y revocación mientras hay cambios pendientes; Auth/redirect/correo real aislado; pruebas físicas Safari/iPhone y Chrome/Android; elección y validación de alojamiento/origen independiente. No se activa persistencia sobre datos reales para resolver estos bloqueos.

**Importantes no bloqueantes del código PRE-RC local:** auditoría de accesibilidad/contraste completa y lectores de pantalla; compatibilidad de módulos heredados no recorridos; política de retención de snapshots locales; manejo visible de revisión/checkpoints no persistidos y grandes históricos con paginación transaccional futura. Limpiar caché vacía de una instalación fallida sin afectar a la activa.

**Posteriores a RC, si quedan expresamente fuera de su alcance:** OCR/PDF completamente offline, mejoras estéticas de iconos y ampliación de informes. Los scripts OCR/PDF externos siguen simulados en pruebas y no se certifican offline.

## Producción intacta

No hubo despliegues, correos reales, creación de usuarios reales, conexiones de pruebas a Supabase real, migraciones ni INSERT/UPDATE/DELETE de datos reales. No se usaron secretos ni service_role. `main`, DOMUS 2.5.8 de producción y los archivos históricos permanecen intactos. Solo se prepara, prueba, documenta y publica código en `domus-3.0`.
