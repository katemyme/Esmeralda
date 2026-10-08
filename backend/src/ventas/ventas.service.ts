import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { exigirTurnoParaVenta } from '../caja/sesion-caja';
import { donde, patronContiene, referencia, veOrigen } from '../comun/consultas';
import { finDelDia, inicioDelDia } from '../comun/fechas';
import { NoEncontrado } from '../comun/no-encontrado';
import { ticketPdf } from '../exportacion/ticket-pdf';
import type { DatosRegistrarVenta, FiltroVentas } from './esquemas';
import { renglonesTicketVenta } from './ticket-venta';

interface UsuarioReferido {
  id: number;
  nombre_completo: string;
}

interface VarianteReferida {
  id: number;
  sku: string;
  nombre: string;
}

/** Una venta en las listas. */
export interface VentaResumen {
  id: number;
  /** Número de factura: correlativo por sucursal (LAM-00000001). */
  numero: string;
  fecha: Date;
  /** COMPLETADA o ANULADA. */
  estado: string;
  sucursal: { id: number; codigo: string; nombre: string };
  turno_id: number;
  vendedor: UsuarioReferido;
  cliente_nombre: string | null;
  subtotal: string;
  /** Rebaja de la promoción aplicada (la única forma de cobrar menos). */
  descuento: string;
  total: string;
  /** Unidades vendidas (suma de las cantidades de las líneas). */
  articulos: number;
  /**
   * Desde dónde se hizo: EQUIPO (uno registrado de la sucursal) o CELULAR. Solo lo ve el
   * administrador; para los demás llega en null.
   */
  origen: string | null;
}

/** La venta completa: es también lo que se imprime en el ticket. No trae costos. */
export interface VentaDetalle extends VentaResumen {
  caja: { id: number; nombre: string };
  cliente_telefono: string | null;
  notas: string | null;
  /** Córdobas por dólar con que se cobró esta venta. */
  tipo_cambio: string;
  promocion: { id: number; nombre: string } | null;
  lineas: {
    id: number;
    variante: VarianteReferida;
    /** PRODUCTO, SERVICIO (perforación sola) o PAQUETE (perforación con pieza). */
    tipo: string;
    cantidad: number;
    /** Precio establecido al momento de la venta. */
    precio_lista: string;
    /** Precio cobrado (igual o mayor que el de lista). */
    precio_unitario: string;
    subtotal: string;
    /** Piezas que salieron del inventario en un paquete. */
    piezas: { variante: VarianteReferida; cantidad: number }[];
  }[];
  /** Lo que entregó el cliente (sin el vuelto). */
  pagos: {
    metodo: { codigo: string; nombre: string };
    moneda: string;
    monto: string;
    tipo_cambio: string;
    monto_nio: string;
    referencia: string | null;
  }[];
  /** Vuelto entregado, en córdobas. */
  vuelto: string;
  anulacion: { fecha: Date; motivo: string; anulada_por: UsuarioReferido } | null;
  /** Si la venta nació de un cambio: la devolución que la pagó (en `pagos`, el "saldo por cambio"). */
  cambio: { devolucion_id: number; numero: string } | null;
  /**
   * Encabezado y pie del ticket (parámetros NEGOCIO_NOMBRE, NEGOCIO_RUC y TICKET_LEYENDA). `qr` es
   * el texto del código QR que va al pie: el número de factura, para buscar la venta al devolver.
   */
  ticket: {
    negocio: string | null;
    ruc: string | null;
    direccion: string | null;
    telefono: string | null;
    leyenda: string | null;
    qr: string;
  };
}

interface FilaVenta {
  id: number;
  numero: string;
  fecha: Date;
  estado: string;
  turno_id: number;
  sucursal_id: number;
  sucursal_codigo: string;
  sucursal_nombre: string;
  sucursal_direccion: string | null;
  sucursal_telefono: string | null;
  caja_id: number;
  caja_nombre: string;
  vendedor_id: number;
  vendedor: string;
  cliente_nombre: string | null;
  cliente_telefono: string | null;
  notas: string | null;
  subtotal: string;
  descuento: string;
  total: string;
  tipo_cambio: string;
  articulos: number;
  origen: string | null;
  vuelto: string;
  promocion_id: number | null;
  promocion: string | null;
  fecha_anulacion: Date | null;
  motivo_anulacion: string | null;
  anulada_por_id: number | null;
  anulada_por: string | null;
  cambio_id: number | null;
  cambio_numero: string | null;
  negocio: string | null;
  ruc: string | null;
  leyenda: string | null;
}

function aResumen(f: FilaVenta): VentaResumen {
  return {
    id: f.id,
    numero: f.numero,
    fecha: f.fecha,
    estado: f.estado,
    sucursal: { id: f.sucursal_id, codigo: f.sucursal_codigo, nombre: f.sucursal_nombre },
    turno_id: f.turno_id,
    vendedor: { id: f.vendedor_id, nombre_completo: f.vendedor },
    cliente_nombre: f.cliente_nombre,
    subtotal: f.subtotal,
    descuento: f.descuento,
    total: f.total,
    articulos: f.articulos,
    origen: f.origen,
  };
}

/**
 * Ventas del POS. Las reglas (precio que solo sube, promoción vigente, stock, pagos que cuadran,
 * vuelto, correlativo de la factura, anular solo con el turno abierto) las aplica la base:
 * fn_registrar_venta y fn_anular_venta. El turno de la venta sale del equipo de la sesión.
 * Alcance: con VENTAS_VER_TODAS, las ventas de sus sucursales; si no, solo las propias. Desde el
 * celular (sin equipo registrado) cada quien ve solo las ventas que hizo en un turno que sigue
 * abierto, tenga el permiso que tenga.
 */
@Injectable()
export class VentasService {
  constructor(private readonly bd: BaseDatosService) {}

  async listar(usuario: UsuarioAutenticado, filtro: FiltroVentas): Promise<VentaResumen[]> {
    const patron = filtro.buscar && patronContiene(filtro.buscar);
    const filas = await this.consultar(
      usuario,
      [
        filtro.sucursal_id && sql`v.sucursal_id = ${filtro.sucursal_id}`,
        filtro.turno_id && sql`v.turno_id = ${filtro.turno_id}`,
        filtro.vendedor_id && sql`v.vendedor_id = ${filtro.vendedor_id}`,
        filtro.estado && sql`v.estado = ${filtro.estado}`,
        filtro.desde && sql`v.fecha >= ${inicioDelDia(filtro.desde)}`,
        filtro.hasta && sql`v.fecha < ${finDelDia(filtro.hasta)}`,
        patron && sql`(v.numero ilike ${patron} or v.cliente_nombre ilike ${patron})`,
        filtro.antes_de && sql`v.id < ${filtro.antes_de}`,
      ],
      filtro.limite,
    );
    return filas.map(aResumen);
  }

  async buscar(usuario: UsuarioAutenticado, id: number): Promise<VentaDetalle> {
    const [fila] = await this.consultar(usuario, [sql`v.id = ${id}`], 1);
    if (!fila) throw new NoEncontrado(`La venta ${id} no existe`);

    const [lineas, piezas, pagos] = await Promise.all([
      sql<{
        id: number;
        variante_id: number;
        sku: string;
        nombre: string;
        tipo: string;
        cantidad: number;
        precio_lista: string;
        precio_unitario: string;
        subtotal: string;
      }>`
        select d.id, va.id as variante_id, va.sku, pr.nombre || ' — ' || va.nombre as nombre,
               pr.tipo, d.cantidad, d.precio_lista, d.precio_unitario, d.subtotal
          from venta_detalle d
          join variante va on va.id = d.variante_id
          join producto pr on pr.id = va.producto_id
         where d.venta_id = ${id}
         order by d.id`.execute(this.bd.db),
      sql<{
        venta_detalle_id: number;
        variante_id: number;
        sku: string;
        nombre: string;
        cantidad: number;
      }>`
        select dp.venta_detalle_id, va.id as variante_id, va.sku,
               pr.nombre || ' — ' || va.nombre as nombre, dp.cantidad
          from venta_detalle_pieza dp
          join venta_detalle d on d.id = dp.venta_detalle_id
          join variante va on va.id = dp.variante_id
          join producto pr on pr.id = va.producto_id
         where d.venta_id = ${id}
         order by dp.venta_detalle_id, va.id`.execute(this.bd.db),
      sql<{
        codigo: string;
        nombre: string;
        moneda: string;
        monto: string;
        tipo_cambio: string;
        monto_nio: string;
        referencia: string | null;
      }>`
        select m.codigo, m.nombre, p.moneda, p.monto, p.tipo_cambio, p.monto_nio, p.referencia
          from venta_pago p
          join metodo_pago m on m.id = p.metodo_pago_id
         where p.venta_id = ${id} and not p.es_vuelto
         order by p.id`.execute(this.bd.db),
    ]);

    return {
      ...aResumen(fila),
      caja: { id: fila.caja_id, nombre: fila.caja_nombre },
      cliente_telefono: fila.cliente_telefono,
      notas: fila.notas,
      tipo_cambio: fila.tipo_cambio,
      promocion: referencia(fila.promocion_id, fila.promocion),
      lineas: lineas.rows.map((l) => ({
        id: l.id,
        variante: { id: l.variante_id, sku: l.sku, nombre: l.nombre },
        tipo: l.tipo,
        cantidad: l.cantidad,
        precio_lista: l.precio_lista,
        precio_unitario: l.precio_unitario,
        subtotal: l.subtotal,
        piezas: piezas.rows
          .filter((p) => p.venta_detalle_id === l.id)
          .map((p) => ({
            variante: { id: p.variante_id, sku: p.sku, nombre: p.nombre },
            cantidad: p.cantidad,
          })),
      })),
      pagos: pagos.rows.map((p) => ({
        metodo: { codigo: p.codigo, nombre: p.nombre },
        moneda: p.moneda,
        monto: p.monto,
        tipo_cambio: p.tipo_cambio,
        monto_nio: p.monto_nio,
        referencia: p.referencia,
      })),
      vuelto: fila.vuelto,
      anulacion:
        fila.fecha_anulacion !== null &&
        fila.motivo_anulacion !== null &&
        fila.anulada_por_id !== null &&
        fila.anulada_por !== null
          ? {
              fecha: fila.fecha_anulacion,
              motivo: fila.motivo_anulacion,
              anulada_por: { id: fila.anulada_por_id, nombre_completo: fila.anulada_por },
            }
          : null,
      cambio:
        fila.cambio_id !== null && fila.cambio_numero !== null
          ? { devolucion_id: fila.cambio_id, numero: fila.cambio_numero }
          : null,
      ticket: {
        negocio: fila.negocio,
        ruc: fila.ruc,
        direccion: fila.sucursal_direccion,
        telefono: fila.sucursal_telefono,
        leyenda: fila.leyenda,
        qr: fila.numero,
      },
    };
  }

  /**
   * Registra la venta en el turno abierto de la caja de la sesión (desde el celular, en el de su
   * sucursal) y anota desde dónde se hizo. Si la clave de idempotencia ya
   * se usó (doble clic, reintento de red), la base devuelve la venta que ya existía: aquí se
   * responde con ella (`repetida`) siempre que sea de este mismo vendedor y turno.
   */
  async registrar(
    usuario: UsuarioAutenticado,
    datos: DatosRegistrarVenta,
  ): Promise<{ venta: VentaDetalle; repetida: boolean }> {
    const { id, repetida } = await this.bd.transaccion(usuario.id, async (trx) => {
      const turno = await exigirTurnoParaVenta(trx, usuario, datos.caja_id);
      const previa = await sql`
        select 1 from venta where clave_idempotencia = ${datos.clave_idempotencia}`.execute(trx);
      const { rows } = await sql<{ id: number }>`
        select fn_registrar_venta(${usuario.id}, ${turno},
               ${JSON.stringify(datos.items)}::jsonb, ${JSON.stringify(datos.pagos)}::jsonb,
               ${datos.promocion_id}::integer, ${datos.cliente_nombre},
               ${datos.cliente_telefono}, ${datos.notas},
               ${datos.clave_idempotencia}::uuid, null,
               ${usuario.equipo ? 'EQUIPO' : 'CELULAR'}) as id`.execute(trx);
      // En otra sentencia: la que llama a la función no ve la venta que esta acaba de guardar
      const venta = await trx
        .selectFrom('venta')
        .select(['id', 'turno_id', 'vendedor_id'])
        .where('id', '=', rows[0].id)
        .executeTakeFirstOrThrow();
      if (venta.turno_id !== turno || venta.vendedor_id !== usuario.id) {
        throw new HttpException(
          {
            codigo: 'CLAVE_REUTILIZADA',
            mensaje: 'Esa clave ya se usó en otra venta: el POS debe generar una clave nueva',
          },
          HttpStatus.CONFLICT,
        );
      }
      return { id: venta.id, repetida: previa.rows.length > 0 };
    });
    return { venta: await this.buscar(usuario, id), repetida };
  }

  /** Anula la venta y devuelve las piezas al inventario; solo mientras su turno sigue abierto. */
  async anular(usuario: UsuarioAutenticado, id: number, motivo: string): Promise<VentaDetalle> {
    await this.buscar(usuario, id); // una venta que el usuario no puede ver responde 404
    await this.bd.transaccion(usuario.id, (trx) =>
      sql`select fn_anular_venta(${usuario.id}, ${id}, ${motivo})`.execute(trx),
    );
    return this.buscar(usuario, id);
  }

  /**
   * El ticket de la venta en PDF (rollo de 80 mm). Cada impresión queda anotada
   * (fn_registrar_impresion_venta): la primera es el original y las siguientes salen como COPIA.
   */
  async imprimir(
    usuario: UsuarioAutenticado,
    id: number,
  ): Promise<{ pdf: Buffer; numero: string; impresion: number }> {
    const venta = await this.buscar(usuario, id); // una venta que el usuario no puede ver responde 404
    return this.bd.transaccion(usuario.id, async (trx) => {
      const { rows } = await sql<{ impresion: number }>`
        select fn_registrar_impresion_venta(${usuario.id}, ${id}) as impresion`.execute(trx);
      const impresion = rows[0].impresion;
      // Dentro de la transacción: si el PDF no se pudiera armar, la impresión no queda anotada
      const pdf = await ticketPdf(renglonesTicketVenta(venta, impresion), `Ticket ${venta.numero}`);
      return { pdf, numero: venta.numero, impresion };
    });
  }

  private async consultar(
    usuario: UsuarioAutenticado,
    condiciones: Parameters<typeof donde>,
    limite: number,
  ): Promise<FilaVenta[]> {
    const usuarioId = usuario.id;
    // Desde el celular: solo sus ventas del turno que sigue abierto (el detalle y el ticket)
    const alcance = sql`(case when (select fn_equipo_autorizado(${usuarioId},
                                                               ${usuario.equipo?.id ?? null}::uuid))
                              then (v.vendedor_id = ${usuarioId}
                                    or ((select fn_tiene_permiso(${usuarioId}, 'VENTAS_VER_TODAS'))
                                        and fn_puede_operar_sucursal(${usuarioId}, v.sucursal_id)))
                              else (v.vendedor_id = ${usuarioId} and t.estado = 'ABIERTO') end)`;
    const { rows } = await sql<FilaVenta>`
      select v.id, v.numero, v.fecha, v.estado, v.turno_id,
             s.id as sucursal_id, s.codigo as sucursal_codigo, s.nombre as sucursal_nombre,
             s.direccion as sucursal_direccion, s.telefono as sucursal_telefono,
             c.id as caja_id, c.nombre as caja_nombre,
             u.id as vendedor_id, u.nombre_completo as vendedor,
             v.cliente_nombre, v.cliente_telefono, v.notas,
             v.subtotal, v.descuento, v.total, v.tipo_cambio,
             (select coalesce(sum(d.cantidad), 0)::integer
                from venta_detalle d where d.venta_id = v.id) as articulos,
             case when ${veOrigen(usuarioId)} then v.origen end as origen,
             (select coalesce(-sum(p.monto), 0)::numeric(12,2)
                from venta_pago p where p.venta_id = v.id and p.es_vuelto) as vuelto,
             pm.id as promocion_id, pm.nombre as promocion,
             v.fecha_anulacion, v.motivo_anulacion,
             ua.id as anulada_por_id, ua.nombre_completo as anulada_por,
             dc.id as cambio_id, dc.numero as cambio_numero,
             (select fn_parametro_txt('NEGOCIO_NOMBRE')) as negocio,
             (select fn_parametro_txt('NEGOCIO_RUC')) as ruc,
             (select fn_parametro_txt('TICKET_LEYENDA')) as leyenda
        from venta v
        join sucursal s on s.id = v.sucursal_id
        join turno_caja t on t.id = v.turno_id
        join caja c on c.id = t.caja_id
        join usuario u on u.id = v.vendedor_id
        left join promocion pm on pm.id = v.promocion_id
        left join usuario ua on ua.id = v.anulada_por
        left join devolucion dc on dc.venta_cambio_id = v.id
        ${donde(alcance, ...condiciones)}
       order by v.id desc
       limit ${limite}`.execute(this.bd.db);
    return rows;
  }
}
