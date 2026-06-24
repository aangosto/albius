/**
 * Servicio de Usuarios — única superficie de I/O Firebase para la UI de
 * Usuarios (D4.9 canónica). Componentes y páginas NO importan directamente
 * `httpsCallable`, `getDocs`, `collection`, etc.; consumen este módulo.
 *
 * Tipos del wire — copia local hasta que cierre TODO[refactor-shared-build].
 * DEBEN coincidir con apps/functions/src/validation.ts
 * (CrearJefeTraficoPayload + CrearConductorPayload + ActualizarUsuarioPayload).
 * Verificar manualmente al modificar cualquiera de los dos lados.
 *
 * SI MODIFICAS LOS TIPOS DEL WIRE, REVISA TAMBIÉN:
 *   - apps/functions/src/validation.ts (CrearJefeTraficoPayload,
 *     CrearConductorPayload, ActualizarUsuarioPayload)
 *   - apps/functions/src/callables/crearJefeTrafico.ts (uso del payload)
 *   - apps/functions/src/callables/crearConductor.ts (uso del payload)
 *   - apps/functions/src/callables/actualizarUsuario.ts (uso del payload)
 *
 * Cuando cierre TODO[refactor-shared-build], los tipos viven en
 * @albius/shared y se importan desde ambos lados.
 *
 * Sin manejo de errores aquí (D4.10): el caller decide qué loggear y los
 * Dialogs traducen al usuario con `mapCallableError`.
 * Sin paginación ni onSnapshot (D4.8): listado client-side con re-fetch
 * tras mutación.
 *
 * D5.6: crearJefeTrafico y crearConductor devuelven `linkPasswordReset`, un
 * secreto de un solo uso (link de configuración de contraseña, hoy
 * distribuido manualmente por el super_admin — ver TODO[email-transport]).
 * El Dialog que consume estos wrappers NO cierra al éxito: muestra el link
 * en una pantalla intermedia (ver CrearUsuarioDialog).
 */

import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  COLLECTIONS,
  type EstadoUsuario,
  type Usuario,
} from '@albius/shared';
import { db, functions } from '@/lib/firebase';

// ============================================================================
//  TIPOS DEL WIRE
// ============================================================================

export interface CrearJefeTraficoInput {
  email: string;
  nombreCompleto: string;
  telefono?: string;
  tenantId: string;
  centroId: string;
}

export interface CrearJefeTraficoResult {
  ok: true;
  usuarioId: string;
  linkPasswordReset: string;
}

/**
 * `conductorId` deliberadamente AUSENTE del input: lo compone el backend como
 * `${tenantId}_${numeroEmpleado}` (D3.1). El frontend solo envía
 * `numeroEmpleado`.
 *
 * Campos operativos (B21, cierran TODO[conductor-campos-operativos-en-alta]):
 * `lineasPreferentes`/`lineasSecundarias` (IDs de líneas del centro),
 * `tiposTurnoPermitidos`/`tiposTurnoExcluidos` (IDs de tipos de turno del
 * centro), `maxHorasSemanales`, `observaciones`. Opcionales: el backend
 * defaultea los arrays a `[]` si se omiten. Los pueblan los pickers de
 * ConductorCamposOperativos con listarLineas/listarTiposTurno del centro.
 */
export interface CrearConductorInput {
  numeroEmpleado: string;
  nombre: string;
  apellidos: string;
  dni: string;
  email: string;
  telefono?: string;
  tenantId: string;
  centroId: string;
  categoria: 'conductor'; // enum de un solo valor (Q9). Fijado por ConductorForm en submit.
  fechaAntiguedad: string; // ISO YYYY-MM-DD (input type="date"). assertISODate lo acepta.
  fechaIncorporacion: string; // ISO YYYY-MM-DD.
  puedeSerReserva: boolean;
  lineasPreferentes?: string[];
  lineasSecundarias?: string[];
  tiposTurnoPermitidos?: string[];
  tiposTurnoExcluidos?: string[];
  maxHorasSemanales?: number;
  observaciones?: string;
}

export interface CrearConductorResult {
  ok: true;
  usuarioId: string;
  conductorId: string;
  linkPasswordReset: string;
}

export interface ActualizarUsuarioInput {
  usuarioId: string;
  nombreCompleto?: string;
  telefono?: string;
  email?: string;
  estado?: EstadoUsuario; // 'activo' | 'suspendido'
}

export interface ActualizarUsuarioResult {
  ok: true;
  usuarioId: string;
}

// ============================================================================
//  WRAPPERS DE CALLABLES
// ============================================================================

export async function crearJefeTrafico(
  input: CrearJefeTraficoInput,
): Promise<CrearJefeTraficoResult> {
  const fn = httpsCallable<CrearJefeTraficoInput, CrearJefeTraficoResult>(
    functions,
    'crearJefeTrafico',
  );
  const res = await fn(input);
  return res.data;
}

export async function crearConductor(
  input: CrearConductorInput,
): Promise<CrearConductorResult> {
  const fn = httpsCallable<CrearConductorInput, CrearConductorResult>(
    functions,
    'crearConductor',
  );
  const res = await fn(input);
  return res.data;
}

export async function actualizarUsuario(
  input: ActualizarUsuarioInput,
): Promise<ActualizarUsuarioResult> {
  const fn = httpsCallable<ActualizarUsuarioInput, ActualizarUsuarioResult>(
    functions,
    'actualizarUsuario',
  );
  const res = await fn(input);
  return res.data;
}

// ============================================================================
//  LISTADO
// ============================================================================

/**
 * Lista todos los usuarios ordenados por nombreCompleto ASC (Firestore
 * orderBy es case-sensitive Unicode, aceptable MVP — refactor si surge
 * necesidad).
 *
 * Sin paginación (D4.8): toda la colección viene en memoria. Para entidades
 * administrativas de baja frecuencia el coste es aceptable. Refactor a
 * paginación servidor cuando se acerque a 1000 usuarios.
 *
 * Sin onSnapshot: el frontend invoca `listarUsuarios` al montar y tras cada
 * mutación exitosa (re-fetch manual). Evita reads continuos en background y
 * simplifica testing manual.
 *
 * La regla read sobre /usuarios garantiza que un super_admin lee TODA la
 * colección. Las ramas owner (ownerOfDoc) y jefe_trafico (sameTenant) de la
 * regla existen para otros roles, pero NO se ejecutan en UsuariosPage: está
 * protegida por el gate suave D4.13 (super_admin only).
 */
export async function listarUsuarios(): Promise<Usuario[]> {
  const q = query(
    collection(db, COLLECTIONS.USUARIOS),
    orderBy('nombreCompleto'),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Usuario);
}
