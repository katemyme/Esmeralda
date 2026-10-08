import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { exigirTurno } from '../caja/sesion-caja';
import { donde, patronContiene } from '../comun/consultas';
import { finDelDia, inicioDelDia } from '../comun/fechas';
import { NoEncontrado } from '../comun/no-encontrado';
import { ticketPdf } from '../exportacion/ticket-pdf';
import type {
  DatosEjecutarDevolucion,
  DatosResolverDevolucion,
  DatosSolicitarDevolucion,
  FiltroDevoluciones,
} from './esquemas';
import { renglonesTicketDevolucion } from './ticket-devolucion';

interface UsuarioReferido {
  id: number;
  nombre_completo: string;
}

interface Ubicacion {
  id: number;
  codigo: string;
  nombre: string;
}

/** Una devolución o un cambio en las listas. */
export interface DevolucionResumen {
  id: number;
  /** Su número propio (DEV-LAM-000001): lo toma al ejecutarse; antes es null. */
  numero: string | null;
  /** DEVOLUCION o CAMBIO. */
  tipo: string;
  /** PENDIENTE, APROBADA, RECHAZADA, EJECUTADA o CANCELADA. */
  estado: string;
  /** La factura original (no se modifica). */
  venta: { id: number; numero: string; fecha: Date; sucursal: Ubicacion };
  motivo: string;
  cliente_nombre: string;
  cliente_telefono: string;
  /** Lo que se pagó por lo devuelto, con la promoción descontada en proporción (C$). */
  monto_total: string;
  /** Dónde se solicitó (donde estaba el cliente). */
  sucursal_solicitud: Ubicacion;
  solicitada_por: UsuarioReferido;
  solicitada_at: Date;
  /** Aprobada: último día (de Managua) para ejecutarla; después se cancela sola. */
  vence_el: string | null;
  /** Dónde se ejecutó: puede ser otra sucursal que la de la venta. */
  sucursal: Ubicacion | null;
  ejecutada_at: Date | null;
  /** Ya se ejecutó y le falta la transferencia que hace el administrador. */
  por_transferir: boolean;
}

/** La devolución completa: es también lo que se imprime en su ticket. No trae costos. */
export interface DevolucionDetalle extends DevolucionResumen {
  lineas: {
    id: number;
    /** La línea de la factura original. */
    detalle_id: number;
    variante: { id: number; sku: string; nombre: string };
    cantidad: number;
    /** BUENO (vuelve al stock) o DEFECTUOSO (entra y sale como merma aprobada). */
    estado_producto: string;
    monto: string;
  }[];
  resolucion: { fecha: Date; resuelta_por: UsuarioReferido; comentario: string | null } | null;
  /** `cancelada_por` null: venció sola (pasó su plazo sin ejecutarse). */
  cancelacion: { fecha: Date; motivo: string; cancelada_por: UsuarioReferido | null } | null;
  /**
   * Cómo recibe el cliente lo devuelto: `saldo` aplicado a la venta nueva (cambio), `efectivo` en
   * córdobas desde la caja y `transferencia` que hace el administrador; se reparte como se pagó
   * la factura. Antes de ejecutar una devolución es lo previsto (`definitivo: false`); en un
   * cambio no se sabe hasta ver qué se lleva el cliente (null).
   */
  reembolso: { saldo: string; efectivo: string; transferencia: string; definitivo: boolean } | null;
  ejecucion: {
    fecha: Date;
    ejecutada_por: UsuarioReferido;
    turno_id: number;
    caja: { id: number; nombre: string };
  } | null;
  /** Cambio ejecutado: la venta de lo que se llevó el cliente. */
  venta_cambio: { id: number; numero: string; total: string } | null;
  transferencia: { referencia: string; fecha: Date; transferida_por: UsuarioReferido } | null;
  /** Encabezado del ticket: el negocio y la sucursal donde se ejecutó. */
  ticket: {
    negocio: string | null;
    ruc: string | null;
    direccion: string | null;
    telefono: string | null;
  };
}

/** Una factura buscada por su número, con lo que se puede devolver de ella. */
export interface VentaParaDevolver {
  id: number;
  numero: string;
  fecha: Date;
  /** COMPLETADA o ANULADA. */
  estado: string;
  sucursal: Ubicacion;
  vendedor: string;
  /** Los que se anotaron en la venta, si los hay (para no volver a escribirlos). */
  cliente_nombre: string | null;
  cliente_telefono: string | null;
  total: string;
  /** null: se puede solicitar. Si no, por qué no (anulada, turno abierto o plazo vencido). */
  motivo_no: string | null;
  /** Último día (de Managua) para solicitar la devolución. */
  limite: string;
  lineas: {
    detalle_id: number;
    variante: { id: number; sku: string; nombre: string };
    categoria: string;
    cantidad: number;
    /** Ya devuelta. */
    devuelta: number;
    /** Pedida en solicitudes pendientes o aprobadas. */
    apartada: number;
    disponible: number;
    /** Lo pagado por cada unidad, con la promoción descontada (aproximado al centavo). */
    monto_unitario: string;
    /** false: no se devuelve (pieza de piercing, perforación, paquete o categoría sin la casilla). */
    admite: boolean;
    motivo_no: string | null;
  }[];
  /** Las solicitudes que ya tiene esta factura, de la más reciente a la más antigua. */
  solicitudes: DevolucionResumen[];
}

interface FilaDevolucion {
  id: number;
  numero: string | null;
  tipo: string;
  estado: string;
  motivo: string;
  cliente_nombre: string;
  cliente_telefono: string;
  monto_total: string;
  venta_id: number;
  venta_numero: string;
  venta_fecha: Date;
  venta_sucursal_id: number;
  venta_sucursal_codigo: string;
  venta_sucursal_nombre: string;
  solicitud_sucursal_id: number;
  solicitud_sucursal_codigo: string;
  solicitud_sucursal_nombre: string;
  solicitada_por_id: number;
  solicitada_por: string;
  solicitada_at: Date;
  vence_el: string | null;
  sucursal_id: number | null;
  sucursal_codigo: string | null;
  sucursal_nombre: string | null;
  sucursal_direccion: string | null;
  sucursal_telefono: string | null;
  ejecutada_at: Date | null;
  ejecutada_por_id: number | null;
  ejecutada_por: string | null;
  turno_id: number | null;
  caja_id: number | null;
  caja_nombre: string | null;
  resuelta_por_id: number | null;
  resuelta_por: string | null;
  resuelta_at: Date | null;
  comentario: string | null;
  cancelada_por_id: number | null;
  cancelada_por: string | null;
  cancelada_at: Date | null;
  motivo_cancelacion: string | null;
  monto_saldo: string | null;
  monto_efectivo: string | null;
  monto_transferencia: string | null;
  previsto_efectivo: string | null;
  previsto_transferencia: string | null;
  venta_cambio_id: number | null;
  venta_cambio_numero: string | null;
  venta_cambio_total: string | null;
  transferencia_referencia: string | null;
  transferida_at: Date | null;
  transferida_por_id: number | null;
  transferida_por: string | null;
  negocio: string | null;
  ruc: string | null;
}

function persona(id: number | null, nombre: string | null): UsuarioReferido | null {
  return id !== null && nombre !== null ? { id, nombre_completo: nombre } : null;
}

function ubicacion(
  id: number | null,
  codigo: string | null,
  nombre: string | null,
): Ubicacion | null {
  return id !== null && codigo !== null && nombre !== null ? { id, codigo, nombre } : null;
}

function aResumen(f: FilaDevolucion): DevolucionResumen {
  return {
    id: f.id,
    numero: f.numero,
    tipo: f.tipo,
    estado: f.estado,
    venta: {
      id: f.venta_id,
      numero: f.venta_numero,
      fecha: f.venta_fecha,
      sucursal: {
        id: f.venta_sucursal_id,
        codigo: f.venta_sucursal_codigo,
        nombre: f.venta_sucursal_nombre,
      },
    },
    motivo: f.motivo,
    cliente_nombre: f.cliente_nombre,
    cliente_telefono: f.cliente_telefono,
    monto_total: f.monto_total,
    sucursal_solicitud: {
      id: f.solicitud_sucursal_id,
      codigo: f.solicitud_sucursal_codigo,
      nombre: f.solicitud_sucursal_nombre,
    },
    solicitada_por: { id: f.solicitada_por_id, nombre_completo: f.solicitada_por },
    solicitada_at: f.solicitada_at,
    vence_el: f.vence_el,
    sucursal: ubicacion(f.sucursal_id, f.sucursal_codigo, f.sucursal_nombre),
    ejecutada_at: f.ejecutada_at,
    por_transferir:
      f.estado === 'EJECUTADA' && Number(f.monto_transferencia) > 0 && f.transferida_at === null,
  };
}

function reembolso(f: FilaDevolucion): DevolucionDetalle['reembolso'] {
  if (f.monto_saldo !== null && f.monto_efectivo !== null && f.monto_transferencia !== null) {
    return {
      saldo: f.monto_saldo,
      efectivo: f.monto_efectivo,
      transferencia: f.monto_transferencia,
      definitivo: true,
    };
  }
  if (f.previsto_efectivo !== null && f.previsto_transferencia !== null) {
    return {
      saldo: '0.00',
      efectivo: f.previsto_efectivo,
      transferencia: f.previsto_transferencia,
      definitivo: false,
    };
  }
  return null;
}

const SIN_EQUIPO = 'Esta operación se hace desde un equipo registrado y activo de la sucursal';

/**
 * Devoluciones y cambios de ventas de turnos ya cerrados (B8). Las reglas las aplica la base:
 * fn_solicitar_devolucion (qué se puede devolver, el plazo, el monto), fn_resolver_devolucion
 * (solo el administrador), fn_ejecutar_devolucion (inventario, número, efectivo o venta del
 * cambio), fn_cancelar_devolucion y fn_registrar_transferencia_devolucion.
 * Alcance: el administrador ve todas; quien las registra, las de sus sucursales (donde se
 * solicitaron o se ejecutaron) y, por su id, cualquiera aprobada: se ejecuta donde aparezca el
 * cliente. La vendedora ve el monto de cada devolución (tiene que entregarlo), nunca sumas.
 */
@Injectable()
export class DevolucionesService {
  constructor(private readonly bd: BaseDatosService) {}

  /** La factura con ese número y lo que se puede devolver de ella, sea de la sucursal que sea. */
  async buscarVenta(usuario: UsuarioAutenticado, numero: string): Promise<VentaParaDevolver> {
    const { rows } = await sql<{
      autorizado: boolean;
      id: number | null;
      numero: string;
      fecha: Date;
      estado: string;
      total: string;
      cliente_nombre: string | null;
      cliente_telefono: string | null;
      sucursal_id: number;
      sucursal_codigo: string;
      sucursal_nombre: string;
      vendedor: string;
      motivo_no: string | null;
      limite: string;
    }>`
      select fn_sesion_permitida(${usuario.id}, ${usuario.equipo?.id ?? null}::uuid) as autorizado,
             v.id, v.numero, v.fecha, v.estado, v.total, v.cliente_nombre, v.cliente_telefono,
             s.id as sucursal_id, s.codigo as sucursal_codigo, s.nombre as sucursal_nombre,
             u.nombre_completo as vendedor, fn_venta_no_devoluble(v.id) as motivo_no,
             (v.fecha at time zone 'America/Managua')::date
               + coalesce(fn_parametro_num('DEVOLUCION_DIAS_MAX'), 0)::integer as limite
        from (select 1) uno
        left join venta v on v.numero = ${numero}
        left join sucursal s on s.id = v.sucursal_id
        left join usuario u on u.id = v.vendedor_id`.execute(this.bd.db);
    const venta = rows[0];
    if (!venta.autorizado) {
      throw new HttpException(
        { codigo: 'PERMISO_DENEGADO', mensaje: SIN_EQUIPO },
        HttpStatus.FORBIDDEN,
      );
    }
    if (venta.id === null) throw new NoEncontrado(`La factura ${numero} no existe`);

    const [lineas, solicitudes] = await Promise.all([
      sql<{
        detalle_id: number;
        variante_id: number;
        sku: string;
        producto: string;
        categoria: string;
        cantidad: number;
        devuelta: number;
        apartada: number;
        disponible: number;
        monto_unitario: string;
        admite: boolean;
        motivo_no: string | null;
      }>`
        select l.detalle_id, l.variante_id, l.sku, l.producto, l.categoria, l.cantidad, l.devuelta,
               l.apartada, l.disponible, round(l.neto_linea / l.cantidad, 2) as monto_unitario,
               l.admite, l.motivo_no
          from fn_lineas_devolubles(${venta.id}) l
         order by l.detalle_id`.execute(this.bd.db),
      this.consultar([sql`d.venta_id = ${venta.id}`], 50),
    ]);
    return {
      id: venta.id,
      numero: venta.numero,
      fecha: venta.fecha,
      estado: venta.estado,
      sucursal: {
        id: venta.sucursal_id,
        codigo: venta.sucursal_codigo,
        nombre: venta.sucursal_nombre,
      },
      vendedor: venta.vendedor,
      cliente_nombre: venta.cliente_nombre,
      cliente_telefono: venta.cliente_telefono,
      total: venta.total,
      motivo_no: venta.motivo_no,
      limite: venta.limite,
      lineas: lineas.rows.map((l) => ({
        detalle_id: l.detalle_id,
        variante: { id: l.variante_id, sku: l.sku, nombre: l.producto },
        categoria: l.categoria,
        cantidad: l.cantidad,
        devuelta: l.devuelta,
        apartada: l.apartada,
        disponible: l.disponible,
        monto_unitario: l.monto_unitario,
        admite: l.admite,
        motivo_no: l.motivo_no,
      })),
      solicitudes: solicitudes.map(aResumen),
    };
  }

  async listar(usuarioId: number, filtro: FiltroDevoluciones): Promise<DevolucionResumen[]> {
    const patron = filtro.buscar && patronContiene(filtro.buscar);
    const filas = await this.consultar(
      [
        sql`((select fn_tiene_permiso(${usuarioId}, 'DEVOLUCIONES_APROBAR'))
             or ((select fn_tiene_permiso(${usuarioId}, 'DEVOLUCIONES_REGISTRAR'))
                 and (fn_puede_operar_sucursal(${usuarioId}, d.sucursal_solicitud_id)
                      or fn_puede_operar_sucursal(${usuarioId}, d.sucursal_id))))`,
        filtro.estado && sql`d.estado = ${filtro.estado}`,
        filtro.tipo && sql`d.tipo = ${filtro.tipo}`,
        filtro.sucursal_id &&
          sql`${filtro.sucursal_id} in (d.sucursal_solicitud_id, d.sucursal_id)`,
        filtro.desde && sql`d.solicitada_at >= ${inicioDelDia(filtro.desde)}`,
        filtro.hasta && sql`d.solicitada_at < ${finDelDia(filtro.hasta)}`,
        filtro.por_transferir !== undefined &&
          sql`(d.estado = 'EJECUTADA' and d.monto_transferencia > 0 and d.transferida_at is null)
              = ${filtro.por_transferir}`,
        patron &&
          sql`(d.numero ilike ${patron} or v.numero ilike ${patron} or d.cliente_nombre ilike ${patron})`,
        filtro.antes_de && sql`d.id < ${filtro.antes_de}`,
      ],
      filtro.limite,
    );
    return filas.map(aResumen);
  }

  async buscar(usuarioId: number, id: number): Promise<DevolucionDetalle> {
    const [fila] = await this.consultar(
      [sql`d.id = ${id}`, sql`fn_puede_ver_devolucion(${usuarioId}, d.id)`],
      1,
    );
    if (!fila) throw new NoEncontrado(`La devolución ${id} no existe`);
    const { rows: lineas } = await sql<{
      id: number;
      detalle_id: number;
      variante_id: number;
      sku: string;
      nombre: string;
      cantidad: number;
      estado_producto: string;
      monto: string;
    }>`
      select dd.id, dd.venta_detalle_id as detalle_id, va.id as variante_id, va.sku,
             pr.nombre || ' — ' || va.nombre as nombre, dd.cantidad, dd.estado_producto, dd.monto
        from devolucion_detalle dd
        join venta_detalle vd on vd.id = dd.venta_detalle_id
        join variante va on va.id = vd.variante_id
        join producto pr on pr.id = va.producto_id
       where dd.devolucion_id = ${id}
       order by dd.id`.execute(this.bd.db);

    const resuelta = persona(fila.resuelta_por_id, fila.resuelta_por);
    const ejecutada = persona(fila.ejecutada_por_id, fila.ejecutada_por);
    const transferida = persona(fila.transferida_por_id, fila.transferida_por);
    return {
      ...aResumen(fila),
      lineas: lineas.map((l) => ({
        id: l.id,
        detalle_id: l.detalle_id,
        variante: { id: l.variante_id, sku: l.sku, nombre: l.nombre },
        cantidad: l.cantidad,
        estado_producto: l.estado_producto,
        monto: l.monto,
      })),
      resolucion:
        resuelta && fila.resuelta_at
          ? { fecha: fila.resuelta_at, resuelta_por: resuelta, comentario: fila.comentario }
          : null,
      cancelacion:
        fila.cancelada_at && fila.motivo_cancelacion !== null
          ? {
              fecha: fila.cancelada_at,
              motivo: fila.motivo_cancelacion,
              cancelada_por: persona(fila.cancelada_por_id, fila.cancelada_por),
            }
          : null,
      reembolso: reembolso(fila),
      ejecucion:
        ejecutada &&
        fila.ejecutada_at &&
        fila.turno_id !== null &&
        fila.caja_id !== null &&
        fila.caja_nombre !== null
          ? {
              fecha: fila.ejecutada_at,
              ejecutada_por: ejecutada,
              turno_id: fila.turno_id,
              caja: { id: fila.caja_id, nombre: fila.caja_nombre },
            }
          : null,
      venta_cambio:
        fila.venta_cambio_id !== null &&
        fila.venta_cambio_numero !== null &&
        fila.venta_cambio_total !== null
          ? {
              id: fila.venta_cambio_id,
              numero: fila.venta_cambio_numero,
              total: fila.venta_cambio_total,
            }
          : null,
      transferencia:
        transferida && fila.transferida_at && fila.transferencia_referencia !== null
          ? {
              referencia: fila.transferencia_referencia,
              fecha: fila.transferida_at,
              transferida_por: transferida,
            }
          : null,
      ticket: {
        negocio: fila.negocio,
        ruc: fila.ruc,
        direccion: fila.sucursal_direccion,
        telefono: fila.sucursal_telefono,
      },
    };
  }

  /** 1) La sucursal solicita: queda pendiente, aparta lo pedido y avisa al administrador. */
  async solicitar(
    usuario: UsuarioAutenticado,
    datos: DatosSolicitarDevolucion,
  ): Promise<DevolucionDetalle> {
    const id = await this.bd.transaccion(usuario.id, async (trx) => {
      const { rows } = await sql<{ id: number }>`
        select fn_solicitar_devolucion(${usuario.id}, ${usuario.equipo?.id ?? null}::uuid,
               ${datos.venta_id}, ${datos.tipo}, ${datos.motivo}, ${datos.cliente_nombre},
               ${datos.cliente_telefono}, ${JSON.stringify(datos.lineas)}::jsonb,
               ${datos.sucursal_id ?? null}::integer) as id`.execute(trx);
      return rows[0].id;
    });
    return this.buscar(usuario.id, id);
  }

  /** 2) El administrador aprueba (empieza a correr el plazo para ejecutarla) o rechaza. */
  async resolver(
    usuarioId: number,
    id: number,
    datos: DatosResolverDevolucion,
  ): Promise<DevolucionDetalle> {
    await this.buscar(usuarioId, id);
    await this.bd.transaccion(usuarioId, (trx) =>
      sql`select fn_resolver_devolucion(${usuarioId}, ${id}, ${datos.aprobar},
                 ${datos.comentario})`.execute(trx),
    );
    return this.buscar(usuarioId, id);
  }

  /** Cancela una solicitud que todavía no se ejecuta: quien la hizo o el administrador. */
  async cancelar(usuarioId: number, id: number, motivo: string): Promise<DevolucionDetalle> {
    await this.buscar(usuarioId, id); // una que el usuario no puede ver responde 404
    await this.bd.transaccion(usuarioId, (trx) =>
      sql`select fn_cancelar_devolucion(${usuarioId}, ${id}, ${motivo})`.execute(trx),
    );
    return this.buscar(usuarioId, id);
  }

  /**
   * 3) Se ejecuta en el turno abierto de la caja de la sesión. En un cambio, `items` y `pagos` son
   * los de la venta nueva; si su clave de idempotencia ya se usó en este mismo cambio (reintento
   * de red), se responde con lo que ya quedó (`repetida`) sin ejecutar nada otra vez.
   */
  async ejecutar(
    usuario: UsuarioAutenticado,
    id: number,
    datos: DatosEjecutarDevolucion,
  ): Promise<{ devolucion: DevolucionDetalle; repetida: boolean }> {
    await this.buscar(usuario.id, id);
    const repetida = await this.bd.transaccion(usuario.id, async (trx) => {
      const turno = await exigirTurno(trx, usuario, datos.caja_id);
      if (datos.clave_idempotencia) {
        const previa = await sql<{ devolucion_id: number | null }>`
          select d.id as devolucion_id
            from venta v
            left join devolucion d on d.venta_cambio_id = v.id
           where v.clave_idempotencia = ${datos.clave_idempotencia}::uuid`.execute(trx);
        if (previa.rows[0]?.devolucion_id === id) return true;
        if (previa.rows[0]) {
          throw new HttpException(
            {
              codigo: 'CLAVE_REUTILIZADA',
              mensaje: 'Esa clave ya se usó en otra venta: el POS debe generar una clave nueva',
            },
            HttpStatus.CONFLICT,
          );
        }
      }
      await sql`
        select fn_ejecutar_devolucion(${usuario.id}, ${id}, ${turno},
               ${datos.items.length > 0 ? JSON.stringify(datos.items) : null}::jsonb,
               ${JSON.stringify(datos.pagos)}::jsonb, ${datos.clave_idempotencia ?? null}::uuid,
               ${datos.notas})`.execute(trx);
      return false;
    });
    return { devolucion: await this.buscar(usuario.id, id), repetida };
  }

  /** El administrador anota la transferencia de lo que no salió de la caja. */
  async registrarTransferencia(
    usuarioId: number,
    id: number,
    referencia: string,
  ): Promise<DevolucionDetalle> {
    await this.buscar(usuarioId, id);
    await this.bd.transaccion(usuarioId, (trx) =>
      sql`select fn_registrar_transferencia_devolucion(${usuarioId}, ${id}, ${referencia})`.execute(
        trx,
      ),
    );
    return this.buscar(usuarioId, id);
  }

  /**
   * El ticket de la devolución en PDF (rollo de 80 mm). Cada impresión queda anotada
   * (fn_registrar_impresion_devolucion): la primera es el original y las siguientes, COPIA.
   */
  async imprimir(
    usuarioId: number,
    id: number,
  ): Promise<{ pdf: Buffer; numero: string; impresion: number }> {
    const devolucion = await this.buscar(usuarioId, id);
    return this.bd.transaccion(usuarioId, async (trx) => {
      const { rows } = await sql<{ impresion: number }>`
        select fn_registrar_impresion_devolucion(${usuarioId}, ${id}) as impresion`.execute(trx);
      const impresion = rows[0].impresion;
      const numero = devolucion.numero ?? String(id);
      // Dentro de la transacción: si el PDF no se pudiera armar, la impresión no queda anotada
      const pdf = await ticketPdf(
        renglonesTicketDevolucion(devolucion, impresion),
        `Devolución ${numero}`,
      );
      return { pdf, numero, impresion };
    });
  }

  private async consultar(
    condiciones: Parameters<typeof donde>,
    limite: number,
  ): Promise<FilaDevolucion[]> {
    const { rows } = await sql<FilaDevolucion>`
      select d.id, d.numero, d.tipo, d.estado, d.motivo, d.cliente_nombre, d.cliente_telefono,
             d.monto_total,
             v.id as venta_id, v.numero as venta_numero, v.fecha as venta_fecha,
             sv.id as venta_sucursal_id, sv.codigo as venta_sucursal_codigo,
             sv.nombre as venta_sucursal_nombre,
             ss.id as solicitud_sucursal_id, ss.codigo as solicitud_sucursal_codigo,
             ss.nombre as solicitud_sucursal_nombre,
             us.id as solicitada_por_id, us.nombre_completo as solicitada_por, d.solicitada_at,
             d.vence_el,
             se.id as sucursal_id, se.codigo as sucursal_codigo, se.nombre as sucursal_nombre,
             se.direccion as sucursal_direccion, se.telefono as sucursal_telefono,
             d.ejecutada_at, ue.id as ejecutada_por_id, ue.nombre_completo as ejecutada_por,
             d.turno_id, c.id as caja_id, c.nombre as caja_nombre,
             ur.id as resuelta_por_id, ur.nombre_completo as resuelta_por, d.resuelta_at,
             d.comentario,
             uc.id as cancelada_por_id, uc.nombre_completo as cancelada_por, d.cancelada_at,
             d.motivo_cancelacion,
             d.monto_saldo, d.monto_efectivo, d.monto_transferencia,
             p.efectivo as previsto_efectivo, p.transferencia as previsto_transferencia,
             vc.id as venta_cambio_id, vc.numero as venta_cambio_numero,
             vc.total as venta_cambio_total,
             d.transferencia_referencia, d.transferida_at,
             ut.id as transferida_por_id, ut.nombre_completo as transferida_por,
             (select fn_parametro_txt('NEGOCIO_NOMBRE')) as negocio,
             (select fn_parametro_txt('NEGOCIO_RUC')) as ruc
        from devolucion d
        join venta v on v.id = d.venta_id
        join sucursal sv on sv.id = v.sucursal_id
        join sucursal ss on ss.id = d.sucursal_solicitud_id
        join usuario us on us.id = d.solicitada_por
        left join sucursal se on se.id = d.sucursal_id
        left join usuario ue on ue.id = d.ejecutada_por
        left join turno_caja t on t.id = d.turno_id
        left join caja c on c.id = t.caja_id
        left join usuario ur on ur.id = d.resuelta_por
        left join usuario uc on uc.id = d.cancelada_por
        left join venta vc on vc.id = d.venta_cambio_id
        left join usuario ut on ut.id = d.transferida_por
        -- lo previsto para una devolución que todavía no se ejecuta: como se pagó la factura
        left join lateral fn_reparto_devolucion(d.venta_id, d.monto_total) p
               on d.tipo = 'DEVOLUCION' and d.estado in ('PENDIENTE', 'APROBADA')
        ${donde(...condiciones)}
       order by d.id desc
       limit ${limite}`.execute(this.bd.db);
    return rows;
  }
}
