# planificador-financiero-dom-stico-

DOMUS 3.0: aplicación estática y propuestas de persistencia de Tesorería.

Para instalar las dependencias de desarrollo y ejecutar las pruebas:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
```

`pnpm run test:rls` prueba el SQL de Tesorería en PostgreSQL en memoria, sin conectar con Supabase.

`pnpm run build` prepara la PWA independiente en `dist/domus-3/`, incluido el SDK local. El HTML fuente requiere ese build. `pnpm run test:browser` comprueba el paquete generado con un servidor local, Edge en Windows y Supabase simulado; no envía correos ni datos reales. Mantener el directorio `/domus-3/` al preparar un alojamiento futuro, sin sustituir la raíz de DOMUS 2.5.8. Este build no despliega nada.

Estado y límites actuales: [auditoría Alpha 15](docs/ALPHA15-AUDITORIA.md).

Consulta la [documentación de Tesorería](docs/TESORERIA-3.0.md) y el [informe Alpha 12](docs/ALPHA12-RLS.md). Los SQL de `database/proposals` no deben ejecutarse en un servidor sin revisión y autorización expresa.
