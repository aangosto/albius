/**
 * Servicio de Conductores — única superficie de I/O Firebase para la UI de
 * Conductores (D4.9 canónica). Hermano de services/lineas.ts.
 *
 * B22: el jefe de tráfico LISTA los conductores de su centro y EDITA su config
 * operativa (callable actualizarConductor de B21). El alta sigue siendo
 * super_admin-only (flujo de Usuarios), por eso aquí NO hay crearConductor.
 *
 * Tipos del wire — copia local hasta que cierre TODO[refactor-shared-build].
 * DEBEN coincidir con apps/functions/src/validation.ts
 * (ActualizarConductorPayload).
 *
 * SI MODIFICAS EL TIPO DEL WIRE, REVISA TAMBIÉN:
 *   - apps/functions/src/validation.ts (ActualizarConductorPayload)
 *   - apps/functions/src/callables/actualizarConductor.ts (uso del payload)
 *
 * Sin manejo de errores aquí (D4.10): el caller decide qué loggear y los
 * Dialogs traducen al usuario con `mapCallableError`.
 * Sin paginación ni onSnapshot (D4.8): listado client-side con re-fetch tras
 * mutación; orden en memoria (sin orderBy server-side → sin índice nuevo).
 */

import { collection, getDocs, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  COLLECTIONS,
  type Conductor,
  type EstadoConductor,
} from '@albius/shared';
import { db, functions } from '@/lib/firebase';

// ============================================================================
//  TIPO DEL WIRE
// ============================================================================

/**
 * Solo campos editables por actualizarConductor (B21). `conductorId` (= id del
 * doc /conductores) identifica cuál. El backend veta identidad/pertenencia y los
 * campos dual-homed con /usuarios (email/telefono/nombre/apellidos → se editan
 * vía actualizarUsuario). Todos opcionales salvo `conductorId`; el callable
 * exige al menos uno (assertAtLeastOneField).
 */
export interface ActualizarConductorInput {
  conductorId: string;
  lineasPreferentes?: string[];
  lineasSecundarias?: string[];
  tiposTurnoPermitidos?: string[];
  tiposTurnoExcluidos?: string[];
  maxHorasSemanales?: number;
  observaciones?: string;
  puedeSerReserva?: boolean;
  estado?: EstadoConductor;
}

export interface ActualizarConductorResult {
  ok: true;
  conductorId: string;
}

// ============================================================================
//  WRAPPER DE CALLABLE
// ============================================================================

export async function actualizarConductor(
  input: ActualizarConductorInput,
): Promise<ActualizarConductorResult> {
  const fn = httpsCallable<ActualizarConductorInput, ActualizarConductorResult>(
    functions,
    'actualizarConductor',
  );
  const res = await fn(input);
  return res.data;
}

// ============================================================================
//  LISTADO
// ============================================================================

/**
 * Lista los conductores de UN centro. La query constriñe `tenantId` Y
 * `centroId` (D6.5): la regla `read` de /conductores valida
 * `sameTenant(resource.data.tenantId)`, y en un `list` Firestore exige que la
 * query pruebe `tenantId` (sin él → permission-denied). Es a la vez requisito
 * técnico y aislamiento real (un jefe filtrando un tenant ajeno → denied).
 *
 * SIN `orderBy` server-side: el orden se hace en cliente (D4.8 carga todo en
 * memoria), lo que evita necesitar un índice compuesto nuevo (el existente
 * `(conductores: centroId+estado)` no serviría para tenantId+centroId+orden).
 */
export async function listarConductores(
  tenantId: string,
  centroId: string,
): Promise<Conductor[]> {
  const q = query(
    collection(db, COLLECTIONS.CONDUCTORES),
    where('tenantId', '==', tenantId),
    where('centroId', '==', centroId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Conductor);
}
