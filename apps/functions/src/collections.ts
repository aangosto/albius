/**
 * Constantes de colecciones Firestore para uso runtime en Cloud Functions.
 *
 * Espejo runtime de `COLLECTIONS` de `@albius/shared/types.ts`. Existe porque
 * `@albius/shared` se distribuye como TypeScript crudo (sin paso de build) y
 * Vite lo resuelve directamente, pero Node CJS (donde corren las functions
 * tras compilar a lib/) no entiende `.ts` y rompe al hacer `require()`.
 *
 * TODO[refactor-shared-build]: cuando `@albius/shared` se compile a JS
 * (Opción A del análisis del Bloque 3.2.c PASO 5), eliminar este archivo y
 * volver a importar `COLLECTIONS` desde `@albius/shared`.
 *
 * Mantener sincronizado con packages/shared/src/types.ts (las 22 colecciones).
 */
export const COLLECTIONS = {
  TENANTS: "tenants",
  CENTROS: "centros",
  USUARIOS: "usuarios",
  CONDUCTORES: "conductores",
  LINEAS: "lineas",
  PARADAS: "paradas",
  FRECUENCIAS: "frecuencias",
  FRECUENCIAS_EXCEPCIONALES: "frecuencias_excepcionales",
  TIPOS_TURNO: "tipos_turno",
  SERVICIOS: "servicios",
  CUADRANTES: "cuadrantes",
  VERSIONES_CUADRANTE: "versiones_cuadrante",
  ASIGNACIONES: "asignaciones",
  CAMBIOS_ASIGNACIONES: "cambios_asignaciones",
  PREFERENCIAS_PERMANENTES: "preferencias_permanentes",
  PREFERENCIAS_PUNTUALES: "preferencias_puntuales",
  SOLICITUDES_INTERCAMBIO: "solicitudes_intercambio",
  INCIDENCIAS: "incidencias",
  FESTIVOS: "festivos",
  CONVENIO: "convenio",
  NOTIFICACIONES: "notificaciones",
  AUDIT_LOGS: "audit_logs",
} as const;
