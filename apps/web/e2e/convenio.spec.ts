import { test, expect, type Page } from '@playwright/test';
import { resetConvenioB35 } from './helpers/seed';

/**
 * E2E de la página de CONVENIO del jefe (B35.1). storageState del jefe.
 * Singleton por centro: sin convenio → aviso + form vacío que crea; con
 * convenio → precarga y edición. Validación cliente espejo del validator.
 */

const CAMPOS = {
  descansoMinimoEntreJornadasHoras: '12',
  maxHorasSemanales: '40',
  maxDiasConsecutivosTrabajados: '6',
  descansoSemanalMinimoHoras: '36',
  maxFinesSemanaConsecutivosTrabajados: '2',
  minDomingosLibresAño: '12',
  maxHorasAnuales: '1800',
  antelacionMinimaPublicacionDias: '15',
} as const;

async function abrir(page: Page): Promise<void> {
  await page.goto('/convenio');
  await expect(page.getByRole('heading', { name: 'Convenio' })).toBeVisible();
}

async function rellenar(page: Page, valores: Record<string, string>) {
  for (const [k, v] of Object.entries(valores)) {
    await page.locator(`#conv-${k}`).fill(v);
  }
}

test.describe('Convenio · jefe', () => {
  test('sin convenio: aviso, marcas de aplicado/no aplicado y alta', async ({
    page,
  }) => {
    resetConvenioB35(false);
    await abrir(page);
    await expect(page.getByTestId('sin-convenio')).toContainText(
      'el optimizador no puede generar',
    );
    // Honestidad de producto: los dos grupos están marcados.
    await expect(page.getByText('Aplicado por el optimizador')).toBeVisible();
    await expect(page.getByText('Registrado, aún no aplicado')).toBeVisible();

    await rellenar(page, CAMPOS);
    await page.getByRole('button', { name: 'Guardar convenio' }).click();
    await expect(page.getByTestId('guardado-ok')).toBeVisible();
    await expect(page.getByTestId('sin-convenio')).toHaveCount(0);
    // Recarga: los valores persisten.
    await page.reload();
    await expect(page.locator('#conv-maxHorasSemanales')).toHaveValue('40');
    await expect(page.getByRole('button', { name: 'Guardar cambios' })).toBeVisible();
  });

  test('con convenio: precarga y edición persisten', async ({ page }) => {
    resetConvenioB35(true);
    await abrir(page);
    await expect(page.locator('#conv-descansoMinimoEntreJornadasHoras')).toHaveValue('12');
    await expect(page.locator('#conv-referencia')).toHaveValue('Convenio de prueba B35');
    await page.locator('#conv-maxHorasSemanales').fill('37.5');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByTestId('guardado-ok')).toBeVisible();
    await page.reload();
    await expect(page.locator('#conv-maxHorasSemanales')).toHaveValue('37.5');
  });

  test('guardar el convenio marca el borrador generado como desactualizado', async ({
    page,
  }) => {
    resetConvenioB35(true, true);
    await page.goto('/cuadrante');
    await page.locator('#periodo-cuadrante').fill('2026-09');
    await expect(page.getByText('Generado', { exact: true })).toBeVisible();
    await expect(page.getByTestId('convenio-desactualizado')).toHaveCount(0);

    await abrir(page);
    await page.locator('#conv-maxHorasSemanales').fill('38');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByTestId('guardado-ok')).toBeVisible();

    await page.goto('/cuadrante');
    await page.locator('#periodo-cuadrante').fill('2026-09');
    await expect(page.getByTestId('convenio-desactualizado')).toContainText(
      'convenio anterior',
    );
  });

  test('publicar avisa de la antelación mínima del convenio (no bloquea)', async ({
    page,
  }) => {
    // Convenio con antelación 15 días + borrador generado de 2026-09: hoy ya
    // estamos dentro (o después) del mes → aviso, pero el botón sigue activo.
    resetConvenioB35(true, true);
    await page.goto('/cuadrante');
    await page.locator('#periodo-cuadrante').fill('2026-09');
    await page.getByRole('button', { name: 'Publicar' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('aviso-publicar')).toContainText(
      'exige 15 días de antelación',
    );
    await expect(
      dialog.getByRole('button', { name: 'Publicar de todos modos' }),
    ).toBeEnabled();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toBeHidden();
  });

  test('validación cliente: fuera de rango bloquea el guardado', async ({
    page,
  }) => {
    resetConvenioB35(true);
    await abrir(page);
    await page.locator('#conv-descansoMinimoEntreJornadasHoras').fill('30');
    await expect(
      page.getByTestId('error-descansoMinimoEntreJornadasHoras'),
    ).toContainText('Máximo 24');
    await expect(page.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    await page.locator('#conv-maxDiasConsecutivosTrabajados').fill('0');
    await expect(
      page.getByTestId('error-maxDiasConsecutivosTrabajados'),
    ).toContainText('Mínimo 1');
  });
});

test.describe('Convenio · gate', () => {
  test.use({ storageState: 'e2e/.auth/conductor.json' });
  test('el conductor ve NoAutorizadoView', async ({ page }) => {
    await page.goto('/convenio');
    await expect(
      page.getByText('No tienes permiso para acceder a esta página.'),
    ).toBeVisible();
  });
});
