# Alpha 13 · Auditoría y líneas repetidas

La propuesta Alpha 13 sustituye Alpha 12 para instalaciones nuevas. No ejecutar ambas ni usarla como actualización de un esquema existente. Ningún SQL se aplica a producción.

Los triggers SECURITY INVOKER fijan `created_at`, `imported_at`, `confirmed_at` y `revoked_at` con `statement_timestamp()` y rechazan actores distintos de `auth.uid()` o sesiones ausentes. Las identidades y fechas de confirmación siguen inmutables al revocar. Los permisos siguen siendo append-only, salvo revocación explícita.

Dos líneas de igual fecha, concepto e importe pueden ser transacciones bancarias legítimas distintas. La identidad es `(import_id, line_ordinal)`; la huella identifica contenido y tiene un índice no único. El fichero mantiene unicidad hogar/cuenta/huella. No se deduplican ni eliminan líneas por parecido o igualdad de contenido.

Pruebas: fechas aportadas maliciosamente, actor falso, duplicados, conservación de líneas idénticas y colisión de peticiones de inserción/revocación. PGlite encola las peticiones en una sola conexión: el ensayo NO valida bloqueos o carreras multiconexión. Sigue pendiente una base aislada equivalente a Supabase para esa verificación y para contrastar las reglas de tablas padre.

Ejecutar `pnpm run test:rls` o `node --test` tras `pnpm install --frozen-lockfile --ignore-scripts`. La reversión se prueba exclusivamente en memoria y sigue siendo destructiva fuera de ese entorno.
