import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { UsuarioActual } from '../autenticacion/decoradores';
import { RequierePermiso } from '../autenticacion/permisos';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { esquemaActiva, idEntero, type DatosActiva } from '../comun/esquemas';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import { CategoriasService, type CategoriaCatalogo } from './categorias.service';
import {
  esquemaAdmiteDevolucion,
  esquemaCategoria,
  type DatosAdmiteDevolucion,
  type DatosCategoria,
} from './esquemas';

/** /api/categorias — catálogo: rubros en que se agrupan los productos. */
@Controller('categorias')
export class CategoriasController {
  constructor(private readonly categorias: CategoriasService) {}

  @Get()
  @RequierePermiso('PRODUCTOS_VER')
  async listar(): Promise<{ categorias: CategoriaCatalogo[] }> {
    return { categorias: await this.categorias.listar() };
  }

  @Post()
  @RequierePermiso('PRODUCTOS_GESTIONAR')
  @HttpCode(HttpStatus.CREATED)
  async crear(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Body(new ValidacionZod(esquemaCategoria)) datos: DatosCategoria,
  ): Promise<{ categoria: CategoriaCatalogo }> {
    return { categoria: await this.categorias.guardar(admin.id, null, datos) };
  }

  @Put(':id')
  @RequierePermiso('PRODUCTOS_GESTIONAR')
  async actualizar(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaCategoria)) datos: DatosCategoria,
  ): Promise<{ categoria: CategoriaCatalogo }> {
    return { categoria: await this.categorias.guardar(admin.id, id, datos) };
  }

  /** Una categoría inactiva no admite productos nuevos. */
  @Put(':id/activa')
  @RequierePermiso('PRODUCTOS_GESTIONAR')
  async cambiarActiva(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaActiva)) datos: DatosActiva,
  ): Promise<{ categoria: CategoriaCatalogo }> {
    return { categoria: await this.categorias.cambiarActiva(admin.id, id, datos.activa) };
  }

  /**
   * La casilla "admite devolución": si lo vendido de esta categoría se puede devolver o cambiar.
   * La marca solo quien aprueba las devoluciones (el administrador). Las perforaciones, nunca.
   */
  @Put(':id/admite-devolucion')
  @RequierePermiso('DEVOLUCIONES_APROBAR')
  async cambiarAdmiteDevolucion(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaAdmiteDevolucion)) datos: DatosAdmiteDevolucion,
  ): Promise<{ categoria: CategoriaCatalogo }> {
    return {
      categoria: await this.categorias.cambiarAdmiteDevolucion(
        admin.id,
        id,
        datos.admite_devolucion,
      ),
    };
  }
}
