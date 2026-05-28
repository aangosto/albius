/**
 * Servicio de Tenants — única superficie de I/O Firebase para la UI de
 * Tenants (D4.9 canónica). Componentes y páginas NO importan directamente
 * `httpsCallable`, `getDocs`, `collection`, etc.; consumen este módulo.
 *
 * Tipos del wire — copia local hasta que cierre TODO[refactor-shared-build].
 * DEBEN coincidir con apps/functions/src/validation.ts
 * (CrearTenantPayload + ActualizarTenantPayload). Verificar manualmente al
 * modificar cualquiera de los dos lados.
 *
 * SI MODIFICAS LOS TIPOS DEL WIRE, REVISA TAMBIÉN:
 *   - apps/functions/src/validation.ts (CrearTenantPayload, ActualizarTenantPayload)
 *   - apps/functions/src/callables/crearTenant.ts (uso del payload)
 *   - apps/functions/src/callables/actualizarTenant.ts (uso del payload)
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
  type EstadoTenant,
  type PlanTenant,
  type Tenant,
} from '@albius/shared';
import { db, functions } from '@/lib/firebase';

// ============================================================================
//  TIPOS DEL WIRE
// ============================================================================

export interface CrearTenantInput {
  nombre: string;
  nombreComercial?: string;
  cif: string;
  comunidadAutonoma: string;
  provincia: string;
  plan?: PlanTenant;
  configuracion?: { zonaHoraria?: string; idioma?: string };
  forzarCIF?: boolean;
}

export interface CrearTenantResult {
  ok: true;
  tenantId: string;
  cifNormalizado: string;
  cifValidacionForzada: boolean;
}

export interface ActualizarTenantInput {
  tenantId: string;
  nombre?: string;
  nombreComercial?: string;
  comunidadAutonoma?: string;
  provincia?: string;
  plan?: PlanTenant;
  estado?: EstadoTenant;
  configuracion?: { zonaHoraria: string; idioma: string };
  logoUrl?: string;
}

export interface ActualizarTenantResult {
  ok: true;
  tenantId: string;
}

// ============================================================================
//  WRAPPERS DE CALLABLES
// ============================================================================

export async function crearTenant(
  input: CrearTenantInput,
): Promise<CrearTenantResult> {
  const fn = httpsCallable<CrearTenantInput, CrearTenantResult>(
    functions,
    'crearTenant',
  );
  const res = await fn(input);
  return res.data;
}

export async function actualizarTenant(
  input: ActualizarTenantInput,
): Promise<ActualizarTenantResult> {
  const fn = httpsCallable<ActualizarTenantInput, ActualizarTenantResult>(
    functions,
    'actualizarTenant',
  );
  const res = await fn(input);
  return res.data;
}

// ============================================================================
//  LISTADO
// ============================================================================

/**
 * Lista todos los tenants ordenados por nombre ASC (Firestore orderBy es
 * case-sensitive Unicode, aceptable MVP — refactor si surge necesidad).
 *
 * Sin paginación (D4.8): toda la colección viene en memoria. Para entidades
 * administrativas de baja frecuencia (cardinality < 1000, mutaciones < 10/día)
 * el coste es aceptable. Refactor a paginación servidor cuando se acerque
 * a 1000 tenants.
 *
 * Sin onSnapshot: el frontend invoca `listarTenants` al montar y tras cada
 * mutación exitosa (re-fetch manual). Evita reads continuos en background y
 * simplifica testing manual.
 *
 * Las reglas Firestore garantizan que un super_admin lee toda la colección,
 * mientras que otros roles solo verían su propio tenant (sameTenant). Para
 * TenantsPage protegida por D4.13 gate suave (super_admin only), esa rama
 * no se ejecuta en la práctica.
 */
export async function listarTenants(): Promise<Tenant[]> {
  const q = query(collection(db, COLLECTIONS.TENANTS), orderBy('nombre'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Tenant);
}
