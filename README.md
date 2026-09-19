# planificador-financiero-dom-stico-

DOMUS 3.0: aplicación estática y propuestas de persistencia de Tesorería.

Para instalar las dependencias de desarrollo y ejecutar las pruebas:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
```

`pnpm run test:rls` prueba el SQL de Tesorería en PostgreSQL en memoria, sin conectar con Supabase.

Consulta la [documentación de Tesorería](docs/TESORERIA-3.0.md) y el [informe Alpha 12](docs/ALPHA12-RLS.md). Los SQL de `database/proposals` no deben ejecutarse en un servidor sin revisión y autorización expresa.
