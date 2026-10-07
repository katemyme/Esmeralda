import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseDatosService } from '../base-datos/base-datos.service';

/** El tipo de cambio vigente: el último registrado hasta hoy (día de Managua). */
export interface TipoCambio {
  /** Día en que se registró (AAAA-MM-DD). */
  fecha: string;
  /** Córdobas por dólar. */
  usd_a_nio: string;
  /** false: hoy no se ha registrado y sigue valiendo el de un día anterior. */
  es_de_hoy: boolean;
  registrado_por: { id: number; nombre_completo: string } | null;
}

/**
 * Tipo de cambio del dólar. Lo registra quien tiene TIPO_CAMBIO_GESTIONAR con fn_set_tipo_cambio:
 * solo el de hoy, que se puede corregir durante el día (cada venta guarda el tipo de cambio con
 * que se cobró, así que el cambio vale para las ventas siguientes).
 */
@Injectable()
export class TipoCambioService {
  constructor(private readonly bd: BaseDatosService) {}

  /** null si todavía no se ha registrado ninguno. */
  async vigente(): Promise<TipoCambio | null> {
    const { rows } = await sql<{
      fecha: string;
      usd_a_nio: string;
      es_de_hoy: boolean;
      usuario_id: number | null;
      usuario: string | null;
    }>`
      select tc.fecha, tc.usd_a_nio,
             tc.fecha = (now() at time zone 'America/Managua')::date as es_de_hoy,
             u.id as usuario_id, u.nombre_completo as usuario
        from tipo_cambio tc
        left join usuario u on u.id = tc.usuario_id
       where tc.fecha <= (now() at time zone 'America/Managua')::date
       order by tc.fecha desc
       limit 1`.execute(this.bd.db);
    const fila = rows[0];
    if (!fila) return null;
    return {
      fecha: fila.fecha,
      usd_a_nio: fila.usd_a_nio,
      es_de_hoy: fila.es_de_hoy,
      registrado_por:
        fila.usuario_id !== null && fila.usuario !== null
          ? { id: fila.usuario_id, nombre_completo: fila.usuario }
          : null,
    };
  }

  async registrar(usuarioId: number, usdANio: string): Promise<TipoCambio | null> {
    await this.bd.transaccion(usuarioId, (trx) =>
      sql`select fn_set_tipo_cambio(${usuarioId}, ${usdANio}::numeric)`.execute(trx),
    );
    return this.vigente();
  }
}
