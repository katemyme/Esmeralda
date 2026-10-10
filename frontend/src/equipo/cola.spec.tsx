import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ponerToken } from '../api/cliente';
import type { TicketEnCola } from '../api/tipos';
import { App } from '../App';
import { TABLET, TABLET_ABIERTA, respuestaDeSesion, sesionDeVendedora } from '../pruebas/datos';
import { ProveedorSesion } from '../sesion/sesion';
import { imprimirConDialogo } from './imprimir';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }),
}));
vi.mock('./imprimir', async (original) => ({
  ...(await original<typeof import('./imprimir')>()),
  imprimirConDialogo: vi.fn(() => Promise.resolve()),
}));

// La cola de impresión en el equipo de la sucursal: los tickets de las ventas hechas desde un
// celular. Se imprimen con un toque o solos, también con la pantalla bloqueada, y un ticket nunca
// sale dos veces ni como copia.

const servidor = setupServer();
/** Lo que el equipo le pide a la API, con su cabecera de sesión (la cola no la lleva). */
const pedidas: { ruta: string; conSesion: boolean }[] = [];
let enCola: TicketEnCola[] = [];
let automatica = false;
let conSesion = true;

const TICKET: TicketEnCola = {
  id: 31,
  venta_id: 12,
  numero: 'LAM-00000012',
  fecha: '2026-10-09T21:42:00.000Z',
  vendedor: 'Carlos Ruiz',
  en_curso: false,
};

const veces = (ruta: string) => pedidas.filter((p) => p.ruta === ruta).length;

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: 'error' });
  servidor.events.on('request:start', ({ request }) => {
    pedidas.push({
      ruta: `${request.method} ${new URL(request.url).pathname}`,
      conSesion: request.headers.has('authorization'),
    });
  });
  const conSimulacion = globalThis.fetch;
  globalThis.fetch = (entrada, opciones) =>
    conSimulacion(
      typeof entrada === 'string' && entrada.startsWith('/')
        ? `http://localhost${entrada}`
        : entrada,
      opciones,
    );
});

afterEach(() => {
  servidor.resetHandlers();
  pedidas.length = 0;
  enCola = [];
  automatica = false;
  conSesion = true;
  vi.mocked(imprimirConDialogo).mockReset().mockResolvedValue(undefined);
  ponerToken(null);
  window.history.pushState({}, '', '/');
});

afterAll(() => servidor.close());

function montar() {
  servidor.use(
    http.post('*/api/auth/refresh', () =>
      conSesion
        ? HttpResponse.json(respuestaDeSesion(sesionDeVendedora('tablet')))
        : HttpResponse.json({ codigo: 'SESION_NO_VALIDA', mensaje: 'Sin sesión' }, { status: 401 }),
    ),
    http.get('*/api/auth/pin/usuarios', () => HttpResponse.json(TABLET_ABIERTA)),
    http.get('*/api/alertas/sucursal', () =>
      HttpResponse.json({ alertas: [], total_pendientes: 0 }),
    ),
    http.get('*/api/tipo-cambio', () => HttpResponse.json({ tipo_cambio: null })),
    http.get('*/api/caja/turno', () =>
      HttpResponse.json({
        turno: {
          id: 9,
          sucursal: TABLET.sucursal,
          caja: { id: 1, nombre: 'Caja 1' },
          abierto_por: { id: 3, nombre_completo: 'Ana Martínez' },
          fecha_apertura: '2026-10-09T14:05:00.000Z',
          cierre_pide_justificacion: false,
        },
      }),
    ),
    http.get('*/api/cola-impresion', () =>
      HttpResponse.json({ atendida: true, automatica, tickets: enCola }),
    ),
    http.post('*/api/cola-impresion/31/ticket', () =>
      HttpResponse.arrayBuffer(new TextEncoder().encode('%PDF-ticket').buffer, {
        headers: { 'Content-Type': 'application/pdf', 'X-Ticket-Impresion': '1' },
      }),
    ),
    http.post('*/api/cola-impresion/31/impreso', () => {
      enCola = [];
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('*/api/cola-impresion/31/no-imprimir', () => {
      enCola = [];
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const consultas = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={consultas}>
      <ProveedorSesion>
        <App />
      </ProveedorSesion>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

describe('tickets por imprimir, con alguien en el equipo', () => {
  it('la barra avisa de que hay un ticket; se imprime con un toque y sale de la lista', async () => {
    enCola = [TICKET];
    const usuario = montar();
    await usuario.click(await screen.findByRole('link', { name: /1 ticket por imprimir/ }));

    expect(await screen.findByRole('heading', { name: 'Tickets por imprimir' })).toBeVisible();
    expect(screen.getByText('LAM-00000012')).toBeInTheDocument();
    expect(screen.getByText(/vendió Carlos Ruiz/)).toBeInTheDocument();
    expect(screen.getByText(/Toque «Imprimir» para sacar cada uno/)).toBeInTheDocument();
    expect(imprimirConDialogo).not.toHaveBeenCalled(); // nada sale solo

    await usuario.click(screen.getByRole('button', { name: 'Imprimir' }));
    expect(await screen.findByText('No hay ningún ticket esperando.')).toBeInTheDocument();
    expect(imprimirConDialogo).toHaveBeenCalledTimes(1);
    expect(veces('POST /api/cola-impresion/31/ticket')).toBe(1);
    expect(veces('POST /api/cola-impresion/31/impreso')).toBe(1);
    expect(screen.queryByRole('link', { name: /por imprimir/ })).not.toBeInTheDocument();
  });

  it('si la impresora falla, reintentar manda el mismo ticket: no se le pide otro a la API', async () => {
    enCola = [TICKET];
    vi.mocked(imprimirConDialogo).mockRejectedValueOnce(new Error('La impresora no responde.'));
    const usuario = montar();
    await usuario.click(await screen.findByRole('link', { name: /1 ticket por imprimir/ }));
    await usuario.click(await screen.findByRole('button', { name: 'Imprimir' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo imprimir. La impresora no responde.',
    );
    expect(veces('POST /api/cola-impresion/31/impreso')).toBe(0); // sigue en la cola
    expect(screen.getByRole('link', { name: /revise la impresora/ })).toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('No hay ningún ticket esperando.')).toBeInTheDocument();
    expect(imprimirConDialogo).toHaveBeenCalledTimes(2);
    expect(veces('POST /api/cola-impresion/31/ticket')).toBe(1);
    expect(veces('POST /api/cola-impresion/31/impreso')).toBe(1);
  });

  it('si el papel salió y lo que falló fue avisarlo, el reintento solo avisa: no sale otra vez', async () => {
    enCola = [TICKET];
    const usuario = montar();
    servidor.use(
      http.post('*/api/cola-impresion/31/impreso', () => HttpResponse.error(), { once: true }),
    );
    await usuario.click(await screen.findByRole('link', { name: /1 ticket por imprimir/ }));
    await usuario.click(await screen.findByRole('button', { name: 'Imprimir' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/No hay conexión/);

    await usuario.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('No hay ningún ticket esperando.')).toBeInTheDocument();
    expect(imprimirConDialogo).toHaveBeenCalledTimes(1);
    expect(veces('POST /api/cola-impresion/31/impreso')).toBe(2);
  });

  it('«No imprimir» pide confirmación y se hace con la sesión de quien lo decide', async () => {
    enCola = [TICKET];
    const usuario = montar();
    await usuario.click(await screen.findByRole('link', { name: /1 ticket por imprimir/ }));
    await usuario.click(await screen.findByRole('button', { name: 'No imprimir' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/queda anotado quién lo decidió/);
    await usuario.click(screen.getByRole('button', { name: 'No imprimirlo' }));

    expect(await screen.findByText('No hay ningún ticket esperando.')).toBeInTheDocument();
    expect(imprimirConDialogo).not.toHaveBeenCalled();
    expect(pedidas.find((p) => p.ruta === 'POST /api/cola-impresion/31/no-imprimir')).toEqual({
      ruta: 'POST /api/cola-impresion/31/no-imprimir',
      conSesion: true,
    });
  });

  it('un ticket que otro equipo está imprimiendo no se puede pedir aquí', async () => {
    enCola = [{ ...TICKET, en_curso: true }];
    const usuario = montar();
    await usuario.click(await screen.findByRole('link', { name: /1 ticket por imprimir/ }));
    expect(await screen.findByText('Imprimiéndose en otro equipo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeDisabled();
  });
});

describe('la cola automática', () => {
  it('imprime sola en cuanto llega el ticket, una sola vez', async () => {
    enCola = [TICKET];
    automatica = true;
    montar();
    await screen.findByRole('heading', { name: 'Hola, Ana' });
    await waitFor(() => expect(veces('POST /api/cola-impresion/31/impreso')).toBe(1));
    expect(imprimirConDialogo).toHaveBeenCalledTimes(1);
    expect(veces('POST /api/cola-impresion/31/ticket')).toBe(1);
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /por imprimir/ })).not.toBeInTheDocument(),
    );
  });

  it('sigue con la pantalla bloqueada: sin sesión, solo con la cookie del equipo', async () => {
    enCola = [TICKET];
    automatica = true;
    conSesion = false;
    montar();
    expect(await screen.findByText('¿Quién va a usar el equipo?')).toBeInTheDocument();
    await waitFor(() => expect(veces('POST /api/cola-impresion/31/impreso')).toBe(1));
    expect(imprimirConDialogo).toHaveBeenCalledTimes(1);
    // nada de lo que hace la cola lleva la sesión de nadie
    const deLaCola = pedidas.filter((p) => p.ruta.includes('/cola-impresion'));
    expect(deLaCola.length).toBeGreaterThanOrEqual(3);
    expect(deLaCola.every((p) => !p.conSesion)).toBe(true);
  });

  it('si falla no insiste sola: lo dice en la pantalla de PIN hasta que alguien entre', async () => {
    enCola = [TICKET];
    automatica = true;
    conSesion = false;
    vi.mocked(imprimirConDialogo).mockRejectedValue(new Error('La impresora no responde.'));
    montar();
    expect(
      await screen.findByText(/1 ticket por imprimir\. No se pudo imprimir: entre y revise/),
    ).toBeInTheDocument();
    expect(imprimirConDialogo).toHaveBeenCalledTimes(1);
    expect(veces('POST /api/cola-impresion/31/impreso')).toBe(0);
  });
});

describe('sin la cola automática, con la pantalla bloqueada', () => {
  it('avisa de que hay tickets esperando y no imprime nada', async () => {
    enCola = [TICKET, { ...TICKET, id: 32, numero: 'LAM-00000013' }];
    conSesion = false;
    montar();
    expect(
      await screen.findByText(/2 tickets por imprimir\. Entre para imprimirlos\./),
    ).toBeInTheDocument();
    expect(imprimirConDialogo).not.toHaveBeenCalled();
  });
});
