import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
} from '@nestjs/common';
import { UsuarioActual } from '../autenticacion/decoradores';
import { RequierePermiso } from '../autenticacion/permisos';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { esquemaActivo, idEntero, type DatosActivo } from '../comun/esquemas';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import { SubirFoto } from '../fotos/fotos.controller';
import { FotosService, type ArchivoSubido } from '../fotos/fotos.service';
import {
  esquemaActualizarProducto,
  esquemaActualizarVariante,
  esquemaBusquedaVenta,
  esquemaCrearProducto,
  esquemaCrearVariante,
  esquemaFiltroProductos,
  esquemaPrecioVariante,
  type BusquedaVenta,
  type DatosActualizarProducto,
  type DatosActualizarVariante,
  type DatosCrearProducto,
  type DatosCrearVariante,
  type DatosPrecioVariante,
  type FiltroProductos,
} from './esquemas';
import {
  ProductosService,
  type CambioPrecio,
  type ExistenciaUbicacion,
  type ProductoCatalogo,
  type VarianteEncontrada,
} from './productos.service';

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
  constructor(
    private readonly productos: ProductosService,
    private readonly fotos: FotosService,
  ) {}

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

  /**
   * `?texto=&sucursal_id=&limite=`: la búsqueda de la pantalla de venta. Solo lo activo, con el
   * stock de la sucursal (por defecto, la del equipo desde el que se inició la sesión).
   */
  @Get('buscar')
  @RequierePermiso('PRODUCTOS_VER')
  async buscar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaBusquedaVenta)) consulta: BusquedaVenta,
  ): Promise<{ variantes: VarianteEncontrada[] }> {
    const sucursalId = consulta.sucursal_id ?? usuario.equipo?.sucursalId;
    if (sucursalId === undefined) {
      throw new HttpException(
        {
          codigo: 'DATOS_INVALIDOS',
          mensaje: 'Indique la sucursal (sucursal_id): esta sesión no es de un equipo registrado',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    return {
      variantes: await this.productos.buscarParaVenta(
        usuario.id,
        consulta.texto,
        sucursalId,
        consulta.limite,
      ),
    };
  }

  /** Cuánto hay de la variante en cada ubicación (la bodega, según lo que el usuario puede ver). */
  @Get(':id/existencias')
  @RequierePermiso('INVENTARIO_VER')
  async existencias(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
  ): Promise<{ existencias: ExistenciaUbicacion[] }> {
    return { existencias: await this.productos.existencias(usuario.id, id) };
  }

  @Get(':id/historial-precios')
  @RequierePermiso('PRODUCTOS_VER')
  async historialPrecios(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
  ): Promise<{ historial: CambioPrecio[] }> {
    return { historial: await this.productos.historialPrecios(usuario.id, id) };
  }

  /** Sube la foto de la variante (campo "foto": JPG, PNG o WebP de hasta 5 MB) y reemplaza la anterior. */
  @Post(':id/foto')
  @RequierePermiso('PRODUCTOS_GESTIONAR')
  @SubirFoto()
  @HttpCode(HttpStatus.OK)
  async subirFoto(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @UploadedFile() archivo: ArchivoSubido | undefined,
  ): Promise<{ producto: ProductoCatalogo }> {
    const fotoUrl = await this.fotos.guardar(archivo);
    try {
      const { producto, anterior } = await this.productos.ponerFoto(admin.id, id, fotoUrl);
      await this.fotos.borrar(anterior);
      return { producto };
    } catch (error) {
      await this.fotos.borrar(fotoUrl); // la variante no existe o no hay permiso: no dejar el archivo suelto
      throw error;
    }
  }

  @Delete(':id/foto')
  @RequierePermiso('PRODUCTOS_GESTIONAR')
  async quitarFoto(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
  ): Promise<{ producto: ProductoCatalogo }> {
    const { producto, anterior } = await this.productos.ponerFoto(admin.id, id, null);
    await this.fotos.borrar(anterior);
    return { producto };
  }
}
