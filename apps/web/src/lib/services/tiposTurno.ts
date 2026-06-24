/**
 * Servicio de Tipos de turno — única superficie de I/O Firebase para la UI de
 * Tipos de turno (D4.9 canónica). Componentes y páginas NO importan
 * directamente `httpsCallable`, `getDocs`, `collection`, etc.; consumen este
 * módulo. Hermano de services/lineas.ts (entidad operativa del jefe).
 *
 * Tipos del wire — copia local hasta que cierre TODO[refactor-shared-build].
 * DEBEN coincidir con apps/functions/src/validation.ts
 * (CrearTipoTurnoPayload + ActualizarTipoTurnoPayload).
 * Verificar manualmente al modificar cualquiera de los dos lados.
 *
 * SI MODIFICAS LOS TIPOS DEL WIRE, REVISA TAMBIÉN:
 *   - apps/functions/src/validation.ts (CrearTipoTurnoPayload, ActualizarTipoTurnoPayload)
 *   - apps/functions/src/callables/crearTipoTurno.ts (uso del payload)
 *   - apps/functions/src/callables/actualizarTipoTurno.ts (uso del payload)
 *
 * Horas: `horaInicio`/`horaFin` y los tramos del partido viajan como string
 * "HH:mm" (el backend las valida con assertHoraHHmm). NO hay conversión a
 * Timestamp (a diferencia de la vigencia de Líneas): son horas-del-día, no
 * fechas. Las duraciones son números DECLARADOS (D6.6): el form no las calcula.
 *
 * Sin manejo de errores aquí (D4.10): el caller decide qué loggear y los
 * Dialogs traducen al usuario con `mapCallableError`.
 * Sin paginación ni onSnapshot (D4.8): listado client-side con re-fetch tras
 * mutación.
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
  type EstadoTipoTurno,
  type TipoDia,
  type TipoTurno,
  type TramoPartido,
} from '@albius/shared';
import { db, functions } from '@/lib/firebase';

// ============================================================================
//  TIPOS DEL WIRE
// ============================================================================

export interface CrearTipoTurnoInput {
  tenantId: string;
  centroId: string;
  codigo: string;
  nombre: string;
  /** "HH:mm" */
  horaInicio: string;
  /** "HH:mm"; si horaFin < horaInicio el turno cruza medianoche. */
  horaFin: string;
  /** Declarada (D6.6), no calculada. */
  duracionMinutos: number;
  /** Declarada (D6.6); <= duracionMinutos. */
  duracionEfectivaMinutos: number;
  esPartido: boolean;
  esNocturno: boolean;
  estado: EstadoTipoTurno;
  /** B27: tipos de día en que el turno se cubre. Requerido, no vacío, sin duplicados. */
  tiposDiaAplicables: TipoDia[];
  color?: string;
  /** Requerido y no vacío SOLO si esPartido. Cada tramo { inicio, fin } "HH:mm". */
  tramosPartido?: TramoPartido[];
}

export interface CrearTipoTurnoResult {
  ok: true;
  tipoTurnoId: string;
}

/**
 * `tenantId` y `centroId` deliberadamente AUSENTES del payload de
 * actualización: son inmutables (defensa en profundidad: reglas Firestore los
 * bloquean en /tipos_turno + el validator del callable los rechaza con mensaje
 * específico). Un tipo de turno pertenece permanentemente a su centro original.
 */
export interface ActualizarTipoTurnoInput {
  tipoTurnoId: string;
  codigo?: string;
  nombre?: string;
  horaInicio?: string;
  horaFin?: string;
  duracionMinutos?: number;
  duracionEfectivaMinutos?: number;
  esPartido?: boolean;
  esNocturno?: boolean;
  estado?: EstadoTipoTurno;
  tiposDiaAplicables?: TipoDia[];
  color?: string;
  tramosPartido?: TramoPartido[];
}

export interface ActualizarTipoTurnoResult {
  ok: true;
  tipoTurnoId: string;
}

// ============================================================================
//  WRAPPERS DE CALLABLES
// ============================================================================

export async function crearTipoTurno(
  input: CrearTipoTurnoInput,
): Promise<CrearTipoTurnoResult> {
  const fn = httpsCallable<CrearTipoTurnoInput, CrearTipoTurnoResult>(
    functions,
    'crearTipoTurno',
  );
  const res = await fn(input);
  return res.data;
}

export async function actualizarTipoTurno(
  input: ActualizarTipoTurnoInput,
): Promise<ActualizarTipoTurnoResult> {
  const fn = httpsCallable<ActualizarTipoTurnoInput, ActualizarTipoTurnoResult>(
    functions,
    'actualizarTipoTurno',
  );
  const res = await fn(input);
  return res.data;
}

// ============================================================================
//  LISTADO
// ============================================================================

/**
 * Lista los tipos de turno de UN centro, ordenados por código ASC.
 *
 * La query filtra por `tenantId` Y `centroId`. El filtro por `tenantId` NO es
 * opcional (D6.5): la regla `read` de /tipos_turno valida
 * `sameTenant(resource.data.tenantId)`, y en una operación `list` (getDocs con
 * where) Firestore NO tiene los documentos, así que exige que la query
 * constriña `tenantId` para poder probar la regla. Sin ese filtro,
 * permission-denied. El filtro es a la vez requisito técnico y aislamiento real
 * (un jefe filtrando `tenantId` ajeno → permission-denied). Mismo patrón que
 * listarLineas (B17).
 *
 * `where(tenantId) + where(centroId) + orderBy(codigo)` la sirve el índice
 * compuesto `(tipos_turno: tenantId+centroId+codigo)` de firestore.indexes.json
 * (creado en B18 aplicando D6.5 desde el diseño).
 */
export async function listarTiposTurno(
  tenantId: string,
  centroId: string,
): Promise<TipoTurno[]> {
  const q = query(
    collection(db, COLLECTIONS.TIPOS_TURNO),
    where('tenantId', '==', tenantId),
    where('centroId', '==', centroId),
    orderBy('codigo'),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as TipoTurno);
}
