import { describe, it, expect } from 'vitest';
import { resolverTipoDia } from './resolverTipoDia';
import type { Festivo, Timestamp } from '../types';

/**
 * Tests del calendario (B27). Esta función alimenta la demanda del optimizador,
 * así que se cubren los límites con cuidado (coincidencia exacta de día, días
 * adyacentes, festivo que sobreescribe el día de semana).
 */

// Festivo mínimo para test: solo importan `fecha` y `tipoTraficoAplicable`.
// La fecha se construye a medianoche UTC (`Z`) para casar con la comparación UTC.
function festivo(
  fechaISO: string,
  tipoTraficoAplicable: Festivo['tipoTraficoAplicable'],
): Festivo {
  const date = new Date(`${fechaISO}T00:00:00.000Z`);
  const ts = { toDate: () => date } as unknown as Timestamp;
  return {
    id: `fest_${fechaISO}`,
    tenantId: 't1',
    fecha: ts,
    nombre: 'Festivo de prueba',
    ambito: 'local',
    tipoTraficoAplicable,
    esEditable: true,
  };
}

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('resolverTipoDia', () => {
  it('martes normal sin festivos → laborable', () => {
    // 2026-06-23 es martes.
    expect(resolverTipoDia(d('2026-06-23'), [])).toBe('laborable');
  });

  it('sábado sin festivos → sabado', () => {
    // 2026-06-20 es sábado.
    expect(resolverTipoDia(d('2026-06-20'), [])).toBe('sabado');
  });

  it('domingo sin festivos → domingo', () => {
    // 2026-06-21 es domingo.
    expect(resolverTipoDia(d('2026-06-21'), [])).toBe('domingo');
  });

  it('festivo que cae en martes (laborable) → festivo (sobreescribe)', () => {
    const fests = [festivo('2026-06-23', 'festivo')];
    expect(resolverTipoDia(d('2026-06-23'), fests)).toBe('festivo');
  });

  it('festivo con tipoTraficoAplicable=domingo en jueves → domingo', () => {
    // 2026-06-25 es jueves; un festivo "tráfico de domingo" lo degrada a domingo.
    const fests = [festivo('2026-06-25', 'domingo')];
    expect(resolverTipoDia(d('2026-06-25'), fests)).toBe('domingo');
  });

  it('festivo con tipoTraficoAplicable=laborable en domingo → laborable', () => {
    // 2026-06-21 es domingo; un festivo "tráfico laborable" lo eleva a laborable.
    const fests = [festivo('2026-06-21', 'laborable')];
    expect(resolverTipoDia(d('2026-06-21'), fests)).toBe('laborable');
  });

  it('festivo en fin de semana sin afectar al día consultado → respeta día de semana', () => {
    // Festivo el sábado 2026-06-20; consultamos el domingo 2026-06-21.
    const fests = [festivo('2026-06-20', 'festivo')];
    expect(resolverTipoDia(d('2026-06-21'), fests)).toBe('domingo');
  });

  it('no confunde días adyacentes: festivo el 24, consulta el 23 y el 25', () => {
    const fests = [festivo('2026-06-24', 'festivo')];
    expect(resolverTipoDia(d('2026-06-23'), fests)).toBe('laborable');
    expect(resolverTipoDia(d('2026-06-24'), fests)).toBe('festivo');
    expect(resolverTipoDia(d('2026-06-25'), fests)).toBe('laborable');
  });

  it('coincidencia exacta de día ignorando la hora del Timestamp', () => {
    // El festivo se almacena a medianoche UTC; la fecha consultada a mediodía UTC
    // del mismo día debe coincidir (compara solo año/mes/día).
    const fests = [festivo('2026-12-25', 'festivo')];
    expect(resolverTipoDia(new Date('2026-12-25T12:00:00.000Z'), fests)).toBe(
      'festivo',
    );
  });

  it('elige el primer festivo que coincide', () => {
    const fests = [
      festivo('2026-06-23', 'festivo'),
      festivo('2026-06-23', 'domingo'),
    ];
    expect(resolverTipoDia(d('2026-06-23'), fests)).toBe('festivo');
  });
});
