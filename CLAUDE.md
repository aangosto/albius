# Albius — contexto del proyecto

> Este fichero es la fuente única de reglas y decisiones del proyecto. Cualquier divergencia entre lo que digo aquí y otro sitio se resuelve a favor de este documento.

## 1. Qué es

SaaS B2B multi-tenant para gestión de turnos en empresas de transporte urbano de viajeros.
Target: empresas medianas (50-300 conductores).
Roles: super_admin (autor del producto), jefe de tráfico (operativa diaria), conductor (móvil-first).

## 2. Diferenciadores

1. **Optimizador matemático** que respeta el convenio y maximiza preferencias individuales del conductor.
2. **Mercado oficial de intercambios** entre conductores con validación automática y aprobación del jefe.

## 3. Stack

- Frontend: React 19 + Vite 6 + TypeScript strict + Tailwind v4 + shadcn/ui (estilo `new-york`, base `slate`).
- Backend: Firebase (Auth + Firestore + Cloud Functions Node).
- Optimizador: Python + OR-Tools en Cloud Run (V2; en MVP es heurística greedy).
- Despliegue: Vercel con CI/CD automático desde `main`.

## 4. Identificadores del proyecto

- Firebase project ID: `albius-cbdb1`
- Repositorio: https://github.com/aangosto/albius
- Despliegue Vercel: https://albius-web.vercel.app

## 5. Estructura del repo

```
albius/
├── apps/
│   ├── web/                          ← React 19 + Vite 6 + TS + Tailwind 4 + shadcn/ui
│   │   └── src/
│   │       ├── App.tsx, main.tsx, router.tsx
│   │       ├── components/{layout,ui}/   ← Sidebar/Topbar + componentes shadcn
│   │       ├── layouts/AppLayout.tsx
│   │       ├── lib/{navigation,utils}.ts
│   │       ├── pages/                    ← 10 páginas (Login + 9 rutas autenticadas)
│   │       └── index.css                 ← Tailwind v4 + tema shadcn
│   └── functions/                    ← Cloud Functions (PLACEHOLDER, sin código)
├── packages/
│   └── shared/                       ← @albius/shared — tipos del modelo (firebase-stubs.ts hasta integrar SDK)
├── infrastructure/
│   └── firestore/                    ← PLACEHOLDER (reglas deny-all, índices vacíos)
├── docs/                             ← ver §7
├── package.json                      ← npm workspaces
├── tsconfig.base.json                ← strict + noUncheckedIndexedAccess + noImplicitOverride
├── eslint.config.js                  ← ESLint 9 flat config
└── .prettierrc, .nvmrc (Node 20)
```

## 6. Scripts

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run format`

Detalle en `README.md`.

## 7. Documentos de referencia (`/docs`)

- `01-especificacion-funcional.pdf` — visión, módulos del MVP, arquitectura, plan de 16 semanas.
- `02-modelo-de-datos.pdf` — 22 colecciones Firestore con campos, ejemplos, reglas e índices.
- `03-modelo-de-datos.ts` — interfaces TS del modelo (idénticas a `packages/shared/src/types.ts`).
- `04-bocetos-pantallas.html` — 8 wireframes (4 web del jefe + 4 móvil del conductor).

## 8. Decisiones tomadas (no cuestionar sin avisar)

Si propones algo que contradice un punto de aquí, primero levanta la mano para abrir conversación.

- **Aislamiento multi-tenant con campo `tenantId` en cada documento Firestore** (colecciones planas), no subcolecciones anidadas bajo cada tenant.
- **Servicios materializados selectivamente:** solo se crea documento `servicios` cuando hay asignación o incidencia que registrar. El resto se calcula al vuelo desde `frecuencias`.
- **Intercambios solo inmediatos en MVP:** únicamente intercambios sobre fechas ya publicadas. Los intercambios diferidos (compromisos futuros entre conductores) quedan fuera.
- **Horizonte del cuadrante: 2 meses publicados.** Los intercambios solo son posibles dentro de ese horizonte.
- **Optimizador en dos fases:** heurística greedy con scoring en MVP (suficiente hasta ~200 conductores); formulación MILP con OR-Tools en V2. Interfaz estable para cambiar de motor sin tocar el resto del sistema.
- **Una única aplicación web responsive** sirve a los tres roles desde móvil y escritorio. Sin app nativa separada en V1; en V2 se podría empaquetar con React Native reutilizando código.
- **Acceso multidispositivo para todos los roles:** super_admin, jefe de tráfico y conductor acceden a la misma aplicación web responsive desde cualquier dispositivo (móvil o escritorio), con las mismas capacidades funcionales.
- **Sin mapa interactivo en MVP:** las paradas se gestionan con texto y coordenadas opcionales. Visualización cartográfica queda para V2.

## 9. Convenciones de código

- Idioma de la UI: español.
- Variables del dominio en español (`conductor`, `cuadrante`, `asignacion`); identificadores técnicos genéricos en inglés.
- Comentarios TODO con etiqueta de contexto: `TODO[auth]`, `TODO[optimizer]`, `TODO[i18n]`, etc. Permite localizar pendientes de un módulo con un grep.
- Componentes shadcn se incorporan vía CLI (copian fuente al repo), no como dependencias npm.

## 10. NO hacer sin pedir confirmación explícita

- Instalar nuevas dependencias.
- Modificar el modelo de datos en `packages/shared/src/types.ts`.
- Tocar las reglas de seguridad de Firestore (`infrastructure/firestore/firestore.rules`).
- Hacer `git push`.
- Borrar archivos.

## 11. Estado actual del proyecto

**Hecho:**
- Scaffold monorepo (npm workspaces): `apps/web`, `apps/functions` (vacío), `packages/shared`, `infrastructure/firestore` (vacío).
- `apps/web` operativa: React Router v7, AppLayout con Sidebar + Topbar, 10 páginas placeholder, login deshabilitado.
- Tipos del modelo accesibles vía `@albius/shared`; CI/CD a Vercel activo desde `main`.

**No hecho:**
- Firebase Auth, custom claims y reglas reales de Firestore.
- Persistencia: ningún CRUD ni funcionalidad de negocio (cuadrante, intercambios, incidencias…).
- Cloud Functions y optimizador Python.
