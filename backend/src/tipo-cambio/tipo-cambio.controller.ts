import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { UsuarioActual } from '../autenticacion/decoradores';
import { RequierePermiso } from '../autenticacion/permisos';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import {
  esquemaHistorialTipoCambio,
  esquemaTipoCambio,
  type DatosTipoCambio,
  type FiltroHistorialTipoCambio,
} from './esquemas';
import { TipoCambioService, type TipoCambio, type TipoCambioDelDia } from './tipo-cambio.service';

/**
 * /api/tipo-cambio — córdobas por dólar para cobrar en dólares. El vigente lo consulta cualquier
 * usuario; el historial, quien lo registra (TIPO_CAMBIO_GESTIONAR).
 */
@Controller('tipo-cambio')
export class TipoCambioController {
  constructor(private readonly tipoCambio: TipoCambioService) {}

  /** El vigente (`tipo_cambio: null` si nunca se ha registrado: no se puede cobrar en dólares). */
  @Get()
  async vigente(): Promise<{ tipo_cambio: TipoCambio | null }> {
    return { tipo_cambio: await this.tipoCambio.vigente() };
  }

  /**
   * Los registrados, un día por fila (del más reciente al más antiguo), con quién dejó cada valor
   * y, en `registros`, todo lo que se registró ese día: `?desde=&hasta=&limite=`.
   */
  @Get('historial')
  @RequierePermiso('TIPO_CAMBIO_GESTIONAR')
  async historial(
    @Query(new ValidacionZod(esquemaHistorialTipoCambio)) filtro: FiltroHistorialTipoCambio,
  ): Promise<{ historial: TipoCambioDelDia[] }> {
    return { historial: await this.tipoCambio.historial(filtro) };
  }

  /**
   * `{ usd_a_nio, confirmar }`: registra o corrige el de hoy. Los días anteriores no se editan.
   * Si se aleja del último más de lo permitido → 409 CONFIRMACION_REQUERIDA, salvo que venga
   * `confirmar: true`. El primero que se registra debe estar entre 20 y 60 (422).
   */
  @Put()
  @RequierePermiso('TIPO_CAMBIO_GESTIONAR')
  async registrar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body(new ValidacionZod(esquemaTipoCambio)) datos: DatosTipoCambio,
  ): Promise<{ tipo_cambio: TipoCambio | null }> {
    return { tipo_cambio: await this.tipoCambio.registrar(usuario.id, datos) };
  }
}
