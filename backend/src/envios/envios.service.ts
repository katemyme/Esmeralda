import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { donde, veCostos } from '../comun/consultas';
import { NoEncontrado } from '../comun/no-encontrado';
import type { DatosCrearEnvio, DatosLineaEnvio, DatosRecibirEnvio, FiltroEnvios } from './esquemas';

interface Ubicacion {
  id: number;
  codigo: string;
  nombre: string;
}

interface UsuarioReferido {
  id: number;
  nombre_completo: string;
}

/** Un envío de mercadería entre ubicaciones (sale al enviar, entra lo escaneado al recibir). */
export interface EnvioResumen {
  id: number;
  /** ENV-000001: se asigna al enviar (null mientras es borrador). */
  numero: string | null;
  origen: Ubicacion;
  destino: Ubicacion;
  /** BORRADOR, EN_TRANSITO, RECIBIDO, RECIBIDO_CON_DIFERENCIAS o CANCELADO. */
  estado: string;
  notas: string | null;
  lineas: number;
  piezas_enviadas: number;
  /** null mientras no se ha recibido. */
  piezas_recibidas: number | null;
  faltantes: number | null;
  creado_por: UsuarioReferido;
  created_at: Date;
  enviado_por: UsuarioReferido | null;
  fecha_envio: Date | null;
  recibido_por: UsuarioReferido | null;
  fecha_recepcion: Date | null;
}

export interface EnvioDetalle extends EnvioResumen {
  detalle: {
    variante: { id: number; sku: string; nombre: string };
    cantidad_enviada: number;
    cantidad_recibida: number | null;
    /** Costo promedio al enviar; null para quien no tiene el permiso REPORTES_COSTOS. */
    costo_unitario: string | null;
  }[];
}

/** Una fila de fn_sugerir_reparto. */
export interface SugerenciaReparto {
  sucursal_id: number;
  sucursal: string;
  stock: number;
  stock_minimo: number;
  en_transito: number;
  vendidas_30d: number;
  sugerido: number;
}

interface FilaEnvio {
  id: number;
  numero: string | null;
  estado: string;
  notas: string | null;
  origen_id: number;
  origen_codigo: string;
  origen_nombre: string;
  destino_id: number;
  destino_codigo: string;
  destino_nombre: string;
  lineas: number;
  piezas_enviadas: number;
  piezas_recibidas: number | null;
  faltantes: number | null;
  creado_por_id: number;
  creado_por: string;
  created_at: Date;
  enviado_por_id: number | null;
  enviado_por: string | null;
  fecha_envio: Date | null;
  recibido_por_id: number | null;
  recibido_por: string | null;
  fecha_recepcion: Date | null;
}

function usuario(id: number | null, nombre: string | null): UsuarioReferido | null {
  return id !== null && nombre !== null ? { id, nombre_completo: nombre } : null;
}

function aEnvio(f: FilaEnvio): EnvioResumen {
  return {
    id: f.id,
    numero: f.numero,
    origen: { id: f.origen_id, codigo: f.origen_codigo, nombre: f.origen_nombre },
    destino: { id: f.destino_id, codigo: f.destino_codigo, nombre: f.destino_nombre },
    estado: f.estado,
    notas: f.notas,
    lineas: f.lineas,
    piezas_enviadas: f.piezas_enviadas,
    piezas_recibidas: f.piezas_recibidas,
    faltantes: f.faltantes,
    creado_por: { id: f.creado_por_id, nombre_completo: f.creado_por },
    created_at: f.created_at,
    enviado_por: usuario(f.enviado_por_id, f.enviado_por),
    fecha_envio: f.fecha_envio,
    recibido_por: usuario(f.recibido_por_id, f.recibido_por),
    fecha_recepcion: f.fecha_recepcion,
  };
}

/**
 * Envíos entre ubicaciones, en dos pasos. Las reglas (stock suficiente al enviar, no recibir más
 * de lo enviado, alerta por faltantes) las aplica la base: fn_crear_envio, fn_envio_set_linea,
 * fn_enviar, fn_recibir_envio, fn_cancelar_envio y fn_sugerir_reparto. Cada quien ve los envíos
 * que salen de sus sucursales o llegan a ellas.
 */
@Injectable()
export class EnviosService {
  constructor(private readonly bd: BaseDatosService) {}

  async listar(usuarioId: number, filtro: FiltroEnvios): Promise<EnvioResumen[]> {
    const filas = await this.consultar(
      usuarioId,
      [
        filtro.estado && sql`e.estado = ${filtro.estado}`,
        filtro.origen_id && sql`e.origen_id = ${filtro.origen_id}`,
        filtro.destino_id && sql`e.destino_id = ${filtro.destino_id}`,
        filtro.antes_de && sql`e.id < ${filtro.antes_de}`,
      ],
      filtro.limite,
    );
    return filas.map(aEnvio);
  }

  async buscar(usuarioId: number, id: number): Promise<EnvioDetalle> {
    const [fila] = await this.consultar(usuarioId, [sql`e.id = ${id}`], 1);
    if (!fila) throw new NoEncontrado(`El envío ${id} no existe`);
    const { rows } = await sql<{
      variante_id: number;
      sku: string;
      nombre: string;
      cantidad_enviada: number;
      cantidad_recibida: number | null;
      costo_unitario: string | null;
    }>`
      select d.variante_id, va.sku, pr.nombre || ' — ' || va.nombre as nombre, d.cantidad_enviada,
             d.cantidad_recibida,
             case when ${veCostos(usuarioId)} then d.costo_unitario end as costo_unitario
        from envio_detalle d
        join variante va on va.id = d.variante_id
        join producto pr on pr.id = va.producto_id
       where d.envio_id = ${id}
       order by pr.nombre, va.nombre, d.id`.execute(this.bd.db);
    return {
      ...aEnvio(fila),
      detalle: rows.map((d) => ({
        variante: { id: d.variante_id, sku: d.sku, nombre: d.nombre },
        cantidad_enviada: d.cantidad_enviada,
        cantidad_recibida: d.cantidad_recibida,
        costo_unitario: d.costo_unitario,
      })),
    };
  }

  /** Crea el envío en borrador con sus líneas, en una sola transacción. */
  async crear(usuarioId: number, datos: DatosCrearEnvio): Promise<EnvioDetalle> {
    const id = await this.bd.transaccion(usuarioId, async (trx) => {
      const { rows } = await sql<{ id: number }>`
        select fn_crear_envio(${usuarioId}, ${datos.origen_id}, ${datos.destino_id}, ${datos.notas}) as id`.execute(
        trx,
      );
      for (const linea of datos.lineas) {
        await sql`select fn_envio_set_linea(${usuarioId}, ${rows[0].id}, ${linea.variante_id},
                         ${linea.cantidad})`.execute(trx);
      }
      return rows[0].id;
    });
    return this.buscar(usuarioId, id);
  }

  /** Agrega la pieza, cambia su cantidad o (con 0) la quita. */
  async ponerLinea(usuarioId: number, id: number, linea: DatosLineaEnvio): Promise<EnvioDetalle> {
    await this.buscar(usuarioId, id);
    await this.bd.transaccion(usuarioId, (trx) =>
      sql`select fn_envio_set_linea(${usuarioId}, ${id}, ${linea.variante_id}, ${linea.cantidad})`.execute(
        trx,
      ),
    );
    return this.buscar(usuarioId, id);
  }

  /** Paso 1: la mercadería sale del origen y el envío queda en tránsito, con su número. */
  async enviar(usuarioId: number, id: number): Promise<EnvioDetalle> {
    await this.bd.transaccion(usuarioId, (trx) =>
      sql`select fn_enviar(${usuarioId}, ${id})`.execute(trx),
    );
    return this.buscar(usuarioId, id);
  }

  /** Paso 2: entra al destino lo escaneado; si falta algo, la base alerta al admin. */
  async recibir(usuarioId: number, id: number, datos: DatosRecibirEnvio): Promise<EnvioDetalle> {
    await this.bd.transaccion(usuarioId, (trx) =>
      sql`select * from fn_recibir_envio(${usuarioId}, ${id}, ${JSON.stringify(datos.recibido)}::jsonb)`.execute(
        trx,
      ),
    );
    return this.buscar(usuarioId, id);
  }

  async cancelar(usuarioId: number, id: number, motivo: string): Promise<EnvioDetalle> {
    await this.buscar(usuarioId, id);
    await this.bd.transaccion(usuarioId, (trx) =>
      sql`select fn_cancelar_envio(${usuarioId}, ${id}, ${motivo})`.execute(trx),
    );
    return this.buscar(usuarioId, id);
  }

  /** Cómo repartir `cantidad` piezas entre las sucursales: primero el stock mínimo, luego según ventas. */
  async sugerirReparto(varianteId: number, piezas: number): Promise<SugerenciaReparto[]> {
    const variante = await this.bd.db
      .selectFrom('variante')
      .select('id')
      .where('id', '=', varianteId)
      .executeTakeFirst();
    if (!variante) throw new NoEncontrado(`La variante ${varianteId} no existe`);
    const { rows } = await sql<SugerenciaReparto>`
      select sucursal_id, sucursal, stock, stock_minimo, en_transito, vendidas_30d, sugerido
        from fn_sugerir_reparto(${varianteId}, ${piezas})`.execute(this.bd.db);
    return rows;
  }

  private async consultar(
    usuarioId: number,
    condiciones: Parameters<typeof donde>,
    limite: number,
  ): Promise<FilaEnvio[]> {
    const { rows } = await sql<FilaEnvio>`
      select e.id, e.numero, e.estado, e.notas,
             o.id as origen_id, o.codigo as origen_codigo, o.nombre as origen_nombre,
             d.id as destino_id, d.codigo as destino_codigo, d.nombre as destino_nombre,
             (select count(*) from envio_detalle x where x.envio_id = e.id) as lineas,
             (select coalesce(sum(x.cantidad_enviada), 0) from envio_detalle x where x.envio_id = e.id) as piezas_enviadas,
             (select sum(x.cantidad_recibida) from envio_detalle x where x.envio_id = e.id) as piezas_recibidas,
             (select sum(x.cantidad_enviada - x.cantidad_recibida) from envio_detalle x where x.envio_id = e.id) as faltantes,
             uc.id as creado_por_id, uc.nombre_completo as creado_por, e.created_at,
             ue.id as enviado_por_id, ue.nombre_completo as enviado_por, e.fecha_envio,
             ur.id as recibido_por_id, ur.nombre_completo as recibido_por, e.fecha_recepcion
        from envio e
        join sucursal o on o.id = e.origen_id
        join sucursal d on d.id = e.destino_id
        join usuario uc on uc.id = e.creado_por
        left join usuario ue on ue.id = e.enviado_por
        left join usuario ur on ur.id = e.recibido_por
        ${donde(
          sql`(fn_puede_operar_sucursal(${usuarioId}, e.origen_id) or fn_puede_operar_sucursal(${usuarioId}, e.destino_id))`,
          ...condiciones,
        )}
       order by e.id desc
       limit ${limite}`.execute(this.bd.db);
    return rows;
  }
}
