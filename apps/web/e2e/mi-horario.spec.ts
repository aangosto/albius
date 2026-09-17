import { test, expect, type Page } from '@playwright/test';
import { resetMiHorarioB34 } from './helpers/seed';

/**
 * E2E de MI HORARIO del conductor (B34.2). storageState del conductor
 * (proyecto setup 'login como conductor').
 *
 * Datos (beforeEach, reset-mi-horario-b34, relativos a HOY en UTC): cuadrante
 * del mes actual publicado; el conductor tiene M-LARGO hoy, T-NOCHE hoy+2 y
 * M-LARGO hoy-3 (las que caen en el mes); permiso AP hoy+1 (o hoy-1 si hoy+1
 * cambia de mes). OTRO conductor tiene P-COMERCIAL hoy y hoy+3: no debe verse.
 * Mes siguiente: sin cuadrante. Dentro de dos meses: borrador.
 */

test.use({ storageState: 'e2e/.auth/conductor.json' });

// --- fechas espejo del reset (UTC) ---
const hoy = new Date();
const AÑO = hoy.getUTCFullYear();
const MES = hoy.getUTCMonth() + 1;
const hoyISO = hoy.toISOString().slice(0, 10);
const sumar = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00.000Z`) + n * 86400000)
    .toISOString()
    .slice(0, 10);
const enMes = (iso: string) =>
  iso.startsWith(`${AÑO}-${String(MES).padStart(2, '0')}-`);
const mesInput = (a: number, m: number) => `${a}-${String(m).padStart(2, '0')}`;
const siguiente = (k: number) => {
  const d = new Date(Date.UTC(AÑO, MES - 1 + k, 1));
  return mesInput(d.getUTCFullYear(), d.getUTCMonth() + 1);
};
const diaAus = enMes(sumar(hoyISO, 1)) ? sumar(hoyISO, 1) : sumar(hoyISO, -1);
const turnosEsperados =
  1 + (enMes(sumar(hoyISO, 2)) ? 1 : 0) + (enMes(sumar(hoyISO, -3)) ? 1 : 0);

async function abrir(page: Page): Promise<void> {
  await page.goto('/mi-horario');
  await expect(page.getByRole('heading', { name: 'Mi horario' })).toBeVisible();
  await expect(page.getByTestId('lista-mes')).toBeVisible();
}

test.describe('Mi horario · conductor', () => {
  test.beforeEach(() => {
    resetMiHorarioB34();
  });

  test('ve sus turnos (hoy en próximos y en el mes) y NO los de otro', async ({
    page,
  }) => {
    await abrir(page);
    const hoyCard = page.getByTestId('proximo-hoy');
    await expect(hoyCard).toBeVisible();
    await expect(hoyCard).toContainText('Hoy');
    await expect(hoyCard).toContainText('M-LARGO');
    await expect(hoyCard).toContainText('06:00–14:00');

    await expect(page.getByTestId(`dia-${hoyISO}`)).toContainText('M-LARGO');
    if (enMes(sumar(hoyISO, 2))) {
      await expect(page.getByTestId(`dia-${sumar(hoyISO, 2)}`)).toContainText(
        'T-NOCHE',
      );
    }
    // El otro conductor tiene P-COMERCIAL hoy y hoy+3: no aparece en ningún sitio.
    await expect(page.getByText('P-COMERCIAL')).toHaveCount(0);
    if (enMes(sumar(hoyISO, 3))) {
      await expect(page.getByTestId(`dia-${sumar(hoyISO, 3)}`)).toContainText(
        'Libre',
      );
    }
    // Resumen: nº de turnos del mes.
    await expect(page.getByTestId('resumen')).toContainText(
      `Turnos${turnosEsperados}`,
    );
  });

  test('la ausencia se muestra como tal, no como libre', async ({ page }) => {
    await abrir(page);
    await expect(page.getByTestId(`dia-${diaAus}`)).toContainText('Permiso (AP)');
    await expect(page.getByTestId(`dia-${diaAus}`)).not.toContainText('Libre');
    if (diaAus === sumar(hoyISO, 1)) {
      await expect(page.getByTestId('proximo-manana')).toContainText(
        'Permiso (AP)',
      );
    }
  });

  test('mes sin cuadrante publicado: mensaje honesto (sin doc y borrador)', async ({
    page,
  }) => {
    await abrir(page);
    // Mes siguiente: no existe cuadrante.
    await page.locator('#periodo-mi-horario').fill(siguiente(1));
    await expect(page.getByTestId('sin-publicar')).toContainText(
      'aún no está publicado',
    );
    await expect(page.getByTestId('lista-mes')).toHaveCount(0);
    // Dentro de dos meses: cuadrante en BORRADOR → mismo mensaje (la regla
    // veta el borrador; la query lo constriñe).
    await page.locator('#periodo-mi-horario').fill(siguiente(2));
    await expect(page.getByTestId('sin-publicar')).toContainText(
      'aún no está publicado',
    );
  });
});

test.describe('Mi horario · móvil 375px', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('próximos turnos y lista legibles sin overflow horizontal', async ({
    page,
  }) => {
    resetMiHorarioB34();
    await abrir(page);
    await expect(page.getByTestId('proximo-hoy')).toBeVisible();
    await expect(page.getByTestId('proximo-hoy')).toContainText('M-LARGO');
    const sinOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    );
    expect(sinOverflow).toBe(true);
    // El drawer móvil lleva los items del conductor.
    await page.getByRole('button', { name: 'Abrir menú' }).click();
    const drawer = page.getByRole('dialog', { name: 'Menú de navegación' });
    await expect(drawer.getByRole('link', { name: 'Mi horario' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Calendario' })).toHaveCount(0);
  });
});

test.describe('Mi horario · gate', () => {
  test.use({ storageState: 'e2e/.auth/jefe.json' });

  test('el jefe ve NoAutorizadoView', async ({ page }) => {
    await page.goto('/mi-horario');
    await expect(
      page.getByText('No tienes permiso para acceder a esta página.'),
    ).toBeVisible();
  });
});
