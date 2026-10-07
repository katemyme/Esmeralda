import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { donde } from '../comun/consultas';
import { finDelDia, inicioDelDia } from '../comun/fechas';
import { NoEncontrado } from '../comun/no-encontrado';
import type {
  DatosAbrirTurno,
  DatosCerrarTurno,
  DatosMovimientoCaja,
  FiltroTurnos,
} from './esquemas';
import { cajaParaAbrir, exigirTurno, turnoDeSesion } from './sesion-caja';

interface UsuarioReferido {
  id: number;
  nombre_completo: string;
}

interface Ubicacion {
  id: number;
  codigo: string;
  nombre: string;
}

/**
 * El turno abierto de la caja de la sesión. No trae ningún monto: el arqueo es a ciegas, y quien
 * vende o cierra no debe poder calcular cuánto se espera en la gaveta.
 */
export interface TurnoActual {
  id: number;
  sucursal: Ubicacion;
  caja: { id: number; nombre: string };
  abierto_por: UsuarioReferido;
  fecha_apertura: Date;
  /** Ya hubo un conteo de cierre que no cuadró: el siguiente debe llevar justificación. */
  cierre_pide_justificacion: boolean;
}

/** Ingreso o egreso de efectivo durante el turno. */
export interface MovimientoCaja {
  id: number;
  /** INGRESO o EGRESO. */
  tipo: string;
  moneda: string;
  monto: string;
  motivo: string;
  usuario: UsuarioReferido;
  fecha: Date;
}

export interface MontoPorMetodo {
  metodo: string;
  moneda: string;
  monto: string;
}

/**
 * Ticket de cierre (fn_ticket_cierre). Nunca trae el monto esperado ni la diferencia. Quien cerró
 * recibe lo que contó, lo que retiró y el fondo que dejó; las ventas y lo cobrado por método solo
 * llegan a quien tiene CAJA_VER_DIFERENCIAS. En un cierre forzado no hubo conteo: sin ese permiso
 * no trae montos.
 */
export interface TicketCierre {
  turno_id: number;
  sucursal: string;
  caja: string;
  abierto_por: string;
  apertura: Date;
  cerrado_por: string | null;
  cierre: Date | null;
  cierre_forzado: boolean;
  contado?: MontoPorMetodo[];
  retiro_nio?: string;
  retiro_usd?: string;
  fondo_siguiente_nio?: string;
  fondo_siguiente_usd?: string;
  ventas?: number;
  anuladas?: number;
  total_vendido?: string;
  descuentos_promociones?: string;
  cobros?: MontoPorMetodo[];
}

/** Un turno con su resultado. Solo para quien tiene CAJA_VER_DIFERENCIAS. */
export interface TurnoResumen {
  id: number;
  sucursal: Ubicacion;
  caja: { id: number; nombre: string };
  /** ABIERTO o CERRADO. */
  estado: string;
  abierto_por: UsuarioReferido;
  fecha_apertura: Date;
  cerrado_por: UsuarioReferido | null;
  fecha_cierre: Date | null;
  cierre_forzado: boolean;
  ventas: number;
  anuladas: number;
  total_vendido: string;
  monto_inicial_nio: string;
  monto_inicial_usd: string;
  /** Lo declarado al abrir menos el fondo que dejó el cierre anterior (null: primer turno de la caja). */
  diferencia_apertura_nio: string | null;
  diferencia_apertura_usd: string | null;
  /** Contado menos esperado al cerrar (null mientras sigue abierto). */
  diferencia_nio: string | null;
  diferencia_usd: string | null;
  retiro_nio: string | null;
  retiro_usd: string | null;
  fondo_siguiente_nio: string | null;
  fondo_siguiente_usd: string | null;
  /** Conteos de cierre que no cuadraron antes de cerrar. */
  intentos_cierre: number;
  justificacion_diferencia: string | null;
  observaciones: string | null;
}

export interface TurnoDetalle extends TurnoResumen {
  fondo_esperado_nio: string | null;
  fondo_esperado_usd: string | null;
  /** Por método y moneda. Con el turno abierto, lo esperado hasta ahora (sin contado). */
  arqueo: {
    metodo: { codigo: string; nombre: string };
    moneda: string;
    esperado: string;
    contado: string | null;
    diferencia: string | null;
  }[];
  /** El conteo del efectivo, billete por billete. */
  denominaciones: { moneda: string; valor: string; cantidad: number }[];
  movimientos: MovimientoCaja[];
}

export interface MetodoPago {
  codigo: string;
  nombre: string;
  /** El efectivo admite vuelto y se cuenta por denominación al cerrar. */
  es_efectivo: boolean;
  /** Pide número de voucher o de transferencia. */
  requiere_referencia: boolean;
}

export interface Denominacion {
  moneda: string;
  valor: string;
  /** BILLETE o MONEDA. */
  tipo: string;
}

interface FilaTurnoActual {
  id: number;
  sucursal_id: number;
  sucursal_codigo: string;
  sucursal_nombre: string;
  caja_id: number;
  caja_nombre: string;
  abierto_por_id: number;
  abierto_por: string;
  fecha_apertura: Date;
  cierre_pide_justificacion: boolean;
}

interface FilaTurno extends Omit<FilaTurnoActual, 'cierre_pide_justificacion'> {
  estado: string;
  cerrado_por_id: number | null;
  cerrado_por: string | null;
  fecha_cierre: Date | null;
  cierre_forzado: boolean;
  ventas: number;
  anuladas: number;
  total_vendido: string;
  monto_inicial_nio: string;
  monto_inicial_usd: string;
  fondo_esperado_nio: string | null;
  fondo_esperado_usd: string | null;
  diferencia_apertura_nio: string | null;
  diferencia_apertura_usd: string | null;
  diferencia_nio: string | null;
  diferencia_usd: string | null;
  retiro_nio: string | null;
  retiro_usd: string | null;
  fondo_siguiente_nio: string | null;
  fondo_siguiente_usd: string | null;
  intentos_cierre: number;
  justificacion_diferencia: string | null;
  observaciones: string | null;
}

interface FilaMovimiento {
  id: number;
  tipo: string;
  moneda: string;
  monto: string;
  motivo: string;
  usuario_id: number;
  usuario: string;
  fecha: Date;
}

/** fn_ticket_cierre devuelve JSON: ahí los montos llegan como número y las fechas como texto. */
interface TicketCrudo {
  cerrado?: boolean;
  turno_id: number;
  sucursal: string;
  caja: string;
  abierto_por: string;
  apertura: string;
  cerrado_por: string | null;
  cierre: string | null;
  cierre_forzado: boolean;
  contado?: { metodo: string; moneda: string; monto: number }[];
  retiro_nio?: number;
  retiro_usd?: number;
  fondo_siguiente_nio?: number;
  fondo_siguiente_usd?: number;
  ventas?: number;
  anuladas?: number;
  total_vendido?: number;
  descuentos_promociones?: number;
  cobros?: { metodo: string; moneda: string; monto: number }[];
}

/** Monto de un JSON de la base → texto con 2 decimales, como el resto de los montos de la API. */
function monto(valor: number): string {
  return valor.toFixed(2);
}

function montos(lista: { metodo: string; moneda: string; monto: number }[]): MontoPorMetodo[] {
  return lista.map((m) => ({ metodo: m.metodo, moneda: m.moneda, monto: monto(m.monto) }));
}

function aTicket(t: TicketCrudo): TicketCierre {
  return {
    turno_id: t.turno_id,
    sucursal: t.sucursal,
    caja: t.caja,
    abierto_por: t.abierto_por,
    apertura: new Date(t.apertura),
    cerrado_por: t.cerrado_por,
    cierre: t.cierre === null ? null : new Date(t.cierre),
    cierre_forzado: t.cierre_forzado,
    ...(t.contado !== undefined && {
      contado: montos(t.contado),
      retiro_nio: monto(t.retiro_nio ?? 0),
      retiro_usd: monto(t.retiro_usd ?? 0),
      fondo_siguiente_nio: monto(t.fondo_siguiente_nio ?? 0),
      fondo_siguiente_usd: monto(t.fondo_siguiente_usd ?? 0),
    }),
    ...(t.cobros !== undefined && {
      ventas: t.ventas ?? 0,
      anuladas: t.anuladas ?? 0,
      total_vendido: monto(t.total_vendido ?? 0),
      descuentos_promociones: monto(t.descuentos_promociones ?? 0),
      cobros: montos(t.cobros),
    }),
  };
}

function aTurnoActual(f: FilaTurnoActual): TurnoActual {
  return {
    id: f.id,
    sucursal: { id: f.sucursal_id, codigo: f.sucursal_codigo, nombre: f.sucursal_nombre },
    caja: { id: f.caja_id, nombre: f.caja_nombre },
    abierto_por: { id: f.abierto_por_id, nombre_completo: f.abierto_por },
    fecha_apertura: f.fecha_apertura,
    cierre_pide_justificacion: f.cierre_pide_justificacion,
  };
}

function aTurno(f: FilaTurno): TurnoResumen {
  return {
    id: f.id,
    sucursal: { id: f.sucursal_id, codigo: f.sucursal_codigo, nombre: f.sucursal_nombre },
    caja: { id: f.caja_id, nombre: f.caja_nombre },
    estado: f.estado,
    abierto_por: { id: f.abierto_por_id, nombre_completo: f.abierto_por },
    fecha_apertura: f.fecha_apertura,
    cerrado_por:
      f.cerrado_por_id !== null && f.cerrado_por !== null
        ? { id: f.cerrado_por_id, nombre_completo: f.cerrado_por }
        : null,
    fecha_cierre: f.fecha_cierre,
    cierre_forzado: f.cierre_forzado,
    ventas: f.ventas,
    anuladas: f.anuladas,
    total_vendido: f.total_vendido,
    monto_inicial_nio: f.monto_inicial_nio,
    monto_inicial_usd: f.monto_inicial_usd,
    diferencia_apertura_nio: f.diferencia_apertura_nio,
    diferencia_apertura_usd: f.diferencia_apertura_usd,
    diferencia_nio: f.diferencia_nio,
    diferencia_usd: f.diferencia_usd,
    retiro_nio: f.retiro_nio,
    retiro_usd: f.retiro_usd,
    fondo_siguiente_nio: f.fondo_siguiente_nio,
    fondo_siguiente_usd: f.fondo_siguiente_usd,
    intentos_cierre: f.intentos_cierre,
    justificacion_diferencia: f.justificacion_diferencia,
    observaciones: f.observaciones,
  };
}

function aMovimiento(f: FilaMovimiento): MovimientoCaja {
  return {
    id: f.id,
    tipo: f.tipo,
    moneda: f.moneda,
    monto: f.monto,
    motivo: f.motivo,
    usuario: { id: f.usuario_id, nombre_completo: f.usuario },
    fecha: f.fecha,
  };
}

/**
 * Caja: apertura, movimientos de efectivo, cierre (arqueo ciego) e historial de turnos. Las reglas
 * las aplica la base (fn_abrir_turno, fn_movimiento_caja, fn_cerrar_turno, fn_cierre_forzado), y
 * la caja de cada operación sale del equipo de la sesión (sesion-caja.ts), no de la solicitud.
 * Los montos esperados y las diferencias solo salen en el historial (CAJA_VER_DIFERENCIAS).
 */
@Injectable()
export class CajaService {
  constructor(private readonly bd: BaseDatosService) {}

  /** El turno abierto de la caja de la sesión, o null si la caja está cerrada. */
  async turnoActual(
    usuario: UsuarioAutenticado,
    cajaElegida: number | undefined,
  ): Promise<TurnoActual | null> {
    const turno = await turnoDeSesion(this.bd.db, usuario, cajaElegida);
    return turno === null ? null : this.turnoAbierto(turno);
  }

  /** Abre el turno declarando el efectivo contado; la diferencia con el fondo esperado no se muestra. */
  async abrir(usuario: UsuarioAutenticado, datos: DatosAbrirTurno): Promise<TurnoActual> {
    const turno = await this.bd.transaccion(usuario.id, async (trx) => {
      const { rows } = await sql<{ id: number }>`
        select fn_abrir_turno(${usuario.id}, ${cajaParaAbrir(usuario, datos.caja_id)},
               ${datos.inicial_nio}::numeric, ${datos.inicial_usd}::numeric) as id`.execute(trx);
      return rows[0].id;
    });
    return this.turnoAbierto(turno);
  }

  async movimientos(
    usuario: UsuarioAutenticado,
    cajaElegida: number | undefined,
  ): Promise<MovimientoCaja[]> {
    const turno = await exigirTurno(this.bd.db, usuario, cajaElegida);
    return this.movimientosDe(turno);
  }

  async registrarMovimiento(
    usuario: UsuarioAutenticado,
    datos: DatosMovimientoCaja,
  ): Promise<MovimientoCaja> {
    const { turno, id } = await this.bd.transaccion(usuario.id, async (trx) => {
      const turno = await exigirTurno(trx, usuario, datos.caja_id);
      const { rows } = await sql<{ id: number }>`
        select fn_movimiento_caja(${usuario.id}, ${turno}, ${datos.tipo}, ${datos.moneda},
               ${datos.monto}::numeric, ${datos.motivo}) as id`.execute(trx);
      return { turno, id: rows[0].id };
    });
    const movimiento = (await this.movimientosDe(turno)).find((m) => m.id === id);
    if (!movimiento) throw new NoEncontrado(`El movimiento ${id} no existe`);
    return movimiento;
  }

  /**
   * Cierra el turno con lo contado. Si el primer conteo no cuadra, la base no cierra y anota el
   * intento (no lanza error, para que quede guardado): aquí se responde 422 CONTEO_NO_CUADRA, sin
   * montos. Solo hay un reconteo: el siguiente intento debe llevar justificación.
   */
  async cerrar(usuario: UsuarioAutenticado, datos: DatosCerrarTurno): Promise<TicketCierre> {
    const ticket = await this.bd.transaccion(usuario.id, async (trx) => {
      const turno = await exigirTurno(trx, usuario, datos.caja_id);
      const { rows } = await sql<{ ticket: TicketCrudo }>`
        select fn_cerrar_turno(${usuario.id}, ${turno}, ${JSON.stringify(datos.efectivo)}::jsonb,
               ${JSON.stringify(datos.no_efectivo)}::jsonb, ${datos.retiro_nio}::numeric,
               ${datos.retiro_usd}::numeric, ${datos.justificacion},
               ${datos.observaciones}) as ticket`.execute(trx);
      return rows[0].ticket;
    });
    if (!ticket.cerrado) {
      throw new HttpException(
        {
          codigo: 'CONTEO_NO_CUADRA',
          mensaje:
            'El conteo no cuadra con lo registrado. Cuente de nuevo: es el único reconteo; en el siguiente intento deberá escribir una justificación y la caja se cerrará con lo que cuente.',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return aTicket(ticket);
  }

  /** Cierre sin arqueo de un turno que nadie cerró: se asume lo esperado. */
  async cierreForzado(adminId: number, turnoId: number, motivo: string): Promise<TicketCierre> {
    const ticket = await this.bd.transaccion(adminId, async (trx) => {
      const { rows } = await sql<{ ticket: TicketCrudo }>`
        select fn_cierre_forzado(${adminId}, ${turnoId}, ${motivo}) as ticket`.execute(trx);
      return rows[0].ticket;
    });
    return aTicket(ticket);
  }

  /** Para reimprimir el ticket de un turno cerrado; cuánto trae lo decide la base según el permiso. */
  async ticket(usuarioId: number, turnoId: number): Promise<TicketCierre> {
    const { rows } = await sql<{ estado: string; ticket: TicketCrudo }>`
      select t.estado,
             fn_ticket_cierre(t.id, (select fn_tiene_permiso(${usuarioId}, 'CAJA_VER_DIFERENCIAS'))) as ticket
        from turno_caja t
        join caja c on c.id = t.caja_id
       where t.id = ${turnoId} and fn_puede_operar_sucursal(${usuarioId}, c.sucursal_id)`.execute(
      this.bd.db,
    );
    if (!rows[0]) throw new NoEncontrado(`El turno ${turnoId} no existe`);
    if (rows[0].estado !== 'CERRADO') {
      throw new HttpException(
        { codigo: 'TURNO_ABIERTO', mensaje: 'El turno sigue abierto: el ticket sale al cerrarlo' },
        HttpStatus.CONFLICT,
      );
    }
    return aTicket(rows[0].ticket);
  }

  async listarTurnos(usuarioId: number, filtro: FiltroTurnos): Promise<TurnoResumen[]> {
    const filas = await this.consultarTurnos(
      usuarioId,
      [
        filtro.sucursal_id && sql`c.sucursal_id = ${filtro.sucursal_id}`,
        filtro.estado && sql`t.estado = ${filtro.estado}`,
        filtro.desde && sql`t.fecha_apertura >= ${inicioDelDia(filtro.desde)}`,
        filtro.hasta && sql`t.fecha_apertura < ${finDelDia(filtro.hasta)}`,
        filtro.antes_de && sql`t.id < ${filtro.antes_de}`,
      ],
      filtro.limite,
    );
    return filas.map(aTurno);
  }

  async verTurno(usuarioId: number, turnoId: number): Promise<TurnoDetalle> {
    const [fila] = await this.consultarTurnos(usuarioId, [sql`t.id = ${turnoId}`], 1);
    if (!fila) throw new NoEncontrado(`El turno ${turnoId} no existe`);
    const [arqueo, denominaciones, movimientos] = await Promise.all([
      sql<{
        codigo: string;
        nombre: string;
        moneda: string;
        esperado: string;
        contado: string | null;
        diferencia: string | null;
      }>`
        select m.codigo, m.nombre, x.moneda, x.esperado::numeric(12,2) as esperado, x.contado,
               x.diferencia
          from (select cd.metodo_pago_id, cd.moneda, cd.monto_esperado as esperado,
                       cd.monto_contado as contado, cd.diferencia
                  from cierre_caja_detalle cd
                 where cd.turno_id = ${turnoId}
                 union all
                select r.metodo_pago_id, r.moneda, r.monto_esperado, null, null
                  from fn_resumen_turno(${turnoId}) r
                 where ${fila.estado}::text = 'ABIERTO' and r.monto_esperado <> 0) x
          join metodo_pago m on m.id = x.metodo_pago_id
         order by m.id, x.moneda`.execute(this.bd.db),
      sql<{ moneda: string; valor: string; cantidad: number }>`
        select moneda, valor, cantidad from cierre_denominacion
         where turno_id = ${turnoId} and cantidad > 0
         order by moneda, valor desc`.execute(this.bd.db),
      this.movimientosDe(turnoId),
    ]);
    return {
      ...aTurno(fila),
      fondo_esperado_nio: fila.fondo_esperado_nio,
      fondo_esperado_usd: fila.fondo_esperado_usd,
      arqueo: arqueo.rows.map((a) => ({
        metodo: { codigo: a.codigo, nombre: a.nombre },
        moneda: a.moneda,
        esperado: a.esperado,
        contado: a.contado,
        diferencia: a.diferencia,
      })),
      denominaciones: denominaciones.rows,
      movimientos,
    };
  }

  async metodosPago(): Promise<MetodoPago[]> {
    return this.bd.db
      .selectFrom('metodo_pago')
      .select(['codigo', 'nombre', 'es_efectivo', 'requiere_referencia'])
      .where('activo', '=', true)
      .orderBy('id')
      .execute();
  }

  /** Billetes y monedas que se cuentan al cerrar, del mayor al menor. */
  async denominaciones(): Promise<Denominacion[]> {
    return this.bd.db
      .selectFrom('denominacion')
      .select(['moneda', 'valor', 'tipo'])
      .where('activa', '=', true)
      .orderBy('moneda')
      .orderBy('valor', 'desc')
      .orderBy('tipo')
      .execute();
  }

  private async turnoAbierto(turnoId: number): Promise<TurnoActual> {
    const { rows } = await sql<FilaTurnoActual>`
      select t.id, s.id as sucursal_id, s.codigo as sucursal_codigo, s.nombre as sucursal_nombre,
             c.id as caja_id, c.nombre as caja_nombre,
             u.id as abierto_por_id, u.nombre_completo as abierto_por, t.fecha_apertura,
             t.intentos_cierre > 0 as cierre_pide_justificacion
        from turno_caja t
        join caja c on c.id = t.caja_id
        join sucursal s on s.id = c.sucursal_id
        join usuario u on u.id = t.usuario_apertura_id
       where t.id = ${turnoId}`.execute(this.bd.db);
    if (!rows[0]) throw new NoEncontrado(`El turno ${turnoId} no existe`);
    return aTurnoActual(rows[0]);
  }

  private async movimientosDe(turnoId: number): Promise<MovimientoCaja[]> {
    const { rows } = await sql<FilaMovimiento>`
      select m.id, m.tipo, m.moneda, m.monto, m.motivo, m.fecha,
             u.id as usuario_id, u.nombre_completo as usuario
        from caja_movimiento m
        join usuario u on u.id = m.usuario_id
       where m.turno_id = ${turnoId}
       order by m.id`.execute(this.bd.db);
    return rows.map(aMovimiento);
  }

  private async consultarTurnos(
    usuarioId: number,
    condiciones: Parameters<typeof donde>,
    limite: number,
  ): Promise<FilaTurno[]> {
    const { rows } = await sql<FilaTurno>`
      select t.id, s.id as sucursal_id, s.codigo as sucursal_codigo, s.nombre as sucursal_nombre,
             c.id as caja_id, c.nombre as caja_nombre, t.estado,
             ua.id as abierto_por_id, ua.nombre_completo as abierto_por, t.fecha_apertura,
             uc.id as cerrado_por_id, uc.nombre_completo as cerrado_por, t.fecha_cierre,
             t.cierre_forzado, v.ventas, v.anuladas, v.total_vendido,
             t.monto_inicial_nio, t.monto_inicial_usd, t.fondo_esperado_nio, t.fondo_esperado_usd,
             t.diferencia_apertura_nio, t.diferencia_apertura_usd,
             d.diferencia_nio, d.diferencia_usd,
             t.retiro_nio, t.retiro_usd, t.fondo_siguiente_nio, t.fondo_siguiente_usd,
             t.intentos_cierre, t.justificacion_diferencia, t.observaciones
        from turno_caja t
        join caja c on c.id = t.caja_id
        join sucursal s on s.id = c.sucursal_id
        join usuario ua on ua.id = t.usuario_apertura_id
        left join usuario uc on uc.id = t.usuario_cierre_id
       cross join lateral (
             select count(*) filter (where ve.estado = 'COMPLETADA')::integer as ventas,
                    count(*) filter (where ve.estado = 'ANULADA')::integer as anuladas,
                    coalesce(sum(ve.total) filter (where ve.estado = 'COMPLETADA'), 0)::numeric(12,2)
                      as total_vendido
               from venta ve
              where ve.turno_id = t.id) v
       cross join lateral (
             select sum(cd.diferencia) filter (where cd.moneda = 'NIO') as diferencia_nio,
                    sum(cd.diferencia) filter (where cd.moneda = 'USD') as diferencia_usd
               from cierre_caja_detalle cd
              where cd.turno_id = t.id) d
        ${donde(sql`fn_puede_operar_sucursal(${usuarioId}, c.sucursal_id)`, ...condiciones)}
       order by t.id desc
       limit ${limite}`.execute(this.bd.db);
    return rows;
  }
}
