import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { donde, referencia, veCostos } from '../comun/consultas';
import { NoEncontrado } from '../comun/no-encontrado';
import type { DatosIniciarConteo, DatosRegistrarConteo, FiltroConteos } from './esquemas';

interface UsuarioReferido {
  id: number;
  nombre_completo: string;
}

/** Un conteo físico: se escanea (ABIERTO), se envía a revisión (ENVIADO) y el admin lo aplica. */
export interface Conteo {
  id: number;
  sucursal: { id: number; codigo: string; nombre: string };
  /** null = conteo de toda la ubicación. */
  categoria: { id: number; nombre: string } | null;
  /** ABIERTO, ENVIADO, APLICADO o CANCELADO. */
  estado: string;
  notas: string | null;
  /** Piezas distintas contadas y unidades en total. */
  lineas: number;
  piezas_contadas: number;
  iniciado_por: UsuarioReferido;
  iniciado_at: Date;
  enviado_por: UsuarioReferido | null;
  enviado_at: Date | null;
  aplicado_por: UsuarioReferido | null;
  aplicado_at: Date | null;
}

/** El conteo con lo escaneado. No incluye el stock del sistema: quien cuenta lo hace a ciegas. */
export interface ConteoDetalle extends Conteo {
  detalle: { variante: { id: number; sku: string; nombre: string }; cantidad_contada: number }[];
}

/** Una fila de fn_conteo_diferencias, para que el admin revise antes de aplicar. */
export interface DiferenciaConteo {
  variante: { id: number; sku: string; nombre: string };
  stock_sistema: number;
  contada: number;
  diferencia: number;
  /** La diferencia a costo; null para quien no tiene el permiso REPORTES_COSTOS. */
  valor_diferencia: string | null;
}

interface FilaConteo {
  id: number;
  sucursal_id: number;
  sucursal_codigo: string;
  sucursal_nombre: string;
  categoria_id: number | null;
  categoria_nombre: string | null;
  estado: string;
  notas: string | null;
  lineas: number;
  piezas_contadas: number;
  iniciado_por_id: number;
  iniciado_por: string;
  iniciado_at: Date;
  enviado_por_id: number | null;
  enviado_por: string | null;
  enviado_at: Date | null;
  aplicado_por_id: number | null;
  aplicado_por: string | null;
  aplicado_at: Date | null;
}

function usuario(id: number | null, nombre: string | null): UsuarioReferido | null {
  return id !== null && nombre !== null ? { id, nombre_completo: nombre } : null;
}

function aConteo(f: FilaConteo): Conteo {
  return {
    id: f.id,
    sucursal: { id: f.sucursal_id, codigo: f.sucursal_codigo, nombre: f.sucursal_nombre },
    categoria: referencia(f.categoria_id, f.categoria_nombre),
    estado: f.estado,
    notas: f.notas,
    lineas: f.lineas,
    piezas_contadas: f.piezas_contadas,
    iniciado_por: { id: f.iniciado_por_id, nombre_completo: f.iniciado_por },
    iniciado_at: f.iniciado_at,
    enviado_por: usuario(f.enviado_por_id, f.enviado_por),
    enviado_at: f.enviado_at,
    aplicado_por: usuario(f.aplicado_por_id, f.aplicado_por),
    aplicado_at: f.aplicado_at,
  };
}

/**
 * Conteos físicos. Las reglas (uno en curso por ubicación, foto del stock al enviar, ajustes al
 * aplicar) las aplica la base: fn_iniciar_conteo, fn_conteo_registrar, fn_enviar_conteo,
 * fn_conteo_diferencias, fn_aplicar_conteo y fn_cancelar_conteo. Cada quien ve los de sus sucursales.
 */
@Injectable()
export class ConteosService {
  constructor(private readonly bd: BaseDatosService) {}

  async listar(usuarioId: number, filtro: FiltroConteos): Promise<Conteo[]> {
    const filas = await this.consultar(
      usuarioId,
      [
        filtro.estado && sql`c.estado = ${filtro.estado}`,
        filtro.sucursal_id && sql`c.sucursal_id = ${filtro.sucursal_id}`,
        filtro.antes_de && sql`c.id < ${filtro.antes_de}`,
      ],
      filtro.limite,
    );
    return filas.map(aConteo);
  }

  async buscar(usuarioId: number, id: number): Promise<ConteoDetalle> {
    const [fila] = await this.consultar(usuarioId, [sql`c.id = ${id}`], 1);
    if (!fila) throw new NoEncontrado(`El conteo ${id} no existe`);
    const { rows } = await sql<{
      variante_id: number;
      sku: string;
      nombre: string;
      cantidad_contada: number;
    }>`
      select d.variante_id, va.sku, pr.nombre || ' — ' || va.nombre as nombre, d.cantidad_contada
        from conteo_detalle d
        join variante va on va.id = d.variante_id
        join producto pr on pr.id = va.producto_id
       where d.conteo_id = ${id}
       order by pr.nombre, va.nombre, d.variante_id`.execute(this.bd.db);
    return {
      ...aConteo(fila),
      detalle: rows.map((d) => ({
        variante: { id: d.variante_id, sku: d.sku, nombre: d.nombre },
        cantidad_contada: d.cantidad_contada,
      })),
    };
  }

  async iniciar(usuarioId: number, datos: DatosIniciarConteo): Promise<ConteoDetalle> {
    const id = await this.bd.transaccion(usuarioId, async (trx) => {
      const { rows } = await sql<{ id: number }>`
        select fn_iniciar_conteo(${usuarioId}, ${datos.sucursal_id}, ${datos.categoria_id}::integer,
               ${datos.notas}) as id`.execute(trx);
      return rows[0].id;
    });
    return this.buscar(usuarioId, id);
  }

  /** Registra lo escaneado y devuelve cuántas van de esa pieza. */
  async registrar(
    usuarioId: number,
    id: number,
    datos: DatosRegistrarConteo,
  ): Promise<{ variante_id: number; cantidad_contada: number }> {
    const total = await this.bd.transaccion(usuarioId, async (trx) => {
      const { rows } = await sql<{ total: number }>`
        select fn_conteo_registrar(${usuarioId}, ${id}, ${datos.variante_id}, ${datos.cantidad},
               ${datos.sumar}) as total`.execute(trx);
      return rows[0].total;
    });
    return { variante_id: datos.variante_id, cantidad_contada: total };
  }

  /** Cierra el escaneo: la base toma la foto del stock y avisa al admin para que lo revise. */
  async enviar(usuarioId: number, id: number): Promise<ConteoDetalle> {
    await this.bd.transaccion(usuarioId, (trx) =>
      sql`select fn_enviar_conteo(${usuarioId}, ${id})`.execute(trx),
    );
    return this.buscar(usuarioId, id);
  }

  /** Lo contado contra el stock del sistema al momento de enviar el conteo. */
  async diferencias(usuarioId: number, id: number): Promise<DiferenciaConteo[]> {
    await this.buscar(usuarioId, id);
    const { rows } = await sql<{
      variante_id: number;
      sku: string;
      producto: string;
      stock_sistema: number;
      contada: number;
      diferencia: number;
      valor_diferencia: string | null;
    }>`
      select f.variante_id, va.sku, f.producto, f.stock_sistema, f.contada, f.diferencia,
             case when ${veCostos(usuarioId)} then f.valor_diferencia end as valor_diferencia
        from fn_conteo_diferencias(${id}) f
        join variante va on va.id = f.variante_id
       order by abs(f.diferencia) desc, f.producto`.execute(this.bd.db);
    return rows.map((f) => ({
      variante: { id: f.variante_id, sku: f.sku, nombre: f.producto },
      stock_sistema: f.stock_sistema,
      contada: f.contada,
      diferencia: f.diferencia,
      valor_diferencia: f.valor_diferencia,
    }));
  }

  /** Cada diferencia se vuelve un ajuste en el kardex. Devuelve cuántos ajustes se hicieron. */
  async aplicar(
    usuarioId: number,
    id: number,
  ): Promise<{ conteo: ConteoDetalle; ajustes: number }> {
    const ajustes = await this.bd.transaccion(usuarioId, async (trx) => {
      const { rows } = await sql<{ ajustes: number }>`
        select fn_aplicar_conteo(${usuarioId}, ${id}) as ajustes`.execute(trx);
      return rows[0].ajustes;
    });
    return { conteo: await this.buscar(usuarioId, id), ajustes };
  }

  async cancelar(usuarioId: number, id: number): Promise<ConteoDetalle> {
    await this.buscar(usuarioId, id);
    await this.bd.transaccion(usuarioId, (trx) =>
      sql`select fn_cancelar_conteo(${usuarioId}, ${id})`.execute(trx),
    );
    return this.buscar(usuarioId, id);
  }

  private async consultar(
    usuarioId: number,
    condiciones: Parameters<typeof donde>,
    limite: number,
  ): Promise<FilaConteo[]> {
    const { rows } = await sql<FilaConteo>`
      select c.id, s.id as sucursal_id, s.codigo as sucursal_codigo, s.nombre as sucursal_nombre,
             k.id as categoria_id, k.nombre as categoria_nombre, c.estado, c.notas,
             (select count(*) from conteo_detalle d where d.conteo_id = c.id) as lineas,
             (select coalesce(sum(d.cantidad_contada), 0) from conteo_detalle d where d.conteo_id = c.id) as piezas_contadas,
             ui.id as iniciado_por_id, ui.nombre_completo as iniciado_por, c.iniciado_at,
             ue.id as enviado_por_id, ue.nombre_completo as enviado_por, c.enviado_at,
             ua.id as aplicado_por_id, ua.nombre_completo as aplicado_por, c.aplicado_at
        from conteo c
        join sucursal s on s.id = c.sucursal_id
        left join categoria k on k.id = c.categoria_id
        join usuario ui on ui.id = c.iniciado_por
        left join usuario ue on ue.id = c.enviado_por
        left join usuario ua on ua.id = c.aplicado_por
        ${donde(sql`fn_puede_operar_sucursal(${usuarioId}, c.sucursal_id)`, ...condiciones)}
       order by c.id desc
       limit ${limite}`.execute(this.bd.db);
    return rows;
  }
}
