import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { UsuarioActual } from '../autenticacion/decoradores';
import { RequierePermiso } from '../autenticacion/permisos';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { esquemaMotivo, idEntero, type DatosMotivo } from '../comun/esquemas';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import {
  ComprasService,
  type CompraDetalle,
  type CompraResumen,
  type ResultadoConfirmacion,
} from './compras.service';
import {
  esquemaActualizarCompra,
  esquemaCrearCompra,
  esquemaFiltroCompras,
  esquemaGastoCompra,
  esquemaLineaCompra,
  type DatosActualizarCompra,
  type DatosCrearCompra,
  type DatosGastoCompra,
  type DatosLineaCompra,
  type FiltroCompras,
} from './esquemas';

/**
 * /api/compras — facturas de proveedor. Se arman en borrador (líneas y gastos de importación) y al
 * confirmar entra la mercadería a la bodega central con su costo ya prorrateado.
 */
@Controller('compras')
@RequierePermiso('INVENTARIO_ENTRADA')
export class ComprasController {
  constructor(private readonly compras: ComprasService) {}

  /** `?estado=&proveedor_id=&desde=&hasta=&limite=&antes_de=` */
  @Get()
  async listar(
    @Query(new ValidacionZod(esquemaFiltroCompras)) filtro: FiltroCompras,
  ): Promise<{ compras: CompraResumen[] }> {
    return { compras: await this.compras.listar(filtro) };
  }

  /** La compra con sus líneas (en borrador, con la vista previa del costeo) y sus gastos. */
  @Get(':id')
  async ver(@Param('id', idEntero()) id: number): Promise<{ compra: CompraDetalle }> {
    return { compra: await this.compras.buscar(id) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async crear(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Body(new ValidacionZod(esquemaCrearCompra)) datos: DatosCrearCompra,
  ): Promise<{ compra: CompraDetalle }> {
    return { compra: await this.compras.crear(admin.id, datos) };
  }

  /** Corrige el encabezado de una compra en borrador. */
  @Put(':id')
  async actualizar(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaActualizarCompra)) datos: DatosActualizarCompra,
  ): Promise<{ compra: CompraDetalle }> {
    return { compra: await this.compras.actualizar(admin.id, id, datos) };
  }

  /** Agrega una línea o reemplaza la de esa pieza. */
  @Put(':id/lineas')
  async ponerLinea(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaLineaCompra)) linea: DatosLineaCompra,
  ): Promise<{ compra: CompraDetalle }> {
    return { compra: await this.compras.ponerLinea(admin.id, id, linea) };
  }

  @Delete(':id/lineas/:varianteId')
  async quitarLinea(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Param('varianteId', idEntero('varianteId')) varianteId: number,
  ): Promise<{ compra: CompraDetalle }> {
    return { compra: await this.compras.quitarLinea(admin.id, id, varianteId) };
  }

  @Post(':id/gastos')
  @HttpCode(HttpStatus.CREATED)
  async agregarGasto(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaGastoCompra)) gasto: DatosGastoCompra,
  ): Promise<{ compra: CompraDetalle }> {
    return { compra: await this.compras.agregarGasto(admin.id, id, gasto) };
  }

  @Delete(':id/gastos/:gastoId')
  async quitarGasto(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Param('gastoId', idEntero('gastoId')) gastoId: number,
  ): Promise<{ compra: CompraDetalle }> {
    return { compra: await this.compras.quitarGasto(admin.id, id, gastoId) };
  }

  /** Entra el stock a la bodega; ya no se puede modificar. */
  @Post(':id/confirmar')
  @HttpCode(HttpStatus.OK)
  confirmar(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
  ): Promise<{ compra: CompraDetalle; resultado: ResultadoConfirmacion[] }> {
    return this.compras.confirmar(admin.id, id);
  }

  @Post(':id/cancelar')
  @HttpCode(HttpStatus.OK)
  async cancelar(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaMotivo)) datos: DatosMotivo,
  ): Promise<{ compra: CompraDetalle }> {
    return { compra: await this.compras.cancelar(admin.id, id, datos.motivo) };
  }
}
