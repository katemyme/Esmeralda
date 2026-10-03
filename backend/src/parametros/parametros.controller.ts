import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { UsuarioActual } from '../autenticacion/decoradores';
import { RequierePermiso } from '../autenticacion/permisos';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import { claveParametro, esquemaValorParametro, type DatosValorParametro } from './esquemas';
import { ParametrosService, type ParametroAdmin } from './parametros.service';

/** /api/parametros — panel de administración: parámetros generales (topes, tolerancias, sesiones). */
@Controller('parametros')
export class ParametrosController {
  constructor(private readonly parametros: ParametrosService) {}

  @Get()
  @RequierePermiso('PARAMETROS_GESTIONAR')
  async listar(): Promise<{ parametros: ParametroAdmin[] }> {
    return { parametros: await this.parametros.listar() };
  }

  @Put(':clave')
  @RequierePermiso('PARAMETROS_GESTIONAR')
  async cambiar(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('clave', claveParametro()) clave: string,
    @Body(new ValidacionZod(esquemaValorParametro)) datos: DatosValorParametro,
  ): Promise<{ parametro: ParametroAdmin }> {
    return { parametro: await this.parametros.cambiar(admin.id, clave, datos.valor) };
  }
}
