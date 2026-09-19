# Alpha 11 · Borrador local de saldo por hogar

## Diagnóstico inicial (2026-09-19)

- Rama `domus-3.0`, árbol limpio tras `git fetch origin`, HEAD y referencia remota en `f70785353d5b05ee890434bb260e00fb4b8553cf`, divergencia 0/0.
- Alpha 10 (`9e3c9b4`) añadió exclusivamente las propuestas SQL `alpha10_treasury_persistence_up.sql` y `alpha10_treasury_persistence_down.sql`. Los dos commits siguientes crearon y eliminaron el archivo de prueba de escritura.
- Aplicación estática: `index.html`, módulos ES JavaScript en `src/treasury`, service worker y copias históricas HTML. No hay TypeScript, compilador ni scripts de lint/build/typecheck. `package.json` solo declara `node --test`.
- Tesorería calcula estados, flujo real, previsión por horizontes, saldos desde checkpoints locales y diferencias frente al banco. Importa CSV, propone candidatos por cuenta, permite revisión manual y descarga informes no persistidos.
- La persistencia de checkpoints, extractos y conciliaciones sigue pendiente. No existe cliente para esas tablas ni pruebas ejecutables de RLS. La documentación llega a Alpha 9 y la versión de la aplicación seguía en Alpha 9.
- No se encontraron marcadores TODO/FIXME/stub en los módulos de Tesorería. Las limitaciones están expresadas en la documentación y mensajes de la interfaz, no en marcadores.
- Las 40 pruebas originales pasan. Cubren cálculo, conciliación, revisión, informes, checkpoints y comprobaciones estáticas de recuperación de contraseña; no verifican producción.

## Incremento implementado

Cada cuenta del hogar activo permite descargar un borrador JSON del saldo y fecha introducidos. La descarga no aplica el saldo localmente ni lo envía a Supabase. Para usarlo en el cálculo se conserva el botón independiente «Usar localmente».

`checkpoint-draft.js` valida UUID, correspondencia cuenta/hogar, fecha de calendario no futura y límites `numeric(14,2)` de la propuesta Alpha 10. El saldo del borrador se serializa como cadena decimal con dos posiciones, sin redondeo silencioso. Solo admite origen manual y EUR. No acepta ni inventa `created_by`, `created_at` o identificadores de fila.

El sobre declara `persisted: false` y `requiresAuthorization: true`. Es material de revisión, no una orden de inserción ni un formato importable automáticamente. Los datos aportados por el navegador no acreditan membresía: una futura escritura requerirá autenticación y RLS del servidor.

Los checkpoints y huellas locales se limpian al cambiar usuario/hogar o perder la sesión. Se invalidan los botones antiguos y los resultados de lecturas CSV que terminarían después de cambiar el contexto o volver a renderizar.

## Archivos

- Nuevos: `src/treasury/checkpoint-draft.js`, `test/treasury-checkpoint-draft.test.js`, `test/treasury-ui-checkpoint.test.js`, este informe.
- Modificados: `src/treasury/ui.js` (descarga y aislamiento), `index.html` (contexto, limpieza de sesión y build), `package.json`, `version.json`, `sw.js` (Alpha 11 y módulo offline), `docs/TESORERIA-3.0.md`.
- No se modifican copias históricas HTML ni propuestas SQL.

## Validación

- Suite completa: 54 pruebas, 54 correctas, sin omitidas. Se ejecuta `node --test` con el runtime disponible; `npm` no está en el PATH.
- Siete pruebas nuevas del contrato decimal, fechas, aislamiento, campos permitidos e inmutabilidad. Seis pruebas de los manejadores reales de UI mediante un puerto DOM mínimo, incluida lectura CSV interrumpida, y una del callback de autenticación real con un cliente simulado.
- Verificación adicional en Edge/Playwright con datos ficticios y peticiones interceptadas: descarga JSON real, rechazo de precisión excesiva, uso local del saldo y cambio de usuario. Sin errores de página; sin conexiones a Supabase.
- No hay scripts de build/lint/typecheck. Se comprueba sintaxis JavaScript y `git diff --check`.

## Riesgos y trabajo pendiente

- Las propuestas Alpha 8 y Alpha 10 siguen sin ejecutar. No se crea una migración nueva en Alpha 11 ni se consulta el esquema de producción. El comentario de Alpha 10 sobre una auditoría previa no sustituye una verificación actual del servidor.
- En Alpha 10, las políticas de checkpoints e importaciones usan `a.household_id = household_id` dentro de una subconsulta sobre `accounts`. El nombre sin calificar puede resolverse en el ámbito interior, sin comprobar el hogar de la fila insertada. Hay referencias sin calificar adicionales en la política de conciliación. Deben corregirse y probarse antes de autorizar el SQL.
- La reversión elimina tablas y datos; no debe ejecutarse automáticamente. La propuesta contiene cascadas que también necesitan revisión frente al requisito de conservar historial.
- La futura persistencia debe probar RLS con usuarios de varios hogares, duplicados, auditoría, revocaciones y concurrencia. Alpha 11 no acredita que el SQL sea seguro para producción.
- Persisten limitaciones anteriores: parser CSV permisivo con fechas/importes, pérdida de revisiones al renderizar y carga histórica limitada por el puente de Tesorería. No se cambian en este incremento.
- La revisión visual del panel aislado muestra desbordamiento horizontal de tablas en 390 px con los estilos actuales. El nuevo formulario y botón son utilizables; queda pendiente revisar el diseño móvil completo dentro de la aplicación autenticada.
- Alpha 12 propuesto: corregir las referencias correlacionadas de la propuesta Alpha 10 y añadir un escenario reproducible de pruebas SQL en base aislada con datos ficticios, incluyendo accesos cruzados entre hogares. El despliegue real seguirá requiriendo autorización expresa.

Referencia consultada para el evento de limpieza de sesión: [Supabase onAuthStateChange](https://supabase.com/docs/reference/javascript/auth-onauthstatechange).
