import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { COLLECTIONS } from "@albius/shared";

/**
 * Verificación de existencia (o no-existencia) de referencias Firestore antes
 * de crear documentos. Centraliza las lecturas previas exigidas por D6 con
 * mensajes de error normalizados.
 *
 * Lee con Admin SDK (bypassa firestore.rules) — son lecturas legítimas del
 * backend. Inyección de dependencia: el cliente Firestore se pasa por
 * parámetro (`db`) para que el callable controle el ciclo de vida y para
 * facilitar testing con un fake.
 *
 * NO contiene:
 *   - Lógica de creación. Solo lecturas.
 *   - El cross-tenant check del INVOCADOR (claims.tenantId vs payload.tenantId):
 *     ese vive en el callable, porque depende del token, no de Firestore.
 *   - Construcción del id compuesto del conductor (`{tenantId}_{numeroEmpleado}`):
 *     el callable la hace in-line.
 */

/**
 * Verifica que el tenant existe. Lanza 'invalid-argument' si no.
 */
export async function assertTenantExists(
  db: Firestore,
  tenantId: string,
): Promise<void> {
  const snap = await db.collection(COLLECTIONS.TENANTS).doc(tenantId).get();
  if (!snap.exists) {
    throw new HttpsError(
      "invalid-argument",
      `El tenant '${tenantId}' no existe.`,
    );
  }
}

/**
 * Verifica que el centro existe Y que su campo `tenantId` coincide con el
 * indicado. Distingue dos errores con mensajes distintos: el segundo caso
 * indica un intento (consciente o no) de cruzar tenants y conviene que
 * quede claro en logs.
 */
export async function assertCentroExistsInTenant(
  db: Firestore,
  centroId: string,
  tenantId: string,
): Promise<void> {
  const snap = await db.collection(COLLECTIONS.CENTROS).doc(centroId).get();
  if (!snap.exists) {
    throw new HttpsError(
      "invalid-argument",
      `El centro '${centroId}' no existe.`,
    );
  }
  const data = snap.data();
  if (!data || data["tenantId"] !== tenantId) {
    throw new HttpsError(
      "invalid-argument",
      `El centro '${centroId}' no pertenece al tenant '${tenantId}'.`,
    );
  }
}

/**
 * Verifica que el id compuesto del conductor NO está ocupado todavía.
 * Lanza 'already-exists' si el documento ya existe.
 *
 * Recibe el id ya compuesto ({tenantId}_{numeroEmpleado}); este helper no
 * construye ids.
 */
export async function assertConductorIdDisponible(
  db: Firestore,
  conductorId: string,
): Promise<void> {
  const snap = await db
    .collection(COLLECTIONS.CONDUCTORES)
    .doc(conductorId)
    .get();
  if (snap.exists) {
    throw new HttpsError(
      "already-exists",
      `Ya existe un conductor con id '${conductorId}'.`,
    );
  }
}
