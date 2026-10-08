import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { sql } from 'kysely';
import { BaseDatosService, type Trx } from '../base-datos/base-datos.service';
import { buscarEquipo, type DatosEquipo } from '../equipos/datos-equipo';
import type { DatosCambioPassword, DatosLogin } from './esquemas';
import {
  generarToken,
  hashearPassword,
  hashParaUsuarioInexistente,
  sha256,
  verificarPassword,
} from './seguridad';
import {
  contenidoToken,
  DURACION_TOKEN_ACCESO_SEG,
  type UsuarioAutenticado,
} from './usuario-autenticado';

/** Datos de quien inicia la solicitud, para la bitácora de accesos y las sesiones. */
export interface ContextoSolicitud {
  ip: string | null;
  userAgent: string | null;
}

export interface DatosUsuario {
  id: number;
  nombre_completo: string;
  username: string;
  rol: { codigo: string; nombre: string };
  debe_cambiar_password: boolean;
  /** Los permisos que valen en esta sesión: desde el celular, solo los marcados sin equipo. */
  permisos: string[];
  sucursales: { id: number; codigo: string; nombre: string }[];
}

/**
 * COMPLETO: un equipo registrado de su sucursal (o el administrador, desde donde sea). CELULAR:
 * sin equipo registrado; solo valen los permisos marcados `sin_equipo`.
 */
export type AccesoSesion = 'COMPLETO' | 'CELULAR';

export interface DatosSesion {
  usuario: DatosUsuario;
  equipo: DatosEquipo | null;
  acceso: AccesoSesion;
}

/** Respuesta de login, refresh y cambio de contraseña. */
export interface RespuestaSesion {
  access_token: string;
  token_type: 'Bearer';
  expira_en: number;
  sesion_expira_at: string;
  usuario: DatosUsuario;
  equipo: DatosEquipo | null;
  acceso: AccesoSesion;
}

/** Sesión abierta: la respuesta para el cliente más el token de renovación (va en una cookie). */
export interface SesionAbierta {
  respuesta: RespuestaSesion;
  tokenRenovacion: string;
  vence: Date;
}

type ResultadoLogin =
  'OK' | 'CREDENCIALES_INVALIDAS' | 'BLOQUEADO' | 'INACTIVO' | 'EQUIPO_NO_AUTORIZADO';

interface FilaSesion {
  sesion_id: string;
  expira_at: Date;
}

/** La cookie de sesión no sirve (vencida, cerrada o renovada): hay que iniciar sesión de nuevo. */
export class SesionNoValida extends HttpException {
  constructor() {
    super(
      { codigo: 'SESION_NO_VALIDA', mensaje: 'Su sesión terminó. Inicie sesión de nuevo.' },
      HttpStatus.UNAUTHORIZED,
    );
  }
}

function errorDeLogin(resultado: ResultadoLogin, minutosBloqueo: number | null): HttpException {
  switch (resultado) {
    case 'BLOQUEADO': {
      const minutos = minutosBloqueo ?? 15;
      return new HttpException(
        {
          codigo: 'CUENTA_BLOQUEADA',
          mensaje:
            `Cuenta bloqueada por intentos fallidos. Intente de nuevo en ${minutos} ` +
            `${minutos === 1 ? 'minuto' : 'minutos'} o pida al administrador que la desbloquee.`,
        },
        HttpStatus.LOCKED,
      );
    }
    case 'INACTIVO':
      return new HttpException(
        {
          codigo: 'USUARIO_INACTIVO',
          mensaje: 'Su usuario está desactivado. Consulte al administrador.',
        },
        HttpStatus.FORBIDDEN,
      );
    case 'EQUIPO_NO_AUTORIZADO':
      return new HttpException(
        {
          codigo: 'EQUIPO_NO_AUTORIZADO',
          mensaje: 'Este equipo está registrado para una sucursal que no es la suya.',
        },
        HttpStatus.FORBIDDEN,
      );
    default:
      return new HttpException(
        { codigo: 'CREDENCIALES_INVALIDAS', mensaje: 'Usuario o contraseña incorrectos' },
        HttpStatus.UNAUTHORIZED,
      );
  }
}

/**
 * Inicio de sesión, renovación, cierre y cambio de contraseña. Las reglas (bloqueo, equipos
 * autorizados, duración y rotación de sesiones) las aplica la base: fn_registrar_login,
 * fn_crear_sesion, fn_renovar_sesion, fn_cerrar_sesion y fn_cambiar_password.
 */
@Injectable()
export class AutenticacionService {
  constructor(
    private readonly bd: BaseDatosService,
    private readonly jwt: JwtService,
  ) {}

  async iniciarSesion(
    { username, password }: DatosLogin,
    contexto: ContextoSolicitud,
    tokenEquipo: string | undefined,
  ): Promise<SesionAbierta> {
    const usuario = await this.bd.db
      .selectFrom('usuario')
      .select(['id', 'password_hash'])
      .where('username', '=', username)
      .executeTakeFirst();
    // Se verifica siempre (con un hash falso si el usuario no existe): misma demora en ambos casos
    const passwordCorrecta = await verificarPassword(
      password,
      usuario?.password_hash ?? (await hashParaUsuarioInexistente()),
    );
    const tokenRenovacion = generarToken();

    const intento = await this.bd.transaccion(usuario?.id ?? null, async (trx) => {
      const equipo = tokenEquipo
        ? (
            await sql<{ dispositivo_id: string }>`
              select dispositivo_id from fn_dispositivo_por_token(${sha256(tokenEquipo)})`.execute(
              trx,
            )
          ).rows[0]
        : undefined;
      const dispositivoId = equipo?.dispositivo_id ?? null;

      const { rows } = await sql<{
        resultado: ResultadoLogin;
        id_usuario: number | null;
        minutos_bloqueo: number | null;
      }>`select * from fn_registrar_login(${username}, ${!!usuario && passwordCorrecta},
           ${contexto.ip}::inet, ${contexto.userAgent}, ${dispositivoId}::uuid)`.execute(trx);
      const { resultado, id_usuario, minutos_bloqueo } = rows[0];
      if (resultado !== 'OK' || id_usuario === null) {
        return { resultado, minutos_bloqueo, sesion: null };
      }
      return {
        resultado,
        minutos_bloqueo,
        sesion: {
          usuarioId: id_usuario,
          dispositivoId,
          ...(await this.crearSesion(trx, id_usuario, tokenRenovacion, dispositivoId, contexto)),
        },
      };
    });

    // El intento fallido ya quedó registrado (la transacción terminó): ahora se informa el error
    if (!intento.sesion) throw errorDeLogin(intento.resultado, intento.minutos_bloqueo);
    const { usuarioId, dispositivoId, sesion_id, expira_at } = intento.sesion;
    return this.armarSesion(usuarioId, dispositivoId, sesion_id, expira_at, tokenRenovacion);
  }

  async renovarSesion(
    tokenActual: string | undefined,
    contexto: ContextoSolicitud,
  ): Promise<SesionAbierta> {
    if (!tokenActual) throw new SesionNoValida();
    const tokenNuevo = generarToken();
    const renovada = await this.bd.transaccion(null, async (trx) => {
      const { rows } = await sql<{
        sesion_id: string;
        usuario_id: number;
        dispositivo_id: string | null;
        expira_at: Date;
      }>`select * from fn_renovar_sesion(${sha256(tokenActual)}, ${sha256(tokenNuevo)},
           ${contexto.ip}::inet, ${contexto.userAgent})`.execute(trx);
      return rows[0];
    });
    if (!renovada) throw new SesionNoValida();
    return this.armarSesion(
      renovada.usuario_id,
      renovada.dispositivo_id,
      renovada.sesion_id,
      renovada.expira_at,
      tokenNuevo,
    );
  }

  async cerrarSesion(token: string): Promise<void> {
    await this.bd.transaccion(null, (trx) =>
      sql`select fn_cerrar_sesion(${sha256(token)})`.execute(trx),
    );
  }

  /**
   * Cambia la contraseña del propio usuario. La base cierra todas sus sesiones (también la
   * actual) y aquí se abre una nueva en el mismo equipo, así quien la cambia sigue trabajando.
   */
  async cambiarPassword(
    usuario: UsuarioAutenticado,
    { password_actual, password_nueva }: DatosCambioPassword,
    contexto: ContextoSolicitud,
  ): Promise<SesionAbierta> {
    const fila = await this.bd.db
      .selectFrom('usuario')
      .select(['username', 'password_hash'])
      .where('id', '=', usuario.id)
      .executeTakeFirstOrThrow();

    if (!(await verificarPassword(password_actual, fila.password_hash))) {
      throw new HttpException(
        { codigo: 'PASSWORD_ACTUAL_INCORRECTA', mensaje: 'La contraseña actual no es correcta' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (password_nueva === password_actual) {
      throw new HttpException(
        {
          codigo: 'PASSWORD_REPETIDA',
          mensaje: 'La nueva contraseña debe ser distinta de la actual',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (password_nueva.toLowerCase().includes(fila.username)) {
      throw new HttpException(
        {
          codigo: 'PASSWORD_DEBIL',
          mensaje: 'La nueva contraseña no puede contener su nombre de usuario',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const hashNuevo = await hashearPassword(password_nueva);
    const tokenRenovacion = generarToken();
    const dispositivoId = usuario.equipo?.id ?? null;
    const sesion = await this.bd.transaccion(usuario.id, async (trx) => {
      await sql`select fn_cambiar_password(${usuario.id}, ${hashNuevo})`.execute(trx);
      return this.crearSesion(trx, usuario.id, tokenRenovacion, dispositivoId, contexto);
    });
    return this.armarSesion(
      usuario.id,
      dispositivoId,
      sesion.sesion_id,
      sesion.expira_at,
      tokenRenovacion,
    );
  }

  /** Usuario (con sus permisos en esta sesión y sus sucursales) y equipo de una sesión. */
  async datosSesion(usuarioId: number, dispositivoId: string | null): Promise<DatosSesion> {
    const { db } = this.bd;
    const [usuario, permisos, sucursales, equipo, acceso] = await Promise.all([
      db
        .selectFrom('usuario as u')
        .innerJoin('rol as r', 'r.id', 'u.rol_id')
        .select([
          'u.id',
          'u.nombre_completo',
          'u.username',
          'u.debe_cambiar_password',
          'r.codigo as rol_codigo',
          'r.nombre as rol_nombre',
        ])
        .where('u.id', '=', usuarioId)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('permiso')
        .select('codigo')
        .where(
          sql<boolean>`fn_permiso_en_sesion(${usuarioId}, codigo, ${dispositivoId}::uuid) = 'OK'`,
        )
        .orderBy('codigo')
        .execute(),
      db
        .selectFrom('sucursal')
        .select(['id', 'codigo', 'nombre'])
        .where('activa', '=', true)
        .where(sql<boolean>`fn_puede_operar_sucursal(${usuarioId}, id)`)
        .orderBy('id')
        .execute(),
      dispositivoId ? buscarEquipo(db, dispositivoId) : null,
      sql<{ completo: boolean }>`
        select fn_equipo_autorizado(${usuarioId}, ${dispositivoId}::uuid) as completo`.execute(db),
    ]);
    return {
      usuario: {
        id: usuario.id,
        nombre_completo: usuario.nombre_completo,
        username: usuario.username,
        rol: { codigo: usuario.rol_codigo, nombre: usuario.rol_nombre },
        debe_cambiar_password: usuario.debe_cambiar_password,
        permisos: permisos.map((p) => p.codigo),
        sucursales,
      },
      equipo,
      acceso: acceso.rows[0].completo ? 'COMPLETO' : 'CELULAR',
    };
  }

  private async crearSesion(
    trx: Trx,
    usuarioId: number,
    tokenRenovacion: string,
    dispositivoId: string | null,
    contexto: ContextoSolicitud,
  ): Promise<FilaSesion> {
    const { rows } = await sql<FilaSesion>`
      select * from fn_crear_sesion(${usuarioId}, ${sha256(tokenRenovacion)}, ${dispositivoId}::uuid,
                                    ${contexto.ip}::inet, ${contexto.userAgent})`.execute(trx);
    return rows[0];
  }

  private async armarSesion(
    usuarioId: number,
    dispositivoId: string | null,
    sesionId: string,
    vence: Date,
    tokenRenovacion: string,
  ): Promise<SesionAbierta> {
    const { usuario, equipo, acceso } = await this.datosSesion(usuarioId, dispositivoId);
    const autenticado: UsuarioAutenticado = {
      id: usuarioId,
      sesionId,
      rol: usuario.rol.codigo,
      debeCambiarPassword: usuario.debe_cambiar_password,
      equipo: equipo
        ? { id: equipo.id, sucursalId: equipo.sucursal.id, cajaId: equipo.caja_id }
        : null,
    };
    return {
      tokenRenovacion,
      vence,
      respuesta: {
        access_token: this.jwt.sign(contenidoToken(autenticado)),
        token_type: 'Bearer',
        expira_en: DURACION_TOKEN_ACCESO_SEG,
        sesion_expira_at: vence.toISOString(),
        usuario,
        equipo,
        acceso,
      },
    };
  }
}
