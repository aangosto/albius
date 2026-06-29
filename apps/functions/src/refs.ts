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
 * Verifica que el centro existe Y está activo antes de crear una entidad hija
 * (línea, tipo de turno, …) bajo él. Paralelo a `assertTenantActivo` (D5.1) con
 * la misma semántica de códigos (D5.2): centro inexistente → 'invalid-argument'
 * (ID inválido); centro existente pero `estado !== 'activo'` →
 * 'failed-precondition' (el estado del padre bloquea la creación de la hija).
 *
 * Mensaje genérico (lo comparten ≥2 callers: crearLinea B16, crearTipoTurno B18).
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
        `No pueden crearse entidades operativas en centros inactivos.`,
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
 * Verifica que el `codigo` de tipo de turno es único DENTRO DEL CENTRO (D6.3),
 * clon de `assertCodigoLineaUnico` (B16). Query con dos filtros de igualdad
 * `where(centroId == X) AND where(codigo == Y)`. `excludeId` lo usa
 * `actualizarTipoTurno` para no chocar consigo mismo al revalidar tras cambiar
 * el código. Respaldado por el índice `(tipos_turno: tenantId+centroId+codigo)`.
 */
export async function assertCodigoTipoTurnoUnico(
  db: Firestore,
  centroId: string,
  codigo: string,
  excludeId?: string,
): Promise<void> {
  const snap = await db
    .collection(COLLECTIONS.TIPOS_TURNO)
    .where("centroId", "==", centroId)
    .where("codigo", "==", codigo)
    .get();
  for (const ttDoc of snap.docs) {
    if (excludeId === undefined || ttDoc.id !== excludeId) {
      throw new HttpsError(
        "already-exists",
        `Ya existe un tipo de turno con código '${codigo}' en este centro.`,
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

/**
 * Verifica que la línea existe y está ACTIVA antes de colgar una hija de ella
 * (B23: Frecuencia / FrecuenciaExcepcional cuelgan de una Línea, su padre
 * directo). Paralelo a `assertCentroActivo` (D5.1) con la misma semántica de
 * códigos (D5.2): línea inexistente → 'invalid-argument' (ID inválido); línea
 * existente pero `estado !== 'activa'` (Línea usa enum-3 'activa'/'inactiva'/
 * 'suspendida', D6.2) → 'failed-precondition' (el estado del padre bloquea).
 *
 * Devuelve los datos mínimos de la línea (tenantId/centroId) para que el
 * callable verifique coherencia sin una segunda lectura.
 */
export async function assertLineaActiva(
  db: Firestore,
  lineaId: string,
): Promise<{ tenantId: string; centroId: string }> {
  const snap = await db.collection(COLLECTIONS.LINEAS).doc(lineaId).get();
  if (!snap.exists) {
    throw new HttpsError(
      "invalid-argument",
      `La línea '${lineaId}' no existe.`,
    );
  }
  const data = snap.data();
  const estado = data?.["estado"];
  if (estado !== "activa") {
    throw new HttpsError(
      "failed-precondition",
      `La línea '${lineaId}' no está activa (estado=${typeof estado === "string" ? estado : "desconocido"}). ` +
        `No pueden crearse frecuencias en líneas inactivas o suspendidas.`,
    );
  }
  return {
    tenantId: typeof data?.["tenantId"] === "string" ? data["tenantId"] : "",
    centroId: typeof data?.["centroId"] === "string" ? data["centroId"] : "",
  };
}

/**
 * Verifica que la línea existe Y pertenece al MISMO centro indicado, SIN exigir
 * que esté activa (B30: lineaId opcional en TipoTurno). Más laxa que
 * `assertLineaActiva` a propósito:
 *
 *   - En `TipoTurno`, `lineaId` es una referencia de AGRUPACIÓN/ETIQUETADO para
 *     el cuadrante (colorear/agrupar por línea), no una dependencia operativa
 *     como en `Frecuencia` (donde una frecuencia sobre una línea muerta no tiene
 *     sentido y por eso allí se usa `assertLineaActiva`). Un tipo de turno
 *     asociado a una línea estacional SUSPENDIDA sigue siendo significativo.
 *   - Simetría crear/editar: la misma regla en ambos lados evita la trampa
 *     "puedo crearlo pero no re-guardarlo porque la línea quedó suspendida".
 *
 * Lo que SÍ se garantiza: la línea existe y es del centro del tipo de turno
 * (anti-cross-centro). Códigos (D5.2): inexistente → 'invalid-argument';
 * de otro centro → 'invalid-argument' (id legítimo pero no encaja en este centro).
 */
export async function assertLineaDelCentro(
  db: Firestore,
  lineaId: string,
  centroId: string,
): Promise<void> {
  const snap = await db.collection(COLLECTIONS.LINEAS).doc(lineaId).get();
  if (!snap.exists) {
    throw new HttpsError(
      "invalid-argument",
      `La línea '${lineaId}' no existe.`,
    );
  }
  const data = snap.data();
  if (data?.["centroId"] !== centroId) {
    throw new HttpsError(
      "invalid-argument",
      `La línea '${lineaId}' no pertenece a este centro. ` +
        `Un tipo de turno solo puede referenciar líneas de su propio centro.`,
    );
  }
}

/**
 * Convierte "HH:mm" a minutos desde medianoche. Local a refs.ts (validation.ts
 * tiene su propio `toMinutos`); duplicación mínima aceptable para no acoplar
 * módulos.
 */
function hhmmAMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * ¿Colisionan dos sentidos? Una frecuencia 'ambos' cubre ida Y vuelta, así que
 * choca con cualquier otra del mismo tramo; 'ida' solo choca con 'ida'/'ambos';
 * 'vuelta' solo con 'vuelta'/'ambos'.
 */
function sentidosColisionan(a: string, b: string): boolean {
  return a === "ambos" || b === "ambos" || a === b;
}

/**
 * Verifica que NO existe otra frecuencia ACTIVA de la misma `lineaId` + `tipoDia`
 * cuyo tramo `[horaInicio, horaFin]` solape con el nuevo Y cuyo `sentido` colisione
 * (B23 — primera validación de no-solapamiento temporal del proyecto).
 *
 * Lógica de solape de tramos (medio-abierto: tocar en el extremo NO solapa, dos
 * tramos adyacentes 06:00–10:00 y 10:00–14:00 conviven): dos intervalos
 * [aIni,aFin) y [bIni,bFin) solapan sii `aIni < bFin && bIni < aFin`. Comparación
 * en minutos desde medianoche (las frecuencias no cruzan medianoche, B23).
 *
 * Solo se consideran frecuencias `activa===true` (una frecuencia inactiva no
 * ocupa el tramo). `excludeId` evita que `actualizarFrecuencia` choque consigo
 * misma. Si solapa → 'failed-precondition' con el tramo conflictivo.
 *
 * Query por `lineaId` solo (índice single-field auto) + filtro en memoria del
 * resto: el nº de frecuencias por línea es pequeño.
 */
export async function assertNoSolapeFrecuencia(
  db: Firestore,
  params: {
    lineaId: string;
    tipoDia: string;
    sentido: string;
    horaInicio: string;
    horaFin: string;
    excludeId?: string;
  },
): Promise<void> {
  const aIni = hhmmAMinutos(params.horaInicio);
  const aFin = hhmmAMinutos(params.horaFin);
  const snap = await db
    .collection(COLLECTIONS.FRECUENCIAS)
    .where("lineaId", "==", params.lineaId)
    .get();
  for (const doc of snap.docs) {
    if (params.excludeId !== undefined && doc.id === params.excludeId) continue;
    const d = doc.data();
    if (d["activa"] !== true) continue;
    if (d["tipoDia"] !== params.tipoDia) continue;
    if (!sentidosColisionan(params.sentido, String(d["sentido"]))) continue;
    const bIni = hhmmAMinutos(String(d["horaInicio"]));
    const bFin = hhmmAMinutos(String(d["horaFin"]));
    if (aIni < bFin && bIni < aFin) {
      throw new HttpsError(
        "failed-precondition",
        `El tramo ${params.horaInicio}–${params.horaFin} (${params.sentido}, ${params.tipoDia}) ` +
          `solapa con una frecuencia existente ${d["horaInicio"]}–${d["horaFin"]} (${d["sentido"]}) de la misma línea.`,
      );
    }
  }
}

/** "YYYY-MM-DD" de un Date o Timestamp (con `.toDate()`), para comparar día. */
function diaISO(value: Date | { toDate: () => Date }): string {
  const d = value instanceof Date ? value : value.toDate();
  return d.toISOString().slice(0, 10);
}

/**
 * Análogo de `assertNoSolapeFrecuencia` para frecuencias_excepcionales, acotado
 * a la MISMA `fecha` (en vez de `tipoDia`): dos excepcionales activas de la
 * misma línea + mismo día cuyos tramos solapen y cuyos sentidos colisionen →
 * 'failed-precondition'. Misma lógica de solape medio-abierto y de colisión de
 * sentido. (B23, tu-criterio: damos a las excepcionales la misma garantía de
 * no-solape que a las regulares.)
 */
export async function assertNoSolapeFrecuenciaExcepcional(
  db: Firestore,
  params: {
    lineaId: string;
    fecha: Date;
    sentido: string;
    horaInicio: string;
    horaFin: string;
    excludeId?: string;
  },
): Promise<void> {
  const aIni = hhmmAMinutos(params.horaInicio);
  const aFin = hhmmAMinutos(params.horaFin);
  const diaNuevo = diaISO(params.fecha);
  const snap = await db
    .collection(COLLECTIONS.FRECUENCIAS_EXCEPCIONALES)
    .where("lineaId", "==", params.lineaId)
    .get();
  for (const doc of snap.docs) {
    if (params.excludeId !== undefined && doc.id === params.excludeId) continue;
    const d = doc.data();
    if (d["activa"] !== true) continue;
    const fechaDoc = d["fecha"];
    if (
      !fechaDoc ||
      typeof fechaDoc.toDate !== "function" ||
      diaISO(fechaDoc) !== diaNuevo
    ) {
      continue;
    }
    if (!sentidosColisionan(params.sentido, String(d["sentido"]))) continue;
    const bIni = hhmmAMinutos(String(d["horaInicio"]));
    const bFin = hhmmAMinutos(String(d["horaFin"]));
    if (aIni < bFin && bIni < aFin) {
      throw new HttpsError(
        "failed-precondition",
        `El tramo excepcional ${params.horaInicio}–${params.horaFin} (${params.sentido}, ${diaNuevo}) ` +
          `solapa con otra frecuencia excepcional ${d["horaInicio"]}–${d["horaFin"]} (${d["sentido"]}) de la misma línea y fecha.`,
      );
    }
  }
}

/**
 * Verifica que el cuadrante existe Y está en estado EDITABLE (`'borrador'`)
 * antes de crear/editar/eliminar asignaciones bajo él (B26). Las asignaciones
 * de un cuadrante `'publicado'`/`'cerrado'` NO se tocan por esta vía: una vez
 * publicado, los cambios pasan por el mercado de intercambios (bloque futuro) o
 * por una re-apertura explícita; un cuadrante cerrado es inmutable.
 *
 * Semántica de códigos (D5.2, paralelo a assertCentroActivo/assertLineaActiva):
 *   - cuadrante inexistente → 'invalid-argument' (ID inválido).
 *   - existe pero `estado !== 'borrador'` → 'failed-precondition' (el estado del
 *     padre bloquea la edición de asignaciones).
 *
 * Devuelve los datos del cuadrante que el callable necesita sin una segunda
 * lectura: `tenantId`/`centroId` (auth anti-cross + coherencia de la asignación)
 * y `año`/`mes` (validar que la `fecha` de la asignación cae dentro del mes).
 */
export async function assertCuadranteEditable(
  db: Firestore,
  cuadranteId: string,
): Promise<{
  tenantId: string;
  centroId: string;
  año: number;
  mes: number;
}> {
  const snap = await db
    .collection(COLLECTIONS.CUADRANTES)
    .doc(cuadranteId)
    .get();
  if (!snap.exists) {
    throw new HttpsError(
      "invalid-argument",
      `El cuadrante '${cuadranteId}' no existe.`,
    );
  }
  const data = snap.data() ?? {};
  const estado = data["estado"];
  if (estado !== "borrador") {
    throw new HttpsError(
      "failed-precondition",
      `El cuadrante '${cuadranteId}' no es editable (estado=${typeof estado === "string" ? estado : "desconocido"}). ` +
        `Solo se editan asignaciones de un cuadrante en borrador; los cambios sobre un cuadrante publicado pasan por intercambios.`,
    );
  }
  return {
    tenantId: typeof data["tenantId"] === "string" ? data["tenantId"] : "",
    centroId: typeof data["centroId"] === "string" ? data["centroId"] : "",
    año: typeof data["año"] === "number" ? data["año"] : 0,
    mes: typeof data["mes"] === "number" ? data["mes"] : 0,
  };
}
