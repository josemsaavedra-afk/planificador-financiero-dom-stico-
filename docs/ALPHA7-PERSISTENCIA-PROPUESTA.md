# Alpha 7 · Propuesta de persistencia (no ejecutable)

Este documento describe el diseño previsto para saldos y conciliaciones. No contiene una migración lista para aplicar y no modifica Supabase.

## Principios

- Tablas nuevas, sin alterar ni reinterpretar movimientos existentes.
- Ningún extracto cambia automáticamente importe, fecha, estado, cuenta, persona o categoría de un movimiento.
- Una conciliación solo nace tras confirmación humana explícita.
- Las correcciones conservan el historial: se revocan o sustituyen, nunca se borran.
- Todas las filas pertenecen a un hogar y deben quedar protegidas por RLS basada en la membresía real del hogar.
- No se usarán metadatos editables del usuario como criterio de autorización.

## Entidades propuestas

### `account_balance_checkpoints`

Registra un saldo confirmado para una cuenta en una fecha determinada.

Campos conceptuales: identificador, hogar, cuenta, fecha de saldo, importe exacto, moneda, origen, creador, fecha de creación y, opcionalmente, referencia al extracto. La combinación cuenta-fecha-origen debe evitar duplicados accidentales.

### `bank_statement_imports`

Registra la cabecera auditable de una importación: hogar, cuenta, nombre del fichero, huella criptográfica, intervalo de fechas, número de líneas, usuario y fecha. El fichero original no debe almacenarse por defecto.

### `bank_statement_lines`

Conserva cada línea normalizada del extracto: importación, fecha, concepto, referencia, importe firmado, ordinal y huella de contenido. Debe impedir que la misma línea se duplique dentro de una importación.

### `treasury_reconciliations`

Relaciona una línea bancaria con un movimiento DOMUS e incluye estado, puntuación propuesta, usuario confirmador, fecha de confirmación, revocación y motivo. Una restricción debe impedir dos confirmaciones activas para la misma línea o para el mismo movimiento.

## Seguridad prevista

- RLS habilitada en todas las tablas expuestas.
- Lectura y escritura limitadas a miembros activos del hogar asociado.
- Las políticas de actualización requieren condiciones equivalentes de lectura y validación del hogar.
- No se prevén funciones `security definer`; si alguna fuera imprescindible, se diseñaría por separado y con permisos explícitos.
- No se concederá acceso genérico por estar simplemente autenticado.

## Secuencia de autorización futura

1. Auditar el esquema real y las políticas actuales en modo lectura.
2. Ajustar nombres y claves foráneas al modelo existente.
3. Generar una migración aditiva y su reversión documentada.
4. Probarla en un entorno aislado con datos ficticios.
5. Ejecutar asesores de seguridad y rendimiento.
6. Presentar SQL, comparación antes/después y plan de recuperación.
7. Aplicarla únicamente tras autorización expresa.

Alpha 7 se detiene antes del paso 1 sobre la base real: no consulta ni modifica tablas de producción.

## Borrador Alpha 8

Alpha 8 incorpora dos ficheros SQL bajo `database/proposals/`: una propuesta aditiva y su reversión. No forman parte de una carpeta de migraciones, no se ejecutan automáticamente y requieren auditar primero los tipos reales de las claves y las políticas existentes.
