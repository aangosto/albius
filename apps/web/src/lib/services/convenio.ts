/**
 * Servicio del Convenio — única superficie de I/O Firebase para el convenio
 * del centro en la UI (D4.9). Lectura (B33.2) + escritura vía guardarConvenio
 * (B35.1, ConvenioPage).
 *
 * Singleton por centro: doc id = centroId (D6.9). Get-by-id: la regla `read
 * sameTenant(resource.data.tenantId)` evalúa bien en un get. Devuelve null si
 * el centro aún no tiene convenio (la UI degrada: sin aviso de descanso).
 */
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { COLLECTIONS, type Convenio } from '@albius/shared';
import { db, functions } from '@/lib/firebase';

export async function obtenerConvenio(
  centroId: string,
): Promise<Convenio | null> {
  try {
    const snap = await getDoc(doc(db, COLLECTIONS.CONVENIO, centroId));
    return snap.exists() ? (snap.data() as Convenio) : null;
  } catch (err) {
    // Doc INEXISTENTE: la regla `read` de /convenio evalúa
    // `sameTenant(resource.data.tenantId)` y sin doc no hay `resource`, así que
    // Firestore responde permission-denied en vez de "no existe" (detectado en
    // B35.1 con el centro sin convenio). Para el jefe leyendo SU centro, ese
    // código solo puede significar "aún no hay convenio" → null. La solución
    // limpia es en reglas (TODO[rules-convenio-get-inexistente]: autorizar el
    // get por doc-id `centroId == token.centroId`, evaluable sin resource).
    if (esPermissionDenied(err)) return null;
    throw err;
  }
}

function esPermissionDenied(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'permission-denied'
  );
}

// ============================================================================
//  ESCRITURA (B35.1) — upsert singleton vía callable guardarConvenio (B25)
// ============================================================================

export interface GuardarConvenioInput {
  tenantId: string;
  centroId: string;
  convenioReferencia?: string;
  descansoMinimoEntreJornadasHoras: number;
  maxHorasSemanales: number;
  maxHorasAnuales: number;
  minDomingosLibresAño: number;
  maxFinesSemanaConsecutivosTrabajados: number;
  maxDiasConsecutivosTrabajados: number;
  descansoSemanalMinimoHoras: number;
  antelacionMinimaPublicacionDias: number;
  horasFestivoComputanComoExtras: boolean;
  computoHoras?: 'jornada' | 'conduccion';
}
export interface GuardarConvenioResult {
  ok: true;
  centroId: string;
}

/** Crea o actualiza el convenio del centro (id = centroId). Los 9 límites son
 *  requeridos y se reenvían siempre; los opcionales, "omit = no tocar". */
export async function guardarConvenio(
  input: GuardarConvenioInput,
): Promise<GuardarConvenioResult> {
  const fn = httpsCallable<GuardarConvenioInput, GuardarConvenioResult>(
    functions,
    'guardarConvenio',
  );
  const res = await fn(input);
  return res.data;
}
