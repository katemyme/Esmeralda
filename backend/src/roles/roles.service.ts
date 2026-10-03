import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { NoEncontrado } from '../comun/no-encontrado';

/** Un rol con los códigos de sus permisos. El ADMIN los tiene todos y no es editable. */
export interface RolAdmin {
  codigo: string;
  nombre: string;
  descripcion: string | null;
  es_sistema: boolean;
  editable: boolean;
  permisos: string[];
  usuarios_activos: number;
}

/** Un permiso del catálogo, para armar la pantalla de roles agrupada por módulo. */
export interface PermisoAdmin {
  codigo: string;
  modulo: string;
  descripcion: string;
}

/** Roles y sus permisos. Qué rol se puede editar y qué permisos se pueden otorgar lo decide la base. */
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

  /** Deja al rol con exactamente los permisos de la lista (fn_set_permisos_rol). */
  async cambiarPermisos(adminId: number, codigo: string, permisos: string[]): Promise<RolAdmin> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_set_permisos_rol(${adminId}, ${codigo}, ${permisos}::text[])`.execute(trx),
    );
    const rol = (await this.listar()).find((r) => r.codigo === codigo);
    if (!rol) throw new NoEncontrado(`El rol ${codigo} no existe`);
    return rol;
  }
}
