# planificador-financiero-dom-stico-

DOMUS 3.0: aplicación estática y propuestas de persistencia de Tesorería.

Para instalar las dependencias de desarrollo y ejecutar las pruebas:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
```

`pnpm run test:rls` prueba el SQL de Tesorería en PostgreSQL en memoria, sin conectar con Supabase.

`pnpm run build` prepara la PWA independiente en `dist/domus-3/`, incluido el SDK local. El HTML fuente requiere ese build. `pnpm run test:browser` comprueba el paquete generado con un servidor local, Edge en Windows y Supabase simulado; no envía correos ni datos reales. Mantener el directorio `/domus-3/` al preparar un alojamiento futuro, sin sustituir la raíz de DOMUS 2.5.8. Este build no despliega nada.

Estado y límites actuales: [Alpha 17 RC readiness](docs/ALPHA17-RC-READINESS.md). Tras el build, `pnpm run check` verifica sintaxis, versiones y paquete; `pnpm run audit:security` comprueba el runtime y clasifica referencias de pruebas/históricos. PostgreSQL real multiconexión sigue pendiente.

El paquete por defecto **no tiene backend configurado** y la persistencia de Tesorería está desactivada. No reutiliza la URL anterior. La [guía de staging aislado](docs/STAGING-3.0.md) describe configuración pública, Auth y uso opcional del harness con un clúster propio o DATABASE_URL local de prueba confirmada. No se despliega ni aplica SQL al hacer build. La API transaccional remota y su outbox todavía no están conectadas a la UI; Alpha 17 no es RC1.

Consulta la [documentación de Tesorería](docs/TESORERIA-3.0.md) y el [informe Alpha 12](docs/ALPHA12-RLS.md). Los SQL de `database/proposals` no deben ejecutarse en un servidor sin revisión y autorización expresa.
