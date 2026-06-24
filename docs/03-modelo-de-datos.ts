/**
 * ============================================================================
 *  MODELO DE DATOS – SaaS Gestión de Turnos para Transporte Urbano
 * ============================================================================
 *
 *  Definición completa de todas las interfaces TypeScript correspondientes
 *  al modelo de datos en Firestore.
 *
 *  Autor: Alberto
 *  Versión: 1.0
 *  Fecha: Mayo 2026
 *
 *  Este archivo es el contrato entre frontend, backend y optimizador.
 *  Cualquier cambio aquí debe propagarse a todos los consumidores.
 *
 *  Convenciones:
 *    - Todos los IDs son strings (autogenerados o compuestos según colección).
 *    - Las fechas usan el tipo Timestamp de Firestore.
 *    - Los campos opcionales se marcan con `?`.
 *    - Los enums se definen como union types para facilitar autocompletado.
 * ============================================================================
 */

import { Timestamp, GeoPoint } from "firebase/firestore";

// ============================================================================
//  TIPOS BASE Y ENUMS
// ============================================================================

export type Rol = "super_admin" | "jefe_trafico" | "conductor";

export type EstadoTenant = "activo" | "suspendido" | "cancelado";

export type PlanTenant = "basico" | "pro" | "enterprise";

export type EstadoCentro = "activo" | "inactivo";

export type EstadoUsuario = "activo" | "suspendido";

export type EstadoConductor =
  | "activo"
  | "baja_temporal"
  | "vacaciones"
  | "baja_definitiva";

export type CategoriaConductor = "conductor"; // Solo en MVP. Más adelante: interventor, inspector, taller...

export type EstadoLinea = "activa" | "inactiva" | "suspendida";

export type EstadoParada = "activa" | "fuera_servicio";

export type TipoDia = "laborable" | "sabado" | "domingo" | "festivo";

export type SentidoLinea = "ida" | "vuelta" | "ambos";

export type TipoFranjaTurno = "mañana" | "tarde" | "nocturno" | "partido";

export type EstadoTipoTurno = "activo" | "obsoleto";

export type EstadoServicio =
  | "programado"
  | "en_curso"
  | "completado"
  | "cancelado";

export type EstadoCuadrante = "borrador" | "publicado" | "cerrado";

export type ModoGeneracion =
  | "optimizador_libre"
  | "optimizador_subgrupos"
  | "optimizador_clasico"
  | "manual";

export type TipoAsignacion =
  | "turno"
  | "reserva_presencial"
  | "reserva_localizable"
  | "libre"
  | "vacaciones"
  | "baja";

export type EstadoAsignacion =
  | "planificada"
  | "en_curso"
  | "completada"
  | "cancelada";

export type TipoCambio = "creacion" | "modificacion" | "eliminacion";

export type OrigenCambio =
  | "manual"
  | "optimizador"
  | "intercambio"
  | "regeneracion";

export type TurnoPreferido = "mañana" | "tarde" | "indiferente";

export type TipoDescansoPreferido = "alterno" | "consecutivo" | "indiferente";

export type DescansoCambioPreferido = "preferir" | "indiferente";

export type TipoPreferenciaPuntual =
  | "dia_libre_preferido"
  | "turno_preferido_mensual"
  | "observacion";

export type EstadoPreferenciaPuntual =
  | "activa"
  | "satisfecha"
  | "no_satisfecha"
  | "cancelada";

export type EstadoSolicitudIntercambio =
  | "pendiente_destino"
  | "aceptada_destino"
  | "aprobada"
  | "rechazada_destino"
  | "rechazada_jefe"
  | "ejecutada"
  | "cancelada";

export type TipoIncidencia =
  | "baja_medica"
  | "ausencia"
  | "retraso"
  | "averia"
  | "otro";

export type EstadoIncidencia =
  | "abierta"
  | "en_curso"
  | "resuelta"
  | "cerrada";

export type AmbitoFestivo =
  | "nacional"
  | "autonomico"
  | "provincial"
  | "local"
  | "empresa";

export type TipoTraficoFestivo = "festivo" | "domingo" | "laborable";

export type CanalNotificacion = "app" | "email" | "push" | "whatsapp";

export type EstadoNotificacion = "pendiente" | "enviada" | "leida" | "error";

export type TipoNotificacion =
  | "cuadrante_publicado"
  | "cambio_turno"
  | "intercambio_aprobado"
  | "solicitud_recibida"
  | "preferencia_pendiente"
  | "otro";

export type ResultadoAuditoria = "ok" | "error" | "denegado";

// ============================================================================
//  4.1  TENANTS – Empresas cliente del SaaS
// ============================================================================

export interface Tenant {
  id: string;
  nombre: string;
  nombreComercial?: string;
  cif: string;
  comunidadAutonoma: string;
  provincia: string;
  plan: PlanTenant;
  estado: EstadoTenant;
  fechaAlta: Timestamp;
  fechaCancelacion?: Timestamp;
  configuracion: {
    zonaHoraria: string; // "Europe/Madrid"
    idioma: string; // "es"
    [key: string]: unknown;
  };
  logoUrl?: string;
}

// ============================================================================
//  4.2  CENTROS – Centros operativos dentro de cada tenant
// ============================================================================

export interface Centro {
  id: string;
  tenantId: string;
  nombre: string;
  direccion?: string;
  ciudad: string;
  provincia: string;
  coordenadas?: GeoPoint;
  estado: EstadoCentro;
  fechaCreacion: Timestamp;
}

// ============================================================================
//  4.3  USUARIOS – Personas con acceso a la aplicación
// ============================================================================

export interface Usuario {
  id: string; // Coincide con el UID de Firebase Auth
  email: string;
  nombreCompleto: string;
  telefono?: string;
  rol: Rol;
  tenantId?: string; // null si super_admin
  centroId?: string; // null si super_admin
  conductorId?: string; // Solo si rol = conductor
  estado: EstadoUsuario;
  fechaCreacion: Timestamp;
  ultimoLogin?: Timestamp;
  tokensFCM?: string[]; // Tokens de dispositivos para push notifications
}

// ============================================================================
//  4.4  CONDUCTORES – Perfil operativo del conductor
// ============================================================================

export interface Conductor {
  id: string;
  tenantId: string;
  centroId: string;
  usuarioId?: string;
  numeroEmpleado?: string;
  nombre: string;
  apellidos: string;
  dni: string;
  telefono?: string;
  email?: string;
  categoria: CategoriaConductor;
  fechaAntiguedad: Timestamp;
  fechaIncorporacion: Timestamp;
  fechaBaja?: Timestamp;
  estado: EstadoConductor;
  lineasPreferentes: string[]; // IDs de líneas
  lineasSecundarias: string[]; // IDs de líneas
  tiposTurnoPermitidos: string[]; // IDs de tipos de turno
  tiposTurnoExcluidos?: string[]; // IDs de tipos de turno
  maxHorasSemanales?: number; // Override del estándar del convenio
  puedeSerReserva: boolean;
  observaciones?: string;
}

// ============================================================================
//  4.5  LINEAS – Líneas de transporte
// ============================================================================

export interface Linea {
  id: string;
  tenantId: string;
  centroId: string;
  codigo: string; // "L5", "N1"
  nombre: string;
  color: string; // HEX format: "#1F77B4"
  esNocturna: boolean;
  paradasIda: string[]; // IDs de paradas en orden
  paradasVuelta: string[]; // IDs de paradas en orden
  estado: EstadoLinea;
  fechaCreacion: Timestamp;
}

// ============================================================================
//  4.6  PARADAS – Paradas de transporte (entidades reutilizables)
// ============================================================================

export interface Parada {
  id: string;
  tenantId: string;
  centroId: string;
  codigo?: string;
  nombre: string;
  direccion?: string;
  coordenadas?: GeoPoint;
  lineas: string[]; // IDs de líneas que la usan
  estado: EstadoParada;
}

// ============================================================================
//  4.7  FRECUENCIAS – Frecuencias estándar por línea y tramo
// ============================================================================

export interface Frecuencia {
  id: string;
  tenantId: string;
  centroId: string;
  lineaId: string;
  tipoDia: TipoDia;
  horaInicio: string; // "HH:mm"
  horaFin: string; // "HH:mm"
  intervaloMinutos: number;
  sentido: SentidoLinea;
  fechaInicio?: Timestamp; // null = vigente desde siempre
  fechaFin?: Timestamp; // null = vigente
}

// ============================================================================
//  4.8  FRECUENCIAS_EXCEPCIONALES – Frecuencias para días puntuales
// ============================================================================

export interface FrecuenciaExcepcional {
  id: string;
  tenantId: string;
  centroId: string;
  lineaId: string;
  fecha: Timestamp;
  horaInicio: string; // "HH:mm"
  horaFin: string; // "HH:mm"
  intervaloMinutos: number;
  sentido: SentidoLinea;
  motivo?: string;
  creadoPor: string; // user ID
  fechaCreacion: Timestamp;
}

// ============================================================================
//  4.9  TIPOS_TURNO – Plantillas de turno definidas por la empresa
// ============================================================================

export interface TramoPartido {
  inicio: string; // "HH:mm"
  fin: string; // "HH:mm"
}

export interface TipoTurno {
  id: string;
  tenantId: string;
  centroId?: string; // null = aplica a todos los centros del tenant
  codigo: string; // "M-LARGO"
  nombre: string;
  horaInicio: string; // "HH:mm"
  horaFin: string; // "HH:mm"
  duracionMinutos: number;
  duracionEfectivaMinutos: number;
  esPartido: boolean;
  tramosPartido?: TramoPartido[];
  tipoFranja: TipoFranjaTurno;
  estado: EstadoTipoTurno;
  fechaCreacion: Timestamp;
}

// ============================================================================
//  4.10  SERVICIOS – Servicios materializados (solo los necesarios)
// ============================================================================

export interface AsignacionTramo {
  conductorId: string;
  asignacionId: string; // Documento en colección "asignaciones"
  desdeHora: string; // "HH:mm"
  hastaHora: string; // "HH:mm"
}

export interface Servicio {
  id: string; // Compuesto: srv_{lineaId}_{fecha}_{horaSalida}
  tenantId: string;
  centroId: string;
  lineaId: string;
  fecha: Timestamp;
  horaSalida: string; // "HH:mm"
  horaLlegadaEstimada: string; // "HH:mm"
  sentido: "ida" | "vuelta";
  duracionMinutos: number;
  estado: EstadoServicio;
  asignaciones?: AsignacionTramo[]; // Soporta relevos en línea
  incidencia?: string; // ID de incidencia si aplica
}

// ============================================================================
//  4.11  CUADRANTES – Metadatos del cuadrante mensual
// ============================================================================

export interface EstadisticasCuadrante {
  coberturaServicios: number; // Porcentaje
  satisfaccionMedia: number; // Porcentaje
  preferenciasCumplidas: number;
  preferenciasNoCumplidas: number;
  [key: string]: number;
}

export interface Cuadrante {
  id: string; // Compuesto: cua_{centroId}_{año}_{mes}
  tenantId: string;
  centroId: string;
  año: number;
  mes: number; // 1-12
  estado: EstadoCuadrante;
  versionActual: number;
  fechaGeneracion: Timestamp;
  fechaPublicacion?: Timestamp;
  ultimaModificacion: Timestamp;
  generadoPor: string; // user ID
  publicadoPor?: string; // user ID
  modoGeneracion: ModoGeneracion;
  estadisticas?: EstadisticasCuadrante;
}

// ============================================================================
//  4.12  VERSIONES_CUADRANTE – Snapshots de versiones publicadas
// ============================================================================

export interface VersionCuadrante {
  id: string;
  tenantId: string;
  cuadranteId: string;
  version: number;
  fecha: Timestamp;
  publicadoPor: string; // user ID
  motivo: string;
  asignacionesSnapshot: Asignacion[] | string; // Array directo o URL a Cloud Storage si excede 1MB
  numeroAsignaciones: number;
  cambiosDesdeAnterior: number;
}

// ============================================================================
//  4.13  ASIGNACIONES – Asignación efectiva conductor-turno-día
// ============================================================================

export interface TramoServicio {
  servicioId: string;
  lineaId: string;
  desdeHora: string; // "HH:mm"
  hastaHora: string; // "HH:mm"
}

export interface Asignacion {
  id: string;
  tenantId: string;
  centroId: string;
  cuadranteId: string;
  conductorId: string;
  fecha: Timestamp;
  tipoTurnoId?: string; // null si turno personalizado
  horaInicio: string; // "HH:mm"
  horaFin: string; // "HH:mm"
  tipoAsignacion: TipoAsignacion;
  tramosServicio?: TramoServicio[];
  esIntercambiada: boolean;
  intercambioId?: string;
  estado: EstadoAsignacion;
  fechaCreacion: Timestamp;
  ultimaModificacion: Timestamp;
}

// ============================================================================
//  4.14  CAMBIOS_ASIGNACIONES – Log de cambios estilo Git
// ============================================================================

export interface CambioAsignacion {
  id: string;
  tenantId: string;
  cuadranteId: string;
  version: number;
  asignacionId: string;
  tipoCambio: TipoCambio;
  fecha: Timestamp;
  usuarioId: string;
  motivo: string;
  valorAnterior?: Partial<Asignacion>;
  valorNuevo?: Partial<Asignacion>;
  origen: OrigenCambio;
}

// ============================================================================
//  4.15  PREFERENCIAS_PERMANENTES – Preferencias generales del conductor
// ============================================================================

export interface PreferenciaPermanente {
  id: string; // Coincide con conductorId
  tenantId: string;
  conductorId: string;
  turnoPreferido: TurnoPreferido;
  tipoDescansoPreferido: TipoDescansoPreferido;
  descansoTrasTardeManana: DescansoCambioPreferido;
  descansoTrasMananaTarde: DescansoCambioPreferido;
  fechaActualizacion: Timestamp;
}

// ============================================================================
//  4.16  PREFERENCIAS_PUNTUALES – Días concretos a librar (vista 12 meses)
// ============================================================================

export interface PreferenciaPuntual {
  id: string;
  tenantId: string;
  conductorId: string;
  tipo: TipoPreferenciaPuntual;
  fecha?: Timestamp; // Para tipo = dia_libre_preferido
  mes?: number; // Para tipo = turno_preferido_mensual
  año?: number;
  valor?: string;
  prioridad: 1 | 2 | 3; // 1=baja, 2=media, 3=alta
  comentario?: string;
  estado: EstadoPreferenciaPuntual;
  fechaCreacion: Timestamp;
}

// ============================================================================
//  4.17  SOLICITUDES_INTERCAMBIO – Intercambios entre conductores
// ============================================================================

export interface ValidacionAutomaticaIntercambio {
  descansoOk: boolean;
  horasOk: boolean;
  lineasOk: boolean;
  turnosCompatibles: boolean;
  mensajes?: string[];
}

export interface SolicitudIntercambio {
  id: string;
  tenantId: string;
  centroId: string;
  conductorOrigenId: string;
  conductorDestinoId: string;
  asignacionOrigenId: string;
  asignacionDestinoId: string;
  estado: EstadoSolicitudIntercambio;
  validacionAutomatica: ValidacionAutomaticaIntercambio;
  motivoOrigen?: string;
  comentarioDestino?: string;
  comentarioJefe?: string;
  fechaCreacion: Timestamp;
  fechaRespuestaDestino?: Timestamp;
  fechaRespuestaJefe?: Timestamp;
  jefeAprobadorId?: string;
}

// ============================================================================
//  4.18  INCIDENCIAS – Bajas, ausencias y eventos imprevistos
// ============================================================================

export interface Incidencia {
  id: string;
  tenantId: string;
  centroId: string;
  tipo: TipoIncidencia;
  conductorId?: string;
  asignacionId?: string;
  fechaInicio: Timestamp;
  fechaFinPrevista?: Timestamp;
  fechaFinReal?: Timestamp;
  estado: EstadoIncidencia;
  descripcion?: string;
  registradaPor: string; // user ID
  fechaRegistro: Timestamp;
  asignacionesAfectadas?: string[];
  asignacionesResultantes?: string[];
}

// ============================================================================
//  4.19  FESTIVOS – Calendario de festivos
// ============================================================================

export interface Festivo {
  id: string;
  tenantId: string;
  centroId?: string; // null = todos los centros del tenant
  fecha: Timestamp;
  nombre: string;
  ambito: AmbitoFestivo;
  tipoTraficoAplicable: TipoTraficoFestivo;
  esEditable: boolean;
  creadoPor?: string;
  fechaCreacion: Timestamp;
}

// ============================================================================
//  4.20  CONVENIO – Reglas legales configurables por CENTRO (singleton)
// ============================================================================
//  Migrado de POR-TENANT a POR-CENTRO en B25 (§10). Singleton: id = centroId.

export interface Convenio {
  id: string; // Coincide con centroId (singleton: exactamente uno por centro)
  centroId: string; // = id; el centro al que aplica el convenio
  tenantId: string; // denormalizado (scoping de reglas / queries)
  convenioReferencia?: string;
  descansoMinimoEntreJornadasHoras: number;
  maxHorasSemanales: number;
  maxHorasAnuales: number;
  minDomingosLibresAño: number;
  maxFinesSemanaConsecutivosTrabajados: number;
  maxDiasConsecutivosTrabajados: number;
  descansoSemanalMinimoHoras: number;
  antelacionMinimaPublicacionDias: number;
  horasFestivoComputanComoExtras: boolean;
  computoHoras?: 'jornada' | 'conduccion'; // R3 spike: jornada total vs conducción efectiva
  // --- Auditoría canónica D6.4 (opcionales) ---
  creadoPor?: string;
  creadoEn?: Timestamp;
  actualizadoPor?: string;
  actualizadoEn?: Timestamp;
}

// ============================================================================
//  4.21  NOTIFICACIONES – Histórico de notificaciones enviadas
// ============================================================================

export interface Notificacion {
  id: string;
  tenantId: string;
  destinatarioId: string; // user ID
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  datosContexto?: Record<string, unknown>;
  canales: CanalNotificacion[];
  estado: EstadoNotificacion;
  fechaCreacion: Timestamp;
  fechaEnvio?: Timestamp;
  fechaLectura?: Timestamp;
  errorMensaje?: string;
}

// ============================================================================
//  4.22  AUDIT_LOGS – Registro general de acciones críticas
// ============================================================================

export interface AuditLog {
  id: string;
  tenantId?: string; // null en acciones globales del super admin
  usuarioId: string;
  rolEnElMomento: Rol;
  accion: string;
  entidadAfectada?: string;
  entidadId?: string;
  detalles?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  resultado: ResultadoAuditoria;
  fecha: Timestamp;
}

// ============================================================================
//  CONSTANTES DE COLECCIONES – Para evitar typos en queries
// ============================================================================

export const COLLECTIONS = {
  TENANTS: "tenants",
  CENTROS: "centros",
  USUARIOS: "usuarios",
  CONDUCTORES: "conductores",
  LINEAS: "lineas",
  PARADAS: "paradas",
  FRECUENCIAS: "frecuencias",
  FRECUENCIAS_EXCEPCIONALES: "frecuencias_excepcionales",
  TIPOS_TURNO: "tipos_turno",
  SERVICIOS: "servicios",
  CUADRANTES: "cuadrantes",
  VERSIONES_CUADRANTE: "versiones_cuadrante",
  ASIGNACIONES: "asignaciones",
  CAMBIOS_ASIGNACIONES: "cambios_asignaciones",
  PREFERENCIAS_PERMANENTES: "preferencias_permanentes",
  PREFERENCIAS_PUNTUALES: "preferencias_puntuales",
  SOLICITUDES_INTERCAMBIO: "solicitudes_intercambio",
  INCIDENCIAS: "incidencias",
  FESTIVOS: "festivos",
  CONVENIO: "convenio",
  NOTIFICACIONES: "notificaciones",
  AUDIT_LOGS: "audit_logs",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
