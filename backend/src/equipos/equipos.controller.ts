import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CookiesAutenticacion } from '../autenticacion/cookies';
import { Publica, UsuarioActual } from '../autenticacion/decoradores';
import { RequierePermiso, SoloEnEquipo } from '../autenticacion/permisos';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { esquemaActivo, idUuid, type DatosActivo } from '../comun/esquemas';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import type { DatosEquipo, EquipoAdmin } from './datos-equipo';
import { EquiposService } from './equipos.service';
import { esquemaRegistroEquipo, type DatosRegistroEquipo } from './esquemas';

/**
 * /api/equipos — equipos autorizados. El admin inicia sesión en la PC de caja o la tablet nueva y
 * la registra desde ahí: el equipo queda identificado por una cookie httpOnly. Desde el panel
 * puede ver todos los equipos y desactivar uno (perdido, robado o dado de baja).
 */
@Controller('equipos')
export class EquiposController {
  constructor(
    private readonly equipos: EquiposService,
    private readonly cookies: CookiesAutenticacion,
  ) {}

  @Get()
  @RequierePermiso('SUCURSALES_GESTIONAR')
  async listar(): Promise<{ equipos: EquipoAdmin[] }> {
    return { equipos: await this.equipos.listar() };
  }

  /** Registra ESTE equipo (el navegador que hace la solicitud). */
  @Post()
  @RequierePermiso('SUCURSALES_GESTIONAR')
  @HttpCode(HttpStatus.CREATED)
  async registrar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body(new ValidacionZod(esquemaRegistroEquipo)) datos: DatosRegistroEquipo,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<{ equipo: DatosEquipo }> {
    const { token, equipo } = await this.equipos.registrar(usuario.id, datos);
    this.cookies.ponerEquipo(respuesta, token);
    return { equipo };
  }

  /** Qué equipo registrado es este navegador (para la pantalla de inicio de sesión). */
  @Get('actual')
  @Publica()
  async actual(@Req() solicitud: Request): Promise<{ equipo: DatosEquipo | null }> {
    return { equipo: await this.equipos.identificar(this.cookies.leerEquipo(solicitud)) };
  }

  /**
   * Cierra ESTE equipo al final del día: deja de aceptar PIN hasta que alguien vuelva a entrar con
   * su contraseña, y se cierran todas las sesiones abiertas en él (también la de quien lo cierra).
   */
  @Post('actual/cerrar')
  @SoloEnEquipo()
  @HttpCode(HttpStatus.NO_CONTENT)
  async cerrar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<void> {
    await this.equipos.cerrar(usuario);
    this.cookies.borrarSesion(respuesta);
  }

  /** Activa o desactiva un equipo (desactivarlo cierra las sesiones abiertas desde él). */
  @Put(':id/activo')
  @RequierePermiso('SUCURSALES_GESTIONAR')
  async cambiarActivo(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idUuid()) id: string,
    @Body(new ValidacionZod(esquemaActivo)) datos: DatosActivo,
  ): Promise<{ equipo: EquipoAdmin }> {
    return { equipo: await this.equipos.cambiarActivo(usuario.id, id, datos.activo) };
  }
}
