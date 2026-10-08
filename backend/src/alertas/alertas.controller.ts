import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { UsuarioActual } from '../autenticacion/decoradores';
import { RequierePermiso } from '../autenticacion/permisos';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { idEntero } from '../comun/esquemas';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import { AlertasService, type AlertaAdmin, type ListaAlertas } from './alertas.service';
import { esquemaFiltroAlertas, type FiltroAlertas } from './esquemas';

/**
 * /api/alertas — avisos que genera la base: los del panel de administración y los que son para
 * quienes trabajan en una sucursal.
 */
@Controller('alertas')
export class AlertasController {
  constructor(private readonly alertas: AlertasService) {}

  /** `?estado=pendientes|atendidas|todas&tipo=&sucursal_id=&limite=&antes_de=` (por defecto, las pendientes). */
  @Get()
  @RequierePermiso('ALERTAS_VER')
  listar(
    @Query(new ValidacionZod(esquemaFiltroAlertas)) filtro: FiltroAlertas,
  ): Promise<ListaAlertas> {
    return this.alertas.listar(filtro);
  }

  /** Los avisos de las sucursales de quien pregunta (no pide permiso). Mismos filtros que el panel. */
  @Get('sucursal')
  listarDeSucursal(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaFiltroAlertas)) filtro: FiltroAlertas,
  ): Promise<ListaAlertas> {
    return this.alertas.listarDeSucursal(usuario.id, filtro);
  }

  /** Sin @RequierePermiso: la base decide (ALERTAS_VER, o trabajar en la sucursal si la alerta es para ella). */
  @Post(':id/atender')
  @HttpCode(HttpStatus.OK)
  async atender(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
  ): Promise<{ alerta: AlertaAdmin }> {
    return { alerta: await this.alertas.atender(usuario.id, id) };
  }
}
