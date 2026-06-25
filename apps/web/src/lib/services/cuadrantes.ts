/**
 * Servicio del Cuadrante — única superficie de I/O Firebase para la UI del
 * cuadrante (D4.9). Cubre el flujo del optimizador (B29 Fase C):
 *   - generarCuadrante: callable en EUROPE-WEST1 (functionsEu), no us-central1.
 *   - crearCuadrante: callable en us-central1 (el resto del ciclo de vida B26).
 *   - suscribirCuadrante: onSnapshot al doc (feedback reactivo del estado de
 *     generación async — patrón NUEVO, justificado: el estado cambia en backend
 *     ~5 min sin acción del cliente; D4.8 era para listas administrativas).
 *   - listarAsignaciones: query del plan generado.
 *
 * Sin manejo de errores aquí (D4.10): el caller decide y `mapCallableError`
 * traduce al usuario.
 */
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  COLLECTIONS,
  type Asignacion,
  type Cuadrante,
} from '@albius/shared';
import { db, functions, functionsEu } from '@/lib/firebase';

// ============================================================================
//  ID DETERMINISTA  (espejo del callable crearCuadrante, B26)
// ============================================================================

/** `cua_{centroId}_{año}_{mes}` — mes 1-12 SIN zero-pad (igual que el callable). */
export function cuadranteIdDe(
  centroId: string,
  año: number,
  mes: number,
): string {
  return `cua_${centroId}_${año}_${mes}`;
}

// ============================================================================
//  CALLABLES
// ============================================================================

export interface GenerarCuadranteInput {
  cuadranteId: string;
}
export interface GenerarCuadranteResult {
  ok: true;
  cuadranteId: string;
}

/**
 * Lanza la generación ASÍNCRONA. Devuelve `{ok, cuadranteId}` en <1s — NO trae el
 * plan: el plan llega async vía el onSnapshot (estadoGeneracion 'generando'→
 * 'completado'). Invoca el callable en EUROPE-WEST1 (functionsEu).
 */
export async function generarCuadrante(
  input: GenerarCuadranteInput,
): Promise<GenerarCuadranteResult> {
  const fn = httpsCallable<GenerarCuadranteInput, GenerarCuadranteResult>(
    functionsEu,
    'generarCuadrante',
  );
  const res = await fn(input);
  return res.data;
}

export interface CrearCuadranteInput {
  tenantId: string;
  centroId: string;
  año: number;
  mes: number;
}
export interface CrearCuadranteResult {
  ok: true;
  cuadranteId: string;
}

/** Crea el cuadrante borrador del mes (callable B26, us-central1). */
export async function crearCuadrante(
  input: CrearCuadranteInput,
): Promise<CrearCuadranteResult> {
  const fn = httpsCallable<CrearCuadranteInput, CrearCuadranteResult>(
    functions,
    'crearCuadrante',
  );
  const res = await fn(input);
  return res.data;
}

// ============================================================================
//  LECTURA
// ============================================================================

/**
 * Suscripción reactiva al doc del cuadrante. `onChange(null)` si el doc no existe
 * (aún no creado para ese mes). Lectura get-by-id: la regla `read sameTenant(
 * resource.data.tenantId)` evalúa bien en un get (resource.data disponible), sin
 * el caveat D6.5 del list. Devuelve el `Unsubscribe` para el cleanup del effect.
 */
export function suscribirCuadrante(
  cuadranteId: string,
  onChange: (cuadrante: Cuadrante | null) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, COLLECTIONS.CUADRANTES, cuadranteId),
    (snap) => onChange(snap.exists() ? (snap.data() as Cuadrante) : null),
    (err) => {
      console.error('[cuadrantes] onSnapshot error:', err);
      onError?.(err);
    },
  );
}

/**
 * Asignaciones del cuadrante, ordenadas por fecha. La query constriñe `tenantId`
 * (D6.5: la regla `read` de /asignaciones es `sameTenant(resource.data.tenantId)`
 * y en un `list` Firestore exige acotar tenantId). Servida por el índice
 * `(asignaciones: tenantId+cuadranteId+fecha)` (B26).
 */
export async function listarAsignaciones(
  tenantId: string,
  cuadranteId: string,
): Promise<Asignacion[]> {
  const q = query(
    collection(db, COLLECTIONS.ASIGNACIONES),
    where('tenantId', '==', tenantId),
    where('cuadranteId', '==', cuadranteId),
    orderBy('fecha'),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Asignacion);
}
