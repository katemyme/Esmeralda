// Lo que la API responde en las pantallas de la base (F1). Los nombres van en snake_case, igual
// que en el backend; los montos llegan como texto ("650.00") y las fechas como texto ISO.

export interface Sucursal {
  id: number;
  codigo: string;
  nombre: string;
}

export interface Equipo {
  id: string;
  nombre: string;
  /** CAJA, TABLET o MOVIL. */
  tipo: string;
  caja_id: number | null;
  sucursal: Sucursal;
}

export type EstadoPin = 'SIN_PIN' | 'ACTIVO' | 'BLOQUEADO';

export interface Usuario {
  id: number;
  nombre_completo: string;
  username: string;
  rol: { codigo: string; nombre: string };
  debe_cambiar_password: boolean;
  /** Solo los permisos que valen en esta sesión (desde el celular son menos). */
  permisos: string[];
  sucursales: Sucursal[];
  pin: EstadoPin;
}

/** COMPLETO: un equipo registrado de su sucursal, o el administrador. CELULAR: sin equipo registrado. */
export type Acceso = 'COMPLETO' | 'CELULAR';

export interface DatosSesion {
  usuario: Usuario;
  equipo: Equipo | null;
  acceso: Acceso;
  pantalla_bloqueo_minutos: number;
}

/** Respuesta de login, de entrar con PIN, de refresh y de cambiar la contraseña. */
export interface RespuestaSesion extends DatosSesion {
  access_token: string;
  token_type: 'Bearer';
  expira_en: number;
  sesion_expira_at: string;
}

/** La pantalla de bloqueo de un equipo registrado. */
export interface PantallaPin {
  equipo: Equipo | null;
  abierto: boolean;
  usuarios: { id: number; nombre_completo: string; pin_bloqueado: boolean }[];
}

export interface Alerta {
  id: number;
  tipo: string;
  titulo: string;
  detalle: Record<string, unknown>;
  sucursal: Sucursal | null;
  creada_at: string;
  atendida_at: string | null;
  atendida_por: { id: number; nombre_completo: string } | null;
}

export interface ListaAlertas {
  alertas: Alerta[];
  total_pendientes: number;
}

export interface SucursalConCajas extends Sucursal {
  tipo: string;
  activa: boolean;
  cajas: { id: number; nombre: string; activa: boolean }[];
}

/** El turno abierto de la caja de la sesión. Nunca trae montos: el arqueo es a ciegas. */
export interface TurnoActual {
  id: number;
  sucursal: Sucursal;
  caja: { id: number; nombre: string };
  abierto_por: { id: number; nombre_completo: string };
  fecha_apertura: string;
}

export interface TipoCambio {
  fecha: string;
  usd_a_nio: string;
  es_de_hoy: boolean;
}
