import { defineConfig } from 'vitest/config';

// Config mínima del primer runner de tests unitarios del proyecto (B27).
// Solo cubre las funciones puras de @albius/shared (calendar, validators).
// shared se sigue distribuyendo como TS crudo (TODO[refactor-shared-build]);
// vitest es exclusivamente dev (no afecta al build ni al runtime).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
