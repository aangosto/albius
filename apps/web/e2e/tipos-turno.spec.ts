import { test, expect, type Locator, type Page } from '@playwright/test';
import { resetTiposTurno } from './helpers/seed';

/**
 * E2E de Tipos de turno (B20 Fase 2) — el checklist manual de B19 hecho código.
 * Es el verify automatizado del frontend de B19.
 *
 * IDEMPOTENCIA: `beforeEach` ejecuta resetTiposTurno() (borra+recrea SOLO los 4
 * tipos del centro-test, sin tocar usuarios → preserva el storageState del
 * jefe). Así cada test parte de un estado conocido y la suite es re-ejecutable
 * sin estado residual de altas/ediciones previas. Los tests de alta usan códigos
 * que no chocan con el seed (T1, P-TEST, N-TEST).
 *
 * LOCATORS: roles + scoping a la fila/diálogo + exact:true donde el texto es
 * subcadena de otro (p.ej. código "REFUERZO" ⊂ nombre "Refuerzo verano"). Sin
 * sleeps: se espera al cierre del Dialog (toBeHidden) y al refetch (auto-wait
 * de las aserciones sobre las celdas).
 */

// ============================================================================
//  Helpers de formulario
// ============================================================================

async function openCrear(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Nuevo tipo de turno' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

interface Basics {
  codigo?: string;
  nombre?: string;
  inicio?: string;
  fin?: string;
  total?: string;
  efectiva?: string;
}

/**
 * Rellena los campos base. Llamar ANTES de marcar esPartido: así solo existen
 * los 2 inputs time principales (horaInicio/Fin en nth 0/1). Los inputs time de
 * los tramos van scoped al <fieldset>, no por nth global.
 */
async function fillBasics(dialog: Locator, b: Basics): Promise<void> {
  if (b.codigo !== undefined) await dialog.getByPlaceholder(/M-LARGO/).fill(b.codigo);
  if (b.nombre !== undefined) await dialog.getByPlaceholder(/Mañana largo/).fill(b.nombre);
  const times = dialog.locator('input[type="time"]');
  if (b.inicio !== undefined) await times.nth(0).fill(b.inicio);
  if (b.fin !== undefined) await times.nth(1).fill(b.fin);
  if (b.total !== undefined) await dialog.getByPlaceholder('480').fill(b.total);
  if (b.efectiva !== undefined) await dialog.getByPlaceholder('450').fill(b.efectiva);
}

const btnCrear = (d: Locator) =>
  d.getByRole('button', { name: 'Crear tipo de turno' });
const btnGuardar = (d: Locator) =>
  d.getByRole('button', { name: 'Guardar cambios' });

// ============================================================================
//  GATE (D4.13)
// ============================================================================

test.describe('Tipos de turno · gate de acceso (D4.13)', () => {
  // Override del storageState del proyecto (jefe) por uno VACÍO: estos tests
  // necesitan partir sin sesión. El fixture `page` normal ya hereda baseURL.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('sin sesión: /tipos-turno redirige a /login y no muestra la tabla', async ({
    page,
  }) => {
    await page.goto('/tipos-turno');
    await page.waitForURL('**/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'M-LARGO', exact: true }),
    ).toHaveCount(0);
  });

  test('como conductor: ve NoAutorizadoView, no la tabla', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill('conductor@albius.local');
    await page.locator('input[type="password"]').fill('albius123');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL('**/mi-horario'); // home del conductor
    await page.goto('/tipos-turno');
    await expect(
      page.getByText('No tienes permiso para acceder a esta página.'),
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'M-LARGO', exact: true }),
    ).toHaveCount(0);
  });
});

// ============================================================================
//  FLUJOS DEL JEFE (storageState del proyecto setup)
// ============================================================================

test.describe('Tipos de turno · flujos del jefe', () => {
  test.beforeEach(async ({ page }) => {
    resetTiposTurno();
    await page.goto('/tipos-turno');
    await expect(
      page.getByRole('heading', { name: 'Tipos de turno' }),
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'M-LARGO', exact: true }),
    ).toBeVisible();
  });

  test('listado: 4 filas con sus indicadores', async ({ page }) => {
    for (const c of ['M-LARGO', 'T-NOCHE', 'P-COMERCIAL', 'REFUERZO']) {
      await expect(
        page.getByRole('cell', { name: c, exact: true }),
      ).toBeVisible();
    }
    const noche = page.getByRole('row', { name: /T-NOCHE/ });
    await expect(noche.getByText(/\+1 día/)).toBeVisible();
    await expect(noche.getByLabel('nocturno')).toBeVisible();

    await expect(
      page.getByRole('row', { name: /P-COMERCIAL/ }).getByLabel('partido'),
    ).toBeVisible();

    await expect(
      page.getByRole('row', { name: /REFUERZO/ }).getByText('Obsoleto'),
    ).toBeVisible();
  });

  test('filtros: estado y búsqueda', async ({ page }) => {
    const combo = page.getByRole('combobox');

    // estado = Obsoleto → solo REFUERZO
    await combo.click();
    await page.getByRole('option', { name: 'Obsoleto' }).click();
    await expect(
      page.getByRole('cell', { name: 'REFUERZO', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'M-LARGO', exact: true }),
    ).toBeHidden();

    // estado = Activo → 3 filas, sin REFUERZO
    await combo.click();
    await page.getByRole('option', { name: 'Activo' }).click();
    for (const c of ['M-LARGO', 'T-NOCHE', 'P-COMERCIAL']) {
      await expect(
        page.getByRole('cell', { name: c, exact: true }),
      ).toBeVisible();
    }
    await expect(
      page.getByRole('cell', { name: 'REFUERZO', exact: true }),
    ).toBeHidden();

    // estado = Todos + búsqueda "noche" → solo T-NOCHE
    await combo.click();
    await page.getByRole('option', { name: 'Todos' }).click();
    await page.getByPlaceholder(/Código o nombre/).fill('noche');
    await expect(
      page.getByRole('cell', { name: 'T-NOCHE', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'M-LARGO', exact: true }),
    ).toBeHidden();
    await expect(
      page.getByRole('cell', { name: 'P-COMERCIAL', exact: true }),
    ).toBeHidden();
  });

  test('alta simple: crear T1', async ({ page }) => {
    const dialog = await openCrear(page);
    await fillBasics(dialog, {
      codigo: 'T1',
      nombre: 'Tarde uno',
      inicio: '14:00',
      fin: '22:00',
      total: '480',
      efectiva: '450',
    });
    await btnCrear(dialog).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(
      page.getByRole('cell', { name: 'T1', exact: true }),
    ).toBeVisible();
  });

  test('alta partido: tramos dinámicos (añadir/quitar) + crear', async ({
    page,
  }) => {
    const dialog = await openCrear(page);
    await fillBasics(dialog, {
      codigo: 'P-TEST',
      nombre: 'Partido test',
      inicio: '08:00',
      fin: '19:00',
      total: '480',
      efectiva: '450',
    });

    await dialog.getByRole('checkbox', { name: /Turno partido/ }).click();
    const tramosFs = dialog.locator('fieldset');
    await expect(tramosFs).toBeVisible();

    const addBtn = dialog.getByRole('button', { name: '+ Añadir tramo' });
    const removeBtns = dialog.getByRole('button', { name: /Quitar tramo/ });

    await addBtn.click();
    await addBtn.click();
    await expect(removeBtns).toHaveCount(2);

    const tramoTimes = tramosFs.locator('input[type="time"]');
    await tramoTimes.nth(0).fill('08:00');
    await tramoTimes.nth(1).fill('12:00');
    await tramoTimes.nth(2).fill('15:00');
    await tramoTimes.nth(3).fill('19:00');

    // Probar "quitar tramo": añadir un 3º y eliminarlo.
    await addBtn.click();
    await expect(removeBtns).toHaveCount(3);
    await dialog.getByRole('button', { name: 'Quitar tramo 3' }).click();
    await expect(removeBtns).toHaveCount(2);

    await btnCrear(dialog).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    const row = page.getByRole('row', { name: /P-TEST/ });
    await expect(row).toBeVisible();
    await expect(row.getByLabel('partido')).toBeVisible();
  });

  test('alta nocturna: icono luna en la tabla', async ({ page }) => {
    const dialog = await openCrear(page);
    await fillBasics(dialog, {
      codigo: 'N-TEST',
      nombre: 'Noche test',
      inicio: '22:00',
      fin: '06:00',
      total: '480',
      efectiva: '450',
    });
    await dialog.getByRole('checkbox', { name: 'Turno nocturno' }).click();
    await btnCrear(dialog).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    const row = page.getByRole('row', { name: /N-TEST/ });
    await expect(row).toBeVisible();
    await expect(row.getByLabel('nocturno')).toBeVisible();
  });

  test('validación cliente: el submit queda bloqueado (no se crea nada)', async ({
    page,
  }) => {
    // (a) duración efectiva > total
    let dialog = await openCrear(page);
    await fillBasics(dialog, {
      codigo: 'X1',
      nombre: 'X uno',
      inicio: '08:00',
      fin: '16:00',
      total: '100',
      efectiva: '200',
    });
    await expect(
      dialog.getByText('La duración efectiva no puede superar la total.'),
    ).toBeVisible();
    await expect(btnCrear(dialog)).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    // (b) esPartido sin tramos + (c) tramo inválido (inicio>=fin / fuera de rango)
    dialog = await openCrear(page);
    await fillBasics(dialog, {
      codigo: 'X2',
      nombre: 'X dos',
      inicio: '08:00',
      fin: '16:00',
      total: '480',
      efectiva: '450',
    });
    await dialog.getByRole('checkbox', { name: /Turno partido/ }).click();
    // Con partido activo y sin tramos, el form muestra este aviso y bloquea el
    // submit (el string interno de validación no se renderiza tal cual).
    await expect(
      dialog.getByText('Aún no hay tramos. Añade al menos uno.'),
    ).toBeVisible();
    await expect(btnCrear(dialog)).toBeDisabled();

    await dialog.getByRole('button', { name: '+ Añadir tramo' }).click();
    const t = dialog.locator('fieldset').locator('input[type="time"]');
    await t.nth(0).fill('19:00');
    await t.nth(1).fill('08:00'); // inicio >= fin
    await expect(
      dialog.getByText('El inicio debe ser anterior al fin.'),
    ).toBeVisible();
    await t.nth(0).fill('06:00');
    await t.nth(1).fill('07:00'); // fuera del rango 08:00–16:00
    await expect(dialog.getByText(/Debe estar dentro de/)).toBeVisible();
    await expect(btnCrear(dialog)).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    // (d) color HEX inválido tras blur
    dialog = await openCrear(page);
    await fillBasics(dialog, {
      codigo: 'X3',
      nombre: 'X tres',
      inicio: '08:00',
      fin: '16:00',
      total: '480',
      efectiva: '450',
    });
    await dialog.getByPlaceholder('#FFD700').fill('#zzz');
    await dialog.getByPlaceholder('#FFD700').blur();
    await expect(
      dialog.getByText(/El color debe ser un HEX de 6 dígitos/),
    ).toBeVisible();
    await expect(btnCrear(dialog)).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    // Nada se creó.
    for (const c of ['X1', 'X2', 'X3']) {
      await expect(
        page.getByRole('cell', { name: c, exact: true }),
      ).toHaveCount(0);
    }
  });

  test('unicidad D6.3: código duplicado lo rechaza el backend', async ({
    page,
  }) => {
    const dialog = await openCrear(page);
    await fillBasics(dialog, {
      codigo: 'M-LARGO', // ya existe en el centro
      nombre: 'Duplicado',
      inicio: '08:00',
      fin: '16:00',
      total: '480',
      efectiva: '450',
    });
    await btnCrear(dialog).click();
    // mapCallableError mapea functions/already-exists a este texto (D4.10).
    await expect(
      dialog.getByText('Ya existe un recurso con esos datos.'),
    ).toBeVisible();
    await expect(page.getByRole('dialog')).toBeVisible(); // sigue abierto
    await page.keyboard.press('Escape');
    // No se creó duplicado: sigue habiendo exactamente 1 fila M-LARGO.
    await expect(
      page.getByRole('cell', { name: 'M-LARGO', exact: true }),
    ).toHaveCount(1);
  });

  test('edición: nombre, omit-only sin cambios y tramo', async ({ page }) => {
    // (1) editar nombre de M-LARGO
    await page
      .getByRole('row', { name: /M-LARGO/ })
      .getByRole('button', { name: 'Editar' })
      .click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Editar: M-LARGO')).toBeVisible();
    await dialog.getByPlaceholder(/Mañana largo/).fill('Mañana largo EDIT');
    await btnGuardar(dialog).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(
      page.getByRole('cell', { name: 'Mañana largo EDIT', exact: true }),
    ).toBeVisible();

    // (2) reabrir sin cambios → "No hay cambios" + botón deshabilitado (omit-only)
    await page
      .getByRole('row', { name: /M-LARGO/ })
      .getByRole('button', { name: 'Editar' })
      .click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByText('No hay cambios que guardar.')).toBeVisible();
    await expect(btnGuardar(dialog)).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    // (3) editar un tramo de P-COMERCIAL y verificar que persiste
    await page
      .getByRole('row', { name: /P-COMERCIAL/ })
      .getByRole('button', { name: 'Editar' })
      .click();
    dialog = page.getByRole('dialog');
    let tramoTimes = dialog.locator('fieldset').locator('input[type="time"]');
    await expect(tramoTimes.nth(1)).toHaveValue('11:00'); // fin del 1er tramo seed
    await tramoTimes.nth(1).fill('12:00');
    await btnGuardar(dialog).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // reabrir y comprobar el valor persistido
    await page
      .getByRole('row', { name: /P-COMERCIAL/ })
      .getByRole('button', { name: 'Editar' })
      .click();
    dialog = page.getByRole('dialog');
    tramoTimes = dialog.locator('fieldset').locator('input[type="time"]');
    await expect(tramoTimes.nth(1)).toHaveValue('12:00');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('obsoleto / reactivar (estado binario D5.3)', async ({ page }) => {
    // M-LARGO activo → Marcar obsoleto
    await page
      .getByRole('row', { name: /M-LARGO/ })
      .getByRole('button', { name: 'Marcar obsoleto' })
      .click();
    let dialog = page.getByRole('dialog');
    await expect(
      dialog.getByText('Marcar tipo de turno como obsoleto'),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Marcar obsoleto' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    const mLargo = page.getByRole('row', { name: /M-LARGO/ });
    await expect(mLargo.getByText('Obsoleto')).toBeVisible();
    await expect(mLargo.getByRole('button', { name: 'Reactivar' })).toBeVisible();

    // REFUERZO obsoleto → Reactivar
    await page
      .getByRole('row', { name: /REFUERZO/ })
      .getByRole('button', { name: 'Reactivar' })
      .click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Reactivar tipo de turno')).toBeVisible();
    await dialog.getByRole('button', { name: 'Reactivar' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(
      page.getByRole('row', { name: /REFUERZO/ }).getByText('Activo'),
    ).toBeVisible();
  });
});
