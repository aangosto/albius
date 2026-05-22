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
- Scaffold monorepo (npm workspaces): `apps/web`, `apps/functions`, `packages/shared`, `infrastructure/firestore` (vacío).
- `apps/web` operativa: React Router v7, AppLayout con Sidebar + Topbar, 10 páginas placeholder, login deshabilitado.
- Tipos del modelo accesibles vía `@albius/shared`; CI/CD a Vercel activo desde `main`.
- Cloud Functions Node con 3 callables (`ping`, `crearJefeTrafico`, `crearConductor`), helpers reutilizables (auth-guards, validación sin Zod por D4, refs Firestore), custom claims operativos en backend y scripts de verificación contra emulators (42 casos pasados).
- Script CLI `scripts/bootstrap-super-admin.mjs` para alta de super_admins con 6 capas de fail-safe contra accidentes en producción (capas 1-3 verificadas empíricamente contra emulator con 11/11 casos; capas 4-6 deferred a verificación con Firebase real, ver `TODO[bootstrap-verify-production-layers]` en §12).

**No hecho:**
- Login en `apps/web` (sigue deshabilitado) y reglas reales de Firestore (`firestore.rules` sigue deny-all).
- Persistencia: ningún CRUD ni funcionalidad de negocio (cuadrante, intercambios, incidencias…).
- Optimizador Python en Cloud Run (V2).

## 12. Deuda técnica conocida (TODOs activos)

Pendientes asumidos conscientemente durante la construcción del proyecto, con etiqueta de contexto para grep. Revisar en el bloque o sesión indicada.

- `TODO[firebase-json-runtime-explicito]` — añadir `"runtime": "nodejs20"` al bloque `functions` de `firebase.json` antes del primer deploy real. Revisar en Bloque 5/6.
- `TODO[deuda-tecnica-deps-firebase]` — cluster de 9 vulnerabilidades `low` transitivas en `firebase-admin` → `@google-cloud/firestore` → `google-gax` → `retry-request` → `teeny-request` → `http-proxy-agent` → `@tootallnate/once`. `npm audit fix --force` bajaría `firebase-admin` a v10 (breaking change). Postpuesto hasta que Firebase publique nuevas versiones del SDK con las deps actualizadas.
- `TODO[verificar-reglas-en-uso-real]` — validar empíricamente en Bloque 5 las ramas de `firestore.rules` (casos 8-15 del Rules Playground) que no se pudieron probar en su momento.
- `TODO[refactor-zod]` — si los callables crecen a 10 o más, refactorizar validación de payloads a Zod.
- Pendiente actualizar Node de 20.17 a 20.19+ cuando convenga (warn `EBADENGINE` de `eslint-visitor-keys`, no bloqueante).
- `TODO[refactor-shared-build]` — compilar `@albius/shared` a JS con su propio paso de build, eliminar el módulo local `apps/functions/src/collections.ts` y volver a importar `COLLECTIONS` desde `@albius/shared`. Origen: commit `e879854` (sub-bloque 3.2.c). Hoy `shared` se distribuye como TypeScript crudo (`main: "./src/index.ts"`, `noEmit: true`), lo cual funciona en `apps/web` por el resolver de Vite pero no en `apps/functions` tras compilar a CJS. Requiere bloque dedicado: toca `packages/shared`, `apps/functions`, scripts de build raíz y posible verificación de Vite.
- `TODO[email-transport]` — implementar transporte real de email para enviar el `linkPasswordReset` que devuelven los callables `crearJefeTrafico` (3.2.b) y `crearConductor` (3.2.d). Hoy el link queda en la respuesta del callable y el super_admin lo distribuye manualmente. Bloquea el flujo automático de alta de usuarios en producción. Decidir entre SendGrid, Resend, Firebase Extensions u otra alternativa antes del primer despliegue real.
- `TODO[refactor-verify-helpers]` — extraer los helpers duplicados de `apps/functions/scripts/verify-crearJefeTrafico.mjs` y `verify-crearConductor.mjs` (`signInWithCustomToken`, `invokeCallable`, `checkEmulatorsUp`, `expectError`, `record`) a un módulo compartido. Origen: commit `af29340` (sub-bloque 3.2.e). Encaja cuando llegue el tercer script de verificación, previsiblemente en Bloque 4. Decisión pendiente: módulo `.mjs` auxiliar o migración a `.mts` con TypeScript (pipeline nueva: build / tsx / ts-node).
- `TODO[refactor-ping-helpers]` — el callable `ping` del sub-bloque 3.1 (commit `d6f2540`) lee `request.auth.token` directamente para extraer el campo `rol`. Refactorizar para usar `extractClaims` y `assertAuth` de `apps/functions/src/auth-guards.ts` (introducidos después en 3.2.a, commit `348f77f`), simétrico al resto de callables. Deuda menor, sin urgencia.
- `TODO[tipos-conductor-requeridos]` — revisar si los arrays `lineasPreferentes`, `lineasSecundarias` y `tiposTurnoPermitidos` del modelo `Conductor` (`packages/shared/src/types.ts`) deben permanecer required. El callable `crearConductor` los defaultea a `[]` cuando el payload los omite (DUDA-8 de 3.2.d, commit `e810832`). Si el dominio acepta "todavía no asignado" como estado natural, considerar marcarlos opcionales (`?`) para reflejar mejor el modelo conceptual.
- `TODO[jefe-claims-incompletos]` — definir comportamiento cuando un token tiene `rol=jefe_trafico` pero falta `tenantId` o `centroId` en custom claims. Hoy `crearConductor` cae en el check anti cross-tenant con mensaje confuso (3.2.d): `claims.tenantId === undefined` siempre será distinto del `payload.tenantId`, lanzando "Un jefe de tráfico no puede crear conductores en otro tenant." cuando el problema real es alta incompleta. Decidir entre `permission-denied` con mensaje específico o `failed-precondition` simétrico a `assertJefeTrafico`.
- `TODO[verify-cleanup-usuarios-huerfanos]` — los scripts `verify-crearJefeTrafico.mjs` y `verify-crearConductor.mjs` dejan documentos `/usuarios/{uid}` huérfanos en Firestore tras ejecuciones repetidas: el `uid` se regenera con cada `createUser` y los docs anteriores no se borran. No afectan funcionalmente (los tests no consultan esos docs), pero ensucian el estado del emulator. Añadir limpieza opcional al inicio (p.ej. borrar `/usuarios` con `creadoEn` > timestamp del seed) cuando se consolide la infra de testing. Encaja con `TODO[refactor-verify-helpers]`.
- `TODO[bootstrap-verify-production-layers]` — verificar empíricamente las capas 4 (banner production), 5 (confirmación 'CONFIRMAR' interactiva) y 6 (project ID = albius-cbdb1) del script `scripts/bootstrap-super-admin.mjs`. Origen: Bloque 4 (alta de super_admin). Hoy están probadas solo por inspección de código + revisión de mensajes; las capas 1-3 sí se verificaron empíricamente (11/11 casos contra emulator). Verificación empírica de 4-6 requiere ejecución contra Firebase real, pospuesta al Bloque 18 (deploy) o equivalente.

## 13. Decisiones del Bloque 3 (callables crearJefeTrafico + crearConductor)

Decisiones de diseño aprobadas durante la planificación del bloque y consolidadas aquí como referencia para la implementación y para futuros bloques que toquen los mismos callables.

- **D1 — `conductorId` desacoplado del `uid` de Firebase Auth.** El identificador del conductor coincide con el número de empleado (información de negocio que debe sobrevivir a cambios de cuenta de Auth) y NO con el `uid` del documento `/usuarios`. El enlace usuario↔conductor se hace mediante el campo `conductorId` en el documento `/usuarios`.
- **D2 — `crearConductor` crea `/usuarios` y `/conductores` atómicamente.** El callable escribe ambos documentos en una única operación. Si alguna de las dos escrituras falla, rollback completo (incluyendo el usuario de Firebase Auth si ya se creó). Un conductor sin sus dos documentos no es funcional.
- **D3 — Contraseña inicial vía `generatePasswordResetLink`.** El email de configuración de contraseña se envía con `generatePasswordResetLink` del Admin SDK. NUNCA devolver contraseñas en la respuesta del callable ni escribirlas en logs. Si el usuario pierde el enlace, se repite el flujo desde super_admin.
- **D4 — Validación de payloads con type guards a mano.** En este bloque NO se introduce Zod: se valida cada campo con type guards y se lanza `invalid-argument` con mensaje claro al fallar. Si los callables crecen a 10 o más se refactoriza (ver `TODO[refactor-zod]` en §12).
- **D5 — Sesión 3 partida en dos sub-sesiones por tamaño.** Bloque 3.1: scaffold del paquete `apps/functions` + callable `ping` (completado). Bloque 3.2: callables `crearJefeTrafico` y `crearConductor`.
- **D6 — Verificación de existencia de referencias antes de crear.** `crearJefeTrafico` verifica que `/tenants/{tenantId}` y `/centros/{centroId}` existen. `crearConductor` verifica lo mismo y además que el `tenantId` del payload coincide con el `tenantId` del jefe que llama (anti cross-tenant). Si falla la verificación, devolver `invalid-argument` indicando qué referencia no existe.
  - **Ampliación 3.2.d:** para `crearConductor` se verifica también que `claims.centroId === payload.centroId` cuando invoca un jefe (anti cross-centro), por simetría con la identidad operativa del jefe `(tenantId, centroId)`. Mensaje: "Un jefe de tráfico no puede crear conductores en otro centro." (DUDA-11 de 3.2.d). Sin esta ampliación, un jefe del centro A podría crear conductores en centro B del mismo tenant, lo cual es abuso de permisos. Implementación: commit `e810832`.
- **D7 — Auditoría mínima en cada documento creado.** Los documentos nuevos en `/usuarios` y `/conductores` incluyen `creadoPor` (uid del invocador, `request.auth.uid`) y `creadoEn` (`FieldValue.serverTimestamp()`).
  - **Ampliación Bloque 4:** bootstrap CLI usa `creadoPor: 'bootstrap-cli'` como valor convencional al no existir `request.auth.uid` (script ejecutado fuera del flujo callable, sin invocador autenticado). Implementación: `scripts/bootstrap-super-admin.mjs`. Grep-eable para localizar todos los super_admins creados por bootstrap CLI vs por callables (que tendrían un uid real en `creadoPor`).
