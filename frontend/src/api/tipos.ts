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
  /** Ya hubo un conteo de cierre que no cuadró: el siguiente debe llevar justificación. */
  cierre_pide_justificacion: boolean;
}

export interface MovimientoCaja {
  id: number;
  /** INGRESO o EGRESO. */
  tipo: string;
  moneda: 'NIO' | 'USD';
  monto: string;
  motivo: string;
  usuario: { id: number; nombre_completo: string };
  fecha: string;
}

export interface Denominacion {
  moneda: 'NIO' | 'USD';
  valor: string;
  /** BILLETE o MONEDA. */
  tipo: string;
}

export interface MetodoPago {
  codigo: string;
  nombre: string;
  es_efectivo: boolean;
  requiere_referencia: boolean;
}

export interface MontoPorMetodo {
  metodo: string;
  moneda: string;
  monto: string;
}

/**
 * El ticket de cierre. Quien cierra recibe lo que contó, lo que retiró y el fondo; lo vendido y lo
 * cobrado solo llegan a quien puede ver las diferencias. Nunca trae lo esperado.
 */
export interface TicketCierre {
  turno_id: number;
  sucursal: string;
  caja: string;
  abierto_por: string;
  apertura: string;
  cerrado_por: string | null;
  cierre: string | null;
  cierre_forzado: boolean;
  contado?: MontoPorMetodo[];
  retiro_nio?: string;
  retiro_usd?: string;
  fondo_siguiente_nio?: string;
  fondo_siguiente_usd?: string;
  ventas?: number;
  total_vendido?: string;
  cobros?: MontoPorMetodo[];
}

/** Un turno en el historial: solo para quien tiene CAJA_VER_DIFERENCIAS. */
export interface TurnoResumen {
  id: number;
  sucursal: Sucursal;
  caja: { id: number; nombre: string };
  estado: string;
  abierto_por: { id: number; nombre_completo: string };
  fecha_apertura: string;
  cerrado_por: { id: number; nombre_completo: string } | null;
  fecha_cierre: string | null;
  cierre_forzado: boolean;
  ventas: number;
  total_vendido: string;
  diferencia_nio: string | null;
  diferencia_usd: string | null;
  retiro_nio: string | null;
  retiro_usd: string | null;
  intentos_cierre: number;
  justificacion_diferencia: string | null;
}

export interface TurnoDetalle extends TurnoResumen {
  arqueo: {
    metodo: { codigo: string; nombre: string };
    moneda: string;
    esperado: string;
    contado: string | null;
    diferencia: string | null;
  }[];
  movimientos: MovimientoCaja[];
}

/** Lo que devuelve la búsqueda de productos (la de la venta y la de precios y existencias). */
export interface VarianteEncontrada {
  id: number;
  sku: string;
  codigo_barras: string | null;
  producto: string;
  variante: string;
  categoria: string;
  /** PRODUCTO, SERVICIO o PAQUETE. */
  tipo: string;
  /** null en los paquetes: su precio depende de la pieza. */
  precio: string | null;
  /** Existencias en la sucursal; null en servicios y paquetes. */
  stock: number | null;
  gama: string | null;
}

export interface ExistenciaUbicacion {
  sucursal_id: number;
  sucursal: string;
  tipo: string;
  /** null: de la bodega solo se sabe si hay o no. */
  cantidad: number | null;
  disponible?: boolean;
}

/** Un renglón de un ticket, tal como lo entrega la API para la impresora por USB. */
export type Renglon =
  | { tipo: 'texto'; texto: string; centrado?: boolean; negrita?: boolean; grande?: boolean }
  | { tipo: 'par'; izquierda: string; derecha: string; negrita?: boolean }
  | { tipo: 'qr'; contenido: string }
  | { tipo: 'linea' }
  | { tipo: 'espacio' };

export interface TipoCambio {
  fecha: string;
  usd_a_nio: string;
  es_de_hoy: boolean;
}
