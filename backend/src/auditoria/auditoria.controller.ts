import { Controller, Get, Query } from '@nestjs/common';
import { RequierePermiso } from '../autenticacion/permisos';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import { AuditoriaService, type AccesoRegistrado, type CambioAuditado } from './auditoria.service';
import {
  esquemaFiltroAccesos,
  esquemaFiltroCambios,
  type FiltroAccesos,
  type FiltroCambios,
} from './esquemas';

/** /api/auditoria — bitácora: quién cambió qué y quién entró (o intentó entrar) al sistema. */
@Controller('auditoria')
export class AuditoriaController {
  constructor(private readonly auditoria: AuditoriaService) {}

  /** `?tabla=&registro_id=&usuario_id=&accion=&desde=&hasta=&limite=&antes_de=` */
  @Get('cambios')
  @RequierePermiso('AUDITORIA_VER')
  async cambios(
    @Query(new ValidacionZod(esquemaFiltroCambios)) filtro: FiltroCambios,
  ): Promise<{ cambios: CambioAuditado[] }> {
    return { cambios: await this.auditoria.cambios(filtro) };
  }

  /** `?usuario_id=&username=&exito=true|false&desde=&hasta=&limite=&antes_de=` */
  @Get('accesos')
  @RequierePermiso('AUDITORIA_VER')
  async accesos(
    @Query(new ValidacionZod(esquemaFiltroAccesos)) filtro: FiltroAccesos,
  ): Promise<{ accesos: AccesoRegistrado[] }> {
    return { accesos: await this.auditoria.accesos(filtro) };
  }
}
