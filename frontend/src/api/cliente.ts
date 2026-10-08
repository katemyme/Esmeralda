import type { RespuestaSesion } from './tipos';

/**
 * Cliente de la API. Todas las pantallas pasan por aquí:
 * - el token de acceso vive solo en memoria (nunca en localStorage); el de renovación va en una
 *   cookie httpOnly que el navegador envía solo;
 * - cuando el token vence (401) se renueva una sola vez, aunque fallen varias solicitudes a la
 *   vez, y la solicitud se repite;
 * - los errores llegan como `ErrorApi`, con el código estable y el mensaje en español de la API.
 */

export class ErrorApi extends Error {
  constructor(
    /** Código estable de la API (PERMISO_DENEGADO, EQUIPO_REQUERIDO…) o SIN_CONEXION. */
    readonly codigo: string,
    mensaje: string,
    /** Estado HTTP; 0 si la solicitud no llegó al servidor. */
    readonly estado: number,
    /** Errores por campo de un 400 DATOS_INVALIDOS. */
    readonly errores: { campo: string; mensaje: string }[] = [],
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
  }
}

/** El texto que se le muestra a la persona cuando algo falla. */
export function mensajeDeError(error: unknown): string {
  if (error instanceof ErrorApi) return error.message;
  return 'Ocurrió un error inesperado. Vuelva a intentarlo.';
}

type Metodo = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface Opciones {
  cuerpo?: unknown;
  /** Rutas que no llevan token ni intentan renovarlo (login, refresh, PIN). */
  publica?: boolean;
}

let tokenAcceso: string | null = null;
let alTerminarSesion: () => void = () => {};
let alRenovarSesion: (sesion: RespuestaSesion) => void = () => {};
let renovacionEnCurso: Promise<RespuestaSesion | null> | null = null;

export function ponerToken(token: string | null): void {
  tokenAcceso = token;
}

/** La sesión avisa aquí qué hacer cuando el token se renueva o cuando ya no hay sesión. */
export function alCambiarSesion(avisos: {
  renovada: (sesion: RespuestaSesion) => void;
  terminada: () => void;
}): void {
  alRenovarSesion = avisos.renovada;
  alTerminarSesion = avisos.terminada;
}

const espera = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

async function enviar(metodo: Metodo, ruta: string, opciones: Opciones): Promise<Response> {
  const cabeceras: Record<string, string> = { Accept: 'application/json' };
  if (opciones.cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json';
  if (tokenAcceso && !opciones.publica) cabeceras.Authorization = `Bearer ${tokenAcceso}`;
  try {
    return await fetch(`/api${ruta}`, {
      method: metodo,
      headers: cabeceras,
      body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
      credentials: 'same-origin',
    });
  } catch {
    throw new ErrorApi(
      'SIN_CONEXION',
      'No hay conexión con el servidor. Revise el internet y vuelva a intentarlo.',
      0,
    );
  }
}

async function comoError(respuesta: Response): Promise<ErrorApi> {
  let cuerpo: { codigo?: string; mensaje?: string; errores?: ErrorApi['errores'] } = {};
  try {
    cuerpo = await respuesta.json();
  } catch {
    // respuesta sin JSON (un proxy caído, por ejemplo)
  }
  return new ErrorApi(
    cuerpo.codigo ?? 'ERROR',
    cuerpo.mensaje ?? 'El servidor no pudo atender la solicitud. Vuelva a intentarlo.',
    respuesta.status,
    cuerpo.errores ?? [],
  );
}

/**
 * Renueva la sesión con la cookie. Una sola a la vez: si varias solicitudes fallan juntas, todas
 * esperan la misma. Devuelve null si ya no hay sesión. Otra pestaña pudo renovar un instante antes
 * (el token viejo vale 30 segundos más): por eso un 401 se reintenta una vez.
 */
export function renovarSesion(): Promise<RespuestaSesion | null> {
  renovacionEnCurso ??= (async () => {
    try {
      for (let intento = 0; intento < 2; intento++) {
        const respuesta = await enviar('POST', '/auth/refresh', { publica: true });
        if (respuesta.ok) {
          const sesion = (await respuesta.json()) as RespuestaSesion;
          tokenAcceso = sesion.access_token;
          alRenovarSesion(sesion);
          return sesion;
        }
        if (respuesta.status !== 401) throw await comoError(respuesta);
        if (intento === 0) await espera(400);
      }
      tokenAcceso = null;
      return null;
    } finally {
      renovacionEnCurso = null;
    }
  })();
  return renovacionEnCurso;
}

/** Hace una solicitud a la API y devuelve su respuesta ya leída (`undefined` si no trae cuerpo). */
export async function api<T>(metodo: Metodo, ruta: string, opciones: Opciones = {}): Promise<T> {
  let respuesta = await enviar(metodo, ruta, opciones);
  if (respuesta.status === 401 && !opciones.publica) {
    // El token de acceso venció (dura 15 minutos): se renueva y se repite la solicitud una vez
    const sesion = await renovarSesion();
    if (!sesion) {
      alTerminarSesion();
      throw new ErrorApi('SESION_NO_VALIDA', 'Su sesión terminó. Inicie sesión de nuevo.', 401);
    }
    respuesta = await enviar(metodo, ruta, opciones);
  }
  if (!respuesta.ok) throw await comoError(respuesta);
  if (respuesta.status === 204) return undefined as T;
  return (await respuesta.json()) as T;
}
