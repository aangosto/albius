import { test, expect, type Locator, type Page } from '@playwright/test';
import { resetConductoresB21, resetTiposTurno, readConductorB21 } from './helpers/seed';

/**
 * E2E del alta de conductor con pickers operativos (B21). El alta vive en el
 * flujo de Usuarios (super_admin), así que usa el storageState del admin.
 *
 * Datos (globalSetup): tenant-test + centro-test (3 líneas L-A/L-B/L-C + 4 tipos
 * de turno de B19) + centro-vacio-b21 (sin líneas/tipos). Ids de seed conocidos:
 * líneas linea_b21_a/b/c; tipos tt_b19_manana/noche/partido/obsoleto.
 *
 * Idempotencia (beforeEach): resetConductoresB21 borra los conductores creados
 * por tests previos + su Auth user (crearConductor crea Auth+/usuarios+/conductores;
 * sin limpiar el Auth user, un 2º run chocaría con "email ya existe").
 * resetTiposTurno deja los 4 tipos canónicos (otros specs los mutan).
 */

test.use({ storageState: 'e2e/.auth/admin.json' });

test.beforeEach(async ({ page }) => {
  resetConductoresB21();
  resetTiposTurno();
  await page.goto('/usuarios');
  await expect(
    page.getByRole('button', { name: 'Nuevo conductor' }),
  ).toBeVisible();
});

// ============================================================================
//  Helpers
// ============================================================================

async function openDialog(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Nuevo conductor' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

async function selectTenantCentro(
  page: Page,
  dialog: Locator,
  centroName: string,
): Promise<void> {
  await dialog.getByRole('combobox').nth(0).click(); // tenant
  await page.getByRole('option', { name: 'Tenant Test' }).click();
  await dialog.getByRole('combobox').nth(1).click(); // centro
  await page.getByRole('option', { name: centroName, exact: true }).click();
}

async function fillBasics(
  dialog: Locator,
  num: string,
  email: string,
): Promise<void> {
  await dialog.getByLabel('Número de empleado').fill(num);
  await dialog.getByLabel('Nombre').fill('Ana');
  await dialog.getByLabel('Apellidos').fill('García');
  await dialog.getByLabel('DNI').fill('12345678Z');
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByLabel('Fecha de antigüedad').fill('2020-01-01');
  await dialog.getByLabel('Fecha de incorporación').fill('2020-02-01');
}

// ============================================================================
//  Tests
// ============================================================================

test('alta con líneas y tipos seleccionados persiste los arrays', async ({
  page,
}) => {
  const dialog = await openDialog(page);
  await fillBasics(dialog, 'E2E-B21-1', 'e2e-b21-1@albius.test');
  await selectTenantCentro(page, dialog, 'Centro Test');

  // Líneas: 2 preferentes (A, B) + 1 secundaria (C).
  await dialog.getByRole('button', { name: 'Líneas' }).click();
  await dialog.locator('#linea-pref-linea_b21_a').click();
  await dialog.locator('#linea-pref-linea_b21_b').click();
  await dialog.locator('#linea-sec-linea_b21_c').click();

  // Tipos: 2 permitidos + 1 excluido.
  await dialog.getByRole('button', { name: 'Tipos de turno' }).click();
  await dialog.locator('#tipo-perm-tt_b19_manana').click();
  await dialog.locator('#tipo-perm-tt_b19_noche').click();
  await dialog.locator('#tipo-excl-tt_b19_partido').click();

  await dialog.getByRole('button', { name: 'Crear conductor' }).click();
  // D5.6: pantalla de éxito (no cierra).
  await expect(
    dialog.getByRole('heading', { name: 'Usuario creado' }),
  ).toBeVisible();

  const doc = readConductorB21('tenant-test_E2E-B21-1');
  expect(doc.exists).toBe(true);
  expect(doc.lineasPreferentes.length).toBe(2);
  expect(doc.lineasSecundarias.length).toBe(1);
  expect(doc.tiposTurnoPermitidos.length).toBe(2);
  expect(doc.tiposTurnoExcluidos.length).toBe(1);
});

test('exclusión mutua: marcar preferente deshabilita en secundarias', async ({
  page,
}) => {
  const dialog = await openDialog(page);
  await selectTenantCentro(page, dialog, 'Centro Test');

  await dialog.getByRole('button', { name: 'Líneas' }).click();
  // Antes de marcar, la línea A está habilitada en ambas listas.
  await expect(dialog.locator('#linea-sec-linea_b21_a')).toBeEnabled();
  // Marcar A como preferente → se deshabilita en secundarias.
  await dialog.locator('#linea-pref-linea_b21_a').click();
  await expect(dialog.locator('#linea-pref-linea_b21_a')).toBeChecked();
  await expect(dialog.locator('#linea-sec-linea_b21_a')).toBeDisabled();
});

test('centro sin líneas: picker vacío y alta con arrays vacíos', async ({
  page,
}) => {
  const dialog = await openDialog(page);
  await fillBasics(dialog, 'E2E-B21-EMPTY', 'e2e-b21-empty@albius.test');
  await selectTenantCentro(page, dialog, 'Centro Vacío B21');

  await dialog.getByRole('button', { name: 'Líneas' }).click();
  await expect(
    dialog.getByText('Este centro no tiene líneas todavía.').first(),
  ).toBeVisible();

  await dialog.getByRole('button', { name: 'Crear conductor' }).click();
  await expect(
    dialog.getByRole('heading', { name: 'Usuario creado' }),
  ).toBeVisible();

  const doc = readConductorB21('tenant-test_E2E-B21-EMPTY');
  expect(doc.exists).toBe(true);
  expect(doc.lineasPreferentes.length).toBe(0);
  expect(doc.lineasSecundarias.length).toBe(0);
  expect(doc.tiposTurnoPermitidos.length).toBe(0);
});

test('cambiar de centro resetea las selecciones', async ({ page }) => {
  const dialog = await openDialog(page);
  await selectTenantCentro(page, dialog, 'Centro Test');

  await dialog.getByRole('button', { name: 'Líneas' }).click();
  await dialog.locator('#linea-pref-linea_b21_a').click();
  await expect(dialog.locator('#linea-pref-linea_b21_a')).toBeChecked();

  // Cambiar a otro centro y volver: la selección debe quedar limpia.
  await dialog.getByRole('combobox').nth(1).click();
  await page.getByRole('option', { name: 'Centro Vacío B21' }).click();
  await dialog.getByRole('combobox').nth(1).click();
  await page.getByRole('option', { name: 'Centro Test', exact: true }).click();

  // La sección sigue abierta; las líneas recargan sin selección.
  await expect(dialog.locator('#linea-pref-linea_b21_a')).not.toBeChecked();
});
