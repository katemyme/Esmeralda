import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { UsuarioActual } from '../autenticacion/decoradores';
import { RequierePermiso, SoloEnEquipo } from '../autenticacion/permisos';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { idEntero } from '../comun/esquemas';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import {
  entregarTicket,
  esquemaFormatoTicket,
  type FormatoTicket,
  type TicketEnRenglones,
} from '../exportacion/ticket-formato';
import {
  CajaService,
  type CajaAbierta,
  type Denominacion,
  type MetodoPago,
  type MovimientoCaja,
  type TicketCierre,
  type TurnoActual,
  type TurnoDetalle,
  type TurnoResumen,
} from './caja.service';
import {
  esquemaAbrirTurno,
  esquemaCajaElegida,
  esquemaCerrarTurno,
  esquemaCierreForzado,
  esquemaFiltroTurnos,
  esquemaMovimientoCaja,
  type CajaElegida,
  type DatosAbrirTurno,
  type DatosCerrarTurno,
  type DatosCierreForzado,
  type DatosMovimientoCaja,
  type FiltroTurnos,
} from './esquemas';

/**
 * /api/caja — el turno de la caja de la sesión. La caja no viene en la solicitud: sale del equipo
 * registrado donde se inició la sesión (solo el administrador, sin caja en su equipo, envía
 * `caja_id`). Ninguna de estas rutas entrega montos esperados ni diferencias. Todo lo de la caja
 * pide un equipo registrado; desde el celular solo se consulta dónde se puede vender
 * (GET /api/caja/abiertas).
 */
@Controller('caja')
export class CajaController {
  constructor(private readonly caja: CajaService) {}

  /** El turno abierto (`turno: null` si la caja está cerrada). Sin montos. */
  @Get('turno')
  @RequierePermiso('CAJA_ABRIR', 'CAJA_CERRAR', 'VENTAS_REGISTRAR')
  @SoloEnEquipo()
  async turno(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaCajaElegida)) consulta: CajaElegida,
  ): Promise<{ turno: TurnoActual | null }> {
    return { turno: await this.caja.turnoActual(usuario, consulta.caja_id) };
  }

  /**
   * Las cajas con turno abierto de las sucursales de quien pregunta: dónde puede entrar una venta
   * hecha desde el celular (vacío: no hay turno abierto). Sin montos.
   */
  @Get('abiertas')
  @RequierePermiso('VENTAS_REGISTRAR')
  async abiertas(@UsuarioActual() usuario: UsuarioAutenticado): Promise<{ cajas: CajaAbierta[] }> {
    return { cajas: await this.caja.cajasAbiertas(usuario.id) };
  }

  /** `{ inicial_nio, inicial_usd }`: el efectivo contado al abrir, sin ver el fondo esperado. */
  @Post('turno/abrir')
  @RequierePermiso('CAJA_ABRIR')
  @HttpCode(HttpStatus.CREATED)
  async abrir(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body(new ValidacionZod(esquemaAbrirTurno)) datos: DatosAbrirTurno,
  ): Promise<{ turno: TurnoActual }> {
    return { turno: await this.caja.abrir(usuario, datos) };
  }

  @Get('turno/movimientos')
  @RequierePermiso('CAJA_MOVIMIENTOS')
  async movimientos(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaCajaElegida)) consulta: CajaElegida,
  ): Promise<{ movimientos: MovimientoCaja[] }> {
    return { movimientos: await this.caja.movimientos(usuario, consulta.caja_id) };
  }

  /** `{ tipo, moneda, monto, motivo }`: ingreso o egreso de efectivo del turno abierto. */
  @Post('turno/movimientos')
  @RequierePermiso('CAJA_MOVIMIENTOS')
  @HttpCode(HttpStatus.CREATED)
  async registrarMovimiento(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body(new ValidacionZod(esquemaMovimientoCaja)) datos: DatosMovimientoCaja,
  ): Promise<{ movimiento: MovimientoCaja }> {
    return { movimiento: await this.caja.registrarMovimiento(usuario, datos) };
  }

  /**
   * Arqueo ciego: `{ efectivo, no_efectivo, retiro_nio, retiro_usd, justificacion, observaciones }`.
   * Si no cuadra → 422 CONTEO_NO_CUADRA (sin montos) y queda un solo reconteo, que debe llevar
   * justificación. Al cerrar devuelve el ticket.
   */
  @Post('turno/cerrar')
  @RequierePermiso('CAJA_CERRAR')
  @HttpCode(HttpStatus.OK)
  async cerrar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body(new ValidacionZod(esquemaCerrarTurno)) datos: DatosCerrarTurno,
  ): Promise<{ ticket: TicketCierre }> {
    return { ticket: await this.caja.cerrar(usuario, datos) };
  }
}

/**
 * /api/turnos — historial de turnos con lo esperado, lo contado y las diferencias. Es el único
 * lugar donde salen esos montos, y pide CAJA_VER_DIFERENCIAS. Cada quien ve los de sus sucursales.
 */
@Controller('turnos')
export class TurnosController {
  constructor(private readonly caja: CajaService) {}

  /** `?sucursal_id=&estado=&desde=&hasta=&limite=&antes_de=` */
  @Get()
  @RequierePermiso('CAJA_VER_DIFERENCIAS')
  async listar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaFiltroTurnos)) filtro: FiltroTurnos,
  ): Promise<{ turnos: TurnoResumen[] }> {
    return { turnos: await this.caja.listarTurnos(usuario.id, filtro) };
  }

  @Get(':id')
  @RequierePermiso('CAJA_VER_DIFERENCIAS')
  async ver(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
  ): Promise<{ turno: TurnoDetalle }> {
    return { turno: await this.caja.verTurno(usuario.id, id) };
  }

  /** Para reimprimir el ticket de cierre. Sin CAJA_VER_DIFERENCIAS llega el reducido. */
  @Get(':id/ticket')
  @RequierePermiso('CAJA_CERRAR', 'CAJA_VER_DIFERENCIAS')
  async ticket(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
  ): Promise<{ ticket: TicketCierre }> {
    return { ticket: await this.caja.ticket(usuario.id, id) };
  }

  /**
   * El ticket de cierre para la impresora de 80 mm (reducido sin CAJA_VER_DIFERENCIAS): en PDF o,
   * con `?formato=renglones`, como renglones para imprimirlo por USB. La primera vez es el
   * original; las siguientes salen con la palabra COPIA (`X-Ticket-Impresion`).
   */
  @Post(':id/imprimir')
  @RequierePermiso('CAJA_CERRAR', 'CAJA_VER_DIFERENCIAS')
  @HttpCode(HttpStatus.OK)
  async imprimir(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Query(new ValidacionZod(esquemaFormatoTicket)) consulta: { formato: FormatoTicket },
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile | TicketEnRenglones> {
    const ticket = await this.caja.imprimirTicket(usuario.id, id, consulta.formato);
    return entregarTicket(respuesta, ticket, `cierre-turno-${id}`);
  }

  /** `{ motivo }`: cierra sin arqueo un turno que nadie cerró (se asume lo esperado). */
  @Post(':id/cierre-forzado')
  @RequierePermiso('CAJA_CIERRE_FORZADO')
  @HttpCode(HttpStatus.OK)
  async cierreForzado(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaCierreForzado)) datos: DatosCierreForzado,
  ): Promise<{ ticket: TicketCierre }> {
    return { ticket: await this.caja.cierreForzado(admin.id, id, datos.motivo) };
  }
}

/** Datos fijos para armar las pantallas de cobro y de conteo. Los ve cualquier usuario con sesión. */
@Controller()
export class DatosCajaController {
  constructor(private readonly caja: CajaService) {}

  @Get('metodos-pago')
  async metodosPago(): Promise<{ metodos_pago: MetodoPago[] }> {
    return { metodos_pago: await this.caja.metodosPago() };
  }

  @Get('denominaciones')
  async denominaciones(): Promise<{ denominaciones: Denominacion[] }> {
    return { denominaciones: await this.caja.denominaciones() };
  }
}
