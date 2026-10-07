import { Body, Controller, Get, Put } from '@nestjs/common';
import { UsuarioActual } from '../autenticacion/decoradores';
import { RequierePermiso } from '../autenticacion/permisos';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import { esquemaTipoCambio, type DatosTipoCambio } from './esquemas';
import { TipoCambioService, type TipoCambio } from './tipo-cambio.service';

/** /api/tipo-cambio — córdobas por dólar para cobrar en dólares. Cualquier usuario lo consulta. */
@Controller('tipo-cambio')
export class TipoCambioController {
  constructor(private readonly tipoCambio: TipoCambioService) {}

  /** El vigente (`tipo_cambio: null` si nunca se ha registrado: no se puede cobrar en dólares). */
  @Get()
  async vigente(): Promise<{ tipo_cambio: TipoCambio | null }> {
    return { tipo_cambio: await this.tipoCambio.vigente() };
  }

  /** `{ usd_a_nio }`: registra o corrige el de hoy. Los días anteriores no se editan. */
  @Put()
  @RequierePermiso('TIPO_CAMBIO_GESTIONAR')
  async registrar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body(new ValidacionZod(esquemaTipoCambio)) datos: DatosTipoCambio,
  ): Promise<{ tipo_cambio: TipoCambio | null }> {
    return { tipo_cambio: await this.tipoCambio.registrar(usuario.id, datos.usd_a_nio) };
  }
}
