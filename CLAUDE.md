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
│   │   ├── src/
│   │   │   ├── App.tsx, main.tsx, router.tsx
│   │   │   ├── components/{auth,layout,ui}/  ← ProtectedRoute + Sidebar/Topbar + shadcn
│   │   │   ├── contexts/AuthContext.tsx  ← Provider + hook useAuth (Firebase Auth Web SDK)
│   │   │   ├── layouts/AppLayout.tsx
│   │   │   ├── lib/                      ← firebase, auth-errors, navigation, utils
│   │   │   ├── pages/                    ← 14 páginas (Login + 12 rutas autenticadas + NotFoundPage)
│   │   │   └── index.css                 ← Tailwind v4 + tema shadcn
│   │   └── .env.example                  ← plantilla VITE_FIREBASE_* + VITE_USE_EMULATORS
│   └── functions/                    ← Cloud Functions Node
│       ├── src/                          ← 3 callables (ping, crearJefeTrafico, crearConductor) + helpers
│       └── scripts/                      ← testing infra (verify-*, seed-*) contra emulator
├── packages/
│   └── shared/                       ← @albius/shared — tipos del modelo (firebase-stubs.ts legacy pendiente de retirar, ver §12)
├── scripts/                          ← scripts CLI standalone (bootstrap-super-admin.mjs)
├── infrastructure/
│   └── firestore/                    ← reglas activas para 4 colecciones (tenants, centros, usuarios, conductores) + helpers de auth; resto deny-all
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
- Cloud Functions Node con 3 callables (`ping`, `crearJefeTrafico`, `crearConductor`), helpers reutilizables (auth-guards, validación sin Zod por D3.4, refs Firestore), custom claims operativos en backend y scripts de verificación contra emulators (42 casos pasados).
- Script CLI `scripts/bootstrap-super-admin.mjs` para alta de super_admins con 6 capas de fail-safe contra accidentes en producción (capas 1-3 verificadas empíricamente contra emulator con 11/11 casos; capas 4-6 deferred a verificación con Firebase real, ver `TODO[bootstrap-verify-production-layers]` en §12).
- Login funcional en `apps/web` con `useAuth` hook + `AuthContext` (Firebase Auth Web SDK + `signInWithEmailAndPassword`). Soporta emulator local vía `VITE_USE_EMULATORS=true`. Verificación manual contra emulator OK: login con super_admin, signOut, persistencia de sesión tras reload, mensajes de error genéricos para credenciales inválidas (decisión de seguridad: no revelar si el email está registrado).
- Reglas Firestore activas para 4 colecciones (tenants, centros, usuarios, conductores) con helpers `isSuperAdmin`/`isJefeTrafico`/`ownerOfDoc`/`sameTenant` y aislamiento por tenant. El resto del modelo tiene deny-all explícito por colección. Origen: previo a Bloque 6 (no rastreado en historial granular del proyecto; descubierto durante PASO 3 del Bloque 7).
- Routing protegido por auth y redirección por rol operativa (Bloque 6). `ProtectedRoute` como layout route gatea `status` + `user.rol`; `LoginPage` centraliza redirección post-login y redirect inverso con `homeForRol()`. Sidebar y Topbar leen `useAuth()`: sidebar muestra items por rol vía `NAV_BY_ROL` (super_admin con secciones Gobierno+Operativa, jefe_trafico con 7 items, conductor con 2), topbar muestra nombre/email + `ROL_LABEL` + signOut funcional. `ClaimsIncompletosView` para el edge case autenticado sin rol. 3 placeholders nuevos para super_admin (Tenants/Centros/Usuarios) + `NotFoundPage` catch-all con CTA inteligente. Eliminados `USUARIO_PLACEHOLDER` y `RolNavegacion` en favor de `Rol` del dominio (`@albius/shared` como SSOT). Seed extendido (`seed-test-user.mjs`) crea 4 users (super_admin/jefe_trafico/conductor/sinclaims) + docs de referencia (tenant/centro/conductor). 16/17 casos verificados contra emulator (caso 11 N/A justificado).
- Forzado de cambio de password en primer login operativo (Bloque 7). AuthContext hidrata el flag `passwordChangeRequired` leyendo `/usuarios/{uid}` con Firebase Web SDK directamente (apoyado en regla `ownerOfDoc` existente). ProtectedRoute añade dos gates: usuarios con flag=true son enviados a `/cambiar-password` antes de cualquier otra ruta privada; usuarios sin flag intentando entrar son redirigidos al home (gate inverso filtra cambio voluntario). CambiarPasswordPage full-screen fuera de AppLayout, form con mínimo 10 caracteres + confirmación + manejo de `auth/weak-password` y `auth/requires-recent-login`. Callable `marcarPasswordCambiada` idempotente cierra el ciclo (pone flag=false + registra `passwordCambiadaEn`). `refreshAuthUser()` en AuthContext re-lee /usuarios tras mutación server-side. Refactor del seed parametriza el flag por user (`jefe`=true verifica Bloque 7; `admin`/`conductor`=false para tests rápidos de Bloque 6). Modelo `Usuario` extendido con `passwordCambiadaEn?: Timestamp`. **Sesión 3 completa.**
- Setup canónico de Sesión 4 (Bloque 8): tipos del modelo `Tenant` y `Centro` extendidos con auditoría completa (`creadoPor`/`creadoEn` retroactivos de D3.7 + `actualizadoPor`/`actualizadoEn` nuevos de D4.1, todos opcionales para retrocompat). Campo `cifValidacionForzada?: boolean` añadido a `Tenant` para trazabilidad del escape hatch de validación de CIF. Validador de CIF español (categoría + dígito control, BOE RD 1065/2007 anexo VI) en triple copia coordinada por `TODO[refactor-shared-build]`: `packages/shared/src/validators/cif.ts` (canónico aspiracional, no consumido todavía) + `apps/functions/src/cif-validator.ts` (consumirá B9) + `apps/web/src/lib/validators/cif.ts` (consumirá B10). Cabecera de cada archivo recuerda mantener sincronizadas las 3 copias; integridad verificable con SHA256 (las 3 copias tienen hash idéntico tras B8). 8/8 + 4/4 PASS del algoritmo verificados empíricamente contra CIFs reales (Telefónica `A28017895`, UCM `Q2818014I`) y sintéticos cubriendo las 3 ramas de categoría (REQ_NUM, REQ_LETRA, flexible) más 3 categorías de error (control-mismatch, category-letter, length/digits). Reglas Firestore refinadas (defensa en profundidad sobre los callables que vendrán, D6.1): `update` en `/tenants` y `/centros` veta cambios sobre campos inmutables (`id`, `cif`, `fechaAlta`/`fechaCreacion`, `creadoPor`, `creadoEn`, y `tenantId` del Centro) reutilizando el helper `fieldsChanged` existente. Dry-run de `firebase deploy --only firestore:rules` verde. 4 canónicas en §13: D4.1 (auditoría UPDATE), D4.2 (defaults backend), D4.3 (soft-delete vía UPDATE), D4.4 (validators de dominio + patrón escape hatch). 3 TODOs nuevos en §12.
- Backend Tenants operativo (Bloque 9): callables `crearTenant` + `actualizarTenant` en `apps/functions/src/callables/`. `crearTenant` aplica defaults backend D4.2 (`estado='activo'`, `plan='basico'`, `configuracion={Europe/Madrid, es}`), valida CIF con escape hatch D4.4 (`forzarCIF: true` + persistencia de `cifValidacionForzada: true`; Opción C3 silenciosa cuando válido + forzar — omit del flag), verifica unicidad de CIF entre tenants (`assertCIFUnico` en `refs.ts`), id auto-generado por Firestore, auditoría D3.7. `actualizarTenant` aplica auditoría D4.1 (`actualizadoPor`/`actualizadoEn` en cada write, incluso no-ops), soft-delete D4.3 vía cambio de `estado` con verificación D4.6 de centros activos (`failed-precondition` si los hay), reactivación con `FieldValue.delete()` sobre `fechaCancelacion`, `configuracion` replace completo D4.5 en UPDATE. Validators dedicados con type guards a mano (D3.4) y 4 helpers nuevos en `validation.ts` (`assertOptionalBoolean`, `assertOptionalEnum`, `assertOptionalConfiguracion[Parcial|Completa]`, `assertAtLeastOneField`). Índice compuesto `(centros: tenantId+estado)` en `firestore.indexes.json` para la query de D4.6. Verify script `verify-tenants.mjs` con **19/19 PASS contra emulator** cubriendo las 4 ramas del escape hatch CIF + 3 transiciones de estado + autorización a 3 niveles + validaciones de payload. Convención del proyecto confirmada: `expectedCode` en verify scripts va en UPPER_SNAKE_CASE (formato del wire protocol HTTPS Callable v2), coherente con verify-jefe/conductor/marcarPassword. 2 canónicas nuevas D4.5 + D4.6 en §13. 2 TODOs nuevos en §12 (`deploy-firestore-indexes`, `validar-zona-iana`).

**No hecho:**
- Reglas Firestore para el resto de colecciones (cuadrantes, líneas, intercambios, etc.) — pendientes de los CRUDs de Sesiones 4-7.
- Persistencia: ningún CRUD ni funcionalidad de negocio (cuadrante, intercambios, incidencias…).
- Optimizador Python en Cloud Run (V2).

## 12. Deuda técnica conocida (TODOs activos)

Pendientes asumidos conscientemente durante la construcción del proyecto, con etiqueta de contexto para grep. Revisar en el bloque o sesión indicada.

- `TODO[firebase-json-runtime-explicito]` — añadir `"runtime": "nodejs20"` al bloque `functions` de `firebase.json` antes del primer deploy real. Revisar en Bloque 5/6.
- `TODO[deuda-tecnica-deps-firebase]` — cluster de 9 vulnerabilidades `low` transitivas en `firebase-admin` → `@google-cloud/firestore` → `google-gax` → `retry-request` → `teeny-request` → `http-proxy-agent` → `@tootallnate/once`. `npm audit fix --force` bajaría `firebase-admin` a v10 (breaking change). Postpuesto hasta que Firebase publique nuevas versiones del SDK con las deps actualizadas.
- `TODO[verificar-reglas-en-uso-real]` — Reglas Firestore activas verificadas implícitamente en runtime:
  - ✅ /usuarios read self-only (Bloque 7, AuthContext)
  - ⏳ /tenants, /centros, /conductores (pendientes de CRUDs en Sesiones 4-7)
- `TODO[refactor-zod]` — si los callables crecen a 10 o más, refactorizar validación de payloads a Zod.
- Pendiente actualizar Node de 20.17 a 20.19+ cuando convenga (warn `EBADENGINE` de `eslint-visitor-keys`, no bloqueante).
- `TODO[refactor-shared-build]` — compilar `@albius/shared` a JS con su propio paso de build, eliminar el módulo local `apps/functions/src/collections.ts` y volver a importar `COLLECTIONS` desde `@albius/shared`. Origen: commit `e879854` (sub-bloque 3.2.c). Hoy `shared` se distribuye como TypeScript crudo (`main: "./src/index.ts"`, `noEmit: true`), lo cual funciona en `apps/web` por el resolver de Vite pero no en `apps/functions` tras compilar a CJS. Requiere bloque dedicado: toca `packages/shared`, `apps/functions`, scripts de build raíz y posible verificación de Vite.
- `TODO[email-transport]` — implementar transporte real de email para enviar el `linkPasswordReset` que devuelven los callables `crearJefeTrafico` (3.2.b) y `crearConductor` (3.2.d). Hoy el link queda en la respuesta del callable y el super_admin lo distribuye manualmente. Bloquea el flujo automático de alta de usuarios en producción. Decidir entre SendGrid, Resend, Firebase Extensions u otra alternativa antes del primer despliegue real.
- `TODO[refactor-verify-helpers]` — extraer los helpers duplicados de `apps/functions/scripts/verify-crearJefeTrafico.mjs` y `verify-crearConductor.mjs` (`signInWithCustomToken`, `invokeCallable`, `checkEmulatorsUp`, `expectError`, `record`) a un módulo compartido. Origen: commit `af29340` (sub-bloque 3.2.e). El Bloque 4 añadió `scripts/bootstrap-super-admin.mjs` y el Bloque 5 añadió `apps/functions/scripts/seed-test-user.mjs`, ambos con scope distinto que no comparte estos helpers concretos. Encaja cuando llegue un tercer script de verificación contra emulator que sí los comparta. Decisión pendiente: módulo `.mjs` auxiliar o migración a `.mts` con TypeScript (pipeline nueva: build / tsx / ts-node).
- `TODO[refactor-ping-helpers]` — el callable `ping` del sub-bloque 3.1 (commit `d6f2540`) lee `request.auth.token` directamente para extraer el campo `rol`. Refactorizar para usar `extractClaims` y `assertAuth` de `apps/functions/src/auth-guards.ts` (introducidos después en 3.2.a, commit `348f77f`), simétrico al resto de callables. Deuda menor, sin urgencia.
- `TODO[tipos-conductor-requeridos]` — revisar si los arrays `lineasPreferentes`, `lineasSecundarias` y `tiposTurnoPermitidos` del modelo `Conductor` (`packages/shared/src/types.ts`) deben permanecer required. El callable `crearConductor` los defaultea a `[]` cuando el payload los omite (DUDA-8 de 3.2.d, commit `e810832`). Si el dominio acepta "todavía no asignado" como estado natural, considerar marcarlos opcionales (`?`) para reflejar mejor el modelo conceptual.
- `TODO[jefe-claims-incompletos]` — definir comportamiento cuando un token tiene `rol=jefe_trafico` pero falta `tenantId` o `centroId` en custom claims. Hoy `crearConductor` cae en el check anti cross-tenant con mensaje confuso (3.2.d): `claims.tenantId === undefined` siempre será distinto del `payload.tenantId`, lanzando "Un jefe de tráfico no puede crear conductores en otro tenant." cuando el problema real es alta incompleta. Decidir entre `permission-denied` con mensaje específico o `failed-precondition` simétrico a `assertJefeTrafico`.
- `TODO[verify-cleanup-usuarios-huerfanos]` — los scripts `verify-crearJefeTrafico.mjs` y `verify-crearConductor.mjs` dejan documentos `/usuarios/{uid}` huérfanos en Firestore tras ejecuciones repetidas: el `uid` se regenera con cada `createUser` y los docs anteriores no se borran. No afectan funcionalmente (los tests no consultan esos docs), pero ensucian el estado del emulator. Añadir limpieza opcional al inicio (p.ej. borrar `/usuarios` con `creadoEn` > timestamp del seed) cuando se consolide la infra de testing. Encaja con `TODO[refactor-verify-helpers]`.
- `TODO[bootstrap-verify-production-layers]` — verificar empíricamente las capas 4 (banner production), 5 (confirmación 'CONFIRMAR' interactiva) y 6 (project ID = albius-cbdb1) del script `scripts/bootstrap-super-admin.mjs`. Origen: Bloque 4 (alta de super_admin). Hoy están probadas solo por inspección de código + revisión de mensajes; las capas 1-3 sí se verificaron empíricamente (11/11 casos contra emulator). Verificación empírica de 4-6 requiere ejecución contra Firebase real, pospuesta al Bloque 18 (deploy) o equivalente.
- `TODO[verify-full-password-reset-flow]` — verificar empíricamente el flujo COMPLETO del password reset link emitido por el bootstrap CLI con `generatePasswordResetLink`. Hoy solo se ha verificado con `apps/functions/scripts/seed-test-user.mjs` que usa password directo (atajo aceptable solo para testing en emulator, decidido durante el Bloque 5). Origen: Bloque 5. Encaja cuando exista transporte de email implementado (ver `TODO[email-transport]`) o cuando se valide manualmente siguiendo el link emitido por bootstrap CLI en emulator desde el navegador.
- `TODO[web-bundle-splitting]` — **PRIORITARIO** (promovido de baja en Bloque 7).

  Estado actual:
  - Bundle principal: 804 kB tras Bloque 7 (vs 615 kB tras Bloque 6, +189 kB por `firebase/functions` SDK + deps transitivas gRPC/Protobuf)
  - Umbral Vite warning (500 kB) cruzado desde Bloque 5
  - Umbral "obligatorio" auto-impuesto (700 kB) cruzado en Bloque 7

  Plan de ataque (sub-bloque dedicado, Sesión 4 o 5):
  1. Analizar bundle con `vite-bundle-visualizer` para identificar top consumidores
  2. Code-splitting por ruta (`React.lazy` + `Suspense`) para páginas pesadas
  3. Considerar `manualChunks` en `vite.config.ts` para separar firebase en chunk vendor propio
  4. Objetivo: bundle principal <500 kB, lazy chunks <200 kB cada uno

  Justificación de no abordarlo en Bloque 7:
  - Cerrar Sesión 3 es prioridad
  - 804 kB funciona y se despliega
  - Solución completa requiere arquitectura, no parche local

  Origen: Bloque 7 PASO 4 (crecimiento por `firebase/functions` SDK).
- `TODO[remove-firebase-stubs]` — eliminar `packages/shared/src/firebase-stubs.ts`. Era un stub temporal con tipos `Timestamp` y `GeoPoint` mientras `@albius/shared` no integraba el Firebase SDK. Hoy `apps/web/src/lib/firebase.ts` (Web SDK) y `apps/functions/src/` (Admin SDK) están operativos; el stub ya no cumple función. Verificar que ningún tipo de `packages/shared` lo importe antes de borrar (grep actual: `types.ts` y `index.ts` lo referencian; migrar a importar tipos de `firebase/firestore` o `firebase-admin/firestore` directamente, o decidir si `@albius/shared` se mantiene neutral SDK). Origen: Bloque 5 (verificación de §5).
- `TODO[topbar-tenant-centro-hidratado]` — Topbar muestra solo `ROL_LABEL` del usuario. Cuando exista hidratación de tenant/centro en `AuthContext` (Sesiones 4-7), refinar para mostrar 'ALSA Murcia · Centro Espinardo' en vez de solo 'Jefe de tráfico'. Origen: Bloque 6. Patrón a seguir: D7.3 + D7.9 (extender `fetchUsuarioDoc` o equivalente, exponer en `AuthUser`, usar `refreshAuthUser()` si requiere refresh).
- `TODO[double-password-change-en-callables]` — los callables `crearJefeTrafico` y `crearConductor` y el bootstrap CLI dejan `passwordChangeRequired=true` al alta Y emiten `linkPasswordReset` con `generatePasswordResetLink`. Cuando un usuario real complete el link reset (set password vía Firebase Auth UI) y haga login, ProtectedRoute lo enviará a `/cambiar-password` y cambiará la contraseña **dos veces**. UX wart en producción. Alternativas a considerar: (a) flipear el flag durante el reset link flow (Firebase no notifica al backend, requeriría tracking lateral); (b) cambiar callables/bootstrap para set `passwordChangeRequired=false` por defecto y dejar que el link sea la única ceremonia; (c) detectar "first login" por `ultimoLogin` ausente en lugar del flag. NO bloquea Bloque 7 (los users seed con flag=true funcionan porque no usan link, usan password directo). Surface en producción cuando se cierre `TODO[email-transport]`. Origen: descubrimiento durante PASO 3 del Bloque 7.
- `TODO[firebase-region]` — actualmente `us-central1` por default de Firebase en `apps/web/src/lib/firebase.ts` (`getFunctions(firebaseApp, 'us-central1')`). Considerar `europe-west1` cuando se despliegue a producción real, para reducir latencia desde España (~80 ms vs ~150 ms desde Europa hacia US-central). Cambio coordinado: también hay que desplegar los callables a esa región (`apps/functions`). Origen: Bloque 7.
- `TODO[validar-cif-consolidar-shared]` — consolidar el validador de CIF en `packages/shared/src/validators/cif.ts` cuando cierre `TODO[refactor-shared-build]`. Hoy triple copia (D4.4): `packages/shared/src/validators/cif.ts` (canónico aspiracional, no consumido aún) + `apps/functions/src/cif-validator.ts` (consumirá callables de B9/B11) + `apps/web/src/lib/validators/cif.ts` (consumirá forms de B10/B12). Integridad verificable con `Get-FileHash`/`sha256sum` sobre los 3 archivos — las 3 deben tener hash SHA256 idéntico. La cabecera de cada archivo recuerda mantener sincronizadas las 3 copias. Origen: Bloque 8 (Sesión 4).
- `TODO[tenant-logo-upload]` — implementar upload de logo de tenant (`Tenant.logoUrl`). Requiere Firebase Storage habilitado + reglas storage + UI dedicada (input file + preview + delete). Out of scope de Sesión 4 (decidido en PASO 2 del Bloque 8). Encaja cuando se aborde branding/personalización de UI por tenant. Origen: Bloque 8 (Sesión 4).
- `TODO[edit-cif-procedimiento]` — si surge necesidad operativa de corregir un typo en el CIF de un tenant existente, documentar procedimiento manual (consola Firebase + auditoría) o evaluar añadir callable especial con flag explícito de "corrección de typo". Por defecto, `cif` es inmutable: reglas Firestore (B8 sub-paso 6) lo bloquean a nivel `update`, y los callables de B9 lo vetarán también. El escape hatch existente (`forzarCIF: true` + `cifValidacionForzada: true`) cubre el caso "CIF legítimo fuera del formato español estándar" pero NO el caso "typo en alta". Origen: Bloque 8 (Sesión 4).
- `TODO[deploy-firestore-indexes]` — antes del primer deploy a producción (Sesión 18), ejecutar `firebase deploy --only firestore:indexes`. Los índices viven en `infrastructure/firestore/firestore.indexes.json` y se auto-crean en emulator local, pero en producción son necesarios explícitamente. Índices actuales: `(centros: tenantId+estado)` origen B9 para D4.6 (verificación de centros activos antes de cancelar tenant). Origen: Bloque 9 (Sesión 4).
- `TODO[validar-zona-iana]` — validar `configuracion.zonaHoraria` contra `Intl.supportedValuesOf('timeZone')` o lista hardcoded de zonas europeas comunes. Hoy: `assertNonEmptyString` en `validation.ts`. Si llega valor inválido, el render falla visiblemente con `Intl` en el frontend (B10+) — error visible, no silencioso. Origen: Bloque 9 (Sesión 4).

## 13. Decisiones canónicas del proyecto

Decisiones de diseño aprobadas durante la planificación de cada bloque y consolidadas aquí como referencia para implementaciones futuras. Subdivididas por bloque. Las decisiones internas (no canónicas) viven en los mensajes de commit, no aquí.

### Bloque 3 — callables crearJefeTrafico + crearConductor

- **D3.1 — `conductorId` desacoplado del `uid` de Firebase Auth.** El identificador del conductor coincide con el número de empleado (información de negocio que debe sobrevivir a cambios de cuenta de Auth) y NO con el `uid` del documento `/usuarios`. El enlace usuario↔conductor se hace mediante el campo `conductorId` en el documento `/usuarios`.
- **D3.2 — `crearConductor` crea `/usuarios` y `/conductores` atómicamente.** El callable escribe ambos documentos en una única operación. Si alguna de las dos escrituras falla, rollback completo (incluyendo el usuario de Firebase Auth si ya se creó). Un conductor sin sus dos documentos no es funcional.
- **D3.3 — Contraseña inicial vía `generatePasswordResetLink`.** El email de configuración de contraseña se envía con `generatePasswordResetLink` del Admin SDK. NUNCA devolver contraseñas en la respuesta del callable ni escribirlas en logs. Si el usuario pierde el enlace, se repite el flujo desde super_admin.
- **D3.4 — Validación de payloads con type guards a mano.** En este bloque NO se introduce Zod: se valida cada campo con type guards y se lanza `invalid-argument` con mensaje claro al fallar. Si los callables crecen a 10 o más se refactoriza (ver `TODO[refactor-zod]` en §12).
- **D3.5 — Sesión 3 partida en dos sub-sesiones por tamaño.** Bloque 3.1: scaffold del paquete `apps/functions` + callable `ping` (completado). Bloque 3.2: callables `crearJefeTrafico` y `crearConductor`.
- **D3.6 — Verificación de existencia de referencias antes de crear.** `crearJefeTrafico` verifica que `/tenants/{tenantId}` y `/centros/{centroId}` existen. `crearConductor` verifica lo mismo y además que el `tenantId` del payload coincide con el `tenantId` del jefe que llama (anti cross-tenant). Si falla la verificación, devolver `invalid-argument` indicando qué referencia no existe.
  - **Ampliación 3.2.d:** para `crearConductor` se verifica también que `claims.centroId === payload.centroId` cuando invoca un jefe (anti cross-centro), por simetría con la identidad operativa del jefe `(tenantId, centroId)`. Mensaje: "Un jefe de tráfico no puede crear conductores en otro centro." (DUDA-11 de 3.2.d). Sin esta ampliación, un jefe del centro A podría crear conductores en centro B del mismo tenant, lo cual es abuso de permisos. Implementación: commit `e810832`.
- **D3.7 — Auditoría mínima en cada documento creado.** Los documentos nuevos en `/usuarios` y `/conductores` incluyen `creadoPor` (uid del invocador, `request.auth.uid`) y `creadoEn` (`FieldValue.serverTimestamp()`).
  - **Ampliación Bloque 4:** bootstrap CLI usa `creadoPor: 'bootstrap-cli'` como valor convencional al no existir `request.auth.uid` (script ejecutado fuera del flujo callable, sin invocador autenticado). Implementación: `scripts/bootstrap-super-admin.mjs`. Grep-eable para localizar todos los super_admins creados por bootstrap CLI vs por callables (que tendrían un uid real en `creadoPor`).

### Bloque 6 — routing protegido + sidebar por rol

- **D6.1 — ProtectedRoute solo gatea autenticación, no rol específico de ruta.** Defensa en profundidad por capas: UI (sidebar oculta items que el rol no debe ver, mejora UX), routing (`<ProtectedRoute/>` valida status+user.rol, evita accidentes con URL bar), backend (reglas Firestore rechazarán lecturas cuando lleguen en sesiones 4+, ÚNICA capa de defensa real). Si surge necesidad de `RoleGate` explícito por ruta, sub-bloque aparte sin tocar este contrato.
- **D6.5 — `homeForRol(rol)` agnóstico al destino.** Mapping `ROL_HOME: Record<Rol, string>` desacopla la convención. Añadir un cuarto rol futuro (ej. `inspector`) requiere solo añadir entrada al record, sin tocar `LoginPage`, `ProtectedRoute` ni `NotFoundPage`.

### Bloque 7 — forzado de cambio de password en primer login

- **D7.3 — `refreshAuthUser()` en AuthContext re-lee el doc `/usuarios` y actualiza `user` state.** Establece patrón canónico: cualquier mutación server-side que el frontend deba reflejar en estado inmediato se canaliza por este método. Aplicable a hidrataciones futuras (tenant/centro en Topbar — ver `TODO[topbar-tenant-centro-hidratado]`) y a estados que dependan del doc `/usuarios`.
- **D7.9 — Hidratación de AuthContext lee `/usuarios/{uid}` directamente con Firebase Web SDK, apoyándose en la regla self-only existente (`ownerOfDoc(uid)`) en `firestore.rules`.** Establece patrón canónico: las hidrataciones del frontend (tenant/centro pendientes, mi-horario, CRUDs en Sesiones 4+) leerán Firestore directamente apoyándose en reglas declarativas, NO en callables hidratadores. Tocar la regla `read` self-only sobre `/usuarios` rompe el flujo de login del Bloque 7 (hay un comentario explicativo encima de la regla en `firestore.rules`).

### Bloque 4 — Tenants y Centros

- **D4.1 — `actualizadoPor` + `actualizadoEn` como auditoría obligatoria de UPDATE en todo callable de modificación.** Refinamiento de D3.7 (que solo cubría CREATE con `creadoPor`/`creadoEn`). Todo callable cuyo verbo es "actualizar" escribe ambos campos en cada write, sin excepción. Implicación: los tipos del modelo añaden `actualizadoPor?: string` y `actualizadoEn?: Timestamp` (opcionales para retrocompatibilidad con docs legados). Aplica retrospectivamente a futuras refactorizaciones de `marcarPasswordCambiada` si se considera UPDATE auditable.
- **D4.2 — Defaults de campos opcionales aplicados en backend, no en frontend.** Los callables de creación rellenan defaults (`configuracion.zonaHoraria='Europe/Madrid'`, `configuracion.idioma='es'`, `estado='activo'`, `plan='basico'`, etc.) cuando el payload los omite. El form puede no enviarlos. Centraliza la regla en un único lugar y evita drift cliente/servidor. Aplica retroactivamente a `crearJefeTrafico`, `crearConductor` y `bootstrap-super-admin.mjs`, que ya defaultean campos del modelo (`passwordChangeRequired=true`, `estado='activo'`, etc.) en backend; D4.2 formaliza el patrón implícito.
- **D4.3 — Soft-delete se implementa como UPDATE del callable `actualizar*` con cambio del campo `estado`, NUNCA callable separado `eliminar*`.** Hard-delete reservado a super_admin manual desde consola Firebase para limpieza de datos contaminados (sin UI). Las reglas Firestore permiten `delete` solo a super_admin pero la web NO expone esa acción. Implicación: simplifica el menú de callables (4 por entidad principal: crear, actualizar, …) y unifica auditoría (`actualizadoPor` registra quién canceló/inactivó).
- **D4.4 — Validaciones de dominio (CIF, futuras: DNI, IBAN, matrículas) viven en `packages/shared/src/validators/` como funciones puras sin dependencias externas, compartidas entre frontend y backend.** Mientras `TODO[refactor-shared-build]` esté abierto, el código se duplica en `apps/functions/src/` y `apps/web/src/lib/validators/` con cabecera de "actualiza las 3 copias". La validación se ejecuta en frontend (UX instant feedback en blur) Y en backend (gate).

  Para CIF específicamente, el gate del backend admite escape hatch (`forzarCIF: true`) para casos legítimos no cubiertos por el algoritmo español estándar (empresas extranjeras, autónomos con DNI, sociedades civiles): el operador confirma conscientemente y se persiste flag `cifValidacionForzada: true` para auditoría. El patrón "escape hatch con flag de auditoría" será reusable para futuros validators de dominio cuando el caso real lo justifique.

- **D4.5 — Objetos compuestos en payload de callables (`configuracion`, futuros similares) tienen tratamiento asimétrico CREATE vs UPDATE.** CREATE: merge del objeto recibido con defaults backend. Permite payload parcial, los huecos se rellenan automáticamente. UPDATE: replace completo. El validator exige que el objeto incluya todos los sub-campos del modelo. Si el frontend quiere editar un sub-campo, debe hidratar primero el objeto entero, modificarlo, y re-enviarlo completo.

  Razón: evita ambigüedad de "envío `{idioma: 'en'}`, ¿qué pasa con `zonaHoraria`?". El replace en UPDATE hace explícita la responsabilidad del frontend. La asimetría es intencional: el alta es "rellena lo que falta", la edición es "este es el estado que quiero".

- **D4.6 — Soft-delete (cambio de estado a `'cancelado'`/`'inactivo'`) verifica que no hay entidades hijas activas dependientes antes de aceptar el cambio.** Si las hay, el callable rechaza con `failed-precondition` indicando qué bloquea (con conteo o lista). Cascada manual: el operador debe inactivar primero las dependencias. NO se implementa cascada automática (riesgo de borrado masivo accidental). Implementaciones del Bloque 9: Tenant → verifica Centros activos via query `where(tenantId, ==, X).where(estado, ==, 'activo')`. Aplicable simétricamente a Centro → Conductores activos (futuro Sesión 7).

## 14. Procedimiento de trabajo (emergente, validado tras Bloques 3-5)

Patrón iterativo que ha demostrado valor en los últimos sub-bloques:

  Diseño → OK del usuario → Aplicación → OK del usuario → Verificación → OK del usuario → Commit → OK del usuario

Reglas operativas observadas:

1. **Pre-commit checks obligatorios**: `npm run build` + `npm run lint` antes de cerrar cualquier commit. Build incluye `tsc -b` (validación de tipos). Origen: lección incorporada tras `e879854` (push con lint en rojo que requirió hotfix `6d76b68`).
2. **Verificación empírica antes de aplicar cambios sugeridos**. Patrón: cuando se ve algo aparentemente raro (línea duplicada, archivo extraño, proceso colgado), primero verificar con `grep` / `cat` / lectura del log; modificar solo tras confirmar la condición real. Lección consolidada: el "bug aparente" fue artefacto visual en 3 ocasiones distintas (commit C2 del 3.2.e, `target` en bootstrap, Vite "colgado" del Bloque 5).
3. **Mensajes de commit detallados** con trazabilidad de decisiones `D-N` y `DUDA-N`, hashes referenciados, justificación de cambios técnicos. El commit debe permitir a un lector futuro entender el contexto sin abrir archivos adicionales.
4. **Deuda explícita**: cuando se pospone una decisión, se anota inmediatamente como `TODO[nombre-descriptivo]` en §12 con contexto, qué resolvería y cuándo encaja.
5. **Separación de scopes para scripts**: `apps/functions/scripts/` para testing infrastructure (`verify-*` que validan callables, `seed-*` que crean datos de prueba); `scripts/` raíz para operaciones CLI standalone (`bootstrap-*` para bootstrap del sistema). Cada tipo tiene perfil de fail-safe distinto: producción (6 capas en bootstrap), emulator-only (hardcoded en seed).
6. **Working tree por commit**: stage explícito por archivo, nunca `git add -A` o `git add .`. Cada commit tiene propósito autocontenido.
7. **Limpieza de procesos al cerrar sesión**: TaskStop por ID + verificación manual de huérfanos. El proceso `java` del Firestore emulator NO recibe el SIGTERM de Node y queda activo en cierres anteriores (3.2.c, 3.2.d, 3.2.e, 4, 5). Matar con `Stop-Process -Force` confirmando con CommandLine que es el Firestore correcto.
8. **`--target` o equivalente sin default** para cualquier script CLI que pueda tocar producción. Forzar elección consciente del operador (capa 1 de fail-safe).
9. **Sistema de auditoría con `creadoPor` en 3 niveles**: callable (uid real de `request.auth.uid`), bootstrap CLI (`'bootstrap-cli'`), testing seed (`'seed-test-user'`). Si en producción aparece `'seed-test-user'`, es alarma temprana de datos contaminados de testing.
10. **Diagnóstico antes que kill**: cuando algo parece colgado, leer log antes de matar proceso. El primer paso de diagnóstico es siempre `tail` del log + `netstat`. Lección: Vite estuvo listo en 449ms; el poll script fallido buscaba string con escapes ANSI que nunca matcheaban.
