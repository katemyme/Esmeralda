import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ponerToken } from '../api/cliente';
import { App } from '../App';
import { TABLET, respuestaDeSesion, sesionDeVendedora } from '../pruebas/datos';
import { ProveedorSesion } from '../sesion/sesion';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }),
}));

// La caja de punta a punta en la tablet, con la API simulada: abrir, y el cierre a ciegas con su
// único reconteo. Lo que más importa: en pantalla nunca aparece lo esperado ni la diferencia.

const servidor = setupServer();
const enviados: { ruta: string; cuerpo: unknown }[] = [];
let turnoAbierto = false;
let intentos = 0;

const TURNO = {
  id: 9,
  sucursal: TABLET.sucursal,
  caja: { id: 1, nombre: 'Caja 1' },
  abierto_por: { id: 3, nombre_completo: 'Ana Martínez' },
  fecha_apertura: '2026-10-08T14:05:00.000Z',
};

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: 'error' });
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
  enviados.length = 0;
  turnoAbierto = false;
  intentos = 0;
  ponerToken(null);
  window.history.pushState({}, '', '/');
});

afterAll(() => servidor.close());

function preparar() {
  const anotar = async (request: Request) => {
    const cuerpo: unknown = await request.json();
    enviados.push({ ruta: new URL(request.url).pathname, cuerpo });
    return cuerpo;
  };
  servidor.use(
    http.post('*/api/auth/refresh', () =>
      HttpResponse.json(respuestaDeSesion(sesionDeVendedora('tablet'))),
    ),
    http.get('*/api/alertas/sucursal', () =>
      HttpResponse.json({ alertas: [], total_pendientes: 0 }),
    ),
    http.get('*/api/tipo-cambio', () =>
      HttpResponse.json({
        tipo_cambio: { fecha: '2026-10-07', usd_a_nio: '36.6243', es_de_hoy: false },
      }),
    ),
    http.get('*/api/caja/turno', () =>
      HttpResponse.json({
        turno: turnoAbierto ? { ...TURNO, cierre_pide_justificacion: intentos > 0 } : null,
      }),
    ),
    http.post('*/api/caja/turno/abrir', async ({ request }) => {
      await anotar(request);
      turnoAbierto = true;
      return HttpResponse.json(
        { turno: { ...TURNO, cierre_pide_justificacion: false } },
        { status: 201 },
      );
    }),
    http.get('*/api/denominaciones', () =>
      HttpResponse.json({
        denominaciones: [
          { moneda: 'NIO', valor: '100.00', tipo: 'BILLETE' },
          { moneda: 'NIO', valor: '500.00', tipo: 'BILLETE' },
          { moneda: 'NIO', valor: '5.00', tipo: 'MONEDA' },
          { moneda: 'USD', valor: '20.00', tipo: 'BILLETE' },
        ],
      }),
    ),
    http.get('*/api/metodos-pago', () =>
      HttpResponse.json({
        metodos_pago: [
          { codigo: 'EFECTIVO', nombre: 'Efectivo', es_efectivo: true, requiere_referencia: false },
          { codigo: 'TARJETA', nombre: 'Tarjeta', es_efectivo: false, requiere_referencia: true },
        ],
      }),
    ),
    http.post('*/api/caja/turno/cerrar', async ({ request }) => {
      const cuerpo = (await anotar(request)) as { justificacion?: string };
      intentos += 1;
      if (intentos === 1) {
        // La API tampoco dice cuánto falta: solo que no cuadra
        return HttpResponse.json(
          {
            codigo: 'CONTEO_NO_CUADRA',
            mensaje: 'El conteo no cuadra con lo registrado en el turno.',
          },
          { status: 422 },
        );
      }
      if (!cuerpo.justificacion)
        return HttpResponse.json({ codigo: 'REGLA_NEGOCIO' }, { status: 422 });
      turnoAbierto = false;
      return HttpResponse.json({
        ticket: {
          turno_id: 9,
          sucursal: 'Multicentro Las Américas',
          caja: 'Caja 1',
          abierto_por: 'Ana Martínez',
          apertura: TURNO.fecha_apertura,
          cerrado_por: 'Ana Martínez',
          cierre: '2026-10-09T01:30:00.000Z',
          cierre_forzado: false,
          contado: [{ metodo: 'Efectivo', moneda: 'NIO', monto: '1100.00' }],
          retiro_nio: '600.00',
          retiro_usd: '0.00',
          fondo_siguiente_nio: '500.00',
          fondo_siguiente_usd: '0.00',
        },
      });
    }),
  );
}

async function abrirLaPantallaDeCaja() {
  preparar();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ProveedorSesion>
        <App />
      </ProveedorSesion>
    </QueryClientProvider>,
  );
  const usuario = userEvent.setup();
  const menu = within((await screen.findAllByRole('navigation', { name: 'Menú' }))[0]);
  await usuario.click(menu.getByRole('link', { name: 'Caja' }));
  return usuario;
}

describe('caja', () => {
  it('se abre declarando lo contado, sin ver ningún fondo esperado, y avisa del tipo de cambio en ámbar', async () => {
    const usuario = await abrirLaPantallaDeCaja();
    expect(await screen.findByRole('heading', { name: 'Abrir la caja' })).toBeInTheDocument();
    // sin el tipo de cambio de hoy: aviso, y la vendedora no lo puede registrar
    expect(screen.getByText(/Todavía no se registra el tipo de cambio de hoy/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Guardar tipo de cambio' }),
    ).not.toBeInTheDocument();

    await usuario.type(screen.getByLabelText('Efectivo en córdobas (C$)'), '500');
    await usuario.click(screen.getByRole('button', { name: 'Abrir turno' }));
    expect(await screen.findByText('Turno abierto')).toBeInTheDocument();
    expect(enviados).toEqual([
      { ruta: '/api/caja/turno/abrir', cuerpo: { inicial_nio: '500', inicial_usd: '0' } },
    ]);
    // la vendedora no registra movimientos de efectivo (no tiene ese permiso)
    expect(screen.queryByText('Entradas y salidas de efectivo')).not.toBeInTheDocument();
  });

  it('cierre a ciegas: si no cuadra queda un solo reconteo con justificación, y nunca se ve lo esperado', async () => {
    turnoAbierto = true;
    const usuario = await abrirLaPantallaDeCaja();
    await usuario.click(await screen.findByRole('button', { name: 'Cerrar la caja' }));
    expect(await screen.findByRole('heading', { name: 'Cerrar la caja' })).toBeInTheDocument();

    // Cuenta dos billetes de 500 y uno de 100: la pantalla solo suma lo que ella cuenta
    await usuario.click(screen.getByRole('button', { name: 'Agregar uno de C$ 500' }));
    await usuario.click(screen.getByRole('button', { name: 'Agregar uno de C$ 500' }));
    await usuario.type(screen.getByLabelText('Cantidad de C$ 100'), '1');
    expect(screen.getByText('C$ 1,100.00')).toBeInTheDocument();
    await usuario.type(screen.getByLabelText('Se retira en córdobas (C$)'), '600');

    await usuario.click(screen.getByRole('button', { name: 'Cerrar la caja' }));
    await usuario.click(await screen.findByRole('button', { name: 'Sí, cerrar' }));

    // Primer intento: no cuadra. No dice cuánto; pide contar otra vez y justificar
    expect(
      await screen.findByText('El conteo no cuadra con lo registrado en el turno.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Queda un solo reconteo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar la caja' })).toBeDisabled(); // falta la justificación
    await usuario.type(screen.getByLabelText(/Justificación/), 'Se pagó el agua sin anotarlo');
    await usuario.click(screen.getByRole('button', { name: 'Cerrar la caja' }));
    await usuario.click(await screen.findByRole('button', { name: 'Sí, cerrar' }));

    expect(await screen.findByText(/La caja quedó cerrada/)).toBeInTheDocument();
    expect(screen.getByText('Fondo para mañana C$')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Imprimir el cierre/ })).toBeInTheDocument();
    // El arqueo es a ciegas: ni lo esperado, ni la diferencia, ni lo vendido
    expect(document.body).not.toHaveTextContent(/esperad|diferencia|faltan|sobran|vendido/i);

    expect(enviados.map((e) => e.ruta)).toEqual([
      '/api/caja/turno/cerrar',
      '/api/caja/turno/cerrar',
    ]);
    expect(enviados[1].cuerpo).toEqual({
      efectivo: [
        { moneda: 'NIO', valor: '100.00', cantidad: 1 },
        { moneda: 'NIO', valor: '500.00', cantidad: 2 },
      ],
      no_efectivo: [{ metodo: 'TARJETA', monto: '0' }],
      retiro_nio: '600',
      retiro_usd: '0',
      justificacion: 'Se pagó el agua sin anotarlo',
    });
  });
});
