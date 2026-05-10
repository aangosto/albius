/**
 * Stubs temporales de los tipos de Firestore.
 *
 * Sustituir por `import { Timestamp, GeoPoint } from 'firebase/firestore';`
 * cuando se integre el SDK de Firebase en el proyecto.
 */

export interface Timestamp {
  toDate(): Date;
  toMillis(): number;
  seconds: number;
  nanoseconds: number;
}

export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
  isEqual(other: GeoPoint): boolean;
}
