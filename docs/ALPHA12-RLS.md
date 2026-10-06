# Alpha 12 · Propuesta corregida y pruebas SQL aisladas

## Punto de partida

Después de `git fetch origin`, `domus-3.0` estaba limpia y sincronizada en `06019bc54d1f54f64639581b512666d222879b4e` (0 commits de divergencia). Se revisaron la propuesta Alpha 10 y los riesgos registrados en Alpha 11.

Las políticas antiguas de saldos e importaciones comparaban `a.household_id = household_id` dentro de una subconsulta sobre `accounts`. El nombre sin calificar se resuelve en esa misma tabla. Un miembro de dos hogares puede ver las dos cuentas y superar la comprobación aunque la cuenta no corresponda al hogar de la fila insertada. Las pruebas reproducen este cruce al restaurar temporalmente las expresiones antiguas, y verifican que la propuesta nueva lo rechaza.

## Propuesta Alpha 12

Los archivos `database/proposals/alpha12_treasury_persistence_up.sql` y `alpha12_treasury_persistence_down.sql` son propuestas para revisión, no migraciones registradas ni aplicadas al servidor.

- Todas las referencias correlacionadas de cuenta, hogar, importación, línea y serie identifican expresamente la tabla exterior.
- Se mantienen autoría vinculada a `auth.uid()`, membresía, permisos mínimos, identidad inmutable de conciliación e índices de unicidad para confirmaciones activas.
- Las FK antes definidas con `ON DELETE CASCADE` pasan a `ON DELETE RESTRICT`, para impedir que eliminar una cuenta, hogar o importación borre su historial de Tesorería como efecto secundario.
- Se conserva Alpha 10 como antecedente. Alpha 12 sustituye su propuesta para una instalación nueva: **no ejecutar ambas**. Si las tablas ya existen, hace falta una migración de actualización específica tras inspeccionar el esquema real.
- Los nuevos SQL están en UTF-8 sin BOM. La primera ejecución detectó un BOM heredado de Alpha 10 que el parser SQL no aceptaba; se corrigió en las copias Alpha 12.
- La reversión sigue siendo destructiva. Se probó solo en memoria. No constituye autorización para borrar datos reales.

## Pruebas reproducibles

Requisitos: Node.js moderno compatible con el proyecto y pnpm. En esta ejecución se usó pnpm 11.19.0. Se incorpora únicamente `@electric-sql/pglite` **0.5.8** como dependencia de desarrollo, fijada en `package.json` y `pnpm-lock.yaml`. No se incorpora al navegador ni al service worker.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run test:rls
pnpm test
```

También se puede ejecutar `node --test test/treasury-rls.test.js` o `node --test` una vez instaladas las dependencias.

El runner crea `new PGlite()` sin directorio persistente. No acepta URL, credenciales ni variables de conexión. No abre un puerto PostgreSQL. Carga un fixture mínimo explícito desde `database/tests/treasury_fixture.sql` y ejecuta el SQL Alpha 12 íntegro. La instancia se cierra al terminar. Cada caso usa una transacción que se revierte.

El fixture representa solo las claves y consultas requeridas por la propuesta: usuarios ficticios, dos hogares, un usuario con doble membresía, cuentas, series y ocurrencias. Sus implementaciones de `auth.uid()` y `private.is_household_member()` son simulaciones locales para probar el contrato; no afirman reproducir las funciones ni las políticas de producción.

Las pruebas de acceso usan el rol `authenticated`, sin superusuario, sin `BYPASSRLS` y sin ser propietario. La preparación de datos, la prueba controlada de la política antigua y las comprobaciones de FK/reversión utilizan el propietario dentro de las instancias efímeras.

## Cobertura y resultados

**21 pruebas SQL correctas; 75/75 pruebas en la suite completa, sin omitidas.**

- Lecturas de las cuatro tablas aisladas por hogar; usuarios sin hogar e identidad nula; permisos de `anon`.
- Inserciones válidas, valores por defecto de autor y ataques de suplantación.
- Cruces de cuenta/hogar con doble membresía, tanto en saldos como en importaciones y conciliaciones.
- Líneas restringidas a su importador; lectura y revisión permitidas a otros miembros del mismo hogar.
- Unicidad de saldo, fichero, ordinal, huella, línea confirmada y ocurrencia confirmada, comprobadas por separado.
- Conciliación de cuenta y hogar compatibles y FK a una ocurrencia existente.
- Revocación con motivo y actor, identidad inmutable, historial conservado y nueva confirmación tras revocar.
- Moneda, origen, rango numérico, huellas, intervalo de importación, ordinal e importe no nulo de línea.
- Prohibición de UPDATE/DELETE en registros append-only y de DELETE en conciliaciones.
- FK que bloquean borrar padres referenciados; rollback y reaplicación en otra instancia vacía.

El test de RESTRICT acepta exclusivamente los SQLSTATE de violación de FK o de RESTRICT (`23503`/`23001`) y confirma que la fila sigue existiendo tras el rechazo. No acepta errores genéricos como prueba de seguridad.

No existen scripts de build, lint ni typecheck. Se valida sintaxis JavaScript y `git diff --check`. No se modifica la interfaz ni su versión Alpha 11: Alpha 12 es un incremento de propuesta SQL y verificación, sin despliegue de persistencia.

## Límites antes de producción

- **No se ha ejecutado SQL en Supabase ni en una base externa.** UP y DOWN solo se ejecutaron en PostgreSQL en memoria con datos ficticios.
- Falta cotejar tipos, claves únicas, permisos, esquema `private`, funciones de membresía y políticas del esquema real. Los cambios de pertenencia y la reasignación posterior de cuentas/series requieren pruebas con las reglas reales de esas tablas padre.
- PGlite usa una conexión: estas pruebas no verifican carreras entre conexiones, bloqueos ni PostgREST/JWT reales. Se necesita un ensayo sobre PostgreSQL/Supabase aislado equivalente al servidor antes de autorizar el despliegue.
- Los defaults de timestamps no impiden que un cliente aporte fechas de auditoría propias. Es un punto pendiente de endurecimiento, distinto de la comprobación de identidad del actor.
- La unicidad actual de huella de línea puede rechazar dos líneas bancarias legítimas idénticas. Antes de persistir extractos hay que definir la identidad de cada línea y su relación con el ordinal.
- `numeric(14,2)` de PostgreSQL puede redondear entradas con más de dos decimales; el borrador Alpha 11 sí las rechaza. Las pruebas SQL verifican el rango, sin atribuir al esquema una validación de precisión que no tiene.

## Alpha 13 propuesta

Endurecer timestamps de auditoría y definir la identidad de líneas repetidas con pruebas de regresión. Preparar después un ensayo de concurrencia y compatibilidad sobre PostgreSQL aislado equivalente a Supabase, manteniendo cualquier despliegue real sujeto a autorización expresa.

Fuentes: [PostgreSQL: políticas de seguridad de filas](https://www.postgresql.org/docs/17/ddl-rowsecurity.html), [PGlite: PostgreSQL en memoria](https://pglite.dev/docs/).
