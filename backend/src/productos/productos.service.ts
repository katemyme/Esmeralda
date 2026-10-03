import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseDatosService, type Trx } from '../base-datos/base-datos.service';
import { NoEncontrado } from '../comun/no-encontrado';
import type {
  DatosActualizarProducto,
  DatosActualizarVariante,
  DatosCrearProducto,
  DatosCrearVariante,
  DatosPrecioVariante,
  FiltroProductos,
} from './esquemas';

/** Una variante: lo que realmente se vende (material / calibre / largo / color). */
export interface VarianteCatalogo {
  id: number;
  sku: string;
  codigo_barras: string | null;
  nombre: string;
  atributos: unknown;
  /** null en los paquetes: su precio se calcula con la pieza (tabla de precios de perforación). */
  precio_venta: string | null;
  /** null para quien no tiene el permiso REPORTES_COSTOS. */
  costo: string | null;
  gama: { id: number; nombre: string } | null;
  foto_url: string | null;
  activo: boolean;
}

export interface ProductoCatalogo {
  id: number;
  nombre: string;
  descripcion: string | null;
  /** PRODUCTO (pieza o artículo con stock), SERVICIO (perforación sola) o PAQUETE (con pieza). */
  tipo: string;
  categoria: { id: number; nombre: string };
  activo: boolean;
  variantes: VarianteCatalogo[];
}

/** Un cambio de precio de venta o de costo (lo registra la base en cada cambio). */
export interface CambioPrecio {
  id: number;
  fecha: Date;
  precio_anterior: string;
  precio_nuevo: string;
  /** null para quien no tiene el permiso REPORTES_COSTOS. */
  costo_anterior: string | null;
  costo_nuevo: string | null;
  usuario: { id: number; nombre_completo: string } | null;
}

/** Un resultado de la búsqueda para la venta. */
export interface VarianteEncontrada {
  id: number;
  sku: string;
  codigo_barras: string | null;
  producto: string;
  variante: string;
  categoria: string;
  tipo: string;
  /** null en los paquetes (se calcula con la pieza). */
  precio: string | null;
  /** Existencias en la sucursal; null en servicios y paquetes. */
  stock: number | null;
  gama: string | null;
  foto_url: string | null;
}

/** Existencias de una variante en una ubicación. */
export interface ExistenciaUbicacion {
  sucursal_id: number;
  sucursal: string;
  tipo: string;
  /** null en la bodega para quien solo puede saber si hay o no (parámetro BODEGA_VISIBILIDAD). */
  cantidad: number | null;
  disponible: boolean;
}

/** Para ILIKE: los comodines que escriba el usuario se buscan como texto. */
function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, '\\$&');
}

/**
 * Catálogo de productos y variantes. Las reglas (permisos, perforaciones que no se editan como
 * productos, no desactivar con existencias, historial de precios) las aplica la base:
 * fn_guardar_producto, fn_set_producto_activo, fn_crear_variante, fn_actualizar_variante,
 * fn_set_precio_variante y fn_set_variante_activa.
 */
@Injectable()
export class ProductosService {
  constructor(private readonly bd: BaseDatosService) {}

  /** Una página del catálogo (ordenada por nombre) y cuántos productos cumplen el filtro. */
  async listar(
    usuarioId: number,
    filtro: FiltroProductos,
  ): Promise<{ productos: ProductoCatalogo[]; total: number }> {
    let base = this.bd.db.selectFrom('producto as p');
    if (filtro.categoria_id) base = base.where('p.categoria_id', '=', filtro.categoria_id);
    if (filtro.tipo) base = base.where('p.tipo', '=', filtro.tipo);
    if (filtro.estado !== 'todos') base = base.where('p.activo', '=', filtro.estado === 'activos');
    if (filtro.buscar) {
      const texto = filtro.buscar;
      const patron = `%${escaparLike(texto)}%`;
      base = base.where((eb) =>
        eb.or([
          eb('p.nombre', 'ilike', patron),
          eb.exists(
            eb
              .selectFrom('variante as v')
              .select('v.id')
              .whereRef('v.producto_id', '=', 'p.id')
              .where((v) =>
                v.or([
                  v('v.sku', 'ilike', patron),
                  v('v.nombre', 'ilike', patron),
                  v('v.codigo_barras', '=', texto),
                ]),
              ),
          ),
        ]),
      );
    }

    const [pagina, conteo] = await Promise.all([
      base
        .select('p.id')
        .orderBy('p.nombre')
        .orderBy('p.id')
        .limit(filtro.limite)
        .offset(filtro.desplazamiento)
        .execute(),
      base.select((eb) => eb.fn.countAll<number>().as('total')).executeTakeFirstOrThrow(),
    ]);
    const productos = await this.consultar(
      usuarioId,
      pagina.map((p) => p.id),
    );
    return { productos, total: conteo.total };
  }

  async buscar(usuarioId: number, id: number): Promise<ProductoCatalogo> {
    const [producto] = await this.consultar(usuarioId, [id]);
    if (!producto) throw new NoEncontrado(`El producto ${id} no existe`);
    return producto;
  }

  /** Crea el producto con sus variantes en una sola transacción. */
  async crear(adminId: number, datos: DatosCrearProducto): Promise<ProductoCatalogo> {
    const id = await this.bd.transaccion(adminId, async (trx) => {
      const { rows } = await sql<{ id: number }>`
        select fn_guardar_producto(${adminId}, null, ${datos.categoria_id}, ${datos.nombre},
               ${datos.descripcion}) as id`.execute(trx);
      for (const variante of datos.variantes) {
        await this.crearVariante(trx, adminId, rows[0].id, variante);
      }
      return rows[0].id;
    });
    return this.buscar(adminId, id);
  }

  async actualizar(
    adminId: number,
    id: number,
    datos: DatosActualizarProducto,
  ): Promise<ProductoCatalogo> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_guardar_producto(${adminId}, ${id}, ${datos.categoria_id}, ${datos.nombre},
                 ${datos.descripcion})`.execute(trx),
    );
    return this.buscar(adminId, id);
  }

  async cambiarActivo(adminId: number, id: number, activo: boolean): Promise<ProductoCatalogo> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_set_producto_activo(${adminId}, ${id}, ${activo})`.execute(trx),
    );
    return this.buscar(adminId, id);
  }

  async agregarVariante(
    adminId: number,
    productoId: number,
    datos: DatosCrearVariante,
  ): Promise<ProductoCatalogo> {
    await this.bd.transaccion(adminId, (trx) =>
      this.crearVariante(trx, adminId, productoId, datos),
    );
    return this.buscar(adminId, productoId);
  }

  async actualizarVariante(
    adminId: number,
    varianteId: number,
    datos: DatosActualizarVariante,
  ): Promise<ProductoCatalogo> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_actualizar_variante(${adminId}, ${varianteId}, ${datos.sku}, ${datos.nombre},
                 ${datos.codigo_barras}, ${datos.gama_id}::integer,
                 ${JSON.stringify(datos.atributos)}::jsonb, ${datos.foto_url})`.execute(trx),
    );
    return this.productoDeVariante(adminId, varianteId);
  }

  /** Cambia precio de venta, costo o ambos; el cambio queda en el historial de precios. */
  async cambiarPrecioVariante(
    adminId: number,
    varianteId: number,
    datos: DatosPrecioVariante,
  ): Promise<ProductoCatalogo> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_set_precio_variante(${adminId}, ${varianteId},
                 ${datos.precio_venta ?? null}::numeric, ${datos.costo ?? null}::numeric)`.execute(
        trx,
      ),
    );
    return this.productoDeVariante(adminId, varianteId);
  }

  async cambiarVarianteActiva(
    adminId: number,
    varianteId: number,
    activa: boolean,
  ): Promise<ProductoCatalogo> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_set_variante_activa(${adminId}, ${varianteId}, ${activa})`.execute(trx),
    );
    return this.productoDeVariante(adminId, varianteId);
  }

  /**
   * Pone (o quita, con null) la foto de una variante. Devuelve también la dirección anterior
   * para que quien llama borre ese archivo.
   */
  async ponerFoto(
    adminId: number,
    varianteId: number,
    fotoUrl: string | null,
  ): Promise<{ producto: ProductoCatalogo; anterior: string | null }> {
    const anterior = await this.bd.transaccion(adminId, async (trx) => {
      const { rows } = await sql<{ anterior: string | null }>`
        select fn_set_foto_variante(${adminId}, ${varianteId}, ${fotoUrl}) as anterior`.execute(
        trx,
      );
      return rows[0].anterior;
    });
    return { producto: await this.productoDeVariante(adminId, varianteId), anterior };
  }

  /** Cambios de precio y de costo de una variante, del más reciente al más antiguo. */
  async historialPrecios(usuarioId: number, varianteId: number): Promise<CambioPrecio[]> {
    await this.exigirVariante(varianteId);
    const veCostos = sql<boolean>`(select fn_tiene_permiso(${usuarioId}, 'REPORTES_COSTOS'))`;
    const filas = await this.bd.db
      .selectFrom('historial_precio as h')
      .leftJoin('usuario as u', 'u.id', 'h.usuario_id')
      .select([
        'h.id',
        'h.fecha',
        'h.precio_anterior',
        'h.precio_nuevo',
        sql<string | null>`case when ${veCostos} then h.costo_anterior end`.as('costo_anterior'),
        sql<string | null>`case when ${veCostos} then h.costo_nuevo end`.as('costo_nuevo'),
        'u.id as usuario_id',
        'u.nombre_completo as usuario_nombre',
      ])
      .where('h.variante_id', '=', varianteId)
      .orderBy('h.id', 'desc')
      .limit(200)
      .execute();
    return filas.map((f) => ({
      id: f.id,
      fecha: f.fecha,
      precio_anterior: f.precio_anterior,
      precio_nuevo: f.precio_nuevo,
      costo_anterior: f.costo_anterior,
      costo_nuevo: f.costo_nuevo,
      usuario:
        f.usuario_id !== null && f.usuario_nombre !== null
          ? { id: f.usuario_id, nombre_completo: f.usuario_nombre }
          : null,
    }));
  }

  /**
   * Búsqueda para la venta (fn_buscar_variantes): por nombre, SKU o código de barras, solo lo
   * activo, con el stock de la sucursal. El usuario debe poder operar en esa sucursal.
   */
  async buscarParaVenta(
    usuarioId: number,
    texto: string,
    sucursalId: number,
    limite: number,
  ): Promise<VarianteEncontrada[]> {
    await sql`select fn_exigir_sucursal(${usuarioId}, ${sucursalId})`.execute(this.bd.db);
    const { rows } = await sql<VarianteEncontrada>`
      select variante_id as id, sku, codigo_barras, producto, variante, categoria, tipo, precio,
             stock, gama, foto_url
        from fn_buscar_variantes(${texto}, ${sucursalId}, ${limite})`.execute(this.bd.db);
    return rows;
  }

  /** Existencias de una variante en cada ubicación, según lo que el usuario puede ver (fn_consultar_stock). */
  async existencias(usuarioId: number, varianteId: number): Promise<ExistenciaUbicacion[]> {
    await this.exigirVariante(varianteId);
    const { rows } = await sql<ExistenciaUbicacion>`
      select sucursal_id, sucursal, tipo, cantidad, disponible
        from fn_consultar_stock(${usuarioId}, ${varianteId})`.execute(this.bd.db);
    return rows;
  }

  private async exigirVariante(varianteId: number): Promise<void> {
    const variante = await this.bd.db
      .selectFrom('variante')
      .select('id')
      .where('id', '=', varianteId)
      .executeTakeFirst();
    if (!variante) throw new NoEncontrado(`La variante ${varianteId} no existe`);
  }

  private async crearVariante(
    trx: Trx,
    adminId: number,
    productoId: number,
    datos: DatosCrearVariante,
  ): Promise<void> {
    await sql`
      select fn_crear_variante(${adminId}, ${productoId}, ${datos.sku}, ${datos.precio_venta}::numeric,
             ${datos.nombre}, ${datos.costo}::numeric, ${datos.codigo_barras}, ${datos.gama_id}::integer,
             ${JSON.stringify(datos.atributos)}::jsonb, ${datos.foto_url})`.execute(trx);
  }

  private async productoDeVariante(
    usuarioId: number,
    varianteId: number,
  ): Promise<ProductoCatalogo> {
    const variante = await this.bd.db
      .selectFrom('variante')
      .select('producto_id')
      .where('id', '=', varianteId)
      .executeTakeFirst();
    if (!variante) throw new NoEncontrado(`La variante ${varianteId} no existe`);
    return this.buscar(usuarioId, variante.producto_id);
  }

  /** Productos con sus variantes, en el orden de `ids`. */
  private async consultar(usuarioId: number, ids: number[]): Promise<ProductoCatalogo[]> {
    if (ids.length === 0) return [];
    const { db } = this.bd;
    const [productos, variantes] = await Promise.all([
      db
        .selectFrom('producto as p')
        .innerJoin('categoria as c', 'c.id', 'p.categoria_id')
        .select([
          'p.id',
          'p.nombre',
          'p.descripcion',
          'p.tipo',
          'p.activo',
          'c.id as categoria_id',
          'c.nombre as categoria_nombre',
        ])
        .where('p.id', 'in', ids)
        .execute(),
      db
        .selectFrom('variante as v')
        .innerJoin('producto as p', 'p.id', 'v.producto_id')
        .leftJoin('gama as g', 'g.id', 'v.gama_id')
        .select([
          'v.id',
          'v.producto_id',
          'v.sku',
          'v.codigo_barras',
          'v.nombre',
          'v.atributos',
          'v.foto_url',
          'v.activo',
          'g.id as gama_id',
          'g.nombre as gama_nombre',
          // El paquete no tiene precio propio; el costo solo lo ve quien puede ver costos
          sql<string | null>`case when p.tipo = 'PAQUETE' then null else v.precio_venta end`.as(
            'precio_venta',
          ),
          sql<
            string | null
          >`case when (select fn_tiene_permiso(${usuarioId}, 'REPORTES_COSTOS')) then v.costo end`.as(
            'costo',
          ),
        ])
        .where('v.producto_id', 'in', ids)
        .orderBy('v.nombre')
        .orderBy('v.id')
        .execute(),
    ]);

    const porId = new Map(productos.map((p) => [p.id, p]));
    return ids.flatMap((id) => {
      const p = porId.get(id);
      if (!p) return [];
      return [
        {
          id: p.id,
          nombre: p.nombre,
          descripcion: p.descripcion,
          tipo: p.tipo,
          categoria: { id: p.categoria_id, nombre: p.categoria_nombre },
          activo: p.activo,
          variantes: variantes
            .filter((v) => v.producto_id === id)
            .map((v) => ({
              id: v.id,
              sku: v.sku,
              codigo_barras: v.codigo_barras,
              nombre: v.nombre,
              atributos: v.atributos,
              precio_venta: v.precio_venta,
              costo: v.costo,
              gama:
                v.gama_id !== null && v.gama_nombre !== null
                  ? { id: v.gama_id, nombre: v.gama_nombre }
                  : null,
              foto_url: v.foto_url,
              activo: v.activo,
            })),
        },
      ];
    });
  }
}
