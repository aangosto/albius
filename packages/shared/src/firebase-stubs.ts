/**
 * Re-export de los tipos base de Firestore.
 *
 * Centraliza en un único módulo la dependencia de `firebase/firestore` para
 * los tipos del modelo. Si en el futuro se cambia el SDK o se requiere mockear
 * en tests, este es el único punto a tocar.
 *
 * El nombre del fichero se mantiene por compatibilidad con el import en
 * `types.ts`; ya no contiene stubs propios.
 */
export type { Timestamp, GeoPoint } from 'firebase/firestore';
