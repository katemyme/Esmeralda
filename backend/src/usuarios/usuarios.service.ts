import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { generarPasswordTemporal, hashearPassword } from '../autenticacion/seguridad';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { NoEncontrado } from '../comun/no-encontrado';
import type { DatosActualizarUsuario, DatosCrearUsuario } from './esquemas';

/** Un usuario tal como lo muestra el panel de administración (nunca incluye el hash). */
export interface UsuarioAdmin {
  id: number;
  nombre_completo: string;
  username: string;
  email: string | null;
  telefono: string | null;
  rol: { codigo: string; nombre: string };
  estado: 'ACTIVO' | 'INACTIVO' | 'BLOQUEADO';
  /** Sucursales asignadas. */
  sucursales: { id: number; codigo: string; nombre: string }[];
  /** Con el permiso SUCURSALES_TODAS opera en todas, aunque no tenga ninguna asignada. */
  todas_las_sucursales: boolean;
  debe_cambiar_password: boolean;
  intentos_fallidos: number;
  bloqueado_hasta: Date | null;
  ultimo_acceso: Date | null;
  sesiones_activas: number;
  created_at: Date;
}

/** Usuario con la contraseña temporal recién generada (se entrega una sola vez). */
export interface UsuarioConPasswordTemporal {
  usuario: UsuarioAdmin;
  password_temporal: string;
}

// Las columnas de una vista llegan como "posiblemente nulas" en los tipos generados
interface FilaUsuario {
  id: number;
  nombre_completo: string;
  username: string;
  email: string | null;
  telefono: string | null;
  rol_codigo: string;
  rol: string;
  estado: UsuarioAdmin['estado'];
  debe_cambiar_password: boolean;
  intentos_fallidos: number;
  bloqueado_hasta: Date | null;
  ultimo_acceso: Date | null;
  sesiones_activas: number;
  created_at: Date;
  todas_las_sucursales: boolean;
}

/**
 * Usuarios del panel de administración. Las reglas (permisos, quién puede asignar el rol ADMIN,
 * último administrador, cierre de sesiones al desactivar o cambiar de rol) las aplica la base:
 * fn_crear_usuario, fn_actualizar_usuario, fn_set_usuario_activo, fn_resetear_password y
 * fn_revocar_sesiones. Aquí solo se generan la contraseña temporal y su hash.
 */
@Injectable()
export class UsuariosService {
  constructor(private readonly bd: BaseDatosService) {}

  listar(): Promise<UsuarioAdmin[]> {
    return this.consultar();
  }

  async buscar(id: number): Promise<UsuarioAdmin> {
    const [usuario] = await this.consultar(id);
    if (!usuario) throw new NoEncontrado(`El usuario ${id} no existe`);
    return usuario;
  }

  async crear(adminId: number, datos: DatosCrearUsuario): Promise<UsuarioConPasswordTemporal> {
    const passwordTemporal = generarPasswordTemporal();
    const hash = await hashearPassword(passwordTemporal);
    const id = await this.bd.transaccion(adminId, async (trx) => {
      const { rows } = await sql<{ id: number }>`
        select fn_crear_usuario(${adminId}, ${datos.nombre_completo}, ${datos.username}, ${hash},
               ${datos.rol}, ${datos.sucursales}::integer[], ${datos.email}, ${datos.telefono}) as id`.execute(
        trx,
      );
      return rows[0].id;
    });
    return { usuario: await this.buscar(id), password_temporal: passwordTemporal };
  }

  async actualizar(
    adminId: number,
    id: number,
    datos: DatosActualizarUsuario,
  ): Promise<UsuarioAdmin> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_actualizar_usuario(${adminId}, ${id}, ${datos.nombre_completo}, ${datos.rol},
                 ${datos.sucursales}::integer[], ${datos.email}, ${datos.telefono})`.execute(trx),
    );
    return this.buscar(id);
  }

  async cambiarActivo(adminId: number, id: number, activo: boolean): Promise<UsuarioAdmin> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_set_usuario_activo(${adminId}, ${id}, ${activo})`.execute(trx),
    );
    return this.buscar(id);
  }

  /** Nueva contraseña temporal: desbloquea la cuenta, cierra sus sesiones y obliga a cambiarla. */
  async resetearPassword(adminId: number, id: number): Promise<UsuarioConPasswordTemporal> {
    const passwordTemporal = generarPasswordTemporal();
    const hash = await hashearPassword(passwordTemporal);
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_resetear_password(${adminId}, ${id}, ${hash})`.execute(trx),
    );
    return { usuario: await this.buscar(id), password_temporal: passwordTemporal };
  }

  /** Cierra todas las sesiones abiertas del usuario. Devuelve cuántas eran. */
  async cerrarSesiones(adminId: number, id: number): Promise<number> {
    await this.buscar(id);
    return this.bd.transaccion(adminId, async (trx) => {
      const { rows } = await sql<{ cerradas: number }>`
        select fn_revocar_sesiones(${adminId}, ${id}) as cerradas`.execute(trx);
      return rows[0].cerradas;
    });
  }

  private async consultar(id?: number): Promise<UsuarioAdmin[]> {
    const { db } = this.bd;
    let usuarios = db
      .selectFrom('v_usuarios_admin as v')
      .select([
        'v.id',
        'v.nombre_completo',
        'v.username',
        'v.email',
        'v.telefono',
        'v.rol_codigo',
        'v.rol',
        'v.estado',
        'v.debe_cambiar_password',
        'v.intentos_fallidos',
        'v.bloqueado_hasta',
        'v.ultimo_acceso',
        'v.sesiones_activas',
        'v.created_at',
        sql<boolean>`fn_tiene_permiso(v.id, 'SUCURSALES_TODAS')`.as('todas_las_sucursales'),
      ])
      .orderBy('v.nombre_completo')
      .orderBy('v.id');
    let asignadas = db
      .selectFrom('usuario_sucursal as us')
      .innerJoin('sucursal as s', 's.id', 'us.sucursal_id')
      .select(['us.usuario_id', 's.id', 's.codigo', 's.nombre'])
      .orderBy('s.id');
    if (id !== undefined) {
      usuarios = usuarios.where('v.id', '=', id);
      asignadas = asignadas.where('us.usuario_id', '=', id);
    }
    const [filas, sucursales] = await Promise.all([
      usuarios.$castTo<FilaUsuario>().execute(),
      asignadas.execute(),
    ]);

    return filas.map((fila) => ({
      id: fila.id,
      nombre_completo: fila.nombre_completo,
      username: fila.username,
      email: fila.email,
      telefono: fila.telefono,
      rol: { codigo: fila.rol_codigo, nombre: fila.rol },
      estado: fila.estado,
      sucursales: sucursales
        .filter((s) => s.usuario_id === fila.id)
        .map(({ id: sucursalId, codigo, nombre }) => ({ id: sucursalId, codigo, nombre })),
      todas_las_sucursales: fila.todas_las_sucursales,
      debe_cambiar_password: fila.debe_cambiar_password,
      intentos_fallidos: fila.intentos_fallidos,
      bloqueado_hasta: fila.bloqueado_hasta,
      ultimo_acceso: fila.ultimo_acceso,
      sesiones_activas: fila.sesiones_activas,
      created_at: fila.created_at,
    }));
  }
}
