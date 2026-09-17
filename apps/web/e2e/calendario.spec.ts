import { readFileSync } from 'node:fs';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { resetConductoresB22, resetCuadranteB33 } from './helpers/seed';

/**
 * E2E del Calendario con EDICIÓN MANUAL (B33.2). storageState del jefe.
 *
 * Datos (beforeEach): 3 conductores de reset-conductores-b22 (Ana García E100
 * con tiposTurnoPermitidos=[tt_b19_manana]; Luis Pérez E101; Marta Ruiz E102)
 * + cuadrante cua_centro-test_2026_9 en borrador sin asignaciones + convenio
 * (descanso 12 h) + ausencia de Luis el 10/09 (reset-cuadrante-b33). Tipos de
 * turno M-LARGO 06–14 / T-NOCHE 22–06 / P-COMERCIAL / REFUERZO (obsoleto) de
 * globalSetup (B19).
 *
 * Validación híbrida B33.2: los avisos (habilitación, ausencia, descanso) NO
 * bloquean — el botón pasa a "… de todos modos".
 *
 * B36.1: la rejilla PINTA las ausencias (D6.29) y el menú Exportar descarga el
 * cuadrante en CSV (BOM + `;`, `D` en descanso, gana el turno sobre la
 * ausencia).
 */

const MES = '2026-09';

async function irAlCalendario(page: Page): Promise<void> {
  await page.goto('/calendario');
  await expect(page.getByRole('heading', { name: 'Calendario' })).toBeVisible();
  await page.locator('#periodo-calendario').fill(MES);
  await expect(page.getByText(/3 conductores/)).toBeVisible();
}

/** Celda (td) del conductor `apellido` en el día `dia` (columna 0 = nombre). */
function celda(page: Page, apellido: string, dia: number): Locator {
  return page
    .getByRole('row', { name: new RegExp(apellido) })
    .locator('td')
    .nth(dia);
}

async function elegirTipo(dialog: Locator, page: Page, codigo: string) {
  await dialog.getByRole('combobox').click();
  await page.getByRole('option', { name: new RegExp(codigo) }).click();
}

async function asignar(
  page: Page,
  apellido: string,
  dia: number,
  codigo: string,
): Promise<void> {
  await celda(page, apellido, dia).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Asignar turno')).toBeVisible();
  await elegirTipo(dialog, page, codigo);
  await dialog.getByRole('button', { name: /^Asignar/ }).click();
  await expect(dialog).toBeHidden();
  await expect(celda(page, apellido, dia)).toHaveText(codigo);
}

test.describe('Calendario · edición manual (borrador)', () => {
  test.beforeEach(async ({ page }) => {
    resetConductoresB22();
    resetCuadranteB33('borrador');
    await irAlCalendario(page);
  });

  test('rejilla: todos los conductores con fila, aunque no tengan turnos', async ({
    page,
  }) => {
    await expect(page.getByText(/0 asignaciones · 09\/2026 · borrador/)).toBeVisible();
    for (const ap of ['García', 'Pérez', 'Ruiz']) {
      await expect(page.getByRole('row', { name: new RegExp(ap) })).toBeVisible();
    }
    // Sin generar + sin asignaciones → aviso de rellenar a mano.
    await expect(page.getByText(/rellenarlo a mano/)).toBeVisible();
  });

  test('asignar un turno en una celda libre', async ({ page }) => {
    await asignar(page, 'García', 5, 'M-LARGO');
    await expect(page.getByText(/1 asignaciones/)).toBeVisible();
  });

  test('cambiar el turno con aviso de "no habilitado" (no bloquea)', async ({
    page,
  }) => {
    await asignar(page, 'García', 5, 'M-LARGO');
    await celda(page, 'García', 5).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Editar turno')).toBeVisible();
    await expect(dialog.getByText(/actualmente M-LARGO/)).toBeVisible();
    // Ana solo tiene permitido tt_b19_manana → T-NOCHE avisa.
    await elegirTipo(dialog, page, 'T-NOCHE');
    await expect(
      dialog.getByText('Este conductor no está habilitado para el turno T-NOCHE.'),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Guardar de todos modos' }).click();
    await expect(dialog).toBeHidden();
    await expect(celda(page, 'García', 5)).toHaveText('T-NOCHE');
  });

  test('quitar el turno deja la celda libre', async ({ page }) => {
    await asignar(page, 'García', 5, 'M-LARGO');
    await celda(page, 'García', 5).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Quitar turno' }).click();
    await expect(dialog).toBeHidden();
    await expect(celda(page, 'García', 5)).toHaveText('·');
    await expect(page.getByText(/0 asignaciones/)).toBeVisible();
  });

  test('aviso de ausencia el día del permiso', async ({ page }) => {
    await celda(page, 'Pérez', 10).click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByText(/está ausente ese día \(permiso AP\)/),
    ).toBeVisible();
    // El aviso no bloquea: sigue pudiendo asignar.
    await elegirTipo(dialog, page, 'M-LARGO');
    await dialog.getByRole('button', { name: 'Asignar de todos modos' }).click();
    await expect(dialog).toBeHidden();
    await expect(celda(page, 'Pérez', 10)).toHaveText('M-LARGO');
  });

  test('aviso de descanso < 12 h con el turno del día anterior', async ({
    page,
  }) => {
    // T-NOCHE (22–06, cruza medianoche) el día 6 → M-LARGO (06–14) el día 7
    // empieza justo al acabar: 0 h de descanso.
    await celda(page, 'Ruiz', 6).click();
    let dialog = page.getByRole('dialog');
    await elegirTipo(dialog, page, 'T-NOCHE');
    await dialog.getByRole('button', { name: /^Asignar/ }).click();
    await expect(dialog).toBeHidden();
    await expect(celda(page, 'Ruiz', 6)).toHaveText('T-NOCHE');

    await celda(page, 'Ruiz', 7).click();
    dialog = page.getByRole('dialog');
    await elegirTipo(dialog, page, 'M-LARGO');
    await expect(
      dialog.getByText(/descanso con el turno anterior \(T-NOCHE, 2026-09-06\) es de 0 h \(mínimo 12 h\)/),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Asignar de todos modos' }).click();
    await expect(dialog).toBeHidden();
    await expect(celda(page, 'Ruiz', 7)).toHaveText('M-LARGO');
  });
});

test.describe('Calendario · solo lectura', () => {
  test('publicado: celdas no clicables y motivo visible', async ({ page }) => {
    resetConductoresB22();
    resetCuadranteB33('publicado');
    await irAlCalendario(page);
    await expect(page.getByText(/está publicado: solo lectura/)).toBeVisible();
    const c = celda(page, 'García', 5);
    await expect(c).not.toHaveAttribute('role', 'button');
    await c.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('Calendario · ausencias en la rejilla + Exportar CSV (B36.1)', () => {
  test.beforeEach(async ({ page }) => {
    resetConductoresB22();
    resetCuadranteB33('borrador');
    await irAlCalendario(page);
  });

  test('la celda del permiso muestra el código de la ausencia (no se ve libre)', async ({
    page,
  }) => {
    const c = celda(page, 'Pérez', 10);
    await expect(c).toHaveText('AP');
    await expect(c).toHaveAttribute('title', 'Ausente: Permiso (AP)');
    // El día siguiente sigue libre.
    await expect(celda(page, 'Pérez', 11)).toHaveText('·');
  });

  test('turno + ausencia el mismo día: gana el turno, la ausencia queda en el tooltip', async ({
    page,
  }) => {
    await celda(page, 'Pérez', 10).click();
    const dialog = page.getByRole('dialog');
    await elegirTipo(dialog, page, 'M-LARGO');
    await dialog.getByRole('button', { name: 'Asignar de todos modos' }).click();
    await expect(dialog).toBeHidden();
    const c = celda(page, 'Pérez', 10);
    await expect(c).toHaveText('M-LARGO');
    await expect(c).toHaveAttribute('title', /Turno M-LARGO .* · Ausente: Permiso \(AP\)/);
  });

  test('Exportar CSV: descarga con BOM, `;`, D en descanso, turno y ausencia', async ({
    page,
  }) => {
    await asignar(page, 'García', 5, 'M-LARGO');

    await page.getByRole('button', { name: 'Exportar' }).click();
    const item = page.getByRole('menuitem', { name: /CSV/ });
    await expect(item).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      item.click(),
    ]);
    expect(download.suggestedFilename()).toBe('cuadrante_centro-test_2026-09.csv');

    const ruta = await download.path();
    expect(ruta).not.toBeNull();
    const contenido = readFileSync(ruta!, 'utf8');
    expect(contenido.startsWith('\uFEFF')).toBe(true);

    const lineas = contenido.slice(1).split('\r\n');
    expect(lineas[0]).toBe('Cuadrante;Centro Test');
    expect(lineas[1]).toBe('Mes;09/2026');
    expect(lineas[2]).toBe('Estado;borrador');
    expect(lineas[3]).toMatch(/^Generado;\d{2}\/\d{2}\/2026 \d{2}:\d{2} por Albius$/);
    expect(lineas[4]).toBe('');
    // Cabecera de la tabla: 1/09/2026 es martes; 30 columnas de día.
    const cabecera = lineas[5]!.split(';');
    expect(cabecera[0]).toBe('Conductor');
    expect(cabecera[1]).toBe('1 M');
    expect(cabecera[2]).toBe('2 X');
    expect(cabecera).toHaveLength(31);

    const fila = (apellido: string) =>
      lineas.find((l) => l.startsWith(apellido))!.split(';');
    const garcia = fila('García, Ana');
    expect(garcia[0]).toMatch(/^García, Ana \(.+\)$/); // con nº de empleado
    expect(garcia[5]).toBe('M-LARGO');
    expect(garcia[1]).toBe('D');
    const perez = fila('Pérez, Luis');
    expect(perez[10]).toBe('AP');
    expect(perez[11]).toBe('D');
    expect(perez).toHaveLength(31);
  });
});
