import { describe, it, expect } from 'vitest';
import { expandirAusenciaEnMes } from './expandirAusenciaEnMes';

/**
 * Tests de la expansión de ausencias a días del mes (B32.3). Alimenta el
 * `ausencias[]` del optimizador, así que se cubren los recortes por ambos
 * extremos y la independencia de la zona horaria.
 */

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('expandirAusenciaEnMes', () => {
  it('rango dentro del mes → todos sus días, inclusive ambos extremos', () => {
    expect(expandirAusenciaEnMes(d('2026-09-07'), d('2026-09-10'), 2026, 9)).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
    ]);
  });

  it('rango que empieza antes del mes → se recorta al día 1', () => {
    expect(expandirAusenciaEnMes(d('2026-08-28'), d('2026-09-02'), 2026, 9)).toEqual([
      '2026-09-01',
      '2026-09-02',
    ]);
  });

  it('rango que acaba después del mes → se recorta al último día (30 en septiembre)', () => {
    expect(expandirAusenciaEnMes(d('2026-09-29'), d('2026-10-05'), 2026, 9)).toEqual([
      '2026-09-29',
      '2026-09-30',
    ]);
  });

  it('rango que envuelve el mes entero → los 30 días', () => {
    const dias = expandirAusenciaEnMes(d('2026-08-15'), d('2026-10-15'), 2026, 9);
    expect(dias).toHaveLength(30);
    expect(dias[0]).toBe('2026-09-01');
    expect(dias[29]).toBe('2026-09-30');
  });

  it('día suelto (inicio == fin) → un solo día', () => {
    expect(expandirAusenciaEnMes(d('2026-09-15'), d('2026-09-15'), 2026, 9)).toEqual([
      '2026-09-15',
    ]);
  });

  it('rango fuera del mes (antes) → vacío', () => {
    expect(expandirAusenciaEnMes(d('2026-08-01'), d('2026-08-31'), 2026, 9)).toEqual([]);
  });

  it('rango fuera del mes (después) → vacío', () => {
    expect(expandirAusenciaEnMes(d('2026-10-01'), d('2026-10-03'), 2026, 9)).toEqual([]);
  });

  it('respeta la longitud real del mes (febrero no bisiesto = 28)', () => {
    expect(expandirAusenciaEnMes(d('2026-01-01'), d('2026-12-31'), 2026, 2)).toHaveLength(28);
  });

  it('UTC: una fecha con hora local tardía no se desplaza de día', () => {
    // 23:30 UTC del día 30 sigue siendo el día 30 (en Europe/Madrid ya sería el 1
    // de octubre; el helper NO debe usar hora local).
    const inicio = new Date('2026-09-30T23:30:00.000Z');
    expect(expandirAusenciaEnMes(inicio, inicio, 2026, 9)).toEqual(['2026-09-30']);
    // Y a las 00:30 UTC del día 1 de octubre ya está fuera del mes.
    const fuera = new Date('2026-10-01T00:30:00.000Z');
    expect(expandirAusenciaEnMes(fuera, fuera, 2026, 9)).toEqual([]);
  });

  it('inicio > fin (rango inválido) → vacío, no explota', () => {
    expect(expandirAusenciaEnMes(d('2026-09-10'), d('2026-09-05'), 2026, 9)).toEqual([]);
  });
});
