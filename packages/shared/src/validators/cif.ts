/**
 * Validador de CIF español (categoría + dígito control).
 *
 * Referencia: BOE — Real Decreto 1065/2007, anexo VI.
 *
 * SI MODIFICAS ESTE ARCHIVO, ACTUALIZA TAMBIÉN LAS COPIAS:
 *   - packages/shared/src/validators/cif.ts   (este archivo, canónico aspiracional)
 *   - apps/functions/src/cif-validator.ts     (consumido por callables del backend)
 *   - apps/web/src/lib/validators/cif.ts      (consumido por forms del frontend)
 *
 * Pendiente consolidación en @albius/shared cuando cierre
 * TODO[refactor-shared-build] (origen sub-bloque 3.2.c).
 * Ver TODO[validar-cif-consolidar-shared] en CLAUDE.md §12.
 *
 * Patrón establecido por D4.4: validators de dominio puros (sin
 * dependencias externas) reusables frontend/backend. Para CIF, el
 * gate del backend admite escape hatch (forzarCIF + flag de
 * auditoría cifValidacionForzada en Tenant). Ver D4.4 en §13.
 */

export type CIFInvalidReason =
  | 'empty'
  | 'length'
  | 'category-letter'
  | 'digits'
  | 'control-mismatch';

export interface CIFValidationResult {
  valid: boolean;
  reason?: CIFInvalidReason;
  /**
   * CIF tras `trim().toUpperCase()`. Presente siempre que el input
   * haya sido un string no vacío, incluso cuando valid=false (excepto
   * para reason='empty'). Permite al callable persistir la forma
   * canónica del CIF (D4.4: backend normaliza, frontend muestra normalizado).
   */
  normalized?: string;
}

// Letras de categoría organizativa permitidas (anexo VI RD 1065/2007).
export const CATEGORIAS_PERMITIDAS: ReadonlySet<string> = new Set([
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'J',
  'N',
  'P',
  'Q',
  'R',
  'S',
  'U',
  'V',
  'W',
]);

// Categorías cuyo dígito de control DEBE ser letra (A-J).
export const REQUIERE_LETRA: ReadonlySet<string> = new Set([
  'P',
  'Q',
  'R',
  'S',
  'W',
  'N',
]);

// Categorías cuyo dígito de control DEBE ser número (0-9).
export const REQUIERE_NUMERO: ReadonlySet<string> = new Set([
  'A',
  'B',
  'E',
  'H',
]);

// Resto de categorías (C, D, F, G, J, U, V) admiten ambos.

// Mapa índice (0-9) → letra de control equivalente.
export const LETRAS_CONTROL = 'JABCDEFGHI';

/**
 * Valida un CIF español.
 *
 * Acepta cualquier string; normaliza (trim + toUpperCase) antes de validar.
 * No lanza: devuelve `{ valid, reason?, normalized? }`.
 *
 * Reglas:
 *   - Longitud exacta 9.
 *   - Primer carácter: letra de categoría permitida.
 *   - Caracteres 2-8: exactamente 7 dígitos.
 *   - Carácter 9: dígito de control.
 *
 * Cálculo del control (BOE RD 1065/2007 anexo VI):
 *   - Dígitos en posiciones PARES del CIF (2, 4, 6, 8 con la letra
 *     inicial como pos 1) → digitos[0], digitos[2], digitos[4], digitos[6].
 *     Cada uno se MULTIPLICA POR 2 y se suman las cifras del resultado
 *     (si producto >= 10, dividir/sumar; equivalentemente: `(2d) % 9` con
 *     ajuste para 0).
 *   - Dígitos en posiciones IMPARES del CIF (3, 5, 7) → digitos[1],
 *     digitos[3], digitos[5]. SE SUMAN tal cual.
 *   - total = sumaPares_doblados + sumaImpares_directa.
 *   - controlNum = (10 - (total mod 10)) mod 10  (esperado como dígito 0-9).
 *   - controlLetra = LETRAS_CONTROL[controlNum]  (equivalente como letra).
 *
 * Validación del control según categoría:
 *   - REQUIERE_NUMERO: el carácter 9 debe ser exactamente `String(controlNum)`.
 *   - REQUIERE_LETRA: el carácter 9 debe ser exactamente `controlLetra`.
 *   - Flexible (resto): el carácter 9 admite cualquiera de los dos.
 */
export function validateCIF(input: string): CIFValidationResult {
  if (typeof input !== 'string') {
    return { valid: false, reason: 'empty' };
  }
  const normalized = input.trim().toUpperCase();
  if (normalized.length === 0) {
    return { valid: false, reason: 'empty' };
  }
  if (normalized.length !== 9) {
    return { valid: false, reason: 'length', normalized };
  }

  const categoria = normalized.charAt(0);
  if (!CATEGORIAS_PERMITIDAS.has(categoria)) {
    return { valid: false, reason: 'category-letter', normalized };
  }

  const digitos = normalized.slice(1, 8);
  if (!/^\d{7}$/.test(digitos)) {
    return { valid: false, reason: 'digits', normalized };
  }

  const control = normalized.charAt(8);

  // Posiciones PARES del CIF (2, 4, 6, 8) — duplicar y sumar cifras.
  let sumaParesDoblados = 0;
  for (const idx of [0, 2, 4, 6] as const) {
    const valor = Number(digitos.charAt(idx));
    const doblado = valor * 2;
    sumaParesDoblados +=
      doblado < 10 ? doblado : Math.floor(doblado / 10) + (doblado % 10);
  }

  // Posiciones IMPARES del CIF (3, 5, 7) — suma directa.
  let sumaImparesDirecta = 0;
  for (const idx of [1, 3, 5] as const) {
    sumaImparesDirecta += Number(digitos.charAt(idx));
  }

  const total = sumaParesDoblados + sumaImparesDirecta;
  const controlNum = (10 - (total % 10)) % 10;
  const controlLetra = LETRAS_CONTROL.charAt(controlNum);

  if (REQUIERE_NUMERO.has(categoria)) {
    if (control !== String(controlNum)) {
      return { valid: false, reason: 'control-mismatch', normalized };
    }
  } else if (REQUIERE_LETRA.has(categoria)) {
    if (control !== controlLetra) {
      return { valid: false, reason: 'control-mismatch', normalized };
    }
  } else {
    // Categorías flexibles: C, D, F, G, J, U, V.
    if (control !== String(controlNum) && control !== controlLetra) {
      return { valid: false, reason: 'control-mismatch', normalized };
    }
  }

  return { valid: true, normalized };
}
