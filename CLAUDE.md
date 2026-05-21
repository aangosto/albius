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

## 12. Deuda técnica conocida (TODOs activos)

Pendientes asumidos conscientemente durante la construcción del proyecto, con etiqueta de contexto para grep. Revisar en el bloque o sesión indicada.

- `TODO[firebase-json-runtime-explicito]` — añadir `"runtime": "nodejs20"` al bloque `functions` de `firebase.json` antes del primer deploy real. Revisar en Bloque 5/6.
- `TODO[deuda-tecnica-deps-firebase]` — cluster de 9 vulnerabilidades `low` transitivas en `firebase-admin` → `@google-cloud/firestore` → `google-gax` → `retry-request` → `teeny-request` → `http-proxy-agent` → `@tootallnate/once`. `npm audit fix --force` bajaría `firebase-admin` a v10 (breaking change). Postpuesto hasta que Firebase publique nuevas versiones del SDK con las deps actualizadas.
- `TODO[verificar-reglas-en-uso-real]` — validar empíricamente en Bloque 5 las ramas de `firestore.rules` (casos 8-15 del Rules Playground) que no se pudieron probar en su momento.
- `TODO[refactor-zod]` — si los callables crecen a 10 o más, refactorizar validación de payloads a Zod.
- Pendiente actualizar Node de 20.17 a 20.19+ cuando convenga (warn `EBADENGINE` de `eslint-visitor-keys`, no bloqueante).

## 13. Decisiones del Bloque 3 (callables crearJefeTrafico + crearConductor)

Decisiones de diseño aprobadas durante la planificación del bloque y consolidadas aquí como referencia para la implementación y para futuros bloques que toquen los mismos callables.

- **D1 — `conductorId` desacoplado del `uid` de Firebase Auth.** El identificador del conductor coincide con el número de empleado (información de negocio que debe sobrevivir a cambios de cuenta de Auth) y NO con el `uid` del documento `/usuarios`. El enlace usuario↔conductor se hace mediante el campo `conductorId` en el documento `/usuarios`.
- **D2 — `crearConductor` crea `/usuarios` y `/conductores` atómicamente.** El callable escribe ambos documentos en una única operación. Si alguna de las dos escrituras falla, rollback completo (incluyendo el usuario de Firebase Auth si ya se creó). Un conductor sin sus dos documentos no es funcional.
- **D3 — Contraseña inicial vía `generatePasswordResetLink`.** El email de configuración de contraseña se envía con `generatePasswordResetLink` del Admin SDK. NUNCA devolver contraseñas en la respuesta del callable ni escribirlas en logs. Si el usuario pierde el enlace, se repite el flujo desde super_admin.
- **D4 — Validación de payloads con type guards a mano.** En este bloque NO se introduce Zod: se valida cada campo con type guards y se lanza `invalid-argument` con mensaje claro al fallar. Si los callables crecen a 10 o más se refactoriza (ver `TODO[refactor-zod]` en §12).
- **D5 — Sesión 3 partida en dos sub-sesiones por tamaño.** Bloque 3.1: scaffold del paquete `apps/functions` + callable `ping` (completado). Bloque 3.2: callables `crearJefeTrafico` y `crearConductor`.
- **D6 — Verificación de existencia de referencias antes de crear.** `crearJefeTrafico` verifica que `/tenants/{tenantId}` y `/centros/{centroId}` existen. `crearConductor` verifica lo mismo y además que el `tenantId` del payload coincide con el `tenantId` del jefe que llama (anti cross-tenant). Si falla la verificación, devolver `invalid-argument` indicando qué referencia no existe.
- **D7 — Auditoría mínima en cada documento creado.** Los documentos nuevos en `/usuarios` y `/conductores` incluyen `creadoPor` (uid del invocador, `request.auth.uid`) y `creadoEn` (`FieldValue.serverTimestamp()`).
