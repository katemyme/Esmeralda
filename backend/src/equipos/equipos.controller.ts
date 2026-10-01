import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CookiesAutenticacion } from '../autenticacion/cookies';
import { Publica, UsuarioActual } from '../autenticacion/decoradores';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import type { DatosEquipo } from './datos-equipo';
import { EquiposService } from './equipos.service';
import { esquemaRegistroEquipo, type DatosRegistroEquipo } from './esquemas';

/**
 * /api/equipos — registro de equipos autorizados. El admin inicia sesión en la PC de caja o
 * la tablet nueva y la registra desde ahí: el equipo queda identificado por una cookie httpOnly.
 */
@Controller('equipos')
export class EquiposController {
  constructor(
    private readonly equipos: EquiposService,
    private readonly cookies: CookiesAutenticacion,
  ) {}

  /** Registra ESTE equipo (el navegador que hace la solicitud). */
  @Post()
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
}
