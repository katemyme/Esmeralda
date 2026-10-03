import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { UsuarioActual } from '../autenticacion/decoradores';
import { RequierePermiso } from '../autenticacion/permisos';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { esquemaActivo, idEntero, type DatosActivo } from '../comun/esquemas';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import {
  esquemaActualizarUsuario,
  esquemaCrearUsuario,
  type DatosActualizarUsuario,
  type DatosCrearUsuario,
} from './esquemas';
import {
  UsuariosService,
  type UsuarioAdmin,
  type UsuarioConPasswordTemporal,
} from './usuarios.service';

/** /api/usuarios — panel de administración: usuarios, sus roles, sucursales y contraseñas. */
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  @RequierePermiso('USUARIOS_VER')
  async listar(): Promise<{ usuarios: UsuarioAdmin[] }> {
    return { usuarios: await this.usuarios.listar() };
  }

  @Get(':id')
  @RequierePermiso('USUARIOS_VER')
  async ver(@Param('id', idEntero()) id: number): Promise<{ usuario: UsuarioAdmin }> {
    return { usuario: await this.usuarios.buscar(id) };
  }

  /** Crea el usuario con una contraseña temporal, que solo se muestra en esta respuesta. */
  @Post()
  @RequierePermiso('USUARIOS_GESTIONAR')
  @HttpCode(HttpStatus.CREATED)
  crear(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Body(new ValidacionZod(esquemaCrearUsuario)) datos: DatosCrearUsuario,
  ): Promise<UsuarioConPasswordTemporal> {
    return this.usuarios.crear(admin.id, datos);
  }

  @Put(':id')
  @RequierePermiso('USUARIOS_GESTIONAR')
  async actualizar(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaActualizarUsuario)) datos: DatosActualizarUsuario,
  ): Promise<{ usuario: UsuarioAdmin }> {
    return { usuario: await this.usuarios.actualizar(admin.id, id, datos) };
  }

  /** Activa o desactiva al usuario (desactivarlo cierra sus sesiones). */
  @Put(':id/activo')
  @RequierePermiso('USUARIOS_GESTIONAR')
  async cambiarActivo(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaActivo)) datos: DatosActivo,
  ): Promise<{ usuario: UsuarioAdmin }> {
    return { usuario: await this.usuarios.cambiarActivo(admin.id, id, datos.activo) };
  }

  /** Nueva contraseña temporal (también desbloquea la cuenta); solo se muestra en esta respuesta. */
  @Post(':id/resetear-password')
  @RequierePermiso('USUARIOS_GESTIONAR')
  @HttpCode(HttpStatus.OK)
  resetearPassword(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
  ): Promise<UsuarioConPasswordTemporal> {
    return this.usuarios.resetearPassword(admin.id, id);
  }

  @Post(':id/cerrar-sesiones')
  @RequierePermiso('USUARIOS_GESTIONAR')
  @HttpCode(HttpStatus.OK)
  async cerrarSesiones(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
  ): Promise<{ sesiones_cerradas: number }> {
    return { sesiones_cerradas: await this.usuarios.cerrarSesiones(admin.id, id) };
  }
}
