import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { donde, veCostos } from '../comun/consultas';
import { finDelDia, inicioDelDia } from '../comun/fechas';
import { NoEncontrado } from '../comun/no-encontrado';
import { fechaHora, mesCorto } from '../exportacion/formato';
import type {
  FiltroInventarioValorizado,
  FiltroReporte,
  FiltroReporteActual,
  FiltroReporteProductos,
  FiltroReporteVentas,
} from './esquemas';
import { resolverRango, type Periodo } from './periodo';
import { seccion, type ColumnaDefinida, type Fila, type Reporte, type Seccion } from './reporte';

/** Lo que se resuelve una vez por reporte: el rango, la sucursal pedida y qué puede ver el usuario. */
interface Contexto {
  usuarioId: number;
  desde: string;
  hasta: string;
  sucursal: Reporte['sucursal'];
  veCostos: boolean;
  /** Tiene CAJA_VER_DIFERENCIAS: sus reportes incluyen las ventas de los turnos abiertos. */
  veTurnosAbiertos: boolean;
  veBodega: boolean;
}

/** Fila de una consulta con `grouping sets`: la de totales llega marcada con es_total = 1. */
type FilaAgrupada = Fila & { es_total: number };

const NOTA_TURNOS_ABIERTOS = 'No incluye las ventas de los turnos de caja que siguen abiertos.';

// Medidas comunes de los reportes de ventas (ver `medidas()`)
const MEDIDAS: ColumnaDefinida[] = [
  { clave: 'ventas', titulo: 'Ventas', tipo: 'entero' },
  { clave: 'unidades', titulo: 'Unidades', tipo: 'entero' },
  { clave: 'descuentos', titulo: 'Descuentos', tipo: 'monto' },
  { clave: 'venta_neta', titulo: 'Venta neta', tipo: 'monto' },
  { clave: 'sobreprecio', titulo: 'Sobreprecio', tipo: 'monto' },
  { clave: 'ticket_promedio', titulo: 'Ticket promedio', tipo: 'monto' },
  { clave: 'costo', titulo: 'Costo', tipo: 'monto', costo: true },
  { clave: 'margen', titulo: 'Margen', tipo: 'monto', costo: true },
  { clave: 'margen_pct', titulo: 'Margen %', tipo: 'porcentaje', costo: true },
];

/**
 * Las medidas de un grupo de líneas de venta (`l`). La venta neta ya trae prorrateado el descuento
 * de la promoción. El costo y el margen solo salen con REPORTES_COSTOS: se ocultan en la consulta.
 */
function medidas(costos: RawBuilder<boolean>): RawBuilder<unknown> {
  return sql`
    count(distinct l.venta_id)::integer as ventas,
    coalesce(sum(l.cantidad), 0)::integer as unidades,
    round(coalesce(sum(l.subtotal_linea) - sum(l.venta_neta), 0), 2) as descuentos,
    round(coalesce(sum(l.venta_neta), 0), 2) as venta_neta,
    round(coalesce(sum(l.sobreprecio), 0), 2) as sobreprecio,
    round(sum(l.venta_neta) / nullif(count(distinct l.venta_id), 0), 2) as ticket_promedio,
    case when ${costos} then round(coalesce(sum(l.costo), 0), 2) end as costo,
    case when ${costos} then round(coalesce(sum(l.margen), 0), 2) end as margen,
    case when ${costos} then round(100 * sum(l.margen) / nullif(sum(l.venta_neta), 0), 1) end
      as margen_pct`;
}

function separar(filas: FilaAgrupada[]): { filas: Fila[]; totales: Fila | null } {
  return {
    filas: filas.filter((f) => f.es_total === 0),
    totales: filas.find((f) => f.es_total === 1) ?? null,
  };
}

/**
 * Reportes (B7). Son lecturas: cada una arma un `Reporte` que sale como JSON, Excel o PDF.
 * Qué ve cada quien lo decide la base en la propia consulta:
 * - las ventas que entran a un reporte las da fn_ventas_reporte (sus sucursales y, sin
 *   CAJA_VER_DIFERENCIAS, solo turnos ya cerrados: el arqueo es a ciegas);
 * - el costo y el margen se ocultan sin REPORTES_COSTOS; la cantidad de la bodega, sin permiso
 *   para verla; lo demás se limita a las sucursales del usuario (fn_puede_operar_sucursal).
 */
@Injectable()
export class ReportesService {
  constructor(private readonly bd: BaseDatosService) {}

  // ------------------------------------------------------------------------ Ventas

  /** Ventas del rango partidas por día, semana (lunes a domingo) o mes. */
  async ventas(usuarioId: number, filtro: FiltroReporteVentas): Promise<Reporte> {
    const c = await this.contexto(usuarioId, filtro);
    const unidad = { dia: 'day', semana: 'week', mes: 'month' }[filtro.agrupar];
    const { rows } = await sql<FilaAgrupada>`
      select grouping(l.periodo)::integer as es_total, l.periodo, ${medidas(veCostos(usuarioId))}
        from (select l.*, date_trunc(${unidad}::text, l.dia::timestamp)::date as periodo
                from ${this.lineas(c)}) l
       group by grouping sets ((l.periodo), ())
       order by 1, 2`.execute(this.bd.db);
    const periodo: Record<Periodo, ColumnaDefinida> = {
      dia: { clave: 'periodo', titulo: 'Día', tipo: 'fecha' },
      semana: { clave: 'periodo', titulo: 'Semana del', tipo: 'fecha' },
      mes: { clave: 'periodo', titulo: 'Mes', tipo: 'mes' },
    };
    const titulo = { dia: 'Ventas por día', semana: 'Ventas por semana', mes: 'Ventas por mes' };
    return this.deVentas(c, 'ventas', titulo[filtro.agrupar], [
      this.seccion(
        c,
        'ventas',
        titulo[filtro.agrupar],
        [periodo[filtro.agrupar], ...MEDIDAS],
        rows,
      ),
    ]);
  }

  /** Lo vendido por cada persona, con las ventas que se le anularon. */
  async ventasPorVendedor(usuarioId: number, filtro: FiltroReporte): Promise<Reporte> {
    const c = await this.contexto(usuarioId, filtro);
    const [ventas, anuladas] = await Promise.all([
      sql<FilaAgrupada>`
        select grouping(l.vendedor_id)::integer as es_total, l.vendedor_id, l.vendedor,
               ${medidas(veCostos(usuarioId))}
          from ${this.lineas(c)}
         group by grouping sets ((l.vendedor_id, l.vendedor), ())
         order by 1, sum(l.venta_neta) desc, l.vendedor`.execute(this.bd.db),
      sql<FilaAgrupada>`
        select grouping(x.vendedor_id)::integer as es_total, x.vendedor_id,
               u.nombre_completo as vendedor, count(*)::integer as anuladas,
               coalesce(sum(x.total), 0)::numeric(14,2) as total_anulado
          from venta x
          join usuario u on u.id = x.vendedor_id
         where x.id in (${this.ventasDelReporte(c, 'ANULADA')})
         group by grouping sets ((x.vendedor_id, u.nombre_completo), ())
         order by 1, u.nombre_completo`.execute(this.bd.db),
    ]);
    // Quien solo tiene ventas anuladas también sale, con sus ventas en cero
    const sinVentas: Fila = {
      ventas: 0,
      unidades: 0,
      descuentos: '0.00',
      venta_neta: '0.00',
      sobreprecio: '0.00',
      ticket_promedio: null,
      costo: '0.00',
      margen: '0.00',
      margen_pct: null,
    };
    // La fila de totales no tiene vendedor: su clave es "1|"
    const clave = (f: FilaAgrupada) => [f.es_total, f.vendedor_id].join('|');
    const anulacion = new Map(anuladas.rows.map((a) => [clave(a), a]));
    const filas: FilaAgrupada[] = ventas.rows.map((v) => {
      const suya = anulacion.get(clave(v));
      anulacion.delete(clave(v));
      return {
        ...v,
        anuladas: suya?.anuladas ?? 0,
        total_anulado: suya?.total_anulado ?? '0.00',
      };
    });
    for (const a of anulacion.values()) filas.push({ ...sinVentas, ...a });
    const titulo = 'Ventas por vendedor';
    return this.deVentas(c, 'ventas-por-vendedor', titulo, [
      this.seccion(
        c,
        'vendedores',
        titulo,
        [
          { clave: 'vendedor', titulo: 'Vendedor', tipo: 'texto' },
          ...MEDIDAS,
          { clave: 'anuladas', titulo: 'Anuladas', tipo: 'entero' },
          { clave: 'total_anulado', titulo: 'Monto anulado', tipo: 'monto' },
        ],
        filas,
      ),
    ]);
  }

  async ventasPorSucursal(usuarioId: number, filtro: FiltroReporte): Promise<Reporte> {
    const c = await this.contexto(usuarioId, filtro);
    const { rows } = await sql<FilaAgrupada>`
      select grouping(l.sucursal_id)::integer as es_total, l.sucursal,
             ${medidas(veCostos(usuarioId))}
        from ${this.lineas(c)}
       group by grouping sets ((l.sucursal_id, l.sucursal), ())
       order by 1, l.sucursal`.execute(this.bd.db);
    const titulo = 'Ventas por sucursal';
    return this.deVentas(c, 'ventas-por-sucursal', titulo, [
      this.seccion(
        c,
        'sucursales',
        titulo,
        [{ clave: 'sucursal', titulo: 'Sucursal', tipo: 'texto' }, ...MEDIDAS],
        rows,
      ),
    ]);
  }

  /** Lo cobrado por método de pago y moneda. El vuelto ya está restado del efectivo en córdobas. */
  async cobros(usuarioId: number, filtro: FiltroReporte): Promise<Reporte> {
    const c = await this.contexto(usuarioId, filtro);
    const { rows } = await sql<FilaAgrupada>`
      select grouping(m.id)::integer as es_total, m.nombre as metodo, p.moneda,
             count(distinct p.venta_id)::integer as ventas,
             case when grouping(m.id) = 0 then sum(p.monto)::numeric(14,2) end as monto,
             coalesce(sum(p.monto_nio), 0)::numeric(14,2) as monto_nio
        from venta_pago p
        join metodo_pago m on m.id = p.metodo_pago_id
       where p.venta_id in (${this.ventasDelReporte(c)})
       group by grouping sets ((m.id, m.nombre, p.moneda), ())
       order by 1, m.id, p.moneda`.execute(this.bd.db);
    const { filas, totales } = separar(rows);
    return this.deVentas(c, 'cobros', 'Cobros por método de pago', [
      seccion(
        'cobros',
        'Cobros por método de pago',
        [
          { clave: 'metodo', titulo: 'Método', tipo: 'texto' },
          { clave: 'moneda', titulo: 'Moneda', tipo: 'texto' },
          { clave: 'ventas', titulo: 'Ventas', tipo: 'entero' },
          { clave: 'monto', titulo: 'Monto en su moneda', tipo: 'monto' },
          { clave: 'monto_nio', titulo: 'Equivalente en C$', tipo: 'monto' },
        ],
        filas,
        // Sumar córdobas con dólares no dice nada: el total va solo en su equivalente
        totales && { ventas: totales.ventas, monto_nio: totales.monto_nio },
        c.veCostos,
      ),
    ]);
  }

  /** Lo que más se vendió, por unidades. */
  async productos(usuarioId: number, filtro: FiltroReporteProductos): Promise<Reporte> {
    const c = await this.contexto(usuarioId, filtro);
    const costos = veCostos(usuarioId);
    const { rows } = await sql<Fila>`
      select l.sku, l.producto || ' — ' || l.variante as producto, l.categoria,
             sum(l.cantidad)::integer as unidades,
             round(sum(l.venta_neta), 2) as venta_neta,
             case when ${costos} then round(sum(l.costo), 2) end as costo,
             case when ${costos} then round(sum(l.margen), 2) end as margen,
             case when ${costos} then round(100 * sum(l.margen) / nullif(sum(l.venta_neta), 0), 1) end
               as margen_pct
        from ${this.lineas(c)}
       group by l.variante_id, l.sku, l.producto, l.variante, l.categoria
       order by sum(l.cantidad) desc, sum(l.venta_neta) desc, l.sku
       limit ${filtro.limite}`.execute(this.bd.db);
    const titulo = 'Productos más vendidos';
    return this.deVentas(c, 'productos', titulo, [
      seccion(
        'productos',
        `${titulo} (los ${filtro.limite} primeros)`,
        [
          { clave: 'sku', titulo: 'SKU', tipo: 'texto' },
          { clave: 'producto', titulo: 'Producto', tipo: 'texto' },
          { clave: 'categoria', titulo: 'Categoría', tipo: 'texto' },
          { clave: 'unidades', titulo: 'Unidades', tipo: 'entero' },
          { clave: 'venta_neta', titulo: 'Venta neta', tipo: 'monto' },
          { clave: 'costo', titulo: 'Costo', tipo: 'monto', costo: true },
          { clave: 'margen', titulo: 'Margen', tipo: 'monto', costo: true },
          { clave: 'margen_pct', titulo: 'Margen %', tipo: 'porcentaje', costo: true },
        ],
        rows,
        null,
        c.veCostos,
      ),
    ]);
  }

  /** Cada perforación: cuántas se vendieron con pieza (paquete) y cuántas de solo servicio. */
  async perforaciones(usuarioId: number, filtro: FiltroReporte): Promise<Reporte> {
    const c = await this.contexto(usuarioId, filtro);
    const { rows } = await sql<FilaAgrupada>`
      select grouping(pf.id)::integer as es_total, pf.nombre as perforacion,
             coalesce(sum(l.cantidad) filter (where l.variante_id = pf.paquete_variante_id), 0)::integer
               as con_pieza,
             coalesce(sum(l.cantidad) filter (where l.variante_id = pf.servicio_variante_id), 0)::integer
               as solo_servicio,
             coalesce(sum(l.cantidad), 0)::integer as total,
             round(coalesce(sum(l.venta_neta), 0), 2) as venta_neta,
             case when ${veCostos(usuarioId)} then round(coalesce(sum(l.margen), 0), 2) end as margen
        from ${this.lineas(c)}
        join perforacion pf on l.variante_id in (pf.servicio_variante_id, pf.paquete_variante_id)
       group by grouping sets ((pf.id, pf.nombre), ())
       order by 1, sum(l.cantidad) desc, pf.nombre`.execute(this.bd.db);
    const titulo = 'Perforaciones: con pieza y solo servicio';
    return this.deVentas(c, 'perforaciones', titulo, [
      this.seccion(
        c,
        'perforaciones',
        titulo,
        [
          { clave: 'perforacion', titulo: 'Perforación', tipo: 'texto' },
          { clave: 'con_pieza', titulo: 'Con pieza', tipo: 'entero' },
          { clave: 'solo_servicio', titulo: 'Solo servicio', tipo: 'entero' },
          { clave: 'total', titulo: 'Total', tipo: 'entero' },
          { clave: 'venta_neta', titulo: 'Venta neta', tipo: 'monto' },
          { clave: 'margen', titulo: 'Margen', tipo: 'monto', costo: true },
        ],
        rows,
      ),
    ]);
  }

  /** Paquetes vendidos según la gama de la pieza que llevaron. */
  async gamas(usuarioId: number, filtro: FiltroReporte): Promise<Reporte> {
    const c = await this.contexto(usuarioId, filtro);
    const { rows } = await sql<FilaAgrupada>`
      select grouping(g.id)::integer as es_total, g.nombre as gama, count(*)::integer as paquetes,
             round(coalesce(sum(l.venta_neta), 0), 2) as venta_neta,
             case when ${veCostos(usuarioId)} then round(coalesce(sum(l.margen), 0), 2) end as margen
        from ${this.lineas(c)}
        join lateral (select min(va.gama_id) as gama_id
                        from venta_detalle_pieza dp
                        join variante va on va.id = dp.variante_id
                       where dp.venta_detalle_id = l.detalle_id) pieza on true
        join gama g on g.id = pieza.gama_id
       where l.tipo = 'PAQUETE'
       group by grouping sets ((g.id, g.nombre, g.orden), ())
       order by 1, g.orden, g.nombre`.execute(this.bd.db);
    const titulo = 'Paquetes vendidos por gama';
    return this.deVentas(c, 'gamas', titulo, [
      this.seccion(
        c,
        'gamas',
        titulo,
        [
          { clave: 'gama', titulo: 'Gama', tipo: 'texto' },
          { clave: 'paquetes', titulo: 'Paquetes', tipo: 'entero' },
          { clave: 'venta_neta', titulo: 'Venta neta', tipo: 'monto' },
          { clave: 'margen', titulo: 'Margen', tipo: 'monto', costo: true },
        ],
        rows,
      ),
    ]);
  }

  /** Cuánto se vendió y cuánto se rebajó con cada promoción. */
  async promociones(usuarioId: number, filtro: FiltroReporte): Promise<Reporte> {
    const c = await this.contexto(usuarioId, filtro);
    const { rows } = await sql<FilaAgrupada>`
      select grouping(pm.id)::integer as es_total, pm.nombre as promocion,
             count(*)::integer as ventas,
             coalesce(sum(v.subtotal), 0)::numeric(14,2) as subtotal,
             coalesce(sum(v.descuento), 0)::numeric(14,2) as descuento,
             coalesce(sum(v.total), 0)::numeric(14,2) as total
        from venta v
        join promocion pm on pm.id = v.promocion_id
       where v.id in (${this.ventasDelReporte(c)})
       group by grouping sets ((pm.id, pm.nombre), ())
       order by 1, sum(v.descuento) desc, pm.nombre`.execute(this.bd.db);
    const titulo = 'Ventas con promoción';
    return this.deVentas(c, 'promociones', titulo, [
      this.seccion(
        c,
        'promociones',
        titulo,
        [
          { clave: 'promocion', titulo: 'Promoción', tipo: 'texto' },
          { clave: 'ventas', titulo: 'Ventas', tipo: 'entero' },
          { clave: 'subtotal', titulo: 'Antes de la rebaja', tipo: 'monto' },
          { clave: 'descuento', titulo: 'Rebaja', tipo: 'monto' },
          { clave: 'total', titulo: 'Cobrado', tipo: 'monto' },
        ],
        rows,
      ),
    ]);
  }

  /** Cada línea que se cobró por encima del precio establecido. */
  async sobreprecios(usuarioId: number, filtro: FiltroReporte): Promise<Reporte> {
    const c = await this.contexto(usuarioId, filtro);
    const subidas = sql`${this.lineas(c)} where l.precio_unitario > l.precio_lista`;
    const [lineas, total] = await Promise.all([
      sql<Fila>`
        select l.fecha, l.numero, l.sucursal, l.vendedor,
               l.producto || ' — ' || l.variante as producto, l.cantidad, l.precio_lista,
               l.precio_unitario,
               round(100 * (l.precio_unitario - l.precio_lista) / nullif(l.precio_lista, 0), 1)
                 as aumento_pct,
               l.sobreprecio::numeric(14,2) as sobreprecio
          from ${subidas}
         order by l.fecha, l.detalle_id`.execute(this.bd.db),
      sql<Fila>`
        select coalesce(sum(l.cantidad), 0)::integer as cantidad,
               coalesce(sum(l.sobreprecio), 0)::numeric(14,2) as sobreprecio
          from ${subidas}`.execute(this.bd.db),
    ]);
    const titulo = 'Ventas cobradas por encima del precio';
    return this.deVentas(c, 'sobreprecios', titulo, [
      seccion(
        'sobreprecios',
        titulo,
        [
          { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha_hora' },
          { clave: 'numero', titulo: 'Factura', tipo: 'texto' },
          { clave: 'sucursal', titulo: 'Sucursal', tipo: 'texto' },
          { clave: 'vendedor', titulo: 'Vendedor', tipo: 'texto' },
          { clave: 'producto', titulo: 'Producto', tipo: 'texto' },
          { clave: 'cantidad', titulo: 'Cantidad', tipo: 'entero' },
          { clave: 'precio_lista', titulo: 'Precio establecido', tipo: 'monto' },
          { clave: 'precio_unitario', titulo: 'Precio cobrado', tipo: 'monto' },
          { clave: 'aumento_pct', titulo: 'Aumento %', tipo: 'porcentaje' },
          { clave: 'sobreprecio', titulo: 'Cobrado de más', tipo: 'monto' },
        ],
        lineas.rows,
        total.rows[0],
        c.veCostos,
      ),
    ]);
  }

  // ------------------------------------------------------------------- Cierres de caja

  /**
   * Los turnos que se cerraron en el rango, con lo esperado, lo contado y la diferencia. Pide
   * CAJA_VER_DIFERENCIAS (lo exige la ruta): es lo único que muestra montos esperados.
   */
  async cierres(usuarioId: number, filtro: FiltroReporte): Promise<Reporte> {
    const c = await this.contexto(usuarioId, filtro);
    const turnos = sql`
      (select t.id, s.nombre as sucursal, cj.nombre as caja, t.fecha_cierre,
              u.nombre_completo as cerrado_por, v.ventas, v.total_vendido,
              d.esperado_nio, d.contado_nio, d.diferencia_nio,
              d.esperado_usd, d.contado_usd, d.diferencia_usd,
              t.intentos_cierre > 0 as hubo_reconteo, t.cierre_forzado,
              t.justificacion_diferencia as justificacion
         from turno_caja t
         join caja cj on cj.id = t.caja_id
         join sucursal s on s.id = cj.sucursal_id
         join usuario u on u.id = t.usuario_cierre_id
        cross join lateral (
              select count(*) filter (where ve.estado = 'COMPLETADA')::integer as ventas,
                     coalesce(sum(ve.total) filter (where ve.estado = 'COMPLETADA'), 0)::numeric(14,2)
                       as total_vendido
                from venta ve
               where ve.turno_id = t.id) v
        cross join lateral (
              select coalesce(sum(cd.monto_esperado) filter (where cd.moneda = 'NIO'), 0)::numeric(14,2) as esperado_nio,
                     coalesce(sum(cd.monto_contado) filter (where cd.moneda = 'NIO'), 0)::numeric(14,2) as contado_nio,
                     coalesce(sum(cd.diferencia) filter (where cd.moneda = 'NIO'), 0)::numeric(14,2) as diferencia_nio,
                     coalesce(sum(cd.monto_esperado) filter (where cd.moneda = 'USD'), 0)::numeric(14,2) as esperado_usd,
                     coalesce(sum(cd.monto_contado) filter (where cd.moneda = 'USD'), 0)::numeric(14,2) as contado_usd,
                     coalesce(sum(cd.diferencia) filter (where cd.moneda = 'USD'), 0)::numeric(14,2) as diferencia_usd
                from cierre_caja_detalle cd
               where cd.turno_id = t.id) d
        ${donde(
          sql`t.estado = 'CERRADO'`,
          sql`t.fecha_cierre >= ${inicioDelDia(c.desde)}`,
          sql`t.fecha_cierre < ${finDelDia(c.hasta)}`,
          sql`fn_puede_operar_sucursal(${usuarioId}, cj.sucursal_id)`,
          c.sucursal && sql`cj.sucursal_id = ${c.sucursal.id}`,
        )}) x`;
    const [cierres, resumen] = await Promise.all([
      sql<Fila>`select x.* from ${turnos} order by x.fecha_cierre, x.id`.execute(this.bd.db),
      sql<Fila>`
        select count(*)::integer as cierres,
               count(*) filter (where x.diferencia_nio <> 0 or x.diferencia_usd <> 0)::integer
                 as con_diferencia,
               count(*) filter (where x.hubo_reconteo)::integer as con_reconteo,
               count(*) filter (where x.cierre_forzado)::integer as forzados,
               coalesce(sum(x.ventas), 0)::integer as ventas,
               coalesce(sum(x.total_vendido), 0)::numeric(14,2) as total_vendido,
               coalesce(sum(x.diferencia_nio), 0)::numeric(14,2) as diferencia_nio,
               coalesce(sum(x.diferencia_usd), 0)::numeric(14,2) as diferencia_usd,
               coalesce(-sum(x.diferencia_nio) filter (where x.diferencia_nio < 0), 0)::numeric(14,2)
                 as faltante_nio,
               coalesce(sum(x.diferencia_nio) filter (where x.diferencia_nio > 0), 0)::numeric(14,2)
                 as sobrante_nio,
               coalesce(-sum(x.diferencia_usd) filter (where x.diferencia_usd < 0), 0)::numeric(14,2)
                 as faltante_usd,
               coalesce(sum(x.diferencia_usd) filter (where x.diferencia_usd > 0), 0)::numeric(14,2)
                 as sobrante_usd
          from ${turnos}`.execute(this.bd.db),
    ]);
    const total = resumen.rows[0];
    return this.reporte(c, 'cierres', 'Cierres de caja', [
      seccion(
        'resumen',
        'Resumen',
        [
          { clave: 'cierres', titulo: 'Cierres', tipo: 'entero' },
          { clave: 'con_diferencia', titulo: 'Con diferencia', tipo: 'entero' },
          { clave: 'con_reconteo', titulo: 'Con reconteo', tipo: 'entero' },
          { clave: 'forzados', titulo: 'Forzados', tipo: 'entero' },
          { clave: 'faltante_nio', titulo: 'Faltante C$', tipo: 'monto' },
          { clave: 'sobrante_nio', titulo: 'Sobrante C$', tipo: 'monto' },
          { clave: 'faltante_usd', titulo: 'Faltante US$', tipo: 'monto' },
          { clave: 'sobrante_usd', titulo: 'Sobrante US$', tipo: 'monto' },
        ],
        [total],
        null,
        c.veCostos,
      ),
      seccion(
        'cierres',
        'Cierres de caja',
        [
          { clave: 'sucursal', titulo: 'Sucursal', tipo: 'texto' },
          { clave: 'caja', titulo: 'Caja', tipo: 'texto' },
          { clave: 'fecha_cierre', titulo: 'Cierre', tipo: 'fecha_hora' },
          { clave: 'cerrado_por', titulo: 'Cerró', tipo: 'texto' },
          { clave: 'ventas', titulo: 'Ventas', tipo: 'entero' },
          { clave: 'total_vendido', titulo: 'Vendido', tipo: 'monto' },
          { clave: 'esperado_nio', titulo: 'Esperado C$', tipo: 'monto' },
          { clave: 'contado_nio', titulo: 'Contado C$', tipo: 'monto' },
          { clave: 'diferencia_nio', titulo: 'Diferencia C$', tipo: 'monto' },
          { clave: 'esperado_usd', titulo: 'Esperado US$', tipo: 'monto' },
          { clave: 'contado_usd', titulo: 'Contado US$', tipo: 'monto' },
          { clave: 'diferencia_usd', titulo: 'Diferencia US$', tipo: 'monto' },
          { clave: 'hubo_reconteo', titulo: 'Reconteo', tipo: 'si_no' },
          { clave: 'cierre_forzado', titulo: 'Forzado', tipo: 'si_no' },
          { clave: 'justificacion', titulo: 'Justificación', tipo: 'texto' },
        ],
        cierres.rows,
        {
          ventas: total.ventas,
          total_vendido: total.total_vendido,
          diferencia_nio: total.diferencia_nio,
          diferencia_usd: total.diferencia_usd,
        },
        c.veCostos,
      ),
    ]);
  }

  // --------------------------------------------------------------------------- Mermas

  /**
   * Mermas aprobadas en el rango, con el costo que tenía la pieza cuando se aprobó (el del
   * movimiento que la descontó). Las pendientes y las rechazadas van aparte: no suman.
   */
  async mermas(usuarioId: number, filtro: FiltroReporte): Promise<Reporte> {
    const c = await this.contexto(usuarioId, filtro);
    const costos = veCostos(usuarioId);
    const base = sql`
      merma m
      join sucursal s on s.id = m.sucursal_id
      join variante va on va.id = m.variante_id
      join producto pr on pr.id = va.producto_id
      join usuario ur on ur.id = m.reportada_por
      left join usuario ua on ua.id = m.resuelta_por
      left join movimiento_inventario mi on mi.id = m.movimiento_id`;
    const alcance = [
      sql`fn_puede_operar_sucursal(${usuarioId}, m.sucursal_id)`,
      c.sucursal && sql`m.sucursal_id = ${c.sucursal.id}`,
    ];
    const resueltas = (estado: string) =>
      donde(
        sql`m.estado = ${estado}`,
        sql`m.resuelta_at >= ${inicioDelDia(c.desde)}`,
        sql`m.resuelta_at < ${finDelDia(c.hasta)}`,
        ...alcance,
      );
    const detalle = sql`
      s.nombre as sucursal, va.sku, pr.nombre || ' — ' || va.nombre as producto, m.cantidad,
      m.motivo, ur.nombre_completo as reportada_por, ua.nombre_completo as resuelta_por,
      m.comentario`;
    const [porSucursal, aprobadas, pendientes, rechazadas] = await Promise.all([
      sql<FilaAgrupada>`
        select grouping(s.id)::integer as es_total, s.nombre as sucursal,
               count(*)::integer as mermas, coalesce(sum(m.cantidad), 0)::integer as cantidad,
               case when ${costos}
                    then coalesce(sum(m.cantidad * mi.costo_unitario), 0)::numeric(14,2) end
                 as valor_costo
          from ${base} ${resueltas('APROBADA')}
         group by grouping sets ((s.id, s.nombre), ())
         order by 1, s.nombre`.execute(this.bd.db),
      sql<Fila>`
        select m.resuelta_at as fecha, ${detalle},
               case when ${costos} then mi.costo_unitario end as costo_unitario,
               case when ${costos} then (m.cantidad * mi.costo_unitario)::numeric(14,2) end
                 as valor_costo
          from ${base} ${resueltas('APROBADA')}
         order by m.resuelta_at, m.id`.execute(this.bd.db),
      sql<Fila>`
        select m.reportada_at as fecha, ${detalle}
          from ${base}
          ${donde(sql`m.estado = 'PENDIENTE'`, sql`m.reportada_at < ${finDelDia(c.hasta)}`, ...alcance)}
         order by m.reportada_at, m.id`.execute(this.bd.db),
      sql<Fila>`
        select m.resuelta_at as fecha, ${detalle}
          from ${base} ${resueltas('RECHAZADA')}
         order by m.resuelta_at, m.id`.execute(this.bd.db),
    ]);
    const merma: ColumnaDefinida[] = [
      { clave: 'sucursal', titulo: 'Ubicación', tipo: 'texto' },
      { clave: 'sku', titulo: 'SKU', tipo: 'texto' },
      { clave: 'producto', titulo: 'Producto', tipo: 'texto' },
      { clave: 'cantidad', titulo: 'Cantidad', tipo: 'entero' },
    ];
    const suma = separar(porSucursal.rows);
    return this.reporte(
      c,
      'mermas',
      'Mermas',
      [
        seccion(
          'por_sucursal',
          'Mermas aprobadas por ubicación',
          [
            { clave: 'sucursal', titulo: 'Ubicación', tipo: 'texto' },
            { clave: 'mermas', titulo: 'Mermas', tipo: 'entero' },
            { clave: 'cantidad', titulo: 'Piezas', tipo: 'entero' },
            { clave: 'valor_costo', titulo: 'Valor a costo', tipo: 'monto', costo: true },
          ],
          suma.filas,
          suma.totales,
          c.veCostos,
        ),
        seccion(
          'aprobadas',
          'Mermas aprobadas',
          [
            { clave: 'fecha', titulo: 'Aprobada', tipo: 'fecha_hora' },
            ...merma,
            { clave: 'costo_unitario', titulo: 'Costo unitario', tipo: 'monto', costo: true },
            { clave: 'valor_costo', titulo: 'Valor a costo', tipo: 'monto', costo: true },
            { clave: 'motivo', titulo: 'Motivo', tipo: 'texto' },
            { clave: 'reportada_por', titulo: 'Reportó', tipo: 'texto' },
            { clave: 'resuelta_por', titulo: 'Aprobó', tipo: 'texto' },
          ],
          aprobadas.rows,
          suma.totales && {
            cantidad: suma.totales.cantidad,
            valor_costo: suma.totales.valor_costo,
          },
          c.veCostos,
        ),
        seccion(
          'pendientes',
          'Pendientes de aprobar',
          [
            { clave: 'fecha', titulo: 'Reportada', tipo: 'fecha_hora' },
            ...merma,
            { clave: 'motivo', titulo: 'Motivo', tipo: 'texto' },
            { clave: 'reportada_por', titulo: 'Reportó', tipo: 'texto' },
          ],
          pendientes.rows,
          null,
          c.veCostos,
        ),
        seccion(
          'rechazadas',
          'Rechazadas',
          [
            { clave: 'fecha', titulo: 'Rechazada', tipo: 'fecha_hora' },
            ...merma,
            { clave: 'motivo', titulo: 'Motivo', tipo: 'texto' },
            { clave: 'reportada_por', titulo: 'Reportó', tipo: 'texto' },
            { clave: 'resuelta_por', titulo: 'Rechazó', tipo: 'texto' },
            { clave: 'comentario', titulo: 'Comentario', tipo: 'texto' },
          ],
          rechazadas.rows,
          null,
          c.veCostos,
        ),
      ],
      {
        notas: [
          'Solo suman las mermas aprobadas. Las pendientes (todas las que siguen sin resolver) todavía no descuentan del inventario.',
        ],
      },
    );
  }

  // ----------------------------------------------------------------------- Inventario

  /**
   * Cuánto vale la mercadería por ubicación y categoría: la de hoy o, con `mes`, la foto del
   * cierre de ese mes (fn_foto_inventario_mensual). Pide REPORTES_COSTOS (lo exige la ruta).
   */
  async inventarioValorizado(
    usuarioId: number,
    filtro: FiltroInventarioValorizado,
  ): Promise<Reporte> {
    const c = await this.contexto(usuarioId, filtro);
    // La cantidad de la bodega solo la ve quien tiene permiso (misma regla que las existencias)
    const visible = sql`fn_puede_operar_sucursal(${usuarioId}, i.sucursal_id)
      and (i.tipo_ubicacion <> 'BODEGA' or (select fn_ve_cantidad_bodega(${usuarioId})))`;
    const origen = filtro.mes
      ? sql`(select f.sucursal_id, s.nombre as sucursal, s.tipo as tipo_ubicacion,
                    cg.nombre as categoria, f.unidades, f.valor_costo, f.valor_venta
               from inventario_cierre_mensual f
               join sucursal s on s.id = f.sucursal_id
               join categoria cg on cg.id = f.categoria_id
              where f.mes = ${`${filtro.mes}-01`}::date) i`
      : sql`v_inventario_valorizado i`;
    const condicion = donde(
      visible,
      sql`i.unidades <> 0`,
      c.sucursal && sql`i.sucursal_id = ${c.sucursal.id}`,
    );
    const costos = veCostos(usuarioId);
    const [detalle, porUbicacion, foto] = await Promise.all([
      sql<Fila>`
        select i.sucursal, i.categoria, i.unidades::integer as unidades,
               case when ${costos} then i.valor_costo::numeric(14,2) end as valor_costo,
               i.valor_venta::numeric(14,2) as valor_venta
          from ${origen} ${condicion}
         order by i.tipo_ubicacion, i.sucursal, i.categoria`.execute(this.bd.db),
      sql<FilaAgrupada>`
        select grouping(i.sucursal_id)::integer as es_total, i.sucursal,
               coalesce(sum(i.unidades), 0)::integer as unidades,
               case when ${costos} then coalesce(sum(i.valor_costo), 0)::numeric(14,2) end
                 as valor_costo,
               coalesce(sum(i.valor_venta), 0)::numeric(14,2) as valor_venta
          from ${origen} ${condicion}
         group by grouping sets ((i.sucursal_id, i.sucursal, i.tipo_ubicacion), ())
         order by 1, i.tipo_ubicacion, i.sucursal`.execute(this.bd.db),
      sql<{ tomada_at: Date | null }>`
        select max(tomada_at) as tomada_at from inventario_cierre_mensual
         where mes = ${`${filtro.mes ?? '0001-01'}-01`}::date`.execute(this.bd.db),
    ]);
    const tomada = foto.rows[0].tomada_at;
    const valores: ColumnaDefinida[] = [
      { clave: 'unidades', titulo: 'Unidades', tipo: 'entero' },
      { clave: 'valor_costo', titulo: 'Valor a costo', tipo: 'monto', costo: true },
      { clave: 'valor_venta', titulo: 'Valor a precio de venta', tipo: 'monto' },
    ];
    const suma = separar(porUbicacion.rows);
    return this.reporte(
      c,
      'inventario-valorizado',
      filtro.mes
        ? `Inventario valorizado al cierre de ${mesCorto(filtro.mes)}`
        : 'Inventario valorizado',
      [
        seccion(
          'por_ubicacion',
          'Por ubicación',
          [{ clave: 'sucursal', titulo: 'Ubicación', tipo: 'texto' }, ...valores],
          suma.filas,
          suma.totales,
          c.veCostos,
        ),
        seccion(
          'por_categoria',
          'Por ubicación y categoría',
          [
            { clave: 'sucursal', titulo: 'Ubicación', tipo: 'texto' },
            { clave: 'categoria', titulo: 'Categoría', tipo: 'texto' },
            ...valores,
          ],
          detalle.rows,
          suma.totales,
          c.veCostos,
        ),
      ],
      {
        rango: false,
        notas: !filtro.mes
          ? ['Existencias de este momento, al costo y al precio de venta actuales.']
          : tomada
            ? [
                `Foto tomada el ${fechaHora(tomada)}: las cantidades son las del cierre del mes; el costo y el precio de venta, los de ese momento.`,
              ]
            : ['No hay una foto guardada del cierre de ese mes.'],
      },
    );
  }

  /** Los meses que tienen foto de cierre (`AAAA-MM`), del más reciente al más antiguo. */
  async mesesConFoto(): Promise<string[]> {
    const { rows } = await sql<{ mes: string }>`
      select distinct to_char(mes, 'YYYY-MM') as mes from inventario_cierre_mensual
       order by 1 desc`.execute(this.bd.db);
    return rows.map((f) => f.mes);
  }

  /** Lo que está en su stock mínimo o por debajo, para saber qué enviar o qué comprar. */
  async porReponer(usuarioId: number, filtro: FiltroReporteActual): Promise<Reporte> {
    const c = await this.contexto(usuarioId, filtro);
    const veBodega = sql<boolean>`(select fn_ve_cantidad_bodega(${usuarioId}))`;
    const { rows } = await sql<Fila>`
      select v.sucursal, v.categoria, v.sku, v.producto || ' — ' || v.variante as producto,
             v.cantidad, v.stock_minimo, v.stock_minimo - v.cantidad as faltante,
             v.en_transito_entrante::integer as en_transito,
             case when ${veBodega}
                  then (select coalesce(sum(ss.cantidad), 0)::integer
                          from stock_sucursal ss
                          join sucursal b on b.id = ss.sucursal_id and b.tipo = 'BODEGA'
                         where ss.variante_id = v.variante_id) end as en_bodega
        from v_stock_actual v
        ${donde(
          sql`v.stock_minimo > 0`,
          sql`v.cantidad <= v.stock_minimo`,
          sql`fn_puede_operar_sucursal(${usuarioId}, v.sucursal_id)`,
          sql`(v.tipo_ubicacion <> 'BODEGA' or ${veBodega})`,
          c.sucursal && sql`v.sucursal_id = ${c.sucursal.id}`,
        )}
       order by v.sucursal, v.categoria, v.producto, v.variante, v.variante_id`.execute(this.bd.db);
    const titulo = 'Por reponer: en su stock mínimo o por debajo';
    return this.reporte(
      c,
      'por-reponer',
      titulo,
      [
        seccion(
          'por_reponer',
          titulo,
          [
            { clave: 'sucursal', titulo: 'Ubicación', tipo: 'texto' },
            { clave: 'categoria', titulo: 'Categoría', tipo: 'texto' },
            { clave: 'sku', titulo: 'SKU', tipo: 'texto' },
            { clave: 'producto', titulo: 'Producto', tipo: 'texto' },
            { clave: 'cantidad', titulo: 'Hay', tipo: 'entero' },
            { clave: 'stock_minimo', titulo: 'Mínimo', tipo: 'entero' },
            { clave: 'faltante', titulo: 'Falta', tipo: 'entero' },
            { clave: 'en_transito', titulo: 'En camino', tipo: 'entero' },
            { clave: 'en_bodega', titulo: 'En bodega', tipo: 'entero', visible: c.veBodega },
          ],
          rows,
          null,
          c.veCostos,
        ),
      ],
      { rango: false },
    );
  }

  // -------------------------------------------------------------------------- Comunes

  /**
   * Las líneas de venta del reporte, como tabla `l` de un FROM. Cuáles entran lo decide
   * fn_ventas_reporte: completadas, del rango, de las sucursales del usuario y, sin
   * CAJA_VER_DIFERENCIAS, solo de turnos ya cerrados.
   */
  private lineas(c: Contexto): RawBuilder<unknown> {
    return sql`(select vl.* from v_ventas_linea vl
                 where vl.venta_id in (${this.ventasDelReporte(c)})) l`;
  }

  private ventasDelReporte(c: Contexto, estado = 'COMPLETADA'): RawBuilder<unknown> {
    return sql`select fn_ventas_reporte(${c.usuarioId}, ${c.desde}::date, ${c.hasta}::date,
                      ${c.sucursal?.id ?? null}::integer, ${estado})`;
  }

  /** Sección de una consulta con `grouping sets`: separa la fila de totales. */
  private seccion(
    c: Contexto,
    clave: string,
    titulo: string,
    columnas: ColumnaDefinida[],
    filasAgrupadas: FilaAgrupada[],
  ): Seccion {
    const { filas, totales } = separar(filasAgrupadas);
    return seccion(clave, titulo, columnas, filas, totales, c.veCostos);
  }

  /** Un reporte de ventas o de cobros: avisa si no incluye los turnos abiertos. */
  private deVentas(c: Contexto, clave: string, titulo: string, secciones: Seccion[]): Reporte {
    return this.reporte(c, clave, titulo, secciones, {
      notas: c.veTurnosAbiertos ? [] : [NOTA_TURNOS_ABIERTOS],
    });
  }

  private reporte(
    c: Contexto,
    clave: string,
    titulo: string,
    secciones: Seccion[],
    opciones: { rango?: boolean; notas?: string[] } = {},
  ): Reporte {
    const conRango = opciones.rango !== false;
    return {
      clave,
      titulo,
      desde: conRango ? c.desde : null,
      hasta: conRango ? c.hasta : null,
      sucursal: c.sucursal,
      generado_at: new Date(),
      notas: opciones.notas ?? [],
      secciones,
    };
  }

  private async contexto(
    usuarioId: number,
    filtro: {
      sucursal_id?: number;
      periodo?: Periodo;
      fecha?: string;
      desde?: string;
      hasta?: string;
    },
  ): Promise<Contexto> {
    const { rows } = await sql<{
      costos: boolean;
      turnos_abiertos: boolean;
      bodega: boolean;
      sucursal_id: number | null;
      codigo: string | null;
      nombre: string | null;
    }>`
      select fn_tiene_permiso(${usuarioId}, 'REPORTES_COSTOS') as costos,
             fn_tiene_permiso(${usuarioId}, 'CAJA_VER_DIFERENCIAS') as turnos_abiertos,
             fn_ve_cantidad_bodega(${usuarioId}) as bodega,
             s.id as sucursal_id, s.codigo, s.nombre
        from (select 1) uno
        left join sucursal s on s.id = ${filtro.sucursal_id ?? null}::integer
                            and fn_puede_operar_sucursal(${usuarioId}, s.id)`.execute(this.bd.db);
    const fila = rows[0];
    // Una sucursal ajena responde igual que una que no existe
    if (filtro.sucursal_id !== undefined && fila.sucursal_id === null) {
      throw new NoEncontrado(`La sucursal ${filtro.sucursal_id} no existe`);
    }
    return {
      usuarioId,
      ...resolverRango(filtro),
      sucursal:
        fila.sucursal_id !== null && fila.codigo !== null && fila.nombre !== null
          ? { id: fila.sucursal_id, codigo: fila.codigo, nombre: fila.nombre }
          : null,
      veCostos: fila.costos,
      veTurnosAbiertos: fila.turnos_abiertos,
      veBodega: fila.bodega,
    };
  }
}
