import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { UsuarioActual } from '../autenticacion/decoradores';
import { RequierePermiso } from '../autenticacion/permisos';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { esquemaActivo, idEntero, type DatosActivo } from '../comun/esquemas';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import { esquemaProveedor, type DatosProveedor } from './esquemas';
import { ProveedoresService, type Proveedor } from './proveedores.service';

/** /api/proveedores — a quién se le compra la mercadería (solo quien registra compras). */
@Controller('proveedores')
@RequierePermiso('INVENTARIO_ENTRADA')
export class ProveedoresController {
  constructor(private readonly proveedores: ProveedoresService) {}

  @Get()
  async listar(): Promise<{ proveedores: Proveedor[] }> {
    return { proveedores: await this.proveedores.listar() };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async crear(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Body(new ValidacionZod(esquemaProveedor)) datos: DatosProveedor,
  ): Promise<{ proveedor: Proveedor }> {
    return { proveedor: await this.proveedores.crear(admin.id, datos) };
  }

  @Put(':id')
  async actualizar(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaProveedor)) datos: DatosProveedor,
  ): Promise<{ proveedor: Proveedor }> {
    return { proveedor: await this.proveedores.actualizar(admin.id, id, datos) };
  }

  /** A un proveedor inactivo no se le registran compras nuevas. */
  @Put(':id/activo')
  async cambiarActivo(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaActivo)) datos: DatosActivo,
  ): Promise<{ proveedor: Proveedor }> {
    return { proveedor: await this.proveedores.cambiarActivo(admin.id, id, datos.activo) };
  }
}
