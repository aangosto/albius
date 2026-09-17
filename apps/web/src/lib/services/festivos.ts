/**
 * Servicio de Festivos — única superficie de I/O Firebase para la UI de
 * festivos (D4.9, B35.1). Callables B27 en us-central1.
 *
 * Listado: los festivos son POR TENANT con `centroId` opcional (ausente =
 * tenant-wide, aplica a todos los centros). El motor aplica al centro los
 * suyos + los tenant-wide (buildRequest), así que la UI del jefe muestra los
 * dos; la query constriñe `tenantId` (D6.5, índice `(festivos: tenantId+fecha)`)
 * y el filtro por centro se hace en memoria. Los tenant-wide solo los toca el
 * super_admin (el callable lo impone): en la UI van en solo lectura.
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
  type AmbitoFestivo,
  type Festivo,
  type TipoTraficoFestivo,
} from '@albius/shared';
import { db, functions } from '@/lib/firebase';

// ============================================================================
//  TIPOS DEL WIRE
// ============================================================================

export interface CrearFestivoInput {
  tenantId: string;
  /** Presente → festivo del centro (jefe). Ausente → tenant-wide (solo super_admin). */
  centroId?: string;
  /** "YYYY-MM-DD" (UTC). */
  fecha: string;
  nombre: string;
  ambito: AmbitoFestivo;
  tipoTraficoAplicable: TipoTraficoFestivo;
  esEditable?: boolean;
}
export interface CrearFestivoResult {
  ok: true;
  festivoId: string;
}

/** `centroId` deliberadamente AUSENTE: el ámbito de un festivo es fijo. */
export interface ActualizarFestivoInput {
  festivoId: string;
  fecha?: string;
  nombre?: string;
  ambito?: AmbitoFestivo;
  tipoTraficoAplicable?: TipoTraficoFestivo;
}
export interface ActualizarFestivoResult {
  ok: true;
  festivoId: string;
}

export interface EliminarFestivoInput {
  festivoId: string;
}
export interface EliminarFestivoResult {
  ok: true;
  festivoId: string;
}

// ============================================================================
//  WRAPPERS DE CALLABLES
// ============================================================================

export async function crearFestivo(
  input: CrearFestivoInput,
): Promise<CrearFestivoResult> {
  const fn = httpsCallable<CrearFestivoInput, CrearFestivoResult>(
    functions,
    'crearFestivo',
  );
  const res = await fn(input);
  return res.data;
}

export async function actualizarFestivo(
  input: ActualizarFestivoInput,
): Promise<ActualizarFestivoResult> {
  const fn = httpsCallable<ActualizarFestivoInput, ActualizarFestivoResult>(
    functions,
    'actualizarFestivo',
  );
  const res = await fn(input);
  return res.data;
}

export async function eliminarFestivo(
  input: EliminarFestivoInput,
): Promise<EliminarFestivoResult> {
  const fn = httpsCallable<EliminarFestivoInput, EliminarFestivoResult>(
    functions,
    'eliminarFestivo',
  );
  const res = await fn(input);
  return res.data;
}

// ============================================================================
//  LISTADO
// ============================================================================

/**
 * Festivos APLICABLES al centro: los del centro + los tenant-wide, ordenados
 * por fecha. Misma regla de aplicabilidad que `buildRequest` (motor).
 */
export async function listarFestivosDelCentro(
  tenantId: string,
  centroId: string,
): Promise<Festivo[]> {
  const q = query(
    collection(db, COLLECTIONS.FESTIVOS),
    where('tenantId', '==', tenantId),
    orderBy('fecha'),
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => d.data() as Festivo)
    .filter((f) => f.centroId === undefined || f.centroId === null || f.centroId === centroId);
}

/** ¿Es tenant-wide (sin centro)? → solo lectura para el jefe. */
export function esTenantWide(f: Festivo): boolean {
  return f.centroId === undefined || f.centroId === null;
}
