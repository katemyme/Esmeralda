import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { errorEquipoRequerido } from '../autenticacion/permisos';
import { sha256 } from '../autenticacion/seguridad';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { NoEncontrado } from '../comun/no-encontrado';
import { armarTicket, type FormatoTicket, type TicketListo } from '../exportacion/ticket-formato';
import { renglonesTicketVenta } from '../ventas/ticket-venta';
import { abreGaveta, VentasService } from '../ventas/ventas.service';

/** Un ticket que espera en la cola. Sin montos: solo lo que hace falta para reconocerlo. */
export interface TicketEnCola {
  id: number;
  venta_id: number;
  /** Número de factura. */
  numero: string;
  fecha: Date;
  vendedor: string;
  /** Otro equipo de la sucursal lo pidió hace menos de un minuto: lo está imprimiendo. */
  en_curso: boolean;
}

export interface ColaDeEquipo {
  /** false: este navegador no es un equipo registrado, o el equipo está cerrado. No hay cola que atender. */
  atendida: boolean;
  /** Parámetro IMPRESION_AUTOMATICA_COLA: el equipo imprime los tickets sin que nadie los toque. */
  automatica: boolean;
  tickets: TicketEnCola[];
}

/**
 * La cola de impresión: los tickets de las ventas hechas desde un celular, que salen en el equipo
 * registrado de la sucursal. La atiende el equipo, no una persona (sigue con la pantalla
 * bloqueada), así que se identifica con la cookie del equipo y no pide sesión. Las reglas —qué
 * tickets ve cada equipo, que esté abierto, que el reintento no sea una copia— son de la base
 * (fn_cola_impresion, fn_cola_tomar, fn_cola_impreso, fn_cola_no_imprimir).
 */
@Injectable()
export class ColaImpresionService {
  constructor(
    private readonly bd: BaseDatosService,
    private readonly ventas: VentasService,
  ) {}

  /** Lo que espera en la cola de este equipo. Con el equipo cerrado, o sin equipo, nada. */
  async ver(tokenEquipo: string | undefined): Promise<ColaDeEquipo> {
    const equipo = await this.equipoDe(tokenEquipo);
    if (!equipo) return { atendida: false, automatica: false, tickets: [] };
    const { db } = this.bd;
    const [estado, tickets] = await Promise.all([
      sql<{ abierto: boolean; automatica: boolean }>`
        select fn_equipo_abierto(${equipo}::uuid) as abierto,
               fn_cola_automatica() as automatica`.execute(db),
      sql<TicketEnCola>`
        select cola_id as id, venta_id, numero, fecha, vendedor, en_curso
          from fn_cola_impresion(${equipo}::uuid)`.execute(db),
    ]);
    const { abierto, automatica } = estado.rows[0];
    return { atendida: abierto, automatica: abierto && automatica, tickets: tickets.rows };
  }

  /**
   * El ticket de la cola, para imprimirlo en este equipo. Es el original: la impresión se anota la
   * primera vez que se pide, y pedirlo otra vez (falló la impresora, se recargó la pantalla)
   * devuelve el mismo, nunca una copia.
   */
  async ticket(
    tokenEquipo: string | undefined,
    id: number,
    formato: FormatoTicket,
  ): Promise<TicketListo & { numero: string }> {
    const equipo = await this.exigirEquipo(tokenEquipo);
    const ventaId = await this.ventaDe(id);
    return this.bd.transaccion(null, async (trx) => {
      const { rows } = await sql<{ impresion: number }>`
        select fn_cola_tomar(${equipo}::uuid, ${id}) as impresion`.execute(trx);
      const impresion = rows[0].impresion;
      const venta = await this.ventas.paraLaCola(ventaId);
      // Dentro de la transacción: si el ticket no se pudiera armar, la impresión no queda anotada
      const ticket = await armarTicket(
        renglonesTicketVenta(venta, impresion),
        impresion,
        `Ticket ${venta.numero}`,
        formato,
      );
      return {
        ...ticket,
        numero: venta.numero,
        abrirGaveta: await abreGaveta(trx, ventaId, impresion),
      };
    });
  }

  /** El equipo avisa de que el ticket ya salió por la impresora: deja de esperar en la cola. */
  async impreso(tokenEquipo: string | undefined, id: number): Promise<void> {
    const equipo = await this.exigirEquipo(tokenEquipo);
    await this.ventaDe(id);
    await this.bd.transaccion(null, (trx) =>
      sql`select fn_cola_impreso(${equipo}::uuid, ${id})`.execute(trx),
    );
  }

  /** «No imprimir»: sale de la cola sin imprimirse y queda quién lo decidió. */
  async noImprimir(usuario: UsuarioAutenticado, id: number): Promise<void> {
    await this.ventaDe(id);
    await this.bd.transaccion(usuario.id, (trx) =>
      sql`select fn_cola_no_imprimir(${usuario.id}, ${usuario.equipo?.id ?? null}::uuid,
                                     ${id})`.execute(trx),
    );
  }

  /**
   * El equipo registrado y activo de la cookie. Solo lee: la cola pregunta cada pocos segundos y
   * no debe contar como uso del equipo (fn_dispositivo_por_token anota `ultimo_uso`).
   */
  private async equipoDe(tokenEquipo: string | undefined): Promise<string | null> {
    if (!tokenEquipo) return null;
    const equipo = await this.bd.db
      .selectFrom('dispositivo')
      .select('id')
      .where('token_hash', '=', sha256(tokenEquipo))
      .where('activo', '=', true)
      .executeTakeFirst();
    return equipo?.id ?? null;
  }

  private async exigirEquipo(tokenEquipo: string | undefined): Promise<string> {
    const equipo = await this.equipoDe(tokenEquipo);
    if (!equipo) throw errorEquipoRequerido();
    return equipo;
  }

  /** La venta de un ticket de la cola; uno que no existe responde 404. */
  private async ventaDe(id: number): Promise<number> {
    const ticket = await this.bd.db
      .selectFrom('ticket_cola')
      .select('venta_id')
      .where('id', '=', id)
      .executeTakeFirst();
    if (!ticket) throw new NoEncontrado(`El ticket ${id} no está en la cola de impresión`);
    return ticket.venta_id;
  }
}
