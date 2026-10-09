import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CookiesAutenticacion } from '../autenticacion/cookies';
import { Publica, UsuarioActual } from '../autenticacion/decoradores';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { idEntero } from '../comun/esquemas';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import {
  entregarTicket,
  esquemaFormatoTicket,
  type FormatoTicket,
  type TicketEnRenglones,
} from '../exportacion/ticket-formato';
import { ColaImpresionService, type ColaDeEquipo } from './cola-impresion.service';

/**
 * /api/cola-impresion — «Tickets por imprimir»: los tickets de las ventas hechas desde un celular,
 * que salen en el equipo registrado de su sucursal.
 *
 * Ver la cola, pedir un ticket y avisar de que salió no piden sesión: dependen de la cookie del
 * equipo, que además tiene que estar abierto (alguien entró hoy en él con su contraseña). Así la
 * cola sigue imprimiendo con la pantalla bloqueada. «No imprimir» sí pide sesión: queda quién.
 */
@Controller('cola-impresion')
export class ColaImpresionController {
  constructor(
    private readonly cola: ColaImpresionService,
    private readonly cookies: CookiesAutenticacion,
  ) {}

  /**
   * Lo que espera en la cola de este equipo (una PC de caja, los de su caja; la tablet o el
   * celular del negocio, los de su sucursal) y si debe imprimirlo solo. Fuera de un equipo
   * registrado y abierto responde `atendida: false`, sin tickets.
   */
  @Get()
  @Publica()
  ver(@Req() solicitud: Request): Promise<ColaDeEquipo> {
    return this.cola.ver(this.cookies.leerEquipo(solicitud));
  }

  /**
   * El ticket para imprimirlo aquí: en PDF o, con `?formato=renglones`, para la impresora por USB.
   * Es el original, y reintentar devuelve el mismo (la cabecera `X-Ticket-Impresion` no cambia).
   */
  @Post(':id/ticket')
  @Publica()
  @HttpCode(HttpStatus.OK)
  async ticket(
    @Req() solicitud: Request,
    @Param('id', idEntero()) id: number,
    @Query(new ValidacionZod(esquemaFormatoTicket)) consulta: { formato: FormatoTicket },
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile | TicketEnRenglones> {
    const ticket = await this.cola.ticket(this.cookies.leerEquipo(solicitud), id, consulta.formato);
    return entregarTicket(respuesta, ticket, `ticket-${ticket.numero}`);
  }

  /** El ticket ya salió por la impresora: deja de esperar. Avisarlo dos veces no hace daño. */
  @Post(':id/impreso')
  @Publica()
  @HttpCode(HttpStatus.NO_CONTENT)
  async impreso(@Req() solicitud: Request, @Param('id', idEntero()) id: number): Promise<void> {
    await this.cola.impreso(this.cookies.leerEquipo(solicitud), id);
  }

  /**
   * «No imprimir»: el ticket sale de la cola sin imprimirse. Lo decide quien hizo la venta (desde
   * su celular, si el cliente no quiere papel) o quien vende en un equipo de esa sucursal; lo
   * valida la base (fn_cola_no_imprimir) y queda quién fue.
   */
  @Post(':id/no-imprimir')
  @HttpCode(HttpStatus.NO_CONTENT)
  async noImprimir(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
  ): Promise<void> {
    await this.cola.noImprimir(usuario, id);
  }
}
