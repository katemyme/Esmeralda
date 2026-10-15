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
import { TipoCambioService, type CambioTipoCambio, type TipoCambio } from './tipo-cambio.service';

/**
 * /api/tipo-cambio — córdobas por dólar para cobrar en dólares. Hay uno vigente, fijo hasta que el
 * administrador lo cambia (no se registra cada día). El vigente lo consulta cualquier usuario; el
 * historial y el cambio, quien tiene TIPO_CAMBIO_GESTIONAR (solo el administrador).
 */
@Controller('tipo-cambio')
export class TipoCambioController {
  constructor(private readonly tipoCambio: TipoCambioService) {}

  /** El vigente (`tipo_cambio: null` solo si no hay ninguno: los datos iniciales traen 36.5). */
  @Get()
  async vigente(): Promise<{ tipo_cambio: TipoCambio | null }> {
    return { tipo_cambio: await this.tipoCambio.vigente() };
  }

  /**
   * Los cambios, del más reciente al más antiguo: cada uno con el valor nuevo, el `anterior`, quién
   * y cuándo. `?desde=&hasta=` (el día del cambio, en Managua) y `?limite=`.
   */
  @Get('historial')
  @RequierePermiso('TIPO_CAMBIO_GESTIONAR')
  async historial(
    @Query(new ValidacionZod(esquemaHistorialTipoCambio)) filtro: FiltroHistorialTipoCambio,
  ): Promise<{ historial: CambioTipoCambio[] }> {
    return { historial: await this.tipoCambio.historial(filtro) };
  }

  /**
   * `{ usd_a_nio, confirmar }`: cambia el vigente; rige desde ya para las ventas siguientes. Si se
   * aleja del vigente más de lo permitido → 409 CONFIRMACION_REQUERIDA, salvo que venga
   * `confirmar: true`. Si no hubiera ninguno, el primero debe estar entre 20 y 60 (422).
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
