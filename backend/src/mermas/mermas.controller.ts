import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { UsuarioActual } from '../autenticacion/decoradores';
import { RequierePermiso } from '../autenticacion/permisos';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { idEntero } from '../comun/esquemas';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import {
  esquemaFiltroMermas,
  esquemaReportarMerma,
  esquemaResolverMerma,
  type DatosReportarMerma,
  type DatosResolverMerma,
  type FiltroMermas,
} from './esquemas';
import { MermasService, type Merma } from './mermas.service';

/** /api/mermas — piezas dañadas o perdidas: la sucursal reporta, el admin aprueba o rechaza. */
@Controller('mermas')
export class MermasController {
  constructor(private readonly mermas: MermasService) {}

  /** `?estado=&sucursal_id=&limite=&antes_de=` — las de las sucursales del usuario. */
  @Get()
  @RequierePermiso('INVENTARIO_REPORTAR_MERMA', 'INVENTARIO_AJUSTAR')
  async listar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaFiltroMermas)) filtro: FiltroMermas,
  ): Promise<{ mermas: Merma[] }> {
    return { mermas: await this.mermas.listar(usuario.id, filtro) };
  }

  /** Reportar no descuenta nada: avisa al admin, que decide. */
  @Post()
  @RequierePermiso('INVENTARIO_REPORTAR_MERMA')
  @HttpCode(HttpStatus.CREATED)
  async reportar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body(new ValidacionZod(esquemaReportarMerma)) datos: DatosReportarMerma,
  ): Promise<{ merma: Merma }> {
    return { merma: await this.mermas.reportar(usuario.id, datos) };
  }

  /** `{ aprobar, comentario }`: aprobar descuenta la pieza del inventario. */
  @Post(':id/resolver')
  @RequierePermiso('INVENTARIO_AJUSTAR')
  @HttpCode(HttpStatus.OK)
  async resolver(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaResolverMerma)) datos: DatosResolverMerma,
  ): Promise<{ merma: Merma }> {
    return { merma: await this.mermas.resolver(usuario.id, id, datos) };
  }
}
