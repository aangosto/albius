/**
 * Servicio de Líneas — única superficie de I/O Firebase para la UI de Líneas
 * (D4.9 canónica). Componentes y páginas NO importan directamente
 * `httpsCallable`, `getDocs`, `collection`, etc.; consumen este módulo.
 *
 * Tipos del wire — copia local hasta que cierre TODO[refactor-shared-build].
 * DEBEN coincidir con apps/functions/src/validation.ts
 * (CrearLineaPayload + ActualizarLineaPayload).
 * Verificar manualmente al modificar cualquiera de los dos lados.
 *
 * SI MODIFICAS LOS TIPOS DEL WIRE, REVISA TAMBIÉN:
 *   - apps/functions/src/validation.ts (CrearLineaPayload, ActualizarLineaPayload)
 *   - apps/functions/src/callables/crearLinea.ts (uso del payload)
 *   - apps/functions/src/callables/actualizarLinea.ts (uso del payload)
 *
 * Cuando cierre TODO[refactor-shared-build], los tipos viven en
 * @albius/shared y se importan desde ambos lados.
 *
 * Fechas: `vigenciaDesde`/`vigenciaHasta` viajan como ISO string en el wire
 * (el backend las valida con assertOptionalISODate y las convierte a
 * Timestamp con Timestamp.fromDate — B16). Mismo principio que las coordenadas
 * de Centros, que viajan como objeto plano y el backend hace GeoPoint.
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
  type EstadoLinea,
  type Linea,
  type TipoLinea,
} from '@albius/shared';
import { db, functions } from '@/lib/firebase';

// ============================================================================
//  TIPOS DEL WIRE
// ============================================================================

export interface CrearLineaInput {
  tenantId: string;
  centroId: string;
  codigo: string;
  nombre: string;
  tipo: TipoLinea;
  esNocturna: boolean;
  estado: EstadoLinea;
  color?: string;
  paradasIda?: string[];
  paradasVuelta?: string[];
  /** ISO string ("YYYY-MM-DD" o completa). El backend la convierte a Timestamp. */
  vigenciaDesde?: string;
  /** ISO string. El backend la convierte a Timestamp. */
  vigenciaHasta?: string;
  observaciones?: string;
}

export interface CrearLineaResult {
  ok: true;
  lineaId: string;
}

/**
 * `tenantId` y `centroId` deliberadamente AUSENTES del payload de
 * actualización: son inmutables (defensa en profundidad: reglas Firestore
 * los bloquean en /lineas + el validator del callable los rechaza con mensaje
 * específico). Una línea pertenece permanentemente a su centro original.
 */
export interface ActualizarLineaInput {
  lineaId: string;
  codigo?: string;
  nombre?: string;
  tipo?: TipoLinea;
  esNocturna?: boolean;
  estado?: EstadoLinea;
  color?: string;
  paradasIda?: string[];
  paradasVuelta?: string[];
  vigenciaDesde?: string;
  vigenciaHasta?: string;
  observaciones?: string;
}

export interface ActualizarLineaResult {
  ok: true;
  lineaId: string;
}

// ============================================================================
//  WRAPPERS DE CALLABLES
// ============================================================================

export async function crearLinea(
  input: CrearLineaInput,
): Promise<CrearLineaResult> {
  const fn = httpsCallable<CrearLineaInput, CrearLineaResult>(
    functions,
    'crearLinea',
  );
  const res = await fn(input);
  return res.data;
}

export async function actualizarLinea(
  input: ActualizarLineaInput,
): Promise<ActualizarLineaResult> {
  const fn = httpsCallable<ActualizarLineaInput, ActualizarLineaResult>(
    functions,
    'actualizarLinea',
  );
  const res = await fn(input);
  return res.data;
}

// ============================================================================
//  LISTADO
// ============================================================================

/**
 * Lista las líneas de UN centro, ordenadas por código ASC.
 *
 * La query filtra por `tenantId` Y `centroId`. El filtro por `tenantId` NO es
 * opcional: la regla `read` de /lineas valida `sameTenant(resource.data.tenantId)`,
 * y en una operación `list` (getDocs con where) Firestore NO tiene los
 * documentos, así que NO puede leer `resource.data` — exige que la query
 * constriña `tenantId` para poder probar la regla. Sin ese filtro, la query se
 * rechaza con permission-denied ("Property tenantId is undefined ... for 'list'").
 * Verificado empíricamente con el SDK de cliente (B17): la regla además bloquea
 * cross-tenant (un jefe filtrando `tenantId` ajeno → permission-denied), así
 * que el filtro es a la vez requisito técnico y aislamiento real.
 *
 * `centroId` añade el scoping operativo del jefe (su único centro). La query
 * `where(tenantId) + where(centroId) + orderBy(codigo)` la sirve el índice
 * compuesto `(lineas: tenantId+centroId+codigo)` de firestore.indexes.json.
 *
 * A diferencia de `listarCentros` (super_admin only, lista toda la colección
 * porque `isSuperAdmin()` cortocircuita la regla), Líneas la lista el jefe, que
 * NO cortocircuita → el filtro por tenantId es imprescindible.
 *
 * Sin paginación (D4.8) ni onSnapshot: re-fetch manual al montar y tras mutación.
 */
export async function listarLineas(
  tenantId: string,
  centroId: string,
): Promise<Linea[]> {
  const q = query(
    collection(db, COLLECTIONS.LINEAS),
    where('tenantId', '==', tenantId),
    where('centroId', '==', centroId),
    orderBy('codigo'),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Linea);
}
