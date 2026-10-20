import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { NoEncontrado } from '../comun/no-encontrado';
import type { DatosPdfEtiquetas } from './esquemas';
import { etiquetasEnHoja, etiquetasEnRollo, type Etiqueta } from './etiquetas-pdf';

/** Una pieza para imprimirle etiquetas. */
export interface PiezaEtiqueta {
  variante_id: number;
  /** El código de la pieza: lo que lleva el QR de la etiqueta. */
  codigo: string;
  producto: string;
  variante: string;
  categoria: string;
  /** El nombre corto que lleva la etiqueta. */
  nombre: string;
  /**
   * Cuántas hay en la bodega (o cuántas entraron con la compra): las copias que se proponen. null
   * en la bodega para quien solo puede saber si hay o no (parámetro BODEGA_VISIBILIDAD).
   */
  cantidad: number | null;
}

/** Una compra para elegirla y sacar las etiquetas de lo que entró con ella. */
export interface CompraParaEtiquetas {
  id: number;
  proveedor: string;
  factura_numero: string;
  fecha_factura: string;
  /** BORRADOR o CONFIRMADA (las canceladas no salen). */
  estado: string;
  /** Cuántas piezas entran con ella (lo recibido). */
  piezas: number;
}

/** El nombre corto de la etiqueta: el producto y su variante (sin «Única»). */
export function nombreCorto(producto: string, variante: string): string {
  return variante === 'Única' ? producto : `${producto} · ${variante}`;
}

function conNombre<T extends Omit<PiezaEtiqueta, 'nombre'>>(fila: T): PiezaEtiqueta {
  return { ...fila, nombre: nombreCorto(fila.producto, fila.variante) };
}

function reglaDeNegocio(mensaje: string): HttpException {
  return new HttpException({ codigo: 'REGLA_NEGOCIO', mensaje }, HttpStatus.UNPROCESSABLE_ENTITY);
}

/**
 * Etiquetas con QR de las piezas: el QR lleva solo su código, y la etiqueta el código y el nombre
 * corto (sin precio). Se imprimen en la bodega (solo el administrador: PRODUCTOS_GESTIONAR), de
 * piezas sueltas, de todo lo que hay en la bodega o de lo que entró con una compra.
 */
@Injectable()
export class EtiquetasService {
  constructor(private readonly bd: BaseDatosService) {}

  /** Por nombre, código o código de barras (lo que se escribe o se escanea). Solo lo activo. */
  async buscar(usuarioId: number, texto: string): Promise<PiezaEtiqueta[]> {
    const { rows } = await sql<Omit<PiezaEtiqueta, 'nombre'>>`
      select b.variante_id, b.sku as codigo, b.producto, b.variante, b.categoria,
             case when (select fn_ve_cantidad_bodega(${usuarioId})) then b.stock end as cantidad
        from fn_buscar_variantes(${texto}, (select id from sucursal where tipo = 'BODEGA'), 30) b
       where b.tipo = 'PRODUCTO'`.execute(this.bd.db);
    return rows.map(conNombre);
  }

  /** Todo lo que hay en la bodega, por categoría y producto: las copias son las existencias. */
  async bodega(usuarioId: number): Promise<PiezaEtiqueta[]> {
    const { rows } = await sql<Omit<PiezaEtiqueta, 'nombre'>>`
      select va.id as variante_id, va.sku as codigo, p.nombre as producto, va.nombre as variante,
             c.nombre as categoria,
             case when (select fn_ve_cantidad_bodega(${usuarioId})) then ss.cantidad end as cantidad
        from stock_sucursal ss
        join sucursal s on s.id = ss.sucursal_id and s.tipo = 'BODEGA'
        join variante va on va.id = ss.variante_id
        join producto p on p.id = va.producto_id and p.tipo = 'PRODUCTO'
        join categoria c on c.id = p.categoria_id
       where ss.cantidad > 0
       order by c.nombre, p.nombre, va.nombre, va.id`.execute(this.bd.db);
    return rows.map(conNombre);
  }

  /** Las compras más recientes (sin las canceladas). Pide además INVENTARIO_ENTRADA, como /api/compras. */
  async compras(usuarioId: number): Promise<CompraParaEtiquetas[]> {
    await this.exigirCompras(usuarioId);
    return this.listaDeCompras(sql`true`, 30);
  }

  /** Lo que entró con una compra: las copias son lo recibido de cada pieza. */
  async compra(
    usuarioId: number,
    id: number,
  ): Promise<{ compra: CompraParaEtiquetas; piezas: PiezaEtiqueta[] }> {
    await this.exigirCompras(usuarioId);
    const [compra] = await this.listaDeCompras(sql`co.id = ${id}`, 1);
    if (!compra) throw new NoEncontrado(`La compra ${id} no existe`);
    const { rows } = await sql<Omit<PiezaEtiqueta, 'nombre'>>`
      select va.id as variante_id, va.sku as codigo, p.nombre as producto, va.nombre as variante,
             c.nombre as categoria, d.cantidad_recibida as cantidad
        from compra_detalle d
        join variante va on va.id = d.variante_id
        join producto p on p.id = va.producto_id
        join categoria c on c.id = p.categoria_id
       where d.compra_id = ${id} and d.cantidad_recibida > 0
       order by p.nombre, va.nombre, va.id`.execute(this.bd.db);
    return { compra, piezas: rows.map(conNombre) };
  }

  /** El PDF: cada pieza tantas veces como copias, en el orden en que vienen. */
  async pdf(datos: DatosPdfEtiquetas): Promise<Buffer> {
    const ids = datos.piezas.map((p) => p.variante_id);
    const { rows } = await sql<{
      id: number;
      sku: string;
      producto: string;
      variante: string;
      tipo: string;
    }>`
      select va.id, va.sku, p.nombre as producto, va.nombre as variante, p.tipo
        from variante va join producto p on p.id = va.producto_id
       where va.id = any(${ids}::bigint[])`.execute(this.bd.db);
    const porId = new Map(rows.map((r) => [r.id, r]));
    const etiquetas: Etiqueta[] = [];
    for (const { variante_id, copias } of datos.piezas) {
      const pieza = porId.get(variante_id);
      if (!pieza) throw new NoEncontrado(`La pieza ${variante_id} no existe`);
      if (pieza.tipo !== 'PRODUCTO') {
        throw reglaDeNegocio(
          `${pieza.producto} es una perforación: las perforaciones no llevan etiqueta`,
        );
      }
      const etiqueta = { codigo: pieza.sku, nombre: nombreCorto(pieza.producto, pieza.variante) };
      for (let n = 0; n < copias; n++) etiquetas.push(etiqueta);
    }
    return datos.formato === 'HOJA'
      ? etiquetasEnHoja(etiquetas, datos.hoja)
      : etiquetasEnRollo(etiquetas, datos.rollo);
  }

  /** Las compras se ven con el permiso de las compras (no basta con administrar el catálogo). */
  private async exigirCompras(usuarioId: number): Promise<void> {
    await sql`select fn_exigir_permiso(${usuarioId}, 'INVENTARIO_ENTRADA')`.execute(this.bd.db);
  }

  /** Compras sin las canceladas (una cancelada responde como si no existiera), la más reciente primero. */
  private async listaDeCompras(
    condicion: ReturnType<typeof sql>,
    limite: number,
  ): Promise<CompraParaEtiquetas[]> {
    const { rows } = await sql<CompraParaEtiquetas>`
      select co.id, pr.nombre as proveedor, co.factura_numero, co.fecha_factura, co.estado,
             coalesce((select sum(d.cantidad_recibida) from compra_detalle d where d.compra_id = co.id), 0)::int
               as piezas
        from compra co
        join proveedor pr on pr.id = co.proveedor_id
       where co.estado <> 'CANCELADA' and ${condicion}
       order by co.fecha_factura desc, co.id desc
       limit ${limite}`.execute(this.bd.db);
    return rows;
  }
}
