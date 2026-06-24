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
const SCRIPTS = path.resolve(here, '../../../functions/scripts');

export function resetTiposTurno(): void {
  execFileSync('node', [path.join(SCRIPTS, 'reset-tipos-turno-b19.mjs')], {
    stdio: 'pipe',
  });
}

/**
 * Borra los conductores creados por los tests (tenant-test) + su Auth user +
 * doc /usuarios. Se llama en beforeEach del spec de B21 para re-ejecutabilidad
 * (crearConductor crea un Auth user con email único — sin limpiarlo, un segundo
 * run chocaría con "email ya existe").
 */
export function resetConductoresB21(): void {
  execFileSync('node', [path.join(SCRIPTS, 'reset-conductor-b21.mjs')], {
    stdio: 'pipe',
  });
}

export interface ConductorOperativo {
  exists: boolean;
  lineasPreferentes: string[];
  lineasSecundarias: string[];
  tiposTurnoPermitidos: string[];
  tiposTurnoExcluidos: string[];
  maxHorasSemanales: number | null;
  observaciones: string | null;
  estado: string | null;
}

/**
 * Lee /conductores/{conductorId} del emulator y devuelve sus campos operativos.
 * Ejecuta read-conductor-b21.mjs y parsea su stdout JSON.
 */
export function readConductorB21(conductorId: string): ConductorOperativo {
  const out = execFileSync(
    'node',
    [path.join(SCRIPTS, 'read-conductor-b21.mjs'), conductorId],
    { encoding: 'utf8' },
  );
  return JSON.parse(out.trim()) as ConductorOperativo;
}
