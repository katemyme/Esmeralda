import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import {
  AutenticacionService,
  SesionNoValida,
  type ContextoSolicitud,
  type PantallaPin,
  type RespuestaSesion,
  type SesionAbierta,
} from './autenticacion.service';
import { CookiesAutenticacion } from './cookies';
import { PermitidaConPasswordTemporal, Publica, UsuarioActual } from './decoradores';
import {
  esquemaCambioPassword,
  esquemaCrearPin,
  esquemaEntrarConPin,
  esquemaLogin,
  type DatosCambioPassword,
  type DatosCrearPin,
  type DatosEntrarConPin,
  type DatosLogin,
} from './esquemas';
import type { UsuarioAutenticado } from './usuario-autenticado';

function contexto(solicitud: Request): ContextoSolicitud {
  return { ip: solicitud.ip ?? null, userAgent: solicitud.get('user-agent') ?? null };
}

/**
 * /api/auth — el token de acceso (15 min) va en el cuerpo de la respuesta y el frontend lo guarda
 * en memoria; el de renovación va en la cookie httpOnly esmeralda_sesion.
 */
@Controller('auth')
export class AutenticacionController {
  constructor(
    private readonly auth: AutenticacionService,
    private readonly cookies: CookiesAutenticacion,
  ) {}

  @Post('login')
  @Publica()
  @UseGuards(ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ValidacionZod(esquemaLogin)) datos: DatosLogin,
    @Req() solicitud: Request,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<RespuestaSesion> {
    const tokenEquipo = this.cookies.leerEquipo(solicitud);
    const sesion = await this.auth.iniciarSesion(datos, contexto(solicitud), tokenEquipo);
    // Cada ingreso desde el equipo renueva su cookie (los navegadores la guardan hasta 400 días)
    if (tokenEquipo && sesion.respuesta.equipo) this.cookies.ponerEquipo(respuesta, tokenEquipo);
    return this.entregar(sesion, respuesta);
  }

  @Post('refresh')
  @Publica()
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() solicitud: Request,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<RespuestaSesion> {
    try {
      const sesion = await this.auth.renovarSesion(
        this.cookies.leerSesion(solicitud),
        contexto(solicitud),
      );
      return this.entregar(sesion, respuesta);
    } catch (error) {
      if (error instanceof SesionNoValida) this.cookies.borrarSesion(respuesta);
      throw error;
    }
  }

  @Post('logout')
  @Publica()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() solicitud: Request,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<void> {
    const token = this.cookies.leerSesion(solicitud);
    if (token) await this.auth.cerrarSesion(token);
    this.cookies.borrarSesion(respuesta);
  }

  @Get('yo')
  @PermitidaConPasswordTemporal()
  yo(@UsuarioActual() usuario: UsuarioAutenticado) {
    return this.auth.datosSesion(usuario.id, usuario.equipo?.id ?? null);
  }

  @Post('cambiar-password')
  @PermitidaConPasswordTemporal()
  @UseGuards(ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  async cambiarPassword(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body(new ValidacionZod(esquemaCambioPassword)) datos: DatosCambioPassword,
    @Req() solicitud: Request,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<RespuestaSesion> {
    const sesion = await this.auth.cambiarPassword(usuario, datos, contexto(solicitud));
    return this.entregar(sesion, respuesta);
  }

  /**
   * La pantalla de bloqueo de este equipo: si está abierto y quiénes pueden entrar con su PIN.
   * Solo responde con nombres al navegador que tiene la cookie de un equipo registrado y abierto.
   */
  @Get('pin/usuarios')
  @Publica()
  pantallaPin(@Req() solicitud: Request): Promise<PantallaPin> {
    return this.auth.pantallaPin(this.cookies.leerEquipo(solicitud));
  }

  /**
   * `{ usuario_id, pin }`: cambio rápido en un equipo registrado que ya abrió alguien con su
   * contraseña. Sin el límite por IP del login (en una sucursal todas las tablets salen por la
   * misma IP y se desbloquean muchas veces): el freno es el bloqueo del PIN a los 5 intentos.
   */
  @Post('pin')
  @Publica()
  @HttpCode(HttpStatus.OK)
  async entrarConPin(
    @Body(new ValidacionZod(esquemaEntrarConPin)) datos: DatosEntrarConPin,
    @Req() solicitud: Request,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<RespuestaSesion> {
    const tokenEquipo = this.cookies.leerEquipo(solicitud);
    const sesion = await this.auth.entrarConPin(datos, contexto(solicitud), tokenEquipo);
    if (tokenEquipo) this.cookies.ponerEquipo(respuesta, tokenEquipo);
    return this.entregar(sesion, respuesta);
  }

  /** `{ password_actual, pin }`: crea o cambia el PIN propio (4 dígitos). Un PIN nuevo quita el bloqueo. */
  @Put('pin')
  @UseGuards(ThrottlerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async guardarPin(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body(new ValidacionZod(esquemaCrearPin)) datos: DatosCrearPin,
  ): Promise<void> {
    await this.auth.guardarPin(usuario, datos);
  }

  private entregar(sesion: SesionAbierta, respuesta: Response): RespuestaSesion {
    this.cookies.ponerSesion(respuesta, sesion.tokenRenovacion, sesion.vence);
    return sesion.respuesta;
  }
}
