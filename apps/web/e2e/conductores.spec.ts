import { test, expect, type Locator, type Page } from '@playwright/test';
import { resetConductoresB22, readConductorB21 } from './helpers/seed';

/**
 * E2E de la ConductoresPage del jefe (B22): listar + editar config operativa.
 * Usa el storageState del jefe (default del proyecto chromium).
 *
 * Datos (beforeEach, reset-conductores-b22): 3 conductores en centro-test —
 * cond_b22_1 "Ana García" (config completa, activo, reserva), cond_b22_2 "Luis
 * Pérez" (1 línea, vacaciones), cond_b22_3 "Marta Ruiz" (sin config, activo).
 * Líneas linea_b21_a/b/c y tipos tt_b19_* vienen de globalSetup (B21/B19).
 */

async function openEdit(page: Page, apellido: string): Promise<Locator> {
  await page
    .getByRole('row', { name: new RegExp(apellido) })
    .getByRole('button', { name: 'Editar' })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

// ============================================================================
//  Gate del super_admin (storageState admin)
// ============================================================================

test.describe('Conductores · gate super_admin', () => {
  test.use({ storageState: 'e2e/.auth/admin.json' });

  test('super_admin: /conductores no en sidebar y URL → NoAutorizado', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    // /conductores se retiró de la nav del super_admin (B22).
    await expect(
      page.getByRole('link', { name: 'Conductores' }),
    ).toHaveCount(0);
    // Entrar por URL directa → NoAutorizadoView.
    await page.goto('/conductores');
    await expect(
      page.getByText('No tienes permiso para acceder a esta página.'),
    ).toBeVisible();
  });
});

// ============================================================================
//  Flujos del jefe (storageState jefe, default del proyecto)
// ============================================================================

test.describe('Conductores · flujos del jefe', () => {
  test.beforeEach(async ({ page }) => {
    resetConductoresB22();
    await page.goto('/conductores');
    await expect(
      page.getByRole('heading', { name: 'Conductores' }),
    ).toBeVisible();
    await expect(page.getByText('Ana García')).toBeVisible();
  });

  test('listado: 3 conductores con conteos y estado', async ({ page }) => {
    await expect(page.getByText('Ana García')).toBeVisible();
    await expect(page.getByText('Luis Pérez')).toBeVisible();
    await expect(page.getByText('Marta Ruiz')).toBeVisible();

    // cond1: 2 líneas (pref+sec) · 2 turnos (perm+excl).
    await expect(
      page.getByRole('row', { name: /García/ }).getByText('2 líneas · 2 turnos'),
    ).toBeVisible();
    // cond3: sin config.
    await expect(
      page.getByRole('row', { name: /Ruiz/ }).getByText('0 líneas · 0 turnos'),
    ).toBeVisible();
    // cond2: estado Vacaciones.
    await expect(
      page.getByRole('row', { name: /Pérez/ }).getByText('Vacaciones'),
    ).toBeVisible();
  });

  test('edición: precarga + cambio de líneas y estado persiste', async ({
    page,
  }) => {
    const dialog = await openEdit(page, 'García');
    await expect(
      dialog.getByRole('heading', { name: 'Editar: Ana García' }),
    ).toBeVisible();

    // Precarga: la sección Líneas muestra linea_b21_a ya marcada como preferente.
    await dialog.getByRole('button', { name: 'Líneas' }).click();
    await expect(dialog.locator('#linea-pref-linea_b21_a')).toBeChecked();

    // Cambio: quitar A, añadir C como preferente.
    await dialog.locator('#linea-pref-linea_b21_a').click();
    await dialog.locator('#linea-pref-linea_b21_c').click();

    // Cambiar estado a Vacaciones.
    await dialog.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Vacaciones' }).click();

    await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    const doc = readConductorB21('cond_b22_1');
    expect(doc.lineasPreferentes).toEqual(['linea_b21_c']);
    expect(doc.estado).toBe('vacaciones');
  });

  test('omit-only: sin cambios → "No hay cambios" + submit disabled', async ({
    page,
  }) => {
    const dialog = await openEdit(page, 'Ruiz'); // cond3, sin config
    await expect(
      dialog.getByText('No hay cambios que guardar.'),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Guardar cambios' }),
    ).toBeDisabled();
  });

  test('exclusión mutua en edición: preferente precargada deshabilita en secundarias', async ({
    page,
  }) => {
    const dialog = await openEdit(page, 'García'); // A preferente, B secundaria
    await dialog.getByRole('button', { name: 'Líneas' }).click();
    // A está en preferentes → deshabilitada en secundarias.
    await expect(dialog.locator('#linea-sec-linea_b21_a')).toBeDisabled();
    // B está en secundarias → deshabilitada en preferentes.
    await expect(dialog.locator('#linea-pref-linea_b21_b')).toBeDisabled();
  });

  test('filtros: estado y búsqueda', async ({ page }) => {
    // estado = Vacaciones → solo Luis Pérez.
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Vacaciones' }).click();
    await expect(page.getByText('Luis Pérez')).toBeVisible();
    await expect(page.getByText('Ana García')).toBeHidden();

    // volver a Todos + búsqueda "Ruiz" → solo Marta.
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Todos' }).click();
    await page.getByPlaceholder(/Nombre, apellidos/).fill('Ruiz');
    await expect(page.getByText('Marta Ruiz')).toBeVisible();
    await expect(page.getByText('Ana García')).toBeHidden();
    await expect(page.getByText('Luis Pérez')).toBeHidden();
  });
});
