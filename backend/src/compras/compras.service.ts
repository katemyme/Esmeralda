import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseDatosService, type Trx } from '../base-datos/base-datos.service';
import { donde } from '../comun/consultas';
import { NoEncontrado } from '../comun/no-encontrado';
import type {
  DatosActualizarCompra,
  DatosCrearCompra,
  DatosGastoCompra,
  DatosLineaCompra,
  FiltroCompras,
} from './esquemas';

interface UsuarioReferido {
  id: number;
  nombre_completo: string;
}

/** Una compra (una factura de proveedor) con sus totales. */
export interface CompraResumen {
  id: number;
  proveedor: { id: number; nombre: string };
  factura_numero: string;
  fecha_factura: string;
  moneda: string;
  tipo_cambio: string;
  /** BORRADOR (se puede editar), CONFIRMADA (ya entró a la bodega) o CANCELADA. */
  estado: string;
  notas: string | null;
  lineas: number;
  piezas_facturadas: number;
  piezas_recibidas: number;
  faltantes: number;
  /** En la moneda de la factura. */
  total_factura: string;
  total_factura_nio: string;
  gastos_nio: string;
  /** Factura + gastos de importación, en córdobas. */
  costo_total_nio: string;
  creada_por: UsuarioReferido;
  created_at: Date;
  confirmada_por: UsuarioReferido | null;
  fecha_confirmacion: Date | null;
}

/**
 * Una línea con su costeo. En borrador es la vista previa (fn_compra_calculo) y trae además el
 * costo y el stock actuales y el margen que quedaría; ya confirmada, lo que se guardó.
 */
export interface LineaCompra {
  detalle_id: number;
  variante: { id: number; sku: string; nombre: string };
  cantidad_facturada: number;
  cantidad_recibida: number;
  costo_unitario_factura: string;
  valor_nio: string;
  gasto_asignado_nio: string | null;
  costo_unitario_final_nio: string | null;
  costo_promedio_nuevo: string | null;
  precio_venta: string;
  costo_actual: string | null;
  stock_actual: number | null;
  margen_nuevo_pct: string | null;
  alerta_margen: boolean | null;
}

export interface GastoCompra {
  id: number;
  concepto: string;
  descripcion: string | null;
  moneda: string;
  monto: string;
  tipo_cambio: string;
  monto_nio: string;
}

export interface CompraDetalle extends CompraResumen {
  detalle: LineaCompra[];
  gastos: GastoCompra[];
}

/** Lo que devuelve fn_confirmar_compra por cada línea. */
export interface ResultadoConfirmacion {
  producto: string;
  cantidad_recibida: number;
  faltantes: number;
  costo_unitario_final_nio: string;
  costo_promedio_nuevo: string;
  margen_nuevo_pct: string | null;
  alerta_margen: boolean;
}

interface FilaCompra {
  id: number;
  proveedor_id: number;
  proveedor: string;
  factura_numero: string;
  fecha_factura: string;
  moneda: string;
  tipo_cambio: string;
  estado: string;
  notas: string | null;
  lineas: number;
  piezas_facturadas: number;
  piezas_recibidas: number;
  faltantes: number;
  total_factura: string;
  total_factura_nio: string;
  gastos_nio: string;
  costo_total_nio: string;
  creada_por_id: number;
  creada_por: string;
  created_at: Date;
  confirmada_por_id: number | null;
  confirmada_por: string | null;
  fecha_confirmacion: Date | null;
}

interface FilaLinea extends Omit<LineaCompra, 'variante'> {
  variante_id: number;
  sku: string;
  producto: string;
}

function aCompra(f: FilaCompra): CompraResumen {
  return {
    id: f.id,
    proveedor: { id: f.proveedor_id, nombre: f.proveedor },
    factura_numero: f.factura_numero,
    fecha_factura: f.fecha_factura,
    moneda: f.moneda,
    tipo_cambio: f.tipo_cambio,
    estado: f.estado,
    notas: f.notas,
    lineas: f.lineas,
    piezas_facturadas: f.piezas_facturadas,
    piezas_recibidas: f.piezas_recibidas,
    faltantes: f.faltantes,
    total_factura: f.total_factura,
    total_factura_nio: f.total_factura_nio,
    gastos_nio: f.gastos_nio,
    costo_total_nio: f.costo_total_nio,
    creada_por: { id: f.creada_por_id, nombre_completo: f.creada_por },
    created_at: f.created_at,
    confirmada_por:
      f.confirmada_por_id !== null && f.confirmada_por !== null
        ? { id: f.confirmada_por_id, nombre_completo: f.confirmada_por }
        : null,
    fecha_confirmacion: f.fecha_confirmacion,
  };
}

/**
 * Compras: toda la mercadería entra por la bodega central. Las reglas (solo borradores se editan,
 * prorrateo de gastos, costo promedio, alertas de margen bajo) las aplica la base: fn_crear_compra,
 * fn_actualizar_compra, fn_compra_set_linea, fn_compra_quitar_linea, fn_compra_agregar_gasto,
 * fn_compra_quitar_gasto, fn_compra_calculo, fn_confirmar_compra y fn_cancelar_compra.
 */
@Injectable()
export class ComprasService {
  constructor(private readonly bd: BaseDatosService) {}

  /** Compras de la más reciente a la más antigua. */
  async listar(filtro: FiltroCompras): Promise<CompraResumen[]> {
    const filas = await this.consultar(
      donde(
        filtro.estado && sql`c.estado = ${filtro.estado}`,
        filtro.proveedor_id && sql`c.proveedor_id = ${filtro.proveedor_id}`,
        filtro.desde && sql`c.fecha_factura >= ${filtro.desde}::date`,
        filtro.hasta && sql`c.fecha_factura <= ${filtro.hasta}::date`,
        filtro.antes_de && sql`c.id < ${filtro.antes_de}`,
      ),
      filtro.limite,
    );
    return filas.map(aCompra);
  }

  async buscar(id: number): Promise<CompraDetalle> {
    const [fila] = await this.consultar(sql`where c.id = ${id}`, 1);
    if (!fila) throw new NoEncontrado(`La compra ${id} no existe`);
    const { db } = this.bd;
    // En borrador, el costeo es la vista previa; después, lo que se guardó al confirmar
    const lineas =
      fila.estado === 'BORRADOR'
        ? sql<FilaLinea>`
            select k.detalle_id, k.variante_id, va.sku, k.producto, k.cantidad_facturada,
                   k.cantidad_recibida, d.costo_unitario_factura, k.valor_nio, k.gasto_asignado_nio,
                   k.costo_unitario_final_nio, k.costo_promedio_nuevo, k.precio_venta,
                   k.costo_actual, k.stock_actual, k.margen_nuevo_pct, k.alerta_margen
              from fn_compra_calculo(${id}) k
              join compra_detalle d on d.id = k.detalle_id
              join variante va on va.id = k.variante_id
             order by k.detalle_id`
        : sql<FilaLinea>`
            select d.id as detalle_id, d.variante_id, va.sku, pr.nombre || ' — ' || va.nombre as producto,
                   d.cantidad_facturada, d.cantidad_recibida, d.costo_unitario_factura,
                   round(d.cantidad_facturada * d.costo_unitario_factura * c.tipo_cambio, 2) as valor_nio,
                   d.gasto_asignado_nio, d.costo_unitario_final_nio, d.costo_promedio_nuevo,
                   va.precio_venta, null::numeric as costo_actual, null::bigint as stock_actual,
                   null::numeric as margen_nuevo_pct, null::boolean as alerta_margen
              from compra_detalle d
              join compra c on c.id = d.compra_id
              join variante va on va.id = d.variante_id
              join producto pr on pr.id = va.producto_id
             where d.compra_id = ${id}
             order by d.id`;
    const [detalle, gastos] = await Promise.all([
      lineas.execute(db),
      db
        .selectFrom('compra_gasto')
        .select(['id', 'concepto', 'descripcion', 'moneda', 'monto', 'tipo_cambio', 'monto_nio'])
        .where('compra_id', '=', id)
        .orderBy('id')
        .execute(),
    ]);
    return {
      ...aCompra(fila),
      detalle: detalle.rows.map(({ variante_id, sku, producto, ...linea }) => ({
        ...linea,
        variante: { id: variante_id, sku, nombre: producto },
      })),
      gastos: gastos.map((g) => ({ ...g, monto_nio: g.monto_nio ?? '0.00' })),
    };
  }

  /** Abre la compra en borrador con sus líneas y gastos, en una sola transacción. */
  async crear(adminId: number, datos: DatosCrearCompra): Promise<CompraDetalle> {
    const id = await this.bd.transaccion(adminId, async (trx) => {
      const { rows } = await sql<{ id: number }>`
        select fn_crear_compra(${adminId}, ${datos.proveedor_id}, ${datos.factura_numero},
               ${datos.fecha_factura}::date, ${datos.moneda}, ${datos.tipo_cambio}::numeric,
               ${datos.notas}) as id`.execute(trx);
      for (const linea of datos.lineas) await this.ponerLineaEn(trx, adminId, rows[0].id, linea);
      for (const gasto of datos.gastos) await this.agregarGastoEn(trx, adminId, rows[0].id, gasto);
      return rows[0].id;
    });
    return this.buscar(id);
  }

  async actualizar(
    adminId: number,
    id: number,
    datos: DatosActualizarCompra,
  ): Promise<CompraDetalle> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_actualizar_compra(${adminId}, ${id}, ${datos.proveedor_id}, ${datos.factura_numero},
                 ${datos.fecha_factura}::date, ${datos.moneda}, ${datos.tipo_cambio}::numeric,
                 ${datos.notas})`.execute(trx),
    );
    return this.buscar(id);
  }

  /** Agrega la línea o, si la pieza ya está en la compra, la reemplaza. */
  async ponerLinea(adminId: number, id: number, linea: DatosLineaCompra): Promise<CompraDetalle> {
    await this.exigir(id);
    await this.bd.transaccion(adminId, (trx) => this.ponerLineaEn(trx, adminId, id, linea));
    return this.buscar(id);
  }

  async quitarLinea(adminId: number, id: number, varianteId: number): Promise<CompraDetalle> {
    await this.exigir(id);
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_compra_quitar_linea(${adminId}, ${id}, ${varianteId})`.execute(trx),
    );
    return this.buscar(id);
  }

  async agregarGasto(adminId: number, id: number, gasto: DatosGastoCompra): Promise<CompraDetalle> {
    await this.exigir(id);
    await this.bd.transaccion(adminId, (trx) => this.agregarGastoEn(trx, adminId, id, gasto));
    return this.buscar(id);
  }

  async quitarGasto(adminId: number, id: number, gastoId: number): Promise<CompraDetalle> {
    const gasto = await this.bd.db
      .selectFrom('compra_gasto')
      .select('id')
      .where('id', '=', gastoId)
      .where('compra_id', '=', id)
      .executeTakeFirst();
    if (!gasto) throw new NoEncontrado(`El gasto ${gastoId} no es de la compra ${id}`);
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_compra_quitar_gasto(${adminId}, ${gastoId})`.execute(trx),
    );
    return this.buscar(id);
  }

  /** Confirma: entra el stock a la bodega, se actualiza el costo promedio y se alerta el margen bajo. */
  async confirmar(
    adminId: number,
    id: number,
  ): Promise<{ compra: CompraDetalle; resultado: ResultadoConfirmacion[] }> {
    const resultado = await this.bd.transaccion(adminId, async (trx) => {
      const { rows } = await sql<ResultadoConfirmacion>`
        select producto, cantidad_recibida, faltantes, costo_unitario_final_nio,
               costo_promedio_nuevo, margen_nuevo_pct, alerta_margen
          from fn_confirmar_compra(${adminId}, ${id})`.execute(trx);
      return rows;
    });
    return { compra: await this.buscar(id), resultado };
  }

  async cancelar(adminId: number, id: number, motivo: string): Promise<CompraDetalle> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_cancelar_compra(${adminId}, ${id}, ${motivo})`.execute(trx),
    );
    return this.buscar(id);
  }

  private ponerLineaEn(trx: Trx, adminId: number, id: number, linea: DatosLineaCompra) {
    return sql`
      select fn_compra_set_linea(${adminId}, ${id}, ${linea.variante_id}, ${linea.cantidad_facturada},
             ${linea.costo_unitario}::numeric, ${linea.cantidad_recibida}::integer)`.execute(trx);
  }

  private agregarGastoEn(trx: Trx, adminId: number, id: number, gasto: DatosGastoCompra) {
    return sql`
      select fn_compra_agregar_gasto(${adminId}, ${id}, ${gasto.concepto}, ${gasto.moneda},
             ${gasto.monto}::numeric, ${gasto.descripcion}, ${gasto.tipo_cambio}::numeric)`.execute(
      trx,
    );
  }

  private async exigir(id: number): Promise<void> {
    const compra = await this.bd.db
      .selectFrom('compra')
      .select('id')
      .where('id', '=', id)
      .executeTakeFirst();
    if (!compra) throw new NoEncontrado(`La compra ${id} no existe`);
  }

  private async consultar(
    condicion: ReturnType<typeof donde>,
    limite: number,
  ): Promise<FilaCompra[]> {
    const { rows } = await sql<FilaCompra>`
      select c.id, c.proveedor_id, v.proveedor, c.factura_numero, c.fecha_factura, c.moneda,
             c.tipo_cambio, c.estado, c.notas, v.lineas, v.piezas_facturadas, v.piezas_recibidas,
             v.faltantes, v.total_factura, v.total_factura_nio, v.gastos_nio, v.costo_total_nio,
             uc.id as creada_por_id, uc.nombre_completo as creada_por, c.created_at,
             uf.id as confirmada_por_id, uf.nombre_completo as confirmada_por, c.fecha_confirmacion
        from compra c
        join v_compras v on v.compra_id = c.id
        join usuario uc on uc.id = c.created_by
        left join usuario uf on uf.id = c.confirmada_por
        ${condicion}
       order by c.id desc
       limit ${limite}`.execute(this.bd.db);
    return rows;
  }
}
