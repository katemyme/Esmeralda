import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { UsuarioActual } from '../autenticacion/decoradores';
import { RequierePermiso } from '../autenticacion/permisos';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { esquemaMotivo, idEntero, type DatosMotivo } from '../comun/esquemas';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import {
  esquemaFiltroVentas,
  esquemaRegistrarVenta,
  type DatosRegistrarVenta,
  type FiltroVentas,
} from './esquemas';
import { VentasService, type VentaDetalle, type VentaResumen } from './ventas.service';

/**
 * /api/ventas — el POS. La venta entra al turno abierto de la caja del equipo de la sesión: la
 * solicitud no lleva sucursal, caja ni turno. Subir el precio y aplicar una promoción piden sus
 * propios permisos (VENTAS_MODIFICAR_PRECIO, VENTAS_PROMOCION), que valida la base.
 */
@Controller('ventas')
export class VentasController {
  constructor(private readonly ventas: VentasService) {}

  /**
   * `?sucursal_id=&turno_id=&vendedor_id=&estado=&desde=&hasta=&buscar=&limite=&antes_de=` — con
   * VENTAS_VER_TODAS, las de sus sucursales; si no, solo las propias.
   */
  @Get()
  @RequierePermiso('VENTAS_VER_PROPIAS', 'VENTAS_VER_TODAS')
  async listar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaFiltroVentas)) filtro: FiltroVentas,
  ): Promise<{ ventas: VentaResumen[] }> {
    return { ventas: await this.ventas.listar(usuario.id, filtro) };
  }

  /** La venta completa, con lo que va en el ticket. */
  @Get(':id')
  @RequierePermiso('VENTAS_VER_PROPIAS', 'VENTAS_VER_TODAS')
  async ver(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
  ): Promise<{ venta: VentaDetalle }> {
    return { venta: await this.ventas.buscar(usuario.id, id) };
  }

  /**
   * `{ clave_idempotencia, items, pagos, promocion_id, cliente_nombre, cliente_telefono, notas }`.
   * 201 con la venta; si la clave ya se había usado (reintento), 200 con la misma venta y
   * `repetida: true`, sin crear otra.
   */
  @Post()
  @RequierePermiso('VENTAS_REGISTRAR')
  async registrar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body(new ValidacionZod(esquemaRegistrarVenta)) datos: DatosRegistrarVenta,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<{ venta: VentaDetalle; repetida: boolean }> {
    const resultado = await this.ventas.registrar(usuario, datos);
    respuesta.status(resultado.repetida ? HttpStatus.OK : HttpStatus.CREATED);
    return resultado;
  }

  /** `{ motivo }`: solo mientras el turno de la venta sigue abierto; devuelve las piezas al inventario. */
  @Post(':id/anular')
  @RequierePermiso('VENTAS_ANULAR')
  @HttpCode(HttpStatus.OK)
  async anular(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaMotivo)) datos: DatosMotivo,
  ): Promise<{ venta: VentaDetalle }> {
    return { venta: await this.ventas.anular(usuario.id, id, datos.motivo) };
  }
}
