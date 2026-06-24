import { test, expect } from '@playwright/test';

/**
 * Test de humo del andamiaje E2E (B20, Fase 1). Arranca ya autenticado como
 * jefe (storageState del proyecto setup), navega a /tipos-turno y verifica que
 * la tabla carga con las filas sembradas por global-setup.
 *
 * Si esto pasa en verde, el andamiaje completo está validado: webServer en
 * puerto fijo, emuladores + seed, login persistido y navegación autenticada.
 */

test('humo: el jefe ve la tabla de tipos de turno sembrada', async ({
  page,
}) => {
  await page.goto('/tipos-turno');

  await expect(
    page.getByRole('heading', { name: 'Tipos de turno' }),
  ).toBeVisible();

  // Las 4 filas sembradas (M-LARGO simple, T-NOCHE nocturno, P-COMERCIAL
  // partido, REFUERZO obsoleto) — filtro por defecto 'todos' las muestra.
  // exact:true porque el código "REFUERZO" es substring del nombre "Refuerzo
  // verano" (otra celda de la misma fila) y el match por nombre es por subcadena.
  await expect(
    page.getByRole('cell', { name: 'M-LARGO', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'T-NOCHE', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'P-COMERCIAL', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'REFUERZO', exact: true }),
  ).toBeVisible();
});
