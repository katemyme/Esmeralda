/** Quién hace la solicitud, según su token de acceso. */
export interface UsuarioAutenticado {
  id: number;
  sesionId: string;
  rol: string;
  debeCambiarPassword: boolean;
  /** Equipo registrado donde se inició la sesión (null: el admin fuera de un equipo registrado). */
  equipo: { id: string; sucursalId: number; cajaId: number | null } | null;
}

/** Contenido del token de acceso (JWT, 15 minutos). Nombres cortos: viaja en cada solicitud. */
export interface ContenidoToken {
  sub: string;
  sid: string;
  rol: string;
  dcp: boolean;
  eq: { id: string; suc: number; caja: number | null } | null;
}

/** Duración del token de acceso: al vencer, el frontend lo renueva con la cookie de sesión. */
export const DURACION_TOKEN_ACCESO_SEG = 15 * 60;

export function contenidoToken(usuario: UsuarioAutenticado): ContenidoToken {
  const { equipo } = usuario;
  return {
    sub: String(usuario.id),
    sid: usuario.sesionId,
    rol: usuario.rol,
    dcp: usuario.debeCambiarPassword,
    eq: equipo ? { id: equipo.id, suc: equipo.sucursalId, caja: equipo.cajaId } : null,
  };
}

export function usuarioDesdeToken(contenido: ContenidoToken): UsuarioAutenticado {
  const id = Number(contenido.sub);
  if (!Number.isSafeInteger(id) || id <= 0 || typeof contenido.sid !== 'string') {
    throw new Error('Token de acceso con contenido inválido');
  }
  const { eq } = contenido;
  return {
    id,
    sesionId: contenido.sid,
    rol: contenido.rol,
    debeCambiarPassword: contenido.dcp === true,
    equipo: eq ? { id: eq.id, sucursalId: eq.suc, cajaId: eq.caja } : null,
  };
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Lo deja GuardiaAutenticacion en las rutas que exigen sesión. */
    usuario?: UsuarioAutenticado;
    /** GuardiaPermisos ya revisó esta solicitud. */
    permisosRevisados?: boolean;
  }
}
