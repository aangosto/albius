export * from './types';
export type { Timestamp, GeoPoint } from './firebase-stubs';
export {
  validateCIF,
  CATEGORIAS_PERMITIDAS,
  REQUIERE_LETRA,
  REQUIERE_NUMERO,
  LETRAS_CONTROL,
} from './validators/cif';
export type { CIFValidationResult, CIFInvalidReason } from './validators/cif';
