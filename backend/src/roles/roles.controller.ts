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
} from '@nestjs/common';
import { UsuarioActual } from '../autenticacion/decoradores';
import { RequierePermiso } from '../autenticacion/permisos';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import {
  codigoRol,
  esquemaActualizarRol,
  esquemaCrearRol,
  esquemaPermisosRol,
  type DatosActualizarRol,
  type DatosCrearRol,
  type DatosPermisosRol,
} from './esquemas';
import { RolesService, type PermisoAdmin, type RolAdmin } from './roles.service';

/** /api/roles y /api/permisos — panel de administración: qué puede hacer cada rol. */
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** Roles con sus permisos (también llena la lista de roles del formulario de usuarios). */
  @Get('roles')
  @RequierePermiso('USUARIOS_VER')
  async listar(): Promise<{ roles: RolAdmin[] }> {
    return { roles: await this.roles.listar() };
  }

  /** Catálogo de permisos, ordenado por módulo. */
  @Get('permisos')
  @RequierePermiso('ROLES_GESTIONAR')
  async catalogoPermisos(): Promise<{ permisos: PermisoAdmin[] }> {
    return { permisos: await this.roles.catalogoPermisos() };
  }

  /** Rol nuevo, sin permisos: se le dan con PUT /api/roles/:codigo/permisos. */
  @Post('roles')
  @RequierePermiso('ROLES_GESTIONAR')
  @HttpCode(HttpStatus.CREATED)
  async crear(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Body(new ValidacionZod(esquemaCrearRol)) datos: DatosCrearRol,
  ): Promise<{ rol: RolAdmin }> {
    return { rol: await this.roles.crear(admin.id, datos) };
  }

  @Put('roles/:codigo')
  @RequierePermiso('ROLES_GESTIONAR')
  async actualizar(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('codigo', codigoRol()) codigo: string,
    @Body(new ValidacionZod(esquemaActualizarRol)) datos: DatosActualizarRol,
  ): Promise<{ rol: RolAdmin }> {
    return { rol: await this.roles.actualizar(admin.id, codigo, datos) };
  }

  /** Solo un rol que no es de sistema y que ya no tiene usuarios. */
  @Delete('roles/:codigo')
  @RequierePermiso('ROLES_GESTIONAR')
  @HttpCode(HttpStatus.NO_CONTENT)
  async eliminar(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('codigo', codigoRol()) codigo: string,
  ): Promise<void> {
    await this.roles.eliminar(admin.id, codigo);
  }

  @Put('roles/:codigo/permisos')
  @RequierePermiso('ROLES_GESTIONAR')
  async cambiarPermisos(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('codigo', codigoRol()) codigo: string,
    @Body(new ValidacionZod(esquemaPermisosRol)) datos: DatosPermisosRol,
  ): Promise<{ rol: RolAdmin }> {
    return { rol: await this.roles.cambiarPermisos(admin.id, codigo, datos.permisos) };
  }
}
