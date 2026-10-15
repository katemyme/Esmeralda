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

/** El tipo de cambio vigente: se queda fijo, día tras día, hasta que el administrador lo cambia. */
export interface TipoCambio {
  /** Desde qué día rige. */
  fecha: string;
  usd_a_nio: string;
  /** null: el valor de los datos iniciales (no lo puso nadie). */
  registrado_por: { id: number; nombre_completo: string } | null;
}

/** Lo que responde una ruta `.../imprimir?formato=renglones`: el ticket para la impresora por USB. */
export interface TicketEnRenglones {
  /** 1 = original; de 2 en adelante, copia. */
  impresion: number;
  renglones: Renglon[];
  /** La impresora debe abrir la gaveta junto con el ticket (parámetro IMPRESION_ABRIR_GAVETA). */
  abrir_gaveta: boolean;
}

/** Una caja con turno abierto donde puede entrar una venta hecha sin equipo registrado. */
export interface CajaAbierta {
  turno_id: number;
  caja: { id: number; nombre: string };
  sucursal: Sucursal;
}

/** Una perforación: se vende sola (servicio) o con pieza (paquete). */
export interface Perforacion {
  id: number;
  codigo: string;
  nombre: string;
  /** Cuántas piezas lleva su paquete. */
  piezas_por_paquete: number;
  activa: boolean;
  servicio_variante_id: number;
  paquete_variante_id: number;
  precio_servicio: string;
}

export interface PrecioPaquete {
  precio: string;
  /** ESPECIAL, TABLA_GAMA o SERVICIO_MAS_PIEZA. */
  regla: string;
  detalle: string;
}

/** Una promoción activa y vigente hoy, con lo que rebajaría del subtotal que se le preguntó. */
export interface PromocionDisponible {
  id: number;
  nombre: string;
  /** PORCENTAJE o MONTO. */
  tipo: string;
  valor: string;
  compra_minima: string;
  /** false: el subtotal no llega a la compra mínima. */
  aplica: boolean;
  descuento: string | null;
}

/** Una venta en las listas. La lista nunca trae sumas: el arqueo es a ciegas. */
export interface VentaResumen {
  id: number;
  /** Número de factura (LAM-00000012). */
  numero: string;
  fecha: string;
  /** COMPLETADA o ANULADA. */
  estado: string;
  sucursal: Sucursal;
  turno_id: number;
  vendedor: { id: number; nombre_completo: string };
  cliente_nombre: string | null;
  subtotal: string;
  descuento: string;
  total: string;
  articulos: number;
  /** EQUIPO o CELULAR; solo lo recibe el administrador. */
  origen: string | null;
}

export interface VentaDetalle extends VentaResumen {
  caja: { id: number; nombre: string };
  cliente_telefono: string | null;
  notas: string | null;
  tipo_cambio: string;
  promocion: { id: number; nombre: string } | null;
  lineas: {
    id: number;
    variante: { id: number; sku: string; nombre: string };
    tipo: string;
    cantidad: number;
    precio_lista: string;
    precio_unitario: string;
    subtotal: string;
    piezas: { variante: { id: number; sku: string; nombre: string }; cantidad: number }[];
  }[];
  pagos: {
    metodo: { codigo: string; nombre: string };
    moneda: string;
    monto: string;
    tipo_cambio: string;
    monto_nio: string;
    referencia: string | null;
  }[];
  /** Lo que se le entregó de vuelto al cliente, en córdobas. */
  vuelto: string;
  anulacion: {
    fecha: string;
    motivo: string;
    anulada_por: { id: number; nombre_completo: string };
  } | null;
  cambio: { devolucion_id: number; numero: string } | null;
  /**
   * El ticket en la cola de impresión del equipo de la sucursal (ventas hechas desde un celular):
   * PENDIENTE, IMPRESO o NO_IMPRESO. null: no pasó por la cola.
   */
  cola: { id: number; estado: string } | null;
}

/** Una devolución o un cambio en las listas. Cada una trae su monto; la lista, ninguna suma. */
export interface DevolucionResumen {
  id: number;
  /** Su número propio (DEV-LAM-000001): lo toma al ejecutarse; antes es null. */
  numero: string | null;
  /** DEVOLUCION o CAMBIO. */
  tipo: string;
  /** PENDIENTE, APROBADA, RECHAZADA, EJECUTADA o CANCELADA. */
  estado: string;
  /** La factura original (nunca se modifica). */
  venta: { id: number; numero: string; fecha: string; sucursal: Sucursal };
  motivo: string;
  cliente_nombre: string;
  cliente_telefono: string;
  /** Lo que se pagó por lo devuelto, en córdobas. */
  monto_total: string;
  sucursal_solicitud: Sucursal;
  solicitada_por: { id: number; nombre_completo: string };
  solicitada_at: string;
  /** Aprobada: último día para ejecutarla (AAAA-MM-DD); después se cancela sola. */
  vence_el: string | null;
  /** Dónde se ejecutó. */
  sucursal: Sucursal | null;
  ejecutada_at: string | null;
  /** Ya se ejecutó y le falta la transferencia que hace el administrador. */
  por_transferir: boolean;
}

export interface DevolucionDetalle extends DevolucionResumen {
  lineas: {
    id: number;
    detalle_id: number;
    variante: { id: number; sku: string; nombre: string };
    cantidad: number;
    /** BUENO (vuelve al stock) o DEFECTUOSO (sale como merma). */
    estado_producto: string;
    monto: string;
  }[];
  resolucion: {
    fecha: string;
    resuelta_por: { id: number; nombre_completo: string };
    comentario: string | null;
  } | null;
  /** `cancelada_por` null: venció sola, sin ejecutarse en su plazo. */
  cancelacion: {
    fecha: string;
    motivo: string;
    cancelada_por: { id: number; nombre_completo: string } | null;
  } | null;
  /**
   * Cómo recibe el cliente lo devuelto: `efectivo` de la caja y `transferencia` del administrador
   * (`saldo`: lo aplicado a la venta de un cambio). `definitivo: false` es lo previsto antes de
   * ejecutar; en un cambio sin ejecutar es null (depende de lo que se lleve).
   */
  reembolso: { saldo: string; efectivo: string; transferencia: string; definitivo: boolean } | null;
  ejecucion: {
    fecha: string;
    ejecutada_por: { id: number; nombre_completo: string };
    turno_id: number;
    caja: { id: number; nombre: string };
  } | null;
  venta_cambio: { id: number; numero: string; total: string } | null;
  transferencia: {
    referencia: string;
    fecha: string;
    transferida_por: { id: number; nombre_completo: string };
  } | null;
  /**
   * Pendiente y con el WhatsApp del administrador puesto: su número, solo con dígitos, para el
   * botón «Avisar al administrador». null: el botón no sale.
   */
  aviso_whatsapp: string | null;
}

/** Una factura buscada por su número, con lo que se puede devolver de ella. */
export interface VentaParaDevolver {
  id: number;
  numero: string;
  fecha: string;
  /** COMPLETADA o ANULADA. */
  estado: string;
  sucursal: Sucursal;
  vendedor: string;
  cliente_nombre: string | null;
  cliente_telefono: string | null;
  total: string;
  /** null: se puede solicitar. Si no, por qué no (anulada, turno abierto o plazo vencido). */
  motivo_no: string | null;
  /** Último día para solicitar la devolución (AAAA-MM-DD). */
  limite: string;
  lineas: LineaDevoluble[];
  /** Las solicitudes que ya tiene esta factura, de la más reciente a la más antigua. */
  solicitudes: DevolucionResumen[];
}

export interface LineaDevoluble {
  detalle_id: number;
  variante: { id: number; sku: string; nombre: string };
  categoria: string;
  cantidad: number;
  devuelta: number;
  /** Pedida en solicitudes pendientes o aprobadas. */
  apartada: number;
  disponible: number;
  /** Lo pagado por cada unidad, con la promoción descontada (aproximado al centavo). */
  monto_unitario: string;
  /** false: no se devuelve (pieza de piercing, perforación, paquete o categoría sin la casilla). */
  admite: boolean;
  motivo_no: string | null;
}

/** Una venta de los últimos días en «No tiene el ticket». */
export interface VentaReciente {
  id: number;
  numero: string;
  fecha: string;
  sucursal: Sucursal;
  vendedor: string;
  cliente_nombre: string | null;
  total: string;
  articulos: number;
  /** Los primeros productos de la factura, para reconocerla sin abrirla. */
  productos: string[];
  /** null: se puede solicitar. Si no, por qué no (su turno sigue abierto). */
  motivo_no: string | null;
}

export interface VentasRecientes {
  /** El plazo para devolver, en días, y el primer día que todavía entra (AAAA-MM-DD). */
  dias: number;
  desde: string;
  ventas: VentaReciente[];
}

/** Un parámetro general, como lo ve quien administra (PARAMETROS_GESTIONAR). */
export interface Parametro {
  clave: string;
  valor: string | null;
  tipo_valor: string;
  permite_vacio: boolean;
  descripcion: string;
}

/** Un ticket que espera en la cola de impresión de este equipo. Sin montos. */
export interface TicketEnCola {
  id: number;
  venta_id: number;
  numero: string;
  fecha: string;
  vendedor: string;
  /** Otro equipo de la sucursal lo está imprimiendo. */
  en_curso: boolean;
}

export interface ColaDeEquipo {
  /** false: este navegador no es un equipo registrado y abierto. */
  atendida: boolean;
  /** El equipo imprime los tickets sin que nadie los toque (IMPRESION_AUTOMATICA_COLA). */
  automatica: boolean;
  tickets: TicketEnCola[];
}
