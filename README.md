# Albius

SaaS multi-tenant de gestión de turnos para empresas de transporte urbano de viajeros.

Monorepo gestionado con npm workspaces.

## Estructura

- `apps/web` — aplicación web (React + Vite + TS + Tailwind + shadcn/ui)
- `apps/functions` — Firebase Cloud Functions (pendiente de inicializar)
- `packages/shared` — tipos TypeScript compartidos
- `infrastructure/firestore` — reglas e índices de Firestore (pendientes)
- `docs/` — documentación funcional

## Requisitos

- Node 20+
- npm 10+

## Scripts

```bash
npm install        # instala dependencias de todos los workspaces
npm run dev        # arranca apps/web en modo desarrollo
npm run build      # build de producción de apps/web
npm run lint       # ESLint en todo el monorepo
npm run format     # Prettier --write
```
