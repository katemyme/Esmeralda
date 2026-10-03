import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { donde, patronContiene, veCostos } from '../comun/consultas';
import { finDelDia, inicioDelDia } from '../comun/fechas';
import { NoEncontrado } from '../comun/no-encontrado';
import type {
  DatosMovimiento,
  DatosStockMinimo,
  FiltroExistencias,
  FiltroMovimientos,
} from './esquemas';

/** Lo que hay de una pieza en una ubicación. */
export interface Existencia {
  variante: { id: number; sku: string; producto: string; variante: string; categoria: string };
  /** null en la bodega para quien solo puede saber si hay o no (parámetro BODEGA_VISIBILIDAD). */
  cantidad: number | null;
  disponible: boolean;
  stock_minimo: number;
  /** Unidades de envíos en tránsito hacia esta ubicación (null si la cantidad está oculta). */
  en_transito_entrante: number | null;
  alerta_stock_bajo: boolean | null;
  precio_venta: string;
  /** null para quien no tiene el permiso REPORTES_COSTOS. */
  costo: string | null;
  valor_costo: string | null;
}

/** Un movimiento del kardex (solo se insertan: nunca se editan ni se borran). */
export interface Movimiento {
  id: number;
  fecha: Date;
  /** ENTRADA, VENTA, TRASLADO_SALIDA, TRASLADO_ENTRADA, AJUSTE_POSITIVO, AJUSTE_NEGATIVO, MERMA o ANULACION_VENTA. */
  tipo: string;
  /** Con signo: positiva entra, negativa sale. */
  cantidad: number;
  stock_resultante: number;
  costo_unitario: string | null;
  motivo: string | null;
  sucursal: { id: number; codigo: string; nombre: string };
  variante: { id: number; sku: string; nombre: string };
  usuario: { id: number; nombre_completo: string };
  /** Documento que lo originó, si lo hay. */
  venta_id: number | null;
  envio_id: number | null;
  compra_id: number | null;
}

interface FilaExistencia {
  variante_id: number;
  sku: string;
  producto: string;
  variante: string;
  categoria: string;
  cantidad: number | null;
  disponible: boolean;
  stock_minimo: number;
  en_transito_entrante: number | null;
  alerta_stock_bajo: boolean | null;
  precio_venta: string;
  costo: string | null;
  valor_costo: string | null;
}

interface FilaMovimiento {
  id: number;
  fecha: Date;
  tipo: string;
  cantidad: number;
  stock_resultante: number;
  costo_unitario: string | null;
  motivo: string | null;
  sucursal_id: number;
  sucursal_codigo: string;
  sucursal_nombre: string;
  variante_id: number;
  sku: string;
  variante_nombre: string;
  usuario_id: number;
  usuario_nombre: string;
  venta_id: number | null;
  envio_id: number | null;
  compra_id: number | null;
}

function aMovimiento(f: FilaMovimiento): Movimiento {
  return {
    id: f.id,
    fecha: f.fecha,
    tipo: f.tipo,
    cantidad: f.cantidad,
    stock_resultante: f.stock_resultante,
    costo_unitario: f.costo_unitario,
    motivo: f.motivo,
    sucursal: { id: f.sucursal_id, codigo: f.sucursal_codigo, nombre: f.sucursal_nombre },
    variante: { id: f.variante_id, sku: f.sku, nombre: f.variante_nombre },
    usuario: { id: f.usuario_id, nombre_completo: f.usuario_nombre },
    venta_id: f.venta_id,
    envio_id: f.envio_id,
    compra_id: f.compra_id,
  };
}

/**
 * Existencias y kardex. El stock solo cambia con movimientos (fn_movimiento_inventario y las
 * funciones de ventas, envíos, compras, mermas y conteos); aquí se consulta, se registran los
 * movimientos manuales y se fija el stock mínimo (fn_set_stock_minimo).
 */
@Injectable()
export class InventarioService {
  constructor(private readonly bd: BaseDatosService) {}

  /** Existencias de una ubicación (solo piezas y artículos activos), ordenadas por producto. */
  async existencias(
    usuarioId: number,
    sucursalId: number,
    filtro: FiltroExistencias,
  ): Promise<{
    sucursal: { id: number; codigo: string; nombre: string; tipo: string };
    existencias: Existencia[];
    total: number;
  }> {
    const sucursal = await this.bd.db
      .selectFrom('sucursal')
      .select(['id', 'codigo', 'nombre', 'tipo'])
      .where('id', '=', sucursalId)
      .where('activa', '=', true)
      .executeTakeFirst();
    if (!sucursal) throw new NoEncontrado(`La ubicación ${sucursalId} no existe o está inactiva`);

    // De la bodega, quien no tiene permiso solo sabe si hay o no (misma regla que fn_consultar_stock)
    const oculta = sql<boolean>`(v.tipo_ubicacion = 'BODEGA' and not (select fn_ve_cantidad_bodega(${usuarioId})))`;
    const patron = filtro.buscar ? patronContiene(filtro.buscar) : null;
    const condicion = donde(
      sql`v.sucursal_id = ${sucursalId}`,
      patron &&
        sql`(v.producto ilike ${patron} or v.variante ilike ${patron} or v.sku ilike ${patron})`,
      filtro.categoria_id &&
        sql`v.producto_id in (select id from producto where categoria_id = ${filtro.categoria_id})`,
      filtro.solo_bajo_minimo &&
        sql`v.stock_minimo > 0 and v.cantidad <= v.stock_minimo and not ${oculta}`,
    );
    const costos = veCostos(usuarioId);
    const [filas, conteo] = await Promise.all([
      sql<FilaExistencia>`
        select v.variante_id, v.sku, v.producto, v.variante, v.categoria,
               case when ${oculta} then null else v.cantidad end as cantidad,
               v.cantidad > 0 as disponible, v.stock_minimo,
               case when ${oculta} then null else v.en_transito_entrante::integer end as en_transito_entrante,
               case when ${oculta} then null else v.alerta_stock_bajo end as alerta_stock_bajo,
               v.precio_venta,
               case when ${costos} then v.costo end as costo,
               case when ${costos} and not ${oculta} then v.valor_costo end as valor_costo
          from v_stock_actual v
          ${condicion}
         order by v.producto, v.variante, v.variante_id
         limit ${filtro.limite} offset ${filtro.desplazamiento}`.execute(this.bd.db),
      sql<{ total: number }>`select count(*) as total from v_stock_actual v ${condicion}`.execute(
        this.bd.db,
      ),
    ]);
    return {
      sucursal,
      existencias: filas.rows.map(
        ({ variante_id, sku, producto, variante, categoria, ...resto }) => ({
          variante: { id: variante_id, sku, producto, variante, categoria },
          ...resto,
        }),
      ),
      total: conteo.rows[0].total,
    };
  }

  /** El kardex, del movimiento más reciente al más antiguo; cada quien ve el de sus sucursales. */
  async movimientos(usuarioId: number, filtro: FiltroMovimientos): Promise<Movimiento[]> {
    const filas = await this.consultarMovimientos(
      usuarioId,
      [
        filtro.sucursal_id && sql`m.sucursal_id = ${filtro.sucursal_id}`,
        filtro.variante_id && sql`m.variante_id = ${filtro.variante_id}`,
        filtro.tipo && sql`m.tipo = ${filtro.tipo}`,
        filtro.desde && sql`m.fecha >= ${inicioDelDia(filtro.desde)}`,
        filtro.hasta && sql`m.fecha < ${finDelDia(filtro.hasta)}`,
        filtro.antes_de && sql`m.id < ${filtro.antes_de}`,
      ],
      filtro.limite,
    );
    return filas.map(aMovimiento);
  }

  /** Entrada directa a la bodega, ajuste o merma directa (fn_movimiento_inventario). */
  async registrarMovimiento(usuarioId: number, datos: DatosMovimiento): Promise<Movimiento> {
    const id = await this.bd.transaccion(usuarioId, async (trx) => {
      const { rows } = await sql<{ id: number }>`
        select fn_movimiento_inventario(${usuarioId}, ${datos.sucursal_id}, ${datos.variante_id},
               ${datos.tipo}, ${datos.cantidad}, ${datos.motivo}, ${datos.costo_unitario}::numeric) as id`.execute(
        trx,
      );
      return rows[0].id;
    });
    const [fila] = await this.consultarMovimientos(usuarioId, [sql`m.id = ${id}`], 1);
    if (!fila) throw new Error(`El movimiento ${id} recién registrado no aparece`);
    return aMovimiento(fila);
  }

  async fijarStockMinimo(usuarioId: number, datos: DatosStockMinimo): Promise<DatosStockMinimo> {
    await this.bd.transaccion(usuarioId, (trx) =>
      sql`select fn_set_stock_minimo(${usuarioId}, ${datos.sucursal_id}, ${datos.variante_id},
                 ${datos.stock_minimo})`.execute(trx),
    );
    return datos;
  }

  private async consultarMovimientos(
    usuarioId: number,
    condiciones: Parameters<typeof donde>,
    limite: number,
  ): Promise<FilaMovimiento[]> {
    const { rows } = await sql<FilaMovimiento>`
      select m.id, m.fecha, m.tipo, m.cantidad, m.stock_resultante,
             case when ${veCostos(usuarioId)} then m.costo_unitario end as costo_unitario, m.motivo,
             s.id as sucursal_id, s.codigo as sucursal_codigo, s.nombre as sucursal_nombre,
             va.id as variante_id, va.sku, pr.nombre || ' — ' || va.nombre as variante_nombre,
             u.id as usuario_id, u.nombre_completo as usuario_nombre,
             m.venta_id, m.envio_id, m.compra_id
        from movimiento_inventario m
        join sucursal s on s.id = m.sucursal_id
        join variante va on va.id = m.variante_id
        join producto pr on pr.id = va.producto_id
        join usuario u on u.id = m.usuario_id
        ${donde(sql`fn_puede_operar_sucursal(${usuarioId}, m.sucursal_id)`, ...condiciones)}
       order by m.id desc
       limit ${limite}`.execute(this.bd.db);
    return rows;
  }
}
