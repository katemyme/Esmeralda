import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { UsuarioActual } from '../autenticacion/decoradores';
import { RequierePermiso } from '../autenticacion/permisos';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { idEntero } from '../comun/esquemas';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import { AlertasService, type AlertaAdmin } from './alertas.service';
import { esquemaFiltroAlertas, type FiltroAlertas } from './esquemas';

/** /api/alertas — panel de administración: avisos que la base genera para el administrador. */
@Controller('alertas')
export class AlertasController {
  constructor(private readonly alertas: AlertasService) {}

  /** `?estado=pendientes|atendidas|todas&tipo=&sucursal_id=&limite=&antes_de=` (por defecto, las pendientes). */
  @Get()
  @RequierePermiso('ALERTAS_VER')
  listar(
    @Query(new ValidacionZod(esquemaFiltroAlertas)) filtro: FiltroAlertas,
  ): Promise<{ alertas: AlertaAdmin[]; total_pendientes: number }> {
    return this.alertas.listar(filtro);
  }

  @Post(':id/atender')
  @RequierePermiso('ALERTAS_VER')
  @HttpCode(HttpStatus.OK)
  async atender(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
  ): Promise<{ alerta: AlertaAdmin }> {
    return { alerta: await this.alertas.atender(admin.id, id) };
  }
}
