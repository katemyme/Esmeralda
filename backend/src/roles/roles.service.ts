import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { NoEncontrado } from '../comun/no-encontrado';
import type { DatosActualizarRol, DatosCrearRol } from './esquemas';

/** Un rol con los códigos de sus permisos. El ADMIN los tiene todos y no es editable. */
export interface RolAdmin {
  codigo: string;
  nombre: string;
  descripcion: string | null;
  /** Los roles de sistema (ADMIN, ENCARGADO, VENDEDOR) no se eliminan. */
  es_sistema: boolean;
  editable: boolean;
  permisos: string[];
  usuarios_activos: number;
  /** Usuarios con este rol, activos o no: mientras tenga alguno no se puede eliminar. */
  usuarios: number;
}

/** Un permiso del catálogo, para armar la pantalla de roles agrupada por módulo. */
export interface PermisoAdmin {
  codigo: string;
  modulo: string;
  descripcion: string;
}

/**
 * Roles y sus permisos. Qué rol se puede editar o eliminar y qué permisos se pueden otorgar lo
 * decide la base: fn_crear_rol, fn_actualizar_rol, fn_eliminar_rol y fn_set_permisos_rol.
 */
@Injectable()
export class RolesService {
  constructor(private readonly bd: BaseDatosService) {}

  listar(): Promise<RolAdmin[]> {
    return this.bd.db
      .selectFrom('v_roles_admin')
      .select([
        'codigo',
        'nombre',
        'descripcion',
        'es_sistema',
        'editable',
        'permisos',
        'usuarios_activos',
        'usuarios',
      ])
      .orderBy('id')
      .$castTo<RolAdmin>()
      .execute();
  }

  catalogoPermisos(): Promise<PermisoAdmin[]> {
    return this.bd.db
      .selectFrom('permiso')
      .select(['codigo', 'modulo', 'descripcion'])
      .orderBy('modulo')
      .orderBy('codigo')
      .execute();
  }

  /** Rol nuevo, sin permisos: se le dan después con cambiarPermisos(). */
  async crear(adminId: number, datos: DatosCrearRol): Promise<RolAdmin> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_crear_rol(${adminId}, ${datos.codigo}, ${datos.nombre}, ${datos.descripcion})`.execute(
        trx,
      ),
    );
    return this.buscar(datos.codigo);
  }

  async actualizar(adminId: number, codigo: string, datos: DatosActualizarRol): Promise<RolAdmin> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_actualizar_rol(${adminId}, ${codigo}, ${datos.nombre}, ${datos.descripcion})`.execute(
        trx,
      ),
    );
    return this.buscar(codigo);
  }

  async eliminar(adminId: number, codigo: string): Promise<void> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_eliminar_rol(${adminId}, ${codigo})`.execute(trx),
    );
  }

  /** Deja al rol con exactamente los permisos de la lista (fn_set_permisos_rol). */
  async cambiarPermisos(adminId: number, codigo: string, permisos: string[]): Promise<RolAdmin> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_set_permisos_rol(${adminId}, ${codigo}, ${permisos}::text[])`.execute(trx),
    );
    return this.buscar(codigo);
  }

  private async buscar(codigo: string): Promise<RolAdmin> {
    const rol = (await this.listar()).find((r) => r.codigo === codigo);
    if (!rol) throw new NoEncontrado(`El rol ${codigo} no existe`);
    return rol;
  }
}
