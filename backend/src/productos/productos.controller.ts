import {
  Body,
  Controller,
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
import { esquemaActivo, idEntero, type DatosActivo } from '../comun/esquemas';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import {
  esquemaActualizarProducto,
  esquemaActualizarVariante,
  esquemaCrearProducto,
  esquemaCrearVariante,
  esquemaFiltroProductos,
  esquemaPrecioVariante,
  type DatosActualizarProducto,
  type DatosActualizarVariante,
  type DatosCrearProducto,
  type DatosCrearVariante,
  type DatosPrecioVariante,
  type FiltroProductos,
} from './esquemas';
import { ProductosService, type ProductoCatalogo } from './productos.service';

/**
 * /api/productos — catálogo de piezas y artículos, cada uno con sus variantes. Las perforaciones
 * (tipos SERVICIO y PAQUETE) aparecen en las consultas, pero se administran en /api/perforaciones.
 */
@Controller('productos')
export class ProductosController {
  constructor(private readonly productos: ProductosService) {}

  /** `?buscar=&categoria_id=&tipo=&estado=activos|inactivos|todos&limite=&desplazamiento=` */
  @Get()
  @RequierePermiso('PRODUCTOS_VER')
  listar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaFiltroProductos)) filtro: FiltroProductos,
  ): Promise<{ productos: ProductoCatalogo[]; total: number }> {
    return this.productos.listar(usuario.id, filtro);
  }

  @Get(':id')
  @RequierePermiso('PRODUCTOS_VER')
  async ver(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
  ): Promise<{ producto: ProductoCatalogo }> {
    return { producto: await this.productos.buscar(usuario.id, id) };
  }

  /** Crea el producto y, si se envían, sus variantes (estas piden además PRECIOS_EDITAR). */
  @Post()
  @RequierePermiso('PRODUCTOS_GESTIONAR')
  @HttpCode(HttpStatus.CREATED)
  async crear(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Body(new ValidacionZod(esquemaCrearProducto)) datos: DatosCrearProducto,
  ): Promise<{ producto: ProductoCatalogo }> {
    return { producto: await this.productos.crear(admin.id, datos) };
  }

  @Put(':id')
  @RequierePermiso('PRODUCTOS_GESTIONAR')
  async actualizar(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaActualizarProducto)) datos: DatosActualizarProducto,
  ): Promise<{ producto: ProductoCatalogo }> {
    return { producto: await this.productos.actualizar(admin.id, id, datos) };
  }

  /** No se puede desactivar un producto que todavía tiene existencias. */
  @Put(':id/activo')
  @RequierePermiso('PRODUCTOS_GESTIONAR')
  async cambiarActivo(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaActivo)) datos: DatosActivo,
  ): Promise<{ producto: ProductoCatalogo }> {
    return { producto: await this.productos.cambiarActivo(admin.id, id, datos.activo) };
  }

  @Post(':id/variantes')
  @RequierePermiso('PRODUCTOS_GESTIONAR')
  @HttpCode(HttpStatus.CREATED)
  async agregarVariante(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaCrearVariante)) datos: DatosCrearVariante,
  ): Promise<{ producto: ProductoCatalogo }> {
    return { producto: await this.productos.agregarVariante(admin.id, id, datos) };
  }
}

/** /api/variantes — cambios sobre una variante; responden con el producto completo. */
@Controller('variantes')
export class VariantesController {
  constructor(private readonly productos: ProductosService) {}

  @Put(':id')
  @RequierePermiso('PRODUCTOS_GESTIONAR')
  async actualizar(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaActualizarVariante)) datos: DatosActualizarVariante,
  ): Promise<{ producto: ProductoCatalogo }> {
    return { producto: await this.productos.actualizarVariante(admin.id, id, datos) };
  }

  /** `{ precio_venta, costo }`: lo que no se envía no cambia. */
  @Put(':id/precio')
  @RequierePermiso('PRECIOS_EDITAR')
  async cambiarPrecio(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaPrecioVariante)) datos: DatosPrecioVariante,
  ): Promise<{ producto: ProductoCatalogo }> {
    return { producto: await this.productos.cambiarPrecioVariante(admin.id, id, datos) };
  }

  @Put(':id/activo')
  @RequierePermiso('PRODUCTOS_GESTIONAR')
  async cambiarActiva(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaActivo)) datos: DatosActivo,
  ): Promise<{ producto: ProductoCatalogo }> {
    return { producto: await this.productos.cambiarVarianteActiva(admin.id, id, datos.activo) };
  }
}
