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

## Variables de entorno

`apps/web` se conecta al proyecto Firebase `albius-cbdb1` mediante variables
de entorno con prefijo `VITE_`. Copia `apps/web/.env.example` a
`apps/web/.env.local` y rellena los valores que aparecen en la consola de
Firebase (Configuración del proyecto → General → Tus apps → App web).

```bash
cp apps/web/.env.example apps/web/.env.local
# Edita apps/web/.env.local con los valores reales
```

`.env.local` está ignorado por git. Para que las previews y producción de
Vercel funcionen, las mismas variables deben darse de alta en el dashboard
de Vercel (Project Settings → Environment Variables) tanto para Production
como para Preview.
