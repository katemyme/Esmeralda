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
let tipoCambio = '36.5000';
let cambiaTipoCambio = false; // solo el administrador lo cambia; los demás lo ven

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
  tipoCambio = '36.5000';
  cambiaTipoCambio = false;
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
    http.post('*/api/auth/refresh', () => {
      const sesion = sesionDeVendedora('tablet');
      const permisos = [
        ...sesion.usuario.permisos,
        ...(cambiaTipoCambio ? ['TIPO_CAMBIO_GESTIONAR'] : []),
      ];
      return HttpResponse.json(
        respuestaDeSesion({ ...sesion, usuario: { ...sesion.usuario, permisos } }),
      );
    }),
    http.get('*/api/alertas/sucursal', () =>
      HttpResponse.json({ alertas: [], total_pendientes: 0 }),
    ),
    http.get('*/api/tipo-cambio', () =>
      HttpResponse.json({
        tipo_cambio: { fecha: '2026-09-30', usd_a_nio: tipoCambio, registrado_por: null },
      }),
    ),
    http.put('*/api/tipo-cambio', async ({ request }) => {
      const cuerpo = (await anotar(request)) as { usd_a_nio: string; confirmar: boolean };
      // como la base: lo que se aleja más de 5 % del vigente pide confirmarlo
      const variacion = Math.abs(Number(cuerpo.usd_a_nio) / Number(tipoCambio) - 1);
      if (variacion > 0.05 && !cuerpo.confirmar) {
        return HttpResponse.json(
          {
            codigo: 'CONFIRMACION_REQUERIDA',
            mensaje: `El tipo de cambio ${cuerpo.usd_a_nio} se aleja más de 5 % del vigente (${tipoCambio}). Si es correcto, confírmelo.`,
          },
          { status: 409 },
        );
      }
      tipoCambio = Number(cuerpo.usd_a_nio).toFixed(4);
      return HttpResponse.json({
        tipo_cambio: { fecha: '2026-10-08', usd_a_nio: tipoCambio, registrado_por: null },
      });
    }),
    http.get('*/api/cola-impresion', () =>
      HttpResponse.json({ atendida: false, automatica: false, tickets: [] }),
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
  it('se abre declarando lo contado, sin ver ningún fondo esperado ni pedir el tipo de cambio', async () => {
    const usuario = await abrirLaPantallaDeCaja();
    expect(await screen.findByRole('heading', { name: 'Abrir la caja' })).toBeInTheDocument();
    // el tipo de cambio vigente se ve; no hay que registrarlo cada día ni hay aviso de que falte
    const tarjeta = (await screen.findByRole('heading', { name: 'Tipo de cambio' })).parentElement!;
    expect(await within(tarjeta).findByText('C$ 36.5000')).toBeInTheDocument();
    expect(tarjeta).toHaveTextContent(/Vigente desde el 30\/09\/2026/);
    expect(screen.queryByText(/[Ff]alta.*tipo de cambio/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrarlo ahora' })).not.toBeInTheDocument();
    // la vendedora (y la encargada) no lo cambian: solo el administrador
    expect(
      screen.queryByRole('button', { name: 'Cambiar el tipo de cambio' }),
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

  it('quien tiene el permiso (el administrador) lo cambia; lo que se aleja más de 5 % lo confirma', async () => {
    cambiaTipoCambio = true;
    const usuario = await abrirLaPantallaDeCaja();
    const campo = await screen.findByLabelText('Nuevo tipo de cambio (córdobas por dólar)');
    await usuario.type(campo, '36.62');
    await usuario.click(screen.getByRole('button', { name: 'Cambiar el tipo de cambio' }));
    expect(await screen.findByText(/rige para las ventas que siguen/)).toBeInTheDocument();
    expect(await screen.findByText('C$ 36.6200')).toBeInTheDocument();

    // un error de dedo (366.2 en vez de 36.62): la base pide confirmarlo y la pantalla pregunta
    await usuario.type(campo, '366.2');
    await usuario.click(screen.getByRole('button', { name: 'Cambiar el tipo de cambio' }));
    const pregunta = await screen.findByRole('alertdialog', { name: '¿Seguro que es ese valor?' });
    expect(pregunta).toHaveTextContent(/se aleja más de 5 % del vigente \(36.6200\)/);
    await usuario.click(within(pregunta).getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByText('C$ 36.6200')).toBeInTheDocument();
    expect(enviados.map((e) => e.cuerpo)).toEqual([
      { usd_a_nio: '36.62', confirmar: false },
      { usd_a_nio: '366.2', confirmar: false },
    ]);
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
