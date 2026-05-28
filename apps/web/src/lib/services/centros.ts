/**
 * Servicio de Centros — única superficie de I/O Firebase para la UI de
 * Centros (D4.9 canónica). Componentes y páginas NO importan directamente
 * `httpsCallable`, `getDocs`, `collection`, etc.; consumen este módulo.
 *
 * Tipos del wire — copia local hasta que cierre TODO[refactor-shared-build].
 * DEBEN coincidir con apps/functions/src/validation.ts
 * (CrearCentroPayload + ActualizarCentroPayload + CoordenadasPayload).
 * Verificar manualmente al modificar cualquiera de los dos lados.
 *
 * SI MODIFICAS LOS TIPOS DEL WIRE, REVISA TAMBIÉN:
 *   - apps/functions/src/validation.ts (CrearCentroPayload, ActualizarCentroPayload)
 *   - apps/functions/src/callables/crearCentro.ts (uso del payload)
 *   - apps/functions/src/callables/actualizarCentro.ts (uso del payload)
 *
 * Cuando cierre TODO[refactor-shared-build], los tipos viven en
 * @albius/shared y se importan desde ambos lados.
 *
 * Sin manejo de errores aquí (D4.10): el caller decide qué loggear y los
 * Dialogs traducen al usuario con `mapCallableError`.
 * Sin paginación ni onSnapshot (D4.8): listado client-side con re-fetch
 * tras mutación.
 */

import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  COLLECTIONS,
  type Centro,
  type EstadoCentro,
} from '@albius/shared';
import { db, functions } from '@/lib/firebase';

// ============================================================================
//  TIPOS DEL WIRE
// ============================================================================

/**
 * Coordenadas geográficas planas (lat/lon en grados decimales). Forma "wire"
 * del GeoPoint de Firestore: el frontend manda este objeto plano al callable
 * y el backend lo convierte a `new GeoPoint(lat, lon)` en la escritura.
 * El validator backend (assertOptionalCoordenadas) exige rangos lat[-90,90]
 * y lon[-180,180] con `Number.isFinite`.
 *
 * Al LEER un Centro desde Firestore (listarCentros), el campo
 * `centro.coordenadas` llega como instancia de GeoPoint del SDK Web Firebase
 * (no plain object). Sus propiedades `latitude` y `longitude` son accesibles
 * idénticamente. Para reenvío al callable, reempaquetar a plain object.
 */
export interface CoordenadasWire {
  latitude: number;
  longitude: number;
}

export interface CrearCentroInput {
  tenantId: string;
  nombre: string;
  ciudad: string;
  provincia: string;
  direccion?: string;
  coordenadas?: CoordenadasWire;
}

export interface CrearCentroResult {
  ok: true;
  centroId: string;
}

/**
 * `tenantId` deliberadamente AUSENTE del payload de actualización: es
 * inmutable (defensa en profundidad: reglas Firestore lo bloquean en
 * /centros + validator del callable lo rechaza con mensaje específico).
 * Si la UI necesitara editar el tenant de un centro, sería operación
 * distinta (no contemplada en MVP — un centro pertenece permanentemente
 * a su tenant original).
 */
export interface ActualizarCentroInput {
  centroId: string;
  nombre?: string;
  direccion?: string;
  ciudad?: string;
  provincia?: string;
  coordenadas?: CoordenadasWire;
  estado?: EstadoCentro;
}

export interface ActualizarCentroResult {
  ok: true;
  centroId: string;
}

// ============================================================================
//  WRAPPERS DE CALLABLES
// ============================================================================

export async function crearCentro(
  input: CrearCentroInput,
): Promise<CrearCentroResult> {
  const fn = httpsCallable<CrearCentroInput, CrearCentroResult>(
    functions,
    'crearCentro',
  );
  const res = await fn(input);
  return res.data;
}

export async function actualizarCentro(
  input: ActualizarCentroInput,
): Promise<ActualizarCentroResult> {
  const fn = httpsCallable<ActualizarCentroInput, ActualizarCentroResult>(
    functions,
    'actualizarCentro',
  );
  const res = await fn(input);
  return res.data;
}

// ============================================================================
//  LISTADO
// ============================================================================

/**
 * Lista todos los centros ordenados por nombre ASC (Firestore orderBy es
 * case-sensitive Unicode, aceptable MVP — refactor si surge necesidad).
 *
 * Sin paginación (D4.8): toda la colección viene en memoria. Para entidades
 * administrativas de baja frecuencia el coste es aceptable. Refactor a
 * paginación servidor cuando se acerque a 1000 centros (ese umbral es
 * MUY lejano dado el target: 50-300 conductores por centro implica decenas
 * de centros como mucho).
 *
 * Sin onSnapshot: el frontend invoca `listarCentros` al montar y tras cada
 * mutación exitosa (re-fetch manual). Evita reads continuos en background y
 * simplifica testing manual.
 *
 * Las reglas Firestore garantizan que un super_admin lee toda la colección,
 * mientras que otros roles solo verían centros de su mismo tenant
 * (sameTenant). Para CentrosPage protegida por gate suave D4.13
 * (super_admin only), esa rama no se ejecuta en la práctica.
 *
 * GeoPoint: el campo `coordenadas` (opcional en el modelo Centro) llega
 * como instancia de GeoPoint del SDK Web Firebase. Sus propiedades
 * `latitude`/`longitude` son accesibles igual; la tabla las muestra con
 * tooltip y el form precarga los inputs string desde ellas.
 */
export async function listarCentros(): Promise<Centro[]> {
  const q = query(collection(db, COLLECTIONS.CENTROS), orderBy('nombre'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Centro);
}
