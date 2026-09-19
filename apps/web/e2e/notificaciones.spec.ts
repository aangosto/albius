import { test, expect, type Page } from '@playwright/test';
import { resetMiHorarioB34, resetNotificacionesB38 } from './helpers/seed';

/**
 * E2E de NOTIFICACIONES IN-APP (B38.5). storageState del conductor (proyecto
 * setup 'login como conductor'), que es el rol que estrena el canal.
 *
 * Datos (beforeEach, reset-notificaciones-b38): 2 sin leer —una del MES ACTUAL
 * con `datosContexto.cuadranteId`, otra sin contexto de mes— y 1 ya leída.
 * `resetMiHorarioB34` deja además el cuadrante del mes publicado, para que Mi
 * horario tenga contenido real debajo del banner.
 */

test.use({ storageState: 'e2e/.auth/conductor.json' });

async function abrirMiHorario(page: Page): Promise<void> {
  await page.goto('/mi-horario');
  await expect(page.getByRole('heading', { name: 'Mi horario' })).toBeVisible();
}

test.describe('Notificaciones · campana y banner', () => {
  test.beforeEach(() => {
    resetMiHorarioB34();
    resetNotificacionesB38();
  });

  test('la campana muestra el contador, lista las notificaciones y al abrirla baja a cero', async ({
    page,
  }) => {
    await abrirMiHorario(page);

    // El badge cuenta SOLO las no leídas (2 de 3).
    const contador = page.getByTestId('campana-contador');
    await expect(contador).toHaveText('2');

    await page.getByTestId('campana').click();
    const panel = page.getByTestId('campana-panel');
    await expect(panel).toBeVisible();

    // Las 3 se listan (la leída también, sin resaltar).
    await expect(panel.getByTestId('campana-item')).toHaveCount(3);
    await expect(panel).toContainText('Tu horario ya está publicado');
    await expect(panel).toContainText('Aviso sin mes');
    await expect(panel).toContainText('Aviso ya leído');

    // Abrir marca como leídas: el badge desaparece (onSnapshot, sin recarga).
    await expect(contador).toHaveCount(0);

    // Y es persistente: tras recargar sigue sin badge.
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByTestId('campana')).toBeVisible();
    await expect(page.getByTestId('campana-contador')).toHaveCount(0);
  });

  test('Escape cierra el panel y el estado leído no se pierde', async ({
    page,
  }) => {
    await abrirMiHorario(page);
    await page.getByTestId('campana').click();
    await expect(page.getByTestId('campana-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('campana-panel')).toHaveCount(0);

    await page.getByTestId('campana').click();
    await expect(page.getByTestId('campana-panel')).toBeVisible();
    // Ninguna resaltada ya, y el contador sigue ausente.
    await expect(page.getByTestId('campana-contador')).toHaveCount(0);
  });

  test('el banner de Mi horario muestra SOLO la notificación del mes y se marca como leída', async ({
    page,
  }) => {
    await abrirMiHorario(page);

    const banner = page.getByTestId('aviso-notificaciones');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Tu horario ya está publicado');
    // La notificación sin contexto de mes NO entra en el banner (sí en la campana).
    await expect(banner).not.toContainText('Aviso sin mes');

    await banner.getByRole('button', { name: 'Marcar como leídas' }).click();

    // Al quedar sin no-leídas del mes, el banner se desmonta solo.
    await expect(banner).toHaveCount(0);
    // Y el badge baja de 2 a 1 (queda la que no era del mes).
    await expect(page.getByTestId('campana-contador')).toHaveText('1');
  });

  test('al navegar a un mes sin notificaciones el banner no aparece', async ({
    page,
  }) => {
    await abrirMiHorario(page);
    await expect(page.getByTestId('aviso-notificaciones')).toBeVisible();

    // Mes siguiente: la notificación sembrada es del mes en curso.
    const hoy = new Date();
    const siguiente = new Date(
      Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, 1),
    );
    await page
      .getByLabel('Mes')
      .fill(
        `${siguiente.getUTCFullYear()}-${String(siguiente.getUTCMonth() + 1).padStart(2, '0')}`,
      );

    await expect(page.getByTestId('aviso-notificaciones')).toHaveCount(0);
    // La campana sigue contando las 2: el filtro es del banner, no del canal.
    await expect(page.getByTestId('campana-contador')).toHaveText('2');
  });
});
