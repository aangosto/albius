import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Helper de reset de datos para los E2E (B20 Fase 2). Ejecuta el script
 * reset-tipos-turno-b19.mjs, que borra y recrea SOLO los 4 tipos de turno del
 * centro-test (sin tocar usuarios → preserva el storageState del jefe).
 *
 * Se llama en un `beforeEach` para que cada test parta de un estado conocido y
 * la suite sea re-ejecutable sin estado residual de altas/ediciones previas.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const RESET_SCRIPT = path.resolve(
  here,
  '../../../functions/scripts/reset-tipos-turno-b19.mjs',
);

export function resetTiposTurno(): void {
  execFileSync('node', [RESET_SCRIPT], { stdio: 'pipe' });
}
