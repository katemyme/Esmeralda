import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi, alCambiarSesion, api, mensajeDeError, ponerToken } from './cliente';

type Solicitud = { url: string; metodo: string; autorizacion: string | null; cuerpo: unknown };

function respuesta(estado: number, cuerpo?: unknown): Response {
  return new Response(cuerpo === undefined ? null : JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('cliente de la API', () => {
  const solicitudes: Solicitud[] = [];
  const renovada = vi.fn();
  const terminada = vi.fn();
  let responder: (s: Solicitud) => Response | Promise<Response>;

  beforeEach(() => {
    solicitudes.length = 0;
    renovada.mockReset();
    terminada.mockReset();
    ponerToken('token-viejo');
    alCambiarSesion({ renovada, terminada });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, opciones: RequestInit) => {
        const solicitud: Solicitud = {
          url,
          metodo: opciones.method ?? 'GET',
          autorizacion: (opciones.headers as Record<string, string>).Authorization ?? null,
          cuerpo: opciones.body ? JSON.parse(opciones.body as string) : undefined,
        };
        solicitudes.push(solicitud);
        return responder(solicitud);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('envía el token y el cuerpo en JSON, y entrega la respuesta ya leída', async () => {
    responder = () => respuesta(200, { alerta: { id: 7 } });
    const datos = await api<{ alerta: { id: number } }>('POST', '/alertas/7/atender', {
      cuerpo: { nota: 'vista' },
    });
    expect(datos).toEqual({ alerta: { id: 7 } });
    expect(solicitudes).toEqual([
      {
        url: '/api/alertas/7/atender',
        metodo: 'POST',
        autorizacion: 'Bearer token-viejo',
        cuerpo: { nota: 'vista' },
      },
    ]);
  });

  it('una respuesta sin cuerpo (204) no falla', async () => {
    responder = () => respuesta(204);
    await expect(api<void>('PUT', '/auth/pin', { cuerpo: {} })).resolves.toBeUndefined();
  });

  it('un error de la API llega con su código, su mensaje en español y los errores por campo', async () => {
    responder = () =>
      respuesta(400, {
        codigo: 'DATOS_INVALIDOS',
        mensaje: 'Revise los datos enviados',
        errores: [{ campo: 'pin', mensaje: 'El PIN debe tener exactamente 4 dígitos' }],
      });
    const error = await api('PUT', '/auth/pin', { cuerpo: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorApi);
    expect(error).toMatchObject({
      codigo: 'DATOS_INVALIDOS',
      estado: 400,
      message: 'Revise los datos enviados',
      errores: [{ campo: 'pin', mensaje: 'El PIN debe tener exactamente 4 dígitos' }],
    });
    expect(mensajeDeError(error)).toBe('Revise los datos enviados');
  });

  it('sin conexión: un error propio, con un mensaje que se puede mostrar', async () => {
    responder = () => {
      throw new TypeError('Failed to fetch');
    };
    const error = await api('GET', '/alertas').catch((e: unknown) => e);
    expect(error).toMatchObject({ codigo: 'SIN_CONEXION', estado: 0 });
    expect(mensajeDeError(error)).toMatch(/No hay conexión con el servidor/);
  });

  it('cuando el token venció lo renueva una sola vez, aunque fallen varias solicitudes juntas, y las repite', async () => {
    responder = (s) => {
      if (s.url === '/api/auth/refresh') return respuesta(200, { access_token: 'token-nuevo' });
      return s.autorizacion === 'Bearer token-nuevo'
        ? respuesta(200, { ruta: s.url })
        : respuesta(401, { codigo: 'TOKEN_VENCIDO', mensaje: 'El token venció' });
    };
    const [a, b] = await Promise.all([
      api<{ ruta: string }>('GET', '/alertas'),
      api<{ ruta: string }>('GET', '/tipo-cambio'),
    ]);
    expect([a.ruta, b.ruta]).toEqual(['/api/alertas', '/api/tipo-cambio']);
    expect(solicitudes.filter((s) => s.url === '/api/auth/refresh')).toHaveLength(1);
    expect(solicitudes.find((s) => s.url === '/api/auth/refresh')?.autorizacion).toBeNull();
    expect(renovada).toHaveBeenCalledTimes(1);
    expect(renovada).toHaveBeenCalledWith({ access_token: 'token-nuevo' });
    expect(terminada).not.toHaveBeenCalled();
  });

  it('si la sesión ya no se puede renovar, avisa que terminó (después de reintentar una vez)', async () => {
    responder = () => respuesta(401, { codigo: 'SESION_NO_VALIDA', mensaje: 'Su sesión terminó.' });
    const error = await api('GET', '/alertas').catch((e: unknown) => e);
    expect(error).toMatchObject({ codigo: 'SESION_NO_VALIDA', estado: 401 });
    // otra pestaña pudo renovar un instante antes: el refresh se intenta dos veces
    expect(solicitudes.filter((s) => s.url === '/api/auth/refresh')).toHaveLength(2);
    expect(terminada).toHaveBeenCalledTimes(1);
    expect(renovada).not.toHaveBeenCalled();
  });

  it('en las rutas públicas (login, PIN) un 401 es la respuesta, no un token vencido', async () => {
    responder = () =>
      respuesta(401, {
        codigo: 'PIN_INCORRECTO',
        mensaje: 'PIN incorrecto. Le quedan 4 intentos.',
      });
    const error = await api('POST', '/auth/pin', {
      cuerpo: { usuario_id: 3, pin: '0000' },
      publica: true,
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ codigo: 'PIN_INCORRECTO', estado: 401 });
    expect(solicitudes).toHaveLength(1);
    expect(solicitudes[0].autorizacion).toBeNull(); // sin token, aunque haya uno guardado
  });
});
