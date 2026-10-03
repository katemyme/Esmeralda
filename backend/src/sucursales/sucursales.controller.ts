import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { UsuarioActual } from '../autenticacion/decoradores';
import { RequierePermiso } from '../autenticacion/permisos';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { esquemaActiva, idEntero, type DatosActiva } from '../comun/esquemas';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import { esquemaCaja, esquemaSucursal, type DatosCaja, type DatosSucursal } from './esquemas';
import { SucursalesService, type SucursalConCajas } from './sucursales.service';

/**
 * /api/sucursales — ubicaciones (sucursales de venta y la bodega central) con sus cajas. Cualquier
 * usuario ve las suyas; crearlas y editarlas pide SUCURSALES_GESTIONAR.
 */
@Controller('sucursales')
export class SucursalesController {
  constructor(private readonly sucursales: SucursalesService) {}

  @Get()
  async listar(
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<{ sucursales: SucursalConCajas[] }> {
    return { sucursales: await this.sucursales.listar(usuario.id) };
  }

  /** Las sucursales nuevas son siempre de venta: la bodega central es única. */
  @Post()
  @RequierePermiso('SUCURSALES_GESTIONAR')
  @HttpCode(HttpStatus.CREATED)
  async crear(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Body(new ValidacionZod(esquemaSucursal)) datos: DatosSucursal,
  ): Promise<{ sucursal: SucursalConCajas }> {
    return { sucursal: await this.sucursales.guardar(admin.id, null, datos) };
  }

  @Put(':id')
  @RequierePermiso('SUCURSALES_GESTIONAR')
  async actualizar(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaSucursal)) datos: DatosSucursal,
  ): Promise<{ sucursal: SucursalConCajas }> {
    return { sucursal: await this.sucursales.guardar(admin.id, id, datos) };
  }

  /** No se desactiva con existencias, un turno de caja abierto o envíos en tránsito. */
  @Put(':id/activa')
  @RequierePermiso('SUCURSALES_GESTIONAR')
  async cambiarActiva(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaActiva)) datos: DatosActiva,
  ): Promise<{ sucursal: SucursalConCajas }> {
    return { sucursal: await this.sucursales.cambiarActiva(admin.id, id, datos.activa) };
  }

  @Post(':id/cajas')
  @RequierePermiso('SUCURSALES_GESTIONAR')
  @HttpCode(HttpStatus.CREATED)
  async crearCaja(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaCaja)) datos: DatosCaja,
  ): Promise<{ sucursal: SucursalConCajas }> {
    return { sucursal: await this.sucursales.crearCaja(admin.id, id, datos) };
  }
}

/** /api/cajas — cambios sobre una caja; responden con su sucursal completa. */
@Controller('cajas')
export class CajasController {
  constructor(private readonly sucursales: SucursalesService) {}

  @Put(':id')
  @RequierePermiso('SUCURSALES_GESTIONAR')
  async renombrar(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaCaja)) datos: DatosCaja,
  ): Promise<{ sucursal: SucursalConCajas }> {
    return { sucursal: await this.sucursales.renombrarCaja(admin.id, id, datos) };
  }

  /** No se desactiva con un turno abierto. */
  @Put(':id/activa')
  @RequierePermiso('SUCURSALES_GESTIONAR')
  async cambiarActiva(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaActiva)) datos: DatosActiva,
  ): Promise<{ sucursal: SucursalConCajas }> {
    return { sucursal: await this.sucursales.cambiarCajaActiva(admin.id, id, datos.activa) };
  }
}
