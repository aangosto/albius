/**
 * Servicio de Ausencias — única superficie de I/O Firebase para la UI de
 * Ausencias (D4.9 canónica). Hermano de services/lineas.ts. B32.2.
 *
 * Tipos del wire — copia local hasta que cierre TODO[refactor-shared-build].
 * DEBEN coincidir con apps/functions/src/validation.ts
 * (CrearAusenciaPayload + ActualizarAusenciaPayload).
 *
 * SI MODIFICAS LOS TIPOS DEL WIRE, REVISA TAMBIÉN:
 *   - apps/functions/src/validation.ts (CrearAusenciaPayload, ActualizarAusenciaPayload)
 *   - apps/functions/src/callables/{crear,actualizar,eliminar}Ausencia.ts
 *
 * Fechas: `fechaInicio`/`fechaFin` viajan como "YYYY-MM-DD" (el backend las
 * parsea con `new Date(iso)` → medianoche UTC → Timestamp). Al leer, la UI
 * las muestra con getUTC* (helper `tsToISODateUTC`) — NUNCA con getDate()
 * local, que en Europe/Madrid desplazaría el día (mismo cuidado que
 * CalendarioPage).
 *
 * Callables en us-central1 (instancia `functions`; `functionsEu` es solo para
 * generarCuadrante, D6.15).
 *
 * Sin manejo de errores aquí (D4.10); sin paginación ni onSnapshot (D4.8).
 */

import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  COLLECTIONS,
  type Ausencia,
  type CategoriaAusencia,
} from '@albius/shared';
import { db, functions } from '@/lib/firebase';

// ============================================================================
//  TIPOS DEL WIRE
// ============================================================================

export interface CrearAusenciaInput {
  tenantId: string;
  centroId: string;
  conductorId: string;
  categoria: CategoriaAusencia;
  codigo?: string;
  /** "YYYY-MM-DD" (inclusive). */
  fechaInicio: string;
  /** "YYYY-MM-DD" (inclusive, >= fechaInicio; igual = un solo día). */
  fechaFin: string;
  observaciones?: string;
}

export interface CrearAusenciaResult {
  ok: true;
  ausenciaId: string;
}

/**
 * `tenantId`/`centroId`/`conductorId` deliberadamente AUSENTES: inmutables
 * (el validator del callable los veta con mensaje específico; una ausencia
 * pertenece a un conductor de por vida — crea otra si cambia de conductor).
 */
export interface ActualizarAusenciaInput {
  ausenciaId: string;
  categoria?: CategoriaAusencia;
  codigo?: string;
  fechaInicio?: string;
  fechaFin?: string;
  observaciones?: string;
}

export interface ActualizarAusenciaResult {
  ok: true;
  ausenciaId: string;
}

export interface EliminarAusenciaInput {
  ausenciaId: string;
}

export interface EliminarAusenciaResult {
  ok: true;
  ausenciaId: string;
}

// ============================================================================
//  WRAPPERS DE CALLABLES
// ============================================================================

export async function crearAusencia(
  input: CrearAusenciaInput,
): Promise<CrearAusenciaResult> {
  const fn = httpsCallable<CrearAusenciaInput, CrearAusenciaResult>(
    functions,
    'crearAusencia',
  );
  const res = await fn(input);
  return res.data;
}

export async function actualizarAusencia(
  input: ActualizarAusenciaInput,
): Promise<ActualizarAusenciaResult> {
  const fn = httpsCallable<ActualizarAusenciaInput, ActualizarAusenciaResult>(
    functions,
    'actualizarAusencia',
  );
  const res = await fn(input);
  return res.data;
}

export async function eliminarAusencia(
  input: EliminarAusenciaInput,
): Promise<EliminarAusenciaResult> {
  const fn = httpsCallable<EliminarAusenciaInput, EliminarAusenciaResult>(
    functions,
    'eliminarAusencia',
  );
  const res = await fn(input);
  return res.data;
}

// ============================================================================
//  LISTADO
// ============================================================================

/**
 * Lista las ausencias de UN centro, más recientes primero (por fechaInicio).
 *
 * La query constriñe `tenantId` Y `centroId` (D6.5: la regla `read` de
 * /ausencias exige probar `tenantId` en un `list`). `orderBy(fechaInicio)` ASC
 * la sirve el índice compuesto `(ausencias: tenantId+centroId+fechaInicio)` de
 * B32.1; el orden DESC se aplica en memoria (invertir el array) para no
 * depender de que Firestore recorra el índice al revés.
 */
export async function listarAusencias(
  tenantId: string,
  centroId: string,
): Promise<Ausencia[]> {
  const q = query(
    collection(db, COLLECTIONS.AUSENCIAS),
    where('tenantId', '==', tenantId),
    where('centroId', '==', centroId),
    orderBy('fechaInicio'),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Ausencia).reverse();
}

// ============================================================================
//  HELPERS DE FECHA (UTC)
// ============================================================================

/** Timestamp → "YYYY-MM-DD" en UTC (para inputs date y comparaciones). */
export function tsToISODateUTC(ts: Ausencia['fechaInicio']): string {
  return ts.toDate().toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → "DD/MM/AAAA" para mostrar. */
export function isoToDisplay(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
