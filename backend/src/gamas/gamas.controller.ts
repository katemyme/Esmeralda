import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { UsuarioActual } from '../autenticacion/decoradores';
import { RequierePermiso } from '../autenticacion/permisos';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { esquemaActiva, idEntero, type DatosActiva } from '../comun/esquemas';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import { esquemaGama, type DatosGama } from './esquemas';
import { GamasService, type GamaCatalogo } from './gamas.service';

/** /api/gamas — catálogo: gamas de pieza (acero clásica, acero de lujo, titanio...). */
@Controller('gamas')
export class GamasController {
  constructor(private readonly gamas: GamasService) {}

  @Get()
  @RequierePermiso('PRODUCTOS_VER')
  async listar(): Promise<{ gamas: GamaCatalogo[] }> {
    return { gamas: await this.gamas.listar() };
  }

  @Post()
  @RequierePermiso('PRODUCTOS_GESTIONAR')
  @HttpCode(HttpStatus.CREATED)
  async crear(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Body(new ValidacionZod(esquemaGama)) datos: DatosGama,
  ): Promise<{ gama: GamaCatalogo }> {
    return { gama: await this.gamas.guardar(admin.id, null, datos) };
  }

  @Put(':id')
  @RequierePermiso('PRODUCTOS_GESTIONAR')
  async actualizar(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaGama)) datos: DatosGama,
  ): Promise<{ gama: GamaCatalogo }> {
    return { gama: await this.gamas.guardar(admin.id, id, datos) };
  }

  /** Una gama inactiva sale de la tabla de precios y no admite piezas nuevas. */
  @Put(':id/activa')
  @RequierePermiso('PRODUCTOS_GESTIONAR')
  async cambiarActiva(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaActiva)) datos: DatosActiva,
  ): Promise<{ gama: GamaCatalogo }> {
    return { gama: await this.gamas.cambiarActiva(admin.id, id, datos.activa) };
  }
}
