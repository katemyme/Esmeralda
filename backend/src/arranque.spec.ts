import { createServer, type AddressInfo, type Server } from 'node:net';
import { ErrorDeArranque, explicarErrorAlEscuchar, levantarApi } from './arranque';

/** Abre un servidor TCP en un puerto libre cualquiera, para simular "otro programa lo está usando". */
function ocuparPuerto(): Promise<{ servidor: Server; puerto: number }> {
  return new Promise((resolve, reject) => {
    const servidor = createServer();
    servidor.once('error', reject);
    servidor.listen(0, () =>
      resolve({ servidor, puerto: (servidor.address() as AddressInfo).port }),
    );
  });
}

describe('levantarApi', () => {
  it('con el puerto ocupado → ErrorDeArranque con un mensaje claro en español', async () => {
    const { servidor, puerto } = await ocuparPuerto();
    try {
      const error = await levantarApi(puerto, { logger: false }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ErrorDeArranque);
      expect((error as Error).message).toBe(
        `El puerto ${puerto} ya está en uso: cierre el otro servidor ` +
          '(¿quedó abierto en otra terminal?) o cambie PORT en backend/.env',
      );
      expect(((error as Error).cause as { code?: string }).code).toBe('EADDRINUSE');
    } finally {
      servidor.close();
    }
  });

  it('con un puerto libre escucha de verdad y responde /api/salud', async () => {
    const app = await levantarApi(0, { logger: false });
    try {
      const { port } = app.getHttpServer().address() as AddressInfo;
      const respuesta = await fetch(`http://localhost:${port}/api/salud`);
      expect(respuesta.status).toBe(200);
      expect(await respuesta.json()).toEqual({ estado: 'ok', baseDatos: 'ok' });
    } finally {
      await app.close();
    }
  });
});

describe('explicarErrorAlEscuchar', () => {
  it('puerto sin permiso (EACCES)', () => {
    expect(explicarErrorAlEscuchar({ code: 'EACCES' }, 80)).toBe(
      'Sin permiso para usar el puerto 80 (puede estar reservado por el sistema): ' +
        'cambie PORT en backend/.env',
    );
  });

  it('otros errores no se disfrazan', () => {
    expect(explicarErrorAlEscuchar(new Error('otra cosa'), 3000)).toBeNull();
    expect(explicarErrorAlEscuchar(null, 3000)).toBeNull();
  });
});
