/**
 * Servicio del Convenio — única superficie de I/O Firebase para el convenio
 * del centro en la UI (D4.9). Solo LECTURA (B33.2): el alta/edición sigue
 * entrando por seed/callable guardarConvenio (TODO[convenio-frontend]).
 *
 * Singleton por centro: doc id = centroId (D6.9). Get-by-id: la regla `read
 * sameTenant(resource.data.tenantId)` evalúa bien en un get. Devuelve null si
 * el centro aún no tiene convenio (la UI degrada: sin aviso de descanso).
 */
import { doc, getDoc } from 'firebase/firestore';
import { COLLECTIONS, type Convenio } from '@albius/shared';
import { db } from '@/lib/firebase';

export async function obtenerConvenio(
  centroId: string,
): Promise<Convenio | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.CONVENIO, centroId));
  return snap.exists() ? (snap.data() as Convenio) : null;
}
