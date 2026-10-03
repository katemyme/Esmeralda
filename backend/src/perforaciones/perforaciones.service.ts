import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { NoEncontrado } from '../comun/no-encontrado';
import type {
  DatosActualizarPerforacion,
  DatosCrearPerforacion,
  DatosPiezaPermitida,
  DatosPrecioEspecial,
  DatosPrecioGama,
} from './esquemas';

interface Referencia {
  id: number;
  nombre: string;
}

/** Una pieza concreta (variante) con el nombre de su producto. */
interface PiezaReferida {
  id: number;
  sku: string;
  nombre: string;
}

/** Una perforación con todo lo que define el precio de su paquete. */
export interface PerforacionCatalogo {
  id: number;
  codigo: string;
  nombre: string;
  piezas_por_paquete: number;
  activa: boolean;
  /** Entradas del catálogo que se venden: perforación sola y perforación con pieza. */
  servicio_variante_id: number;
  paquete_variante_id: number;
  precio_servicio: string;
  /** Tabla perforación × gama (gamas activas en modo TABLA); precio null = falta definirlo. */
  precios_gama: { gama: Referencia; precio: string | null }[];
  /** Excepciones: ganan a la tabla y a "servicio + pieza". */
  precios_especiales: {
    id: number;
    variante: PiezaReferida | null;
    gama: Referencia | null;
    precio: string;
    motivo: string | null;
  }[];
  /** Reglas de piezas permitidas; sin reglas vale cualquier pieza que tenga gama. */
  piezas_permitidas: {
    id: number;
    gama: Referencia | null;
    categoria: Referencia | null;
    variante: PiezaReferida | null;
  }[];
}

/** Resultado de fn_precio_paquete: cuánto cuesta el paquete y qué regla se aplicó. */
export interface PrecioPaquete {
  precio: string;
  /** ESPECIAL, TABLA_GAMA o SERVICIO_MAS_PIEZA. */
  regla: string;
  detalle: string;
}

function referencia(id: number | null, nombre: string | null): Referencia | null {
  return id !== null && nombre !== null ? { id, nombre } : null;
}

function pieza(id: number | null, sku: string | null, nombre: string | null): PiezaReferida | null {
  return id !== null && sku !== null && nombre !== null ? { id, sku, nombre } : null;
}

/**
 * Perforaciones y precio de sus paquetes. Las reglas viven en la base: fn_crear_perforacion,
 * fn_actualizar_perforacion, fn_set_perforacion_activa, fn_set_precio_variante (solo servicio),
 * fn_set_precio_gama, fn_set_precio_especial, fn_set_pieza_permitida y fn_precio_paquete.
 */
@Injectable()
export class PerforacionesService {
  constructor(private readonly bd: BaseDatosService) {}

  listar(): Promise<PerforacionCatalogo[]> {
    return this.consultar();
  }

  async buscar(id: number): Promise<PerforacionCatalogo> {
    const [perforacion] = await this.consultar(id);
    if (!perforacion) throw new NoEncontrado(`La perforación ${id} no existe`);
    return perforacion;
  }

  async crear(adminId: number, datos: DatosCrearPerforacion): Promise<PerforacionCatalogo> {
    const id = await this.bd.transaccion(adminId, async (trx) => {
      const { rows } = await sql<{ id: number }>`
        select fn_crear_perforacion(${adminId}, ${datos.codigo}, ${datos.nombre},
               ${datos.precio_servicio}::numeric, ${datos.piezas_por_paquete}::smallint) as id`.execute(
        trx,
      );
      return rows[0].id;
    });
    return this.buscar(id);
  }

  async actualizar(
    adminId: number,
    id: number,
    datos: DatosActualizarPerforacion,
  ): Promise<PerforacionCatalogo> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_actualizar_perforacion(${adminId}, ${id}, ${datos.nombre},
                 ${datos.piezas_por_paquete}::integer)`.execute(trx),
    );
    return this.buscar(id);
  }

  async cambiarActiva(adminId: number, id: number, activa: boolean): Promise<PerforacionCatalogo> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_set_perforacion_activa(${adminId}, ${id}, ${activa})`.execute(trx),
    );
    return this.buscar(id);
  }

  /** El precio de "solo servicio" es el precio de venta de la variante de servicio. */
  async cambiarPrecioServicio(
    adminId: number,
    id: number,
    precio: string,
  ): Promise<PerforacionCatalogo> {
    const perforacion = await this.buscar(id);
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_set_precio_variante(${adminId}, ${perforacion.servicio_variante_id},
                 ${precio}::numeric)`.execute(trx),
    );
    return this.buscar(id);
  }

  async cambiarPrecioGama(
    adminId: number,
    id: number,
    datos: DatosPrecioGama,
  ): Promise<PerforacionCatalogo> {
    await this.buscar(id);
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_set_precio_gama(${adminId}, ${id}, ${datos.gama_id},
                 ${datos.precio}::numeric)`.execute(trx),
    );
    return this.buscar(id);
  }

  async cambiarPrecioEspecial(
    adminId: number,
    id: number,
    datos: DatosPrecioEspecial,
  ): Promise<PerforacionCatalogo> {
    await this.buscar(id);
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_set_precio_especial(${adminId}, ${id}, ${datos.variante_id}::bigint,
                 ${datos.gama_id}::integer, ${datos.precio}::numeric, ${datos.motivo})`.execute(
        trx,
      ),
    );
    return this.buscar(id);
  }

  async cambiarPiezaPermitida(
    adminId: number,
    id: number,
    datos: DatosPiezaPermitida,
  ): Promise<PerforacionCatalogo> {
    await this.buscar(id);
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_set_pieza_permitida(${adminId}, ${id}, ${datos.gama_id}::integer,
                 ${datos.categoria_id}::integer, ${datos.variante_id}::bigint,
                 ${datos.permitir})`.execute(trx),
    );
    return this.buscar(id);
  }

  /** Precio del paquete con las piezas indicadas (las que se escanean al vender). */
  async precioPaquete(id: number, piezas: number[]): Promise<PrecioPaquete> {
    const { rows } = await sql<PrecioPaquete>`
      select precio, regla, detalle from fn_precio_paquete(${id}, ${piezas}::bigint[])`.execute(
      this.bd.db,
    );
    return rows[0];
  }

  private async consultar(id?: number): Promise<PerforacionCatalogo[]> {
    const { db } = this.bd;
    let perforaciones = db
      .selectFrom('perforacion as pf')
      .innerJoin('variante as sv', 'sv.id', 'pf.servicio_variante_id')
      .select([
        'pf.id',
        'pf.codigo',
        'pf.nombre',
        'pf.piezas_por_paquete',
        'pf.activa',
        'pf.servicio_variante_id',
        'pf.paquete_variante_id',
        'sv.precio_venta as precio_servicio',
      ])
      .orderBy('pf.nombre');
    let tabla = db
      .selectFrom('v_precios_perforacion as t')
      .select(['t.perforacion_id', 't.gama_id', 't.gama', 't.precio_paquete'])
      .orderBy('t.orden')
      .orderBy('t.gama');
    let especiales = db
      .selectFrom('precio_especial_paquete as e')
      .leftJoin('variante as v', 'v.id', 'e.variante_id')
      .leftJoin('producto as p', 'p.id', 'v.producto_id')
      .leftJoin('gama as g', 'g.id', 'e.gama_id')
      .select([
        'e.id',
        'e.perforacion_id',
        'e.precio',
        'e.motivo',
        'v.id as variante_id',
        'v.sku',
        sql<string | null>`p.nombre || ' — ' || v.nombre`.as('variante_nombre'),
        'g.id as gama_id',
        'g.nombre as gama_nombre',
      ])
      .orderBy('e.id');
    let permitidas = db
      .selectFrom('perforacion_pieza_permitida as r')
      .leftJoin('gama as g', 'g.id', 'r.gama_id')
      .leftJoin('categoria as c', 'c.id', 'r.categoria_id')
      .leftJoin('variante as v', 'v.id', 'r.variante_id')
      .leftJoin('producto as p', 'p.id', 'v.producto_id')
      .select([
        'r.id',
        'r.perforacion_id',
        'g.id as gama_id',
        'g.nombre as gama_nombre',
        'c.id as categoria_id',
        'c.nombre as categoria_nombre',
        'v.id as variante_id',
        'v.sku',
        sql<string | null>`p.nombre || ' — ' || v.nombre`.as('variante_nombre'),
      ])
      .orderBy('r.id');
    if (id !== undefined) {
      perforaciones = perforaciones.where('pf.id', '=', id);
      tabla = tabla.where('t.perforacion_id', '=', id);
      especiales = especiales.where('e.perforacion_id', '=', id);
      permitidas = permitidas.where('r.perforacion_id', '=', id);
    }

    const [filas, filasTabla, filasEspeciales, filasPermitidas] = await Promise.all([
      perforaciones.execute(),
      tabla
        .$castTo<{
          perforacion_id: number;
          gama_id: number;
          gama: string;
          precio_paquete: string | null;
        }>()
        .execute(),
      especiales.execute(),
      permitidas.execute(),
    ]);

    return filas.map((pf) => ({
      ...pf,
      precios_gama: filasTabla
        .filter((t) => t.perforacion_id === pf.id)
        .map((t) => ({ gama: { id: t.gama_id, nombre: t.gama }, precio: t.precio_paquete })),
      precios_especiales: filasEspeciales
        .filter((e) => e.perforacion_id === pf.id)
        .map((e) => ({
          id: e.id,
          variante: pieza(e.variante_id, e.sku, e.variante_nombre),
          gama: referencia(e.gama_id, e.gama_nombre),
          precio: e.precio,
          motivo: e.motivo,
        })),
      piezas_permitidas: filasPermitidas
        .filter((r) => r.perforacion_id === pf.id)
        .map((r) => ({
          id: r.id,
          gama: referencia(r.gama_id, r.gama_nombre),
          categoria: referencia(r.categoria_id, r.categoria_nombre),
          variante: pieza(r.variante_id, r.sku, r.variante_nombre),
        })),
    }));
  }
}
