import { test, expect, type Page } from '@playwright/test';
import { resetFestivosB35 } from './helpers/seed';

/**
 * E2E de la página de FESTIVOS del jefe (B35.1). storageState del jefe.
 *
 * Datos (beforeEach, reset-festivos-b35): fest_b35_nacional (tenant-wide,
 * oficial, 12/10/2026, solo lectura) y fest_b35_local (centro-test, editable,
 * 19/09/2026, tráfico "como domingo").
 */

async function abrir(page: Page): Promise<void> {
  await page.goto('/festivos');
  await expect(page.getByRole('heading', { name: 'Festivos' })).toBeVisible();
  await expect(page.getByTestId('festivo-fest_b35_local')).toBeVisible();
}

test.describe('Festivos · jefe', () => {
  test.beforeEach(async ({ page }) => {
    resetFestivosB35();
    await abrir(page);
  });

  test('listado: el tenant-wide oficial va en solo lectura, el del centro es editable', async ({
    page,
  }) => {
    const nacional = page.getByTestId('festivo-fest_b35_nacional');
    await expect(nacional).toContainText('Fiesta Nacional de España');
    await expect(nacional).toContainText('Todos los centros');
    await expect(nacional).toContainText('oficial');
    await expect(nacional).toContainText('Solo lectura');
    await expect(nacional.getByRole('button', { name: 'Editar' })).toHaveCount(0);

    const local = page.getByTestId('festivo-fest_b35_local');
    await expect(local).toContainText('Este centro');
    await expect(local).toContainText('Como domingo');
    await expect(local.getByRole('button', { name: 'Editar' })).toBeVisible();
    await expect(local.getByRole('button', { name: 'Eliminar' })).toBeVisible();
  });

  test('alta de un festivo del centro (incluso ámbito nacional)', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Nuevo festivo' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#fest-fecha').fill('2026-11-01');
    await dialog.locator('#fest-nombre').fill('Todos los Santos');
    await dialog.locator('#fest-ambito').click();
    await page.getByRole('option', { name: 'Nacional' }).click();
    await dialog.getByRole('button', { name: 'Crear festivo' }).click();
    await expect(dialog).toBeHidden();
    const fila = page.getByRole('row', { name: /Todos los Santos/ });
    await expect(fila).toContainText('01/11/2026');
    await expect(fila).toContainText('Nacional');
    await expect(fila).toContainText('Este centro');
    await expect(fila.getByRole('button', { name: 'Editar' })).toBeVisible();
  });

  test('edición: cambia nombre y tráfico', async ({ page }) => {
    const local = page.getByTestId('festivo-fest_b35_local');
    await local.getByRole('button', { name: 'Editar' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#fest-nombre').fill('Fiesta local editada');
    await dialog.locator('#fest-trafico').click();
    await page.getByRole('option', { name: 'Festivo', exact: true }).click();
    await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(dialog).toBeHidden();
    await expect(local).toContainText('Fiesta local editada');
    await expect(local).toContainText('Festivo');
  });

  test('borrado del festivo del centro', async ({ page }) => {
    const local = page.getByTestId('festivo-fest_b35_local');
    await local.getByRole('button', { name: 'Eliminar' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Fiesta local de prueba');
    await dialog.getByRole('button', { name: 'Eliminar' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('festivo-fest_b35_local')).toHaveCount(0);
    await expect(page.getByTestId('festivo-fest_b35_nacional')).toBeVisible();
  });

  test('filtro por mes', async ({ page }) => {
    await page.locator('#filtro-mes-festivos').fill('2026-10');
    await expect(page.getByTestId('festivo-fest_b35_nacional')).toBeVisible();
    await expect(page.getByTestId('festivo-fest_b35_local')).toHaveCount(0);
    await page.getByRole('button', { name: 'Quitar' }).click();
    await expect(page.getByTestId('festivo-fest_b35_local')).toBeVisible();
  });
});
