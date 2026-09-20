# DOMUS 3.0 · Tesorería 3.0

Primer bloque funcional posterior a Alpha 3. No modifica producción ni el esquema de Supabase.

## Criterios

- Separa importe bruto, coste y neto prefinanciado.
- La fecha efectiva sigue esta prioridad: real/liquidación, prefinanciación, reprogramación, previsión, vencimiento y ocurrencia.
- Deriva los estados `previsto`, `pendiente`, `vencido`, `realizado`, `reprogramado`, `prefinanciado`, `liquidado` y `cancelado`.
- Conserva la fecha original al reprogramar.
- Calcula totales y proyección cronológica por cuenta sin sustituir datos reales por previsiones.
- El adaptador acepta las ocurrencias generadas por el modelo 2.5.8.

## Seguridad de datos

Este bloque es deliberadamente de solo cálculo. No ejecuta `INSERT`, `UPDATE`, `DELETE` ni migraciones. La futura persistencia será una migración aditiva y requerirá comparación antes/después.

## Verificación

Instalar las dependencias de desarrollo con `pnpm install --frozen-lockfile --ignore-scripts` y ejecutar `pnpm test` (o `node --test`). Las pruebas cubren clasificación temporal, precedencia de estados, reprogramación, prefinanciación, cancelaciones, saldos por cuenta, horizontes y compatibilidad heredada. Desde Alpha 12 incluyen PostgreSQL en memoria; `pnpm run test:rls` ejecuta solo esas pruebas.

## Alpha 5

- Integración no destructiva del motor con `index.html` mediante un puente de compatibilidad.
- Paneles separados para estados reales y previsiones, próximo cobro, pagos hasta el próximo cobro, horizontes acumulados y flujo real por cuenta.
- Desglose navegable de todas las cifras.
- El simulador heredado de prefinanciación se conserva plegado durante la transición.
- Los módulos de Tesorería 3.0 se incluyen en la caché offline de la rama de desarrollo.

## Alpha 6

- El saldo calculado por cuenta parte exclusivamente de un saldo inicial confirmado y fechado; si falta alguno, la interfaz explica por qué no ofrece una cifra.
- La conciliación importa extractos CSV de forma local, admite columnas de importe único o cargo/abono y no escribe datos.
- Las coincidencias se proponen por importe exacto, proximidad de fecha y similitud de concepto o referencia.
- Los casos ambiguos, incompletos o sin coincidencia quedan señalados para revisión; ninguna propuesta se confirma automáticamente.
- Un movimiento de DOMUS no puede asignarse como propuesta principal a dos líneas distintas del mismo extracto.
- La persistencia de saldos iniciales, extractos y confirmaciones queda aplazada hasta aprobar una migración aditiva, reversible y auditable.

### Contrato CSV provisional

Se admite separador coma o punto y coma, fechas ISO o `dd/mm/aaaa`, y encabezados habituales en español o inglés. Cada fila debe contener `fecha`, `concepto` y `importe`, o bien `fecha`, `concepto`, `cargo` y `abono`. Los importes se normalizan únicamente en memoria y el fichero no se transmite ni se conserva.

### Diseño de persistencia pendiente de autorización

Una futura migración debería mantener checkpoints de saldo por cuenta en una tabla separada, con fecha, importe, origen y metadatos de auditoría, y guardar extractos y vínculos de conciliación como registros independientes. No debe sobrescribir saldos ni estados existentes. Este diseño es informativo: Alpha 6 no incluye ni ejecuta SQL de migración.

## Alpha 7

- Cada línea del extracto dispone de una revisión explícita: seleccionar candidato, confirmar localmente o descartar.
- Las coincidencias ambiguas nunca llegan preseleccionadas.
- Una misma operación DOMUS no puede confirmarse para dos líneas del extracto.
- Las decisiones cerradas no se alteran accidentalmente durante la sesión.
- Las confirmaciones generan únicamente un borrador trazable en memoria; al recargar o salir se pierden y no se envían a Supabase.
- La propuesta de persistencia futura está documentada en `ALPHA7-PERSISTENCIA-PROPUESTA.md`, sin SQL ejecutable.

## Alpha 8

- Permite introducir en memoria un saldo inicial confirmado y su fecha para cada cuenta.
- Calcula el saldo desde ese checkpoint usando exclusivamente movimientos reales posteriores.
- Compara el saldo calculado con un saldo bancario observado y muestra el descuadre exacto sin crear movimientos compensatorios.
- Los checkpoints y comprobaciones se pierden al cerrar o recargar la aplicación y nunca se envían a Supabase.
- Incluye bajo `database/proposals/` un borrador aditivo y su reversión para revisión; ambos están expresamente bloqueados hasta auditar el esquema real y obtener autorización.

## Alpha 9

- Obliga a seleccionar la cuenta bancaria antes de leer un extracto.
- Compara las líneas solo con movimientos reales de esa cuenta; no propone movimientos de otras cuentas.
- Calcula en el navegador la huella SHA-256 del contenido y bloquea la revisión duplicada del mismo fichero para la misma cuenta durante la sesión.
- La misma huella puede revisarse para otra cuenta, porque la identidad de importación combina cuenta y contenido.
- Genera un informe JSON descargable con cuenta, fichero, huella, resumen, decisiones y vínculos seleccionados.
- El informe declara expresamente `persisted: false`; su descarga no confirma ni guarda conciliaciones.
- Incorpora recuperación de contraseña: solicitud de correo, detección de `PASSWORD_RECOVERY` y formulario para establecer una contraseña nueva.
- La solicitud devuelve siempre un mensaje genérico y no revela si el correo existe.
- La recuperación conserva el mismo usuario y, por tanto, su pertenencia al hogar compartido; no crea una segunda cuenta.

## Alpha 10

- Añade una propuesta SQL de persistencia y su reversión bajo `database/proposals/`, sin activarlas en la aplicación.
- Las propuestas requieren autorización y validación de esquema/RLS antes de ejecutarse.

## Alpha 11

- Permite descargar un borrador JSON del saldo introducido para una cuenta del hogar activo.
- Valida hogar, cuenta, fecha e importe decimal sin redondearlo. El borrador declara `persisted: false` y no envía datos a Supabase.
- La descarga no cambia el saldo calculado: «Usar localmente» mantiene su función separada.
- Limpia saldos y huellas temporales al cambiar usuario u hogar o perder la sesión; invalida lecturas CSV pendientes de otro contexto.
- Diagnóstico, pruebas y riesgos pendientes de la propuesta SQL: [auditoría Alpha 11](ALPHA11-AUDITORIA.md).

## Alpha 12

- Nueva propuesta SQL con referencias correlacionadas explícitas para impedir cruces entre hogares, incluso con doble membresía.
- Sustituye cascadas por restricciones para conservar el historial ante borrados de entidades padre.
- Añade 21 pruebas SQL ejecutadas en PostgreSQL en memoria: RLS, integridad, duplicados, revocaciones y reversión aislada.
- Las propuestas anteriores se conservan como antecedentes. No se aplica ninguna migración a Supabase ni se activa persistencia en la aplicación.
- Instrucciones reproducibles y límites: [informe Alpha 12](ALPHA12-RLS.md).

## Alpha 13

- Auditoría temporal fijada por el servidor y líneas idénticas conservadas por ordinal.
- 77 pruebas correctas; SQL solo en memoria. [Detalle y límites](ALPHA13-AUDITORIA.md).

## Alpha 14

- Parser CSV estricto: comillas escapadas, campos multilínea, fechas reales, importes no ambiguos y errores localizados. Límites: 5 MB y 5000 movimientos. No mezcla importe único y cargo/abono; no deduplica líneas idénticas.
- Revisiones en memoria conservadas al renderizar. Reabrir una revisión o importar su fichero de nuevo permite continuarla. Un cambio en los movimientos marca el informe como obsoleto (`stale`) y bloquea decisiones; reimportar genera otra revisión conservando la anterior. Cerrar sesión o recargar sigue borrando datos no persistidos.
- Snapshot propio de Tesorería con todo el historial conocido, sin recorte de cinco años; incluye estados realizados anticipadamente. Movimientos se cargan por páginas; la paginación de estados quedó pendiente y se corrige en Alpha 15. Los errores de carga no publican resultados parciales. El snapshot no garantiza consistencia transaccional entre páginas concurrentemente modificadas.
- 86 pruebas correctas. No se activa persistencia ni se consulta producción durante las pruebas.

## Alpha 15

- PWA empaquetada bajo `/domus-3/`, con SDK fijado y recursos offline, identidad, cachés y almacenamiento separados.
- Recuperación probada con SDK real y HTTP simulado; corrige la carrera que ocultaba el formulario. Mantiene usuario y hogar.
- Tablas desplazables dentro de las tarjetas y formularios a 390 px; checkpoints y revisión bancaria probados en navegador.
- Paginación de estados históricos verificada con 1.201 registros; protección frente a respuestas de otro contexto de usuario/hogar.
- 95 pruebas Node y cuatro escenarios de navegador. Persistencia SQL sigue siendo propuesta; no es aún RC. [Resultados, reproducción y pendientes](ALPHA15-AUDITORIA.md).

## Alpha 16 · PRE-RC

- Propuesta consolidada `alpha16_prerc_up.sql` para instalación futura nueva: FK compuestas, cuenta de conciliación derivada y grants mínimos explícitos. Sustituye como candidata a las anteriores; no es una actualización incremental.
- Rollback vacío probado y bloqueado si existe historial. No se modifica el movimiento original ni se activa persistencia.
- Conflictos offline conservados, sincronización simultánea unificada, cancelación de recuperación y mejoras de teclado/labels.
- 103 pruebas Node (28 SQL aisladas), 12 escenarios de navegador y cuatro tamaños de pantalla. PostgreSQL real multiconexión sigue pendiente; harness local preparado.
- [Auditoría, pruebas y bloqueantes para RC](ALPHA16-AUDITORIA.md).

## Alpha 17 · RC readiness

- Configuración pública explícita sin backend por defecto. Flag y kill switch del nuevo contrato; UI local o bloqueada mientras no haya adaptador remoto.
- Adaptador SQL transaccional probado con PGlite: importación atómica, líneas idénticas, confirmación, revocación, idempotencia, rollback y respuesta perdida. No hay transporte hacia producción ni API remota conectada.
- Fallos de IndexedDB visibles, snapshots incompletos rechazados, respuestas de refresh fuera de orden descartadas y snapshot/estado vaciados al perder membership.
- 120 pruebas Node, incluidas 35 SQL aisladas; 20 escenarios de navegador y actualización desde los archivos Alpha 16 hasta Alpha 17. PostgreSQL real, staging y dispositivos físicos pendientes.
- [Matriz y bloqueantes reales](ALPHA17-RC-READINESS.md) · [Preparación de staging sin desplegar](STAGING-3.0.md).

## Alpha 18 · Persistence runtime

- API transaccional y recibos idempotentes del servidor; revisiones de fuentes y conciliaciones. Propuesta SQL aditiva, exclusivamente ensayada en fixtures PGlite.
- Outbox IndexedDB por contexto, leases, retries acotados, recuperación tras cierre y conflictos conservados. UI para preparar saldos/extractos/conciliaciones/revocaciones, consultar historial y revisar conflictos.
- 154 pruebas Node, 48 SQL incluidas; 28 escenarios de navegador. PWA Alpha17→18 y ocho ensayos nuevos con reinicio real del navegador.
- Flag remoto OFF; endpoint alojado, proveedores reales Auth/SQL, PostgreSQL multiconexión, staging y dispositivos físicos pendientes.
- [Arquitectura, evidencia, límites y matriz RC](ALPHA18-PERSISTENCE-RUNTIME.md).
