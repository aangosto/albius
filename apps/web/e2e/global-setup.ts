import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * globalSetup de Playwright (B20). Corre UNA vez antes de todos los proyectos
 * (incluido `setup`/login).
 *
 *   1. Verifica que los emuladores de Firebase están corriendo (hub 4400). Si
 *      no, lanza un error con instrucciones — los E2E NO levantan emuladores
 *      (decisión documentada en playwright.config.ts).
 *   2. Siembra datos deterministas ejecutando seed-tipos-turno-b19.mjs (jefe +
 *      tenant + centro + 4 tipos de turno). Idempotente: el seed borra y recrea,
 *      así cada run parte de un estado conocido.
 *
 * El path al seed se ancla al fichero (import.meta.url), no al cwd, para ser
 * robusto al directorio desde el que se invoque Playwright.
 */

const HUB_URL = 'http://127.0.0.1:4400/emulators';

async function globalSetup(): Promise<void> {
  // 1. Emuladores arriba
  try {
    const res = await fetch(HUB_URL);
    if (!res.ok) throw new Error(`hub respondió ${res.status}`);
  } catch (err) {
    throw new Error(
      '\n[E2E] Los emuladores de Firebase no están corriendo ' +
        '(hub 127.0.0.1:4400).\n' +
        '      Levántalos antes de los E2E:  npm run emulate\n' +
        `      Detalle: ${(err as Error).message}\n`,
    );
  }

  // 2. Seed determinista
  const here = path.dirname(fileURLToPath(import.meta.url));
  const seedScript = path.resolve(
    here,
    '../../functions/scripts/seed-tipos-turno-b19.mjs',
  );
  console.log('[E2E] Sembrando datos de prueba (tipos de turno B19)…');
  execFileSync('node', [seedScript], { stdio: 'inherit' });

  // Seed adicional B21: 3 líneas en centro-test + un centro vacío. Se ejecuta
  // DESPUÉS del seed B19 (que crea usuarios/tenant/centro/tipos) y NO toca
  // usuarios. Necesario para los pickers de líneas/tipos del alta de conductor.
  const seedB21 = path.resolve(
    here,
    '../../functions/scripts/seed-conductor-b21.mjs',
  );
  console.log('[E2E] Sembrando datos de prueba (conductor B21)…');
  execFileSync('node', [seedB21], { stdio: 'inherit' });

  // 3. Warm-up del Functions emulator: la PRIMERA invocación de un callable
  //    sufre cold-start (carga del runtime/módulo) y puede superar el timeout de
  //    un test. Disparamos POSTs a los endpoints callable (data vacía → fallan
  //    con unauthenticated/invalid-argument, pero el módulo queda cargado) para
  //    que las mutaciones de los tests respondan rápido sea cual sea su orden.
  console.log('[E2E] Calentando el Functions emulator…');
  const base = 'http://127.0.0.1:5001/albius-cbdb1/us-central1';
  await Promise.all(
    [
      'crearTipoTurno',
      'actualizarTipoTurno',
      'crearConductor',
      'actualizarConductor',
    ].map((fn) =>
      fetch(`${base}/${fn}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: {} }),
      }).catch(() => undefined),
    ),
  );
}

export default globalSetup;
