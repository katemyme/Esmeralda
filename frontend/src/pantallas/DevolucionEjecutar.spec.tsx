import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ponerToken } from '../api/cliente';
import type {
  DatosSesion,
  DevolucionDetalle,
  DevolucionResumen,
  VarianteEncontrada,
} from '../api/tipos';
import { App } from '../App';
import { imprimirConDialogo } from '../equipo/imprimir';
import { TABLET, respuestaDeSesion, sesionDeAdmin, sesionDeVendedora } from '../pruebas/datos';
import { solicitud } from '../pruebas/devoluciones';
import { ProveedorSesion } from '../sesion/sesion';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }),
}));
vi.mock('../equipo/imprimir', async (original) => ({
  ...(await original<typeof import('../equipo/imprimir')>()),
  imprimirConDialogo: vi.fn(() => Promise.resolve()),
}));

// Devoluciones, parte 2, con la API simulada: ejecutar en caja una devolución o un cambio ya
// aprobado, los tickets y la lista de transferencias del administrador. El reparto entre efectivo
// y transferencia lo da la API; la pantalla nunca suma montos de varias devoluciones.

const servidor = setupServer();
const pedidas: string[] = [];
const enviados: { ruta: string; cuerpo: unknown }[] = [];
let guardada: DevolucionDetalle = solicitud();
let turnoAbierto = true;
let porTransferir: DevolucionResumen[] = [];

const TURNO = {
  id: 9,
  sucursal: TABLET.sucursal,
  caja: { id: 1, nombre: 'Caja 1' },
  abierto_por: { id: 3, nombre_completo: 'Ana Martínez' },
  fecha_apertura: '2026-10-15T14:05:00.000Z',
  cierre_pide_justificacion: false,
};

const variante = (datos: Partial<VarianteEncontrada>): VarianteEncontrada => ({
  id: 0,
  sku: '',
  codigo_barras: null,
  producto: '',
  variante: 'Única',
  categoria: 'Joyería',
  tipo: 'PRODUCTO',
  precio: null,
  stock: null,
  gama: null,
  ...datos,
});

const CATALOGO: VarianteEncontrada[] = [
  variante({
    id: 7,
    sku: 'JOY-ARE',
    producto: 'Aretes',
    variante: 'Perla',
    precio: '230.00',
    stock: 4,
  }),
  variante({
    id: 8,
    sku: 'JOY-PUL',
    producto: 'Pulsera',
    variante: 'Plata',
    precio: '650.00',
    stock: 2,
  }),
];

const APROBADA = {
  estado: 'APROBADA',
  vence_el: '2026-10-18',
  resolucion: {
    fecha: '2026-10-15T15:00:00.000Z',
    resuelta_por: { id: 1, nombre_completo: 'Víctor Alcocer' },
    comentario: null,
  },
} as const;

/** La solicitud n.º 12 ya ejecutada, con lo que de verdad se entregó. */
function ejecutada(
  reembolso: { saldo: string; efectivo: string; transferencia: string },
  ventaCambio: DevolucionDetalle['venta_cambio'] = null,
): DevolucionDetalle {
  return {
    ...guardada,
    estado: 'EJECUTADA',
    numero: 'DEV-LAM-000001',
    sucursal: TABLET.sucursal,
    ejecutada_at: '2026-10-15T16:00:00.000Z',
    monto_transferencia: reembolso.transferencia,
    por_transferir: Number(reembolso.transferencia) > 0,
    reembolso: { ...reembolso, definitivo: true },
    venta_cambio: ventaCambio,
    lineas: guardada.lineas.map((l) => ({ ...l, estado_recibido: l.estado_producto })),
  };
}

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: 'error' });
  servidor.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    pedidas.push(`${request.method} ${url.pathname}${url.search}`);
  });
  const conSimulacion = globalThis.fetch;
  globalThis.fetch = (entrada, opciones) =>
    conSimulacion(
      typeof entrada === 'string' && entrada.startsWith('/')
        ? `http://localhost${entrada}`
        : entrada,
      opciones,
    );
  URL.createObjectURL = () => 'blob:ticket-de-prueba';
  URL.revokeObjectURL = () => {};
});

afterEach(() => {
  servidor.resetHandlers();
  pedidas.length = 0;
  enviados.length = 0;
  guardada = solicitud();
  turnoAbierto = true;
  porTransferir = [];
  vi.mocked(imprimirConDialogo).mockClear();
  ponerToken(null);
  window.history.pushState({}, '', '/');
});

afterAll(() => servidor.close());

const pdf = () =>
  HttpResponse.arrayBuffer(new TextEncoder().encode('%PDF-ticket').buffer, {
    headers: { 'Content-Type': 'application/pdf' },
  });

function preparar(sesion: DatosSesion) {
  const anotar = async (request: Request) => {
    const cuerpo: unknown = await request.json();
    enviados.push({ ruta: new URL(request.url).pathname, cuerpo });
    return cuerpo as Record<string, unknown>;
  };
  servidor.use(
    http.post('*/api/auth/refresh', () => HttpResponse.json(respuestaDeSesion(sesion))),
    http.get('*/api/alertas', () => HttpResponse.json({ alertas: [], total_pendientes: 0 })),
    http.get('*/api/alertas/sucursal', () =>
      HttpResponse.json({ alertas: [], total_pendientes: 0 }),
    ),
    http.get('*/api/tipo-cambio', () =>
      HttpResponse.json({
        tipo_cambio: { fecha: '2026-10-01', usd_a_nio: '36.5000', registrado_por: null },
      }),
    ),
    http.get('*/api/cola-impresion', () =>
      HttpResponse.json({ atendida: true, automatica: false, tickets: [] }),
    ),
    http.get('*/api/caja/turno', () => HttpResponse.json({ turno: turnoAbierto ? TURNO : null })),
    http.get('*/api/perforaciones', () => HttpResponse.json({ perforaciones: [] })),
    http.get('*/api/metodos-pago', () =>
      HttpResponse.json({
        metodos_pago: [
          { codigo: 'EFECTIVO', nombre: 'Efectivo', es_efectivo: true, requiere_referencia: false },
          { codigo: 'TARJETA', nombre: 'Tarjeta', es_efectivo: false, requiere_referencia: true },
        ],
      }),
    ),
    http.get('*/api/variantes/buscar', ({ request }) => {
      const texto = (new URL(request.url).searchParams.get('texto') ?? '').toLowerCase();
      return HttpResponse.json({
        variantes: CATALOGO.filter((v) =>
          `${v.producto} ${v.variante} ${v.sku}`.toLowerCase().includes(texto),
        ),
      });
    }),
    http.get('*/api/devoluciones', ({ request }) =>
      HttpResponse.json({
        devoluciones:
          new URL(request.url).searchParams.get('por_transferir') === 'true' ? porTransferir : [],
      }),
    ),
    http.get('*/api/devoluciones/12', () => HttpResponse.json({ devolucion: guardada })),
    http.get('*/api/devoluciones/12/reparto', ({ request }) => {
      // lo que diría la base: la factura se pagó 2/3 en efectivo
      const total = Number(new URL(request.url).searchParams.get('total'));
      const sobra = Math.max(Number(guardada.monto_total) - total, 0);
      const efectivo = Math.round((sobra * 200) / 3) / 100;
      return HttpResponse.json({
        reparto: {
          saldo: Math.min(total, Number(guardada.monto_total)).toFixed(2),
          por_cobrar: Math.max(total - Number(guardada.monto_total), 0).toFixed(2),
          efectivo: efectivo.toFixed(2),
          transferencia: (sobra - efectivo).toFixed(2),
        },
      });
    }),
    http.post('*/api/devoluciones/12/ejecutar', async ({ request }) => {
      const cuerpo = await anotar(request);
      if (guardada.tipo === 'DEVOLUCION') {
        guardada = ejecutada({ saldo: '0.00', efectivo: '800.00', transferencia: '400.00' });
      } else {
        const nuevo = Number(cuerpo.items && (cuerpo.items as unknown[]).length ? 230 : 0);
        guardada =
          Number(guardada.monto_total) > nuevo
            ? ejecutada(
                { saldo: '230.00', efectivo: '646.67', transferencia: '323.33' },
                {
                  id: 40,
                  numero: 'LAM-00000040',
                  total: '230.00',
                },
              )
            : guardada;
      }
      return HttpResponse.json({ devolucion: guardada, repetida: false });
    }),
    http.post('*/api/devoluciones/12/imprimir', pdf),
    http.post('*/api/ventas/40/imprimir', pdf),
    http.get('*/api/ventas/40', () =>
      HttpResponse.json({
        venta: { id: 40, numero: 'LAM-00000040', total: '230.00', vuelto: '0.00' },
      }),
    ),
    http.post('*/api/devoluciones/12/transferencia', async ({ request }) => {
      const { referencia } = await anotar(request);
      porTransferir = [];
      return HttpResponse.json({
        devolucion: {
          ...guardada,
          numero: 'DEV-LAM-000001',
          por_transferir: false,
          transferencia: {
            referencia,
            fecha: '2026-10-15T18:00:00.000Z',
            transferida_por: { id: 1, nombre_completo: 'Víctor Alcocer' },
          },
        },
      });
    }),
  );
}

async function abrir(ruta: string, sesion: DatosSesion) {
  preparar(sesion);
  window.history.pushState({}, '', ruta);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ProveedorSesion>
        <App />
      </ProveedorSesion>
    </QueryClientProvider>,
  );
  await screen.findAllByRole('navigation', { name: 'Menú' });
  return userEvent.setup();
}

const resultado = (nombre: RegExp) =>
  waitFor(() =>
    within(screen.getByRole('list', { name: 'Resultados' })).getByRole('button', { name: nombre }),
  );

describe('ejecutar en caja una devolución aprobada', () => {
  it('dice cuánto entregar en efectivo y cuánto se transfiere; cada línea se recibe en su estado; salen el ticket y la copia', async () => {
    guardada = solicitud(APROBADA);
    const usuario = await abrir('/devoluciones/12', sesionDeVendedora('tablet'));
    await usuario.click(await screen.findByRole('link', { name: 'Ejecutar en caja' }));
    expect(
      await screen.findByRole('heading', { name: 'Ejecutar la devolución n.º 12' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Entra en Multicentro Las Américas · Caja 1')).toBeInTheDocument();
    // lo previsto por la base, de esta devolución (nunca una suma de varias)
    expect(screen.getByText('En efectivo, de la caja').parentElement).toHaveTextContent(
      'C$ 800.00',
    );
    expect(
      screen.getByText('Por transferencia (la hace la administración)').parentElement,
    ).toHaveTextContent('C$ 400.00');

    // la cadena se pidió defectuosa; uno de los perfumes llega defectuoso
    const perfumes = screen.getByRole('group', { name: 'Cómo llega 2 × Perfume — Rosas' });
    expect(within(perfumes).getByRole('button', { name: 'En buen estado' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await usuario.click(within(perfumes).getByRole('button', { name: 'Defectuoso' }));
    expect(screen.getByText('Se pidió en buen estado.')).toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: 'Ejecutar la devolución' }));
    const pregunta = await screen.findByRole('alertdialog', { name: '¿Ejecutar la devolución?' });
    expect(pregunta).toHaveTextContent('Entregue C$ 800.00 en efectivo de la caja.');
    expect(pregunta).toHaveTextContent('C$ 400.00 se le transfieren');
    await usuario.click(within(pregunta).getByRole('button', { name: 'Sí, ejecutarla' }));

    expect(await screen.findByText('Devolución ejecutada')).toBeInTheDocument();
    expect(enviados).toEqual([
      {
        ruta: '/api/devoluciones/12/ejecutar',
        cuerpo: { lineas: [{ id: 2, estado: 'DEFECTUOSO' }] },
      },
    ]);
    expect(screen.getByText('DEV-LAM-000001')).toBeInTheDocument();
    expect(screen.getByText('Entregue en efectivo').parentElement).toHaveTextContent('C$ 800.00');
    // el ticket que firma el cliente sale solo; la copia, con su botón
    await waitFor(() => expect(imprimirConDialogo).toHaveBeenCalledTimes(1));
    await usuario.click(screen.getByRole('button', { name: 'Copia para el cliente' }));
    await waitFor(() => expect(imprimirConDialogo).toHaveBeenCalledTimes(2));
    expect(pedidas.filter((p) => p === 'POST /api/devoluciones/12/imprimir')).toHaveLength(2);
  });

  it('cambio más barato: se arma con el buscador, sin promoción, y la base dice cuánto se le devuelve y cómo', async () => {
    guardada = solicitud({ ...APROBADA, tipo: 'CAMBIO', reembolso: null });
    const usuario = await abrir('/devoluciones/12/ejecutar', sesionDeVendedora('tablet'));
    expect(
      await screen.findByRole('heading', { name: 'Ejecutar el cambio n.º 12' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/En un cambio no se aplican promociones/)).toBeInTheDocument();
    await usuario.type(screen.getByRole('searchbox'), 'aretes');
    await usuario.click(await resultado(/Aretes — Perla/));
    expect(screen.queryByLabelText('Promoción')).not.toBeInTheDocument();
    expect(screen.getByText('Lo devuelto').parentElement).toHaveTextContent('C$ 1,200.00');
    expect(
      screen.getByText('Lo que se lleva', { selector: 'span' }).parentElement,
    ).toHaveTextContent('C$ 230.00');
    // lo que sobra (C$ 970) se reparte como se pagó la factura: lo calcula la base
    expect(await screen.findByText('Lo que se le entrega')).toBeInTheDocument();
    expect(pedidas).toContain('GET /api/devoluciones/12/reparto?total=230.00');
    expect(screen.getByText('En efectivo, de la caja').parentElement).toHaveTextContent(
      'C$ 646.67',
    );

    await usuario.click(screen.getByRole('button', { name: 'Ejecutar el cambio' }));
    const pregunta = await screen.findByRole('alertdialog', { name: '¿Ejecutar el cambio?' });
    expect(pregunta).toHaveTextContent(
      'Se le devuelven C$ 970.00: C$ 646.67 en efectivo de la caja y C$ 323.33 por transferencia.',
    );
    await usuario.click(within(pregunta).getByRole('button', { name: 'Sí, ejecutarlo' }));

    expect(await screen.findByText('Cambio ejecutado')).toBeInTheDocument();
    expect(enviados[0]).toEqual({
      ruta: '/api/devoluciones/12/ejecutar',
      cuerpo: {
        clave_idempotencia: expect.stringMatching(/^[0-9a-f-]{36}$/),
        items: [{ variante_id: 7, cantidad: 1 }],
        pagos: [],
        lineas: [],
      },
    });
    expect(screen.getByText('Factura nueva LAM-00000040')).toBeInTheDocument();
    // primero el ticket del cambio y después la factura nueva, uno detrás del otro
    await waitFor(() => expect(imprimirConDialogo).toHaveBeenCalledTimes(2));
    const tickets = pedidas.filter((p) => p.endsWith('/imprimir'));
    expect(tickets).toEqual(['POST /api/devoluciones/12/imprimir', 'POST /api/ventas/40/imprimir']);
  });

  it('cambio más caro: la diferencia se cobra con el mismo cobro de la venta', async () => {
    guardada = solicitud({
      ...APROBADA,
      tipo: 'CAMBIO',
      reembolso: null,
      monto_total: '600.00',
      lineas: [solicitud().lineas[0]],
    });
    const usuario = await abrir('/devoluciones/12/ejecutar', sesionDeVendedora('tablet'));
    await usuario.type(await screen.findByRole('searchbox'), 'pulsera');
    await usuario.click(await resultado(/Pulsera — Plata/));
    await usuario.click(screen.getByRole('button', { name: 'Cobrar la diferencia C$ 50.00' }));

    expect(
      await screen.findByRole('heading', { name: 'Cobrar la diferencia' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Diferencia a cobrar').parentElement).toHaveTextContent('C$ 50.00');
    // el cliente ya viene de la solicitud
    expect(
      screen.queryByRole('button', { name: 'Anotar el nombre del cliente' }),
    ).not.toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Exacto' }));
    await usuario.click(screen.getByRole('button', { name: 'Ejecutar el cambio' }));
    await waitFor(() => expect(enviados).toHaveLength(1));
    expect(enviados[0].cuerpo).toMatchObject({
      items: [{ variante_id: 8, cantidad: 1 }],
      pagos: [{ metodo: 'EFECTIVO', moneda: 'NIO', monto: '50.00' }],
    });
    // sin lo que sobra no hace falta preguntar a la base cómo repartirlo
    expect(pedidas.some((p) => p.includes('/reparto'))).toBe(false);
  });

  it('con la caja cerrada no se ejecuta; desde el celular solo se ve dónde se hace', async () => {
    guardada = solicitud(APROBADA);
    turnoAbierto = false;
    await abrir('/devoluciones/12/ejecutar', sesionDeVendedora('tablet'));
    expect(await screen.findByText('La caja está cerrada.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a la caja' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Ejecutar la devolución' }),
    ).not.toBeInTheDocument();
  });

  it('desde su celular la vendedora ve la aprobada, pero sin el botón de ejecutar', async () => {
    guardada = solicitud(APROBADA);
    await abrir('/devoluciones/12', sesionDeVendedora('celular'));
    expect(await screen.findByText(/Aprobada por Víctor Alcocer/)).toBeInTheDocument();
    expect(
      screen.getByText(/en el equipo de la sucursal donde esté el cliente/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ejecutar en caja' })).not.toBeInTheDocument();
    expect(pedidas.some((p) => p.startsWith('GET /api/caja'))).toBe(false);
  });
});

describe('transferencias pendientes del administrador', () => {
  it('cada una con el cliente, su teléfono, la factura y el monto; anotada la referencia, sale de la lista', async () => {
    guardada = ejecutada({ saldo: '0.00', efectivo: '800.00', transferencia: '400.00' });
    porTransferir = [guardada];
    const usuario = await abrir('/', sesionDeAdmin());
    const acceso = await screen.findByRole('link', { name: /Transferencias pendientes/ });
    await waitFor(() => expect(acceso).toHaveTextContent('Hay 1 por hacer.'));
    await usuario.click(acceso);

    const lista = await screen.findByRole('list', { name: 'Por transferir' });
    const tarjeta = within(lista).getByRole('listitem');
    expect(tarjeta).toHaveTextContent('Carla Cliente');
    expect(within(tarjeta).getByRole('link', { name: '8888-1234' })).toHaveAttribute(
      'href',
      'tel:88881234',
    );
    expect(tarjeta).toHaveTextContent('Factura LAM-00000012');
    expect(tarjeta).toHaveTextContent('C$ 400.00');

    const anotar = within(tarjeta).getByRole('button', { name: 'Anotar la transferencia' });
    expect(anotar).toBeDisabled();
    await usuario.type(
      within(tarjeta).getByLabelText('Referencia de la transferencia de DEV-LAM-000001'),
      'BAC-778899',
    );
    await usuario.click(anotar);
    expect(
      await screen.findByText('Transferencia de DEV-LAM-000001 anotada (ref. BAC-778899).'),
    ).toBeInTheDocument();
    expect(enviados).toEqual([
      { ruta: '/api/devoluciones/12/transferencia', cuerpo: { referencia: 'BAC-778899' } },
    ]);
    expect(await screen.findByText('No hay transferencias pendientes.')).toBeInTheDocument();
  });
});
