import { defineConfig, devices } from '@playwright/test';

/**
 * Configuración Playwright E2E de Albius (B20).
 *
 * PUERTO FIJO: el dev server del usuario cae en un puerto variable (5173/5174/
 * 5175 según lo que esté ocupado). Para que los E2E no dependan de eso,
 * Playwright arranca SU PROPIO dev server en el puerto fijo 5180 (--strictPort)
 * vía `webServer`. baseURL apunta ahí. Con `reuseExistingServer` reutiliza uno
 * ya levantado en 5180 si existe (iteración rápida), pero nunca colisiona con el
 * 5175 del usuario.
 *
 * EMULADORES: prerequisito asumido corriendo (el usuario los mantiene vivos
 * entre bloques). `globalSetup` verifica que están arriba y SIEMBRA datos
 * deterministas en cada run (jefe + tenant + centro + tipos de turno B19). Si
 * los emuladores no están, globalSetup falla con un mensaje claro. Se eligió
 * NO levantarlos desde Playwright porque: (a) el boot de los emuladores es lento
 * y reconstruye functions; (b) el seed necesita un paso aparte de todos modos;
 * (c) el flujo del usuario ya tiene los emuladores como proceso de larga vida.
 *
 * LOGIN: proyecto `setup` (auth.setup.ts) hace login UI una vez y guarda
 * storageState con indexedDB:true (Firebase Auth persiste la sesión en
 * IndexedDB, no en cookies/localStorage). Los proyectos de test dependen de
 * `setup` y arrancan ya autenticados, sin re-loguear en cada test.
 *
 * SERIE (workers:1, fullyParallel:false): los tests comparten la misma BD del
 * emulador y los de Fase 2 mutarán estado (alta/edición/obsoleto). Ejecutar en
 * serie evita carreras sobre datos compartidos.
 */

const PORT = 5180;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  timeout: 30_000,
  // 15s: absorbe la latencia de los callables contra el emulador (incluido algo
  // de cold-start residual pese al warm-up de globalSetup) sin esconder cuelgues.
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      testMatch: /.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/jefe.json',
      },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
