import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type { Usuario } from "@albius/shared";
import { COLLECTIONS } from "./collections";

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

/**
 * Verifica que el tenant existe Y está en estado `'activo'`. Lanza:
 *   - `invalid-argument` si el tenant no existe (D5.2: ID inválido, posible
 *     bug del frontend o referencia corrupta).
 *   - `failed-precondition` si existe pero su estado no es `'activo'`
 *     (D5.2: ID legítimo pero estado del padre bloquea la operación).
 *
 * Patrón D5.1 (validación jerárquica): toda entidad hija comprueba que su
 * entidad padre existe y está operativa antes de crearse. Aplica a Centro
 * (padre = Tenant) y a futuras Línea/Conductor (padre = Centro), etc.
 *
 * Mensaje de `failed-precondition` indica explícitamente que no se crean
 * centros en tenants suspendidos o cancelados.
 */
export async function assertTenantActivo(
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
  const data = snap.data();
  const estado = data?.["estado"];
  if (estado !== "activo") {
    throw new HttpsError(
      "failed-precondition",
      `El tenant '${tenantId}' no está activo (estado=${typeof estado === "string" ? estado : "desconocido"}). ` +
        `No pueden crearse centros en tenants suspendidos o cancelados.`,
    );
  }
}

/**
 * Verifica que el centro existe Y está activo antes de crear una línea (u otra
 * entidad hija) bajo él. Paralelo a `assertTenantActivo` (D5.1) con la misma
 * semántica de códigos (D5.2): centro inexistente → 'invalid-argument' (ID
 * inválido); centro existente pero `estado !== 'activo'` → 'failed-precondition'
 * (el estado del padre bloquea la creación de la entidad hija).
 *
 * Mensaje de `failed-precondition` indica explícitamente que no se crean
 * líneas en centros inactivos.
 */
export async function assertCentroActivo(
  db: Firestore,
  centroId: string,
): Promise<void> {
  const snap = await db.collection(COLLECTIONS.CENTROS).doc(centroId).get();
  if (!snap.exists) {
    throw new HttpsError(
      "invalid-argument",
      `El centro '${centroId}' no existe.`,
    );
  }
  const data = snap.data();
  const estado = data?.["estado"];
  if (estado !== "activo") {
    throw new HttpsError(
      "failed-precondition",
      `El centro '${centroId}' no está activo (estado=${typeof estado === "string" ? estado : "desconocido"}). ` +
        `No pueden crearse líneas en centros inactivos.`,
    );
  }
}

/**
 * Estados de Conductor que IMPIDEN inactivar el centro al que están
 * asignados (D4.6 aplicado a la cascada Centro → Conductores). Lista
 * positiva: el conductor en `baja_definitiva` es estado terminal y NO
 * bloquea (queda fuera del sistema operativo).
 *
 * Si en el futuro se añade un nuevo estado al union `EstadoConductor`
 * (`packages/shared/src/types.ts`), revisar conscientemente si debe entrar
 * en esta lista. La lista positiva es self-documenting: cada estado
 * presente bloquea explícitamente.
 *
 * `as const` para que TS infiera el tipo literal y el operador `in` de la
 * query Firestore reciba un array tipado correctamente.
 */
export const ESTADOS_CONDUCTOR_BLOQUEANTES = [
  "activo",
  "baja_temporal",
  "vacaciones",
] as const;

/**
 * Verifica que el centro indicado NO tiene conductores asignados en estados
 * bloqueantes (`ESTADOS_CONDUCTOR_BLOQUEANTES`). Lanza `failed-precondition`
 * con conteo en el mensaje si los hay.
 *
 * Query: `where(centroId == X) AND where(estado in BLOQUEANTES)`. Requiere
 * índice compuesto `(centroId, estado)` en `firestore.indexes.json` (B11).
 *
 * NO se usa `.limit(1)`: queremos `snap.size` en el mensaje para informar al
 * operador de cuántos conductores debe reasignar/dar de baja primero. El
 * coste extra (leer hasta N docs al fallar) es aceptable: N ≤ ~300 (target
 * de conductores por centro).
 *
 * D4.6 aplicado a la cascada Centro → Conductores (paralelo a la cascada
 * Tenant → Centros que vive en `actualizarTenant`).
 */
export async function assertNoConductoresActivosEnCentro(
  db: Firestore,
  centroId: string,
): Promise<void> {
  const snap = await db
    .collection(COLLECTIONS.CONDUCTORES)
    .where("centroId", "==", centroId)
    .where("estado", "in", ESTADOS_CONDUCTOR_BLOQUEANTES)
    .get();
  if (!snap.empty) {
    throw new HttpsError(
      "failed-precondition",
      `No puede inactivarse un centro con conductores asignados (activos, en baja temporal o vacaciones). ` +
        `Reasigna o da de baja definitiva a los ${snap.size} conductores primero.`,
    );
  }
}

/**
 * Verifica que el CIF no está usado por ningún tenant existente. Invariante
 * de negocio: no puede haber dos tenants con el mismo CIF (normalizado).
 *
 * Query single-field (`where('cif','==',X)`); Firestore indexa
 * automáticamente este caso, no requiere índice compuesto.
 *
 * `excludeTenantId` (opcional): el callable `actualizarTenant` no lo usa
 * hoy (el `cif` es inmutable post-create según D4.4), pero el parámetro
 * queda preparado por simetría con el patrón del modelo y por si surge
 * `TODO[edit-cif-procedimiento]` en el futuro: permitiría reescribir el
 * CIF de un tenant excluyendo el propio doc del check de unicidad.
 */
export async function assertCIFUnico(
  db: Firestore,
  cifNormalizado: string,
  excludeTenantId?: string,
): Promise<void> {
  const snap = await db
    .collection(COLLECTIONS.TENANTS)
    .where("cif", "==", cifNormalizado)
    .get();
  for (const tenantDoc of snap.docs) {
    if (excludeTenantId === undefined || tenantDoc.id !== excludeTenantId) {
      throw new HttpsError(
        "already-exists",
        `Ya existe un tenant con CIF '${cifNormalizado}'.`,
      );
    }
  }
}

/**
 * Verifica que el `codigo` de línea es único DENTRO DEL CENTRO (D6.3): dos
 * centros distintos pueden tener cada uno una línea '42A', pero el mismo centro
 * no puede tenerla dos veces. Paralelo a `assertCIFUnico`.
 *
 * Query con dos filtros de igualdad `where(centroId == X) AND where(codigo == Y)`.
 * Se respalda con índice compuesto `(centroId, codigo)` en
 * `firestore.indexes.json` (se añade en el PASO 3 del Bloque 16, junto al
 * callable `crearLinea`).
 *
 * NO se usa `.limit(1)`: el set es pequeño (a lo sumo 1 colisión) y el patrón
 * hermano `assertCIFUnico` tampoco lo usa.
 *
 * `excludeLineaId` (opcional): lo usa `actualizarLinea` para que la línea no
 * choque consigo misma al revalidar unicidad si edita su propio `codigo`
 * (simétrico al `excludeTenantId` de `assertCIFUnico`).
 */
export async function assertCodigoLineaUnico(
  db: Firestore,
  centroId: string,
  codigo: string,
  excludeLineaId?: string,
): Promise<void> {
  const snap = await db
    .collection(COLLECTIONS.LINEAS)
    .where("centroId", "==", centroId)
    .where("codigo", "==", codigo)
    .get();
  for (const lineaDoc of snap.docs) {
    if (excludeLineaId === undefined || lineaDoc.id !== excludeLineaId) {
      throw new HttpsError(
        "already-exists",
        `Ya existe una línea con código '${codigo}' en este centro.`,
      );
    }
  }
}

/**
 * Verifica que el usuario existe en /usuarios. Lanza 'invalid-argument' si no
 * (semántica D5.2: ID inexistente es error de entrada, no estado bloqueante).
 *
 * DIVERGENCIA CONSCIENTE respecto a los assert*Exists hermanos
 * (`assertTenantExists`, `assertCentroExistsInTenant`), que devuelven `void`:
 * este helper DEVUELVE los datos del documento (`Usuario`). Razón (B13): el
 * callable `actualizarUsuario` necesita `doc.estado` para decidir la
 * transición de estado (no-op Opción A) y, de devolver `void`, tendría que
 * releer el documento. Devolver los datos evita esa doble lectura.
 *
 * Cast permisivo a `Usuario`: confiamos en que el doc fue creado por
 * `crearJefeTrafico`/`crearConductor`/bootstrap (que escriben los campos
 * required). Mismo criterio que el cast de `actualizarTenant`/`actualizarCentro`.
 */
export async function assertUsuarioExists(
  db: Firestore,
  usuarioId: string,
): Promise<Usuario> {
  const snap = await db.collection(COLLECTIONS.USUARIOS).doc(usuarioId).get();
  if (!snap.exists) {
    throw new HttpsError(
      "invalid-argument",
      `El usuario '${usuarioId}' no existe.`,
    );
  }
  return snap.data() as Usuario;
}
