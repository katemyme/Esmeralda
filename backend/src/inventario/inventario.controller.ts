import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { UsuarioActual } from '../autenticacion/decoradores';
import { RequierePermiso } from '../autenticacion/permisos';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import {
  esquemaFiltroExistencias,
  esquemaFiltroMovimientos,
  esquemaMovimiento,
  esquemaStockMinimo,
  type DatosMovimiento,
  type DatosStockMinimo,
  type FiltroExistencias,
  type FiltroMovimientos,
} from './esquemas';
import { InventarioService, type Existencia, type Movimiento } from './inventario.service';

/** /api/inventario — existencias por ubicación, kardex, movimientos manuales y stock mínimo. */
@Controller('inventario')
export class InventarioController {
  constructor(private readonly inventario: InventarioService) {}

  /**
   * `?sucursal_id=&buscar=&categoria_id=&solo_bajo_minimo=&limite=&desplazamiento=` — lo que hay en
   * una ubicación (por defecto, la del equipo desde el que se inició la sesión).
   */
  @Get('existencias')
  @RequierePermiso('INVENTARIO_VER')
  existencias(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaFiltroExistencias)) filtro: FiltroExistencias,
  ): Promise<{
    sucursal: { id: number; codigo: string; nombre: string; tipo: string };
    existencias: Existencia[];
    total: number;
  }> {
    const sucursalId = filtro.sucursal_id ?? usuario.equipo?.sucursalId;
    if (sucursalId === undefined) {
      throw new HttpException(
        {
          codigo: 'DATOS_INVALIDOS',
          mensaje: 'Indique la ubicación (sucursal_id): esta sesión no es de un equipo registrado',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.inventario.existencias(usuario.id, sucursalId, filtro);
  }

  /** `?sucursal_id=&variante_id=&tipo=&desde=&hasta=&limite=&antes_de=` — el kardex. */
  @Get('movimientos')
  @RequierePermiso('INVENTARIO_VER')
  async movimientos(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaFiltroMovimientos)) filtro: FiltroMovimientos,
  ): Promise<{ movimientos: Movimiento[] }> {
    return { movimientos: await this.inventario.movimientos(usuario.id, filtro) };
  }

  /**
   * Movimiento manual: ENTRADA directa a la bodega (INVENTARIO_ENTRADA) o ajuste / merma directa
   * (INVENTARIO_AJUSTAR). El permiso de cada tipo lo valida la base.
   */
  @Post('movimientos')
  @RequierePermiso('INVENTARIO_ENTRADA', 'INVENTARIO_AJUSTAR')
  @HttpCode(HttpStatus.CREATED)
  async registrarMovimiento(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body(new ValidacionZod(esquemaMovimiento)) datos: DatosMovimiento,
  ): Promise<{ movimiento: Movimiento }> {
    return { movimiento: await this.inventario.registrarMovimiento(usuario.id, datos) };
  }

  /** `{ sucursal_id, variante_id, stock_minimo }`: por debajo del mínimo se marca alerta de stock bajo. */
  @Put('stock-minimo')
  @RequierePermiso('INVENTARIO_AJUSTAR')
  fijarStockMinimo(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body(new ValidacionZod(esquemaStockMinimo)) datos: DatosStockMinimo,
  ): Promise<DatosStockMinimo> {
    return this.inventario.fijarStockMinimo(usuario.id, datos);
  }
}
