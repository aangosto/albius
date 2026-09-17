/**
 * Servicio de MI HORARIO (conductor, B34.2) — única superficie de I/O Firebase
 * de la vista (D4.9). Solo LECTURA.
 *
 * CRÍTICO (D6.5 + reglas B34.1): un `list` de Firestore se evalúa SIN
 * resource.data, así que cada query debe constreñir EXACTAMENTE lo que la
 * regla exige, o Firestore rechaza el list aunque los docs sean del propio
 * conductor:
 *   - /asignaciones: where('conductorId','==',<claim>) (+ tenantId).
 *   - /ausencias:    where('conductorId','==',<claim>) (+ tenantId).
 *   - /cuadrantes:   where('estado','in',['publicado','cerrado']) (+ tenant/centro).
 * El `conductorId` sale de AuthContext (leído del doc /usuarios); las reglas lo
 * cotejan con el custom claim del token (B34.1).
 *
 * Índices: asignaciones (tenantId+conductorId+fecha) de B26; el resto son
 * queries de igualdad (index merging, sin compuesto).
 */
import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
  Timestamp,
} from 'firebase/firestore';
import {
  COLLECTIONS,
  type Asignacion,
  type Ausencia,
  type Cuadrante,
} from '@albius/shared';
import { db } from '@/lib/firebase';

/** Cuadrantes del centro que el conductor puede ver: publicados + cerrados
 *  (borrador = trabajo en curso, la regla lo veta). */
export async function listarCuadrantesVisibles(
  tenantId: string,
  centroId: string,
): Promise<Cuadrante[]> {
  const q = query(
    collection(db, COLLECTIONS.CUADRANTES),
    where('tenantId', '==', tenantId),
    where('centroId', '==', centroId),
    where('estado', 'in', ['publicado', 'cerrado']),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Cuadrante);
}

/**
 * Asignaciones del conductor en el mes (UTC), filtradas en memoria a los
 * cuadrantes visibles (`cuadranteIdsVisibles`): una asignación de un
 * cuadrante en borrador no se muestra aunque el índice la devolviera (no lo
 * hará: la regla de /asignaciones es por conductorId, no por estado del
 * cuadrante, así que el filtro en memoria es el que aplica la decisión
 * "solo publicados/cerrados").
 */
export async function listarMisAsignaciones(
  tenantId: string,
  conductorId: string,
  año: number,
  mes: number,
  cuadranteIdsVisibles: ReadonlySet<string>,
): Promise<Asignacion[]> {
  const desde = Timestamp.fromDate(new Date(Date.UTC(año, mes - 1, 1)));
  const hasta = Timestamp.fromDate(new Date(Date.UTC(año, mes, 0)));
  const q = query(
    collection(db, COLLECTIONS.ASIGNACIONES),
    where('tenantId', '==', tenantId),
    where('conductorId', '==', conductorId),
    where('fecha', '>=', desde),
    where('fecha', '<=', hasta),
    orderBy('fecha'),
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => d.data() as Asignacion)
    .filter((a) => cuadranteIdsVisibles.has(a.cuadranteId));
}

/** Todas las ausencias del conductor (pocas; el recorte al mes lo hace la
 *  vista con expandirAusenciaEnMes). */
export async function listarMisAusencias(
  tenantId: string,
  conductorId: string,
): Promise<Ausencia[]> {
  const q = query(
    collection(db, COLLECTIONS.AUSENCIAS),
    where('tenantId', '==', tenantId),
    where('conductorId', '==', conductorId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Ausencia);
}
