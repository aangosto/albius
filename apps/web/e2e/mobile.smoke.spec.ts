import { test, expect, type Page } from '@playwright/test';
import {
  resetConductoresB22,
  resetCuadranteB33,
  resetFestivosB35,
} from './helpers/seed';

/**
 * Smoke MÓVIL (B34.3): viewport 375×667 (iPhone SE/8). storageState del jefe.
 *
 *   1. El drawer de navegación: el botón hamburguesa abre un dialog con los
 *      items de NAV_BY_ROL; pulsar un item navega y cierra; Escape cierra.
 *   2. Ninguna página del jefe desborda horizontalmente el body (las tablas
 *      y la rejilla scrollean en su contenedor).
 *   3. El menú Exportar del Calendario (B36.1) abre y cierra en móvil sin
 *      desbordar.
 */

test.use({ viewport: { width: 375, height: 667 } });

async function sinOverflowHorizontal(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
}

test('drawer: abre, navega y cierra', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  // En móvil el sidebar fijo no se ve.
  await expect(page.getByRole('link', { name: 'Calendario' })).toHaveCount(0);

  const boton = page.getByRole('button', { name: 'Abrir menú' });
  await expect(boton).toBeVisible();
  await boton.click();

  const drawer = page.getByRole('dialog', { name: 'Menú de navegación' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Cuadrante' })).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Calendario' })).toBeVisible();

  // Pulsar un item navega y cierra el drawer.
  await drawer.getByRole('link', { name: 'Calendario' }).click();
  await expect(page).toHaveURL(/\/calendario$/);
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Calendario' })).toBeVisible();

  // Escape cierra.
  await boton.click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  // Clic fuera (overlay) cierra.
  await boton.click();
  await expect(drawer).toBeVisible();
  await page.mouse.click(360, 600);
  await expect(drawer).toBeHidden();
});

test('páginas del jefe sin overflow horizontal a 375px (incl. Festivos y Convenio, B35.1)', async ({ page }) => {
  resetConductoresB22();
  resetCuadranteB33('borrador');
  resetFestivosB35();
  const rutas = [
    ['/dashboard', 'Dashboard'],
    ['/cuadrante', 'Cuadrante'],
    ['/calendario', 'Calendario'],
    ['/conductores', 'Conductores'],
    ['/ausencias', 'Ausencias'],
    ['/lineas', 'Líneas'],
    ['/tipos-turno', 'Tipos de turno'],
    ['/festivos', 'Festivos'],
    ['/convenio', 'Convenio'],
  ] as const;
  for (const [ruta, titulo] of rutas) {
    await page.goto(ruta);
    await expect(page.getByRole('heading', { name: titulo })).toBeVisible();
    // Deja cargar listados/rejilla antes de medir.
    await page.waitForTimeout(500);
    expect(await sinOverflowHorizontal(page), `overflow en ${ruta}`).toBe(true);
  }
});

test('menú Exportar del Calendario a 375px (B36.1-B36.3)', async ({ page }) => {
  resetConductoresB22();
  resetCuadranteB33('borrador');
  await page.goto('/calendario');
  await expect(page.getByRole('heading', { name: 'Calendario' })).toBeVisible();
  await page.locator('#periodo-calendario').fill('2026-09');
  await expect(page.getByText(/3 conductores/)).toBeVisible();

  const boton = page.getByRole('button', { name: 'Exportar' });
  await expect(boton).toBeVisible();
  await boton.click();
  const item = page.getByRole('menuitem', { name: /CSV/ });
  await expect(item).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^Excel/ })).toBeVisible();
  // B36.4: los PDF van en un submenú (A4 · A3 · Semanal).
  await expect(page.getByRole('menuitem', { name: /^PDF/ })).toBeVisible();
  await page.getByRole('menuitem', { name: /^PDF/ }).click();
  await expect(page.getByRole('menuitem', { name: /^Semanal/ })).toBeVisible();
  expect(await sinOverflowHorizontal(page), 'overflow con el menú abierto').toBe(true);
  await page.keyboard.press('Escape');
  await expect(item).toBeHidden();
});

test('la campana de notificaciones no rompe el Topbar a 375px (B38.5)', async ({
  page,
}) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  // Los tres controles del Topbar conviven en 375px: hamburguesa, campana y
  // cerrar sesión (este último, en móvil, solo con el icono).
  await expect(page.getByRole('button', { name: 'Abrir menú' })).toBeVisible();
  const campana = page.getByTestId('campana');
  await expect(campana).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  expect(await sinOverflowHorizontal(page), 'overflow con la campana').toBe(true);

  // El panel desplegado tampoco desborda (max-w calc(100vw-1.5rem)).
  await campana.click();
  await expect(page.getByTestId('campana-panel')).toBeVisible();
  expect(
    await sinOverflowHorizontal(page),
    'overflow con el panel abierto',
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('campana-panel')).toHaveCount(0);
});
