import { test as setup, expect } from '@playwright/test';

/**
 * Proyecto `setup`: login UI real como jefe de tráfico y persistencia de la
 * sesión en storageState (B20). Los proyectos de test dependen de este y
 * arrancan ya autenticados.
 *
 * indexedDB:true es CLAVE: Firebase Auth Web SDK guarda la sesión en IndexedDB
 * (firebaseLocalStorageDb), NO en cookies/localStorage. Sin esa opción el
 * storageState no capturaría la sesión y los tests caerían en /login.
 * (Soportado desde Playwright 1.51; aquí 1.61.)
 *
 * Esperas explícitas (no sleeps): waitForURL al dashboard + el link de la
 * sidebar visible garantizan que onAuthStateChanged hidrató el rol antes de
 * volcar el estado.
 */

const AUTH_FILE_JEFE = 'e2e/.auth/jefe.json';
const AUTH_FILE_ADMIN = 'e2e/.auth/admin.json';

setup('login como jefe de tráfico', async ({ page }) => {
  await page.goto('/login');

  await page.locator('input[type="email"]').fill('jefe@albius.local');
  await page.locator('input[type="password"]').fill('albius123');
  await page.getByRole('button', { name: 'Entrar' }).click();

  // El login redirige al home del rol (jefe → /dashboard).
  await page.waitForURL('**/dashboard');
  // La sidebar solo se pinta con user.rol hidratado: prueba de sesión completa.
  await expect(
    page.getByRole('link', { name: 'Tipos de turno' }),
  ).toBeVisible();

  await page.context().storageState({ path: AUTH_FILE_JEFE, indexedDB: true });
});

// super_admin: el alta de conductor (con los pickers de B21) vive en el flujo
// de Usuarios (UsuariosPage, super_admin only). Los specs de B21 usan este
// storageState vía test.use.
setup('login como super_admin', async ({ page }) => {
  await page.goto('/login');

  await page.locator('input[type="email"]').fill('admin@albius.local');
  await page.locator('input[type="password"]').fill('albius123');
  await page.getByRole('button', { name: 'Entrar' }).click();

  await page.waitForURL('**/dashboard');
  // El super_admin ve la sección Gobierno (link Usuarios).
  await expect(page.getByRole('link', { name: 'Usuarios' })).toBeVisible();

  await page.context().storageState({ path: AUTH_FILE_ADMIN, indexedDB: true });
});
