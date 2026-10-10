import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ponerToken } from '../api/cliente';
import type { DatosSesion, VarianteEncontrada, VentaDetalle } from '../api/tipos';
import { App } from '../App';
import { imprimirConDialogo } from '../equipo/imprimir';
import { TABLET, respuestaDeSesion, sesionDeVendedora } from '../pruebas/datos';
import { ProveedorSesion } from '../sesion/sesion';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }),
}));
// El diálogo de imprimir no existe en las pruebas: basta saber que se le mandó el ticket
vi.mock('../equipo/imprimir', async (original) => ({
  ...(await original<typeof import('../equipo/imprimir')>()),
  imprimirConDialogo: vi.fn(() => Promise.resolve()),
}));

// La venta de punta a punta con la API simulada: armar el carrito (también una perforación con su
// pieza), aplicar una promoción, cobrar en varias formas, y qué pasa con el ticket en el equipo de
// la sucursal y en el celular.

const servidor = setupServer();
const pedidas: string[] = [];
const ventasEnviadas: Record<string, unknown>[] = [];
let sesion: DatosSesion;
let turnoAbierto = true;
let fallosDeRed = 0;
let estadoEnCola: string | null = null;

const variante = (datos: Partial<VarianteEncontrada>): VarianteEncontrada => ({
  id: 0,
  sku: '',
  codigo_barras: null,
  producto: '',
  variante: 'Única',
  categoria: 'Piercing',
  tipo: 'PRODUCTO',
  precio: null,
  stock: null,
  gama: null,
  ...datos,
});

const CATALOGO: VarianteEncontrada[] = [
  variante({
    id: 7,
    sku: 'ACE-ARO-16-8',
    producto: 'Aro acero',
    variante: '8 mm',
    precio: '230.00',
    stock: 5,
    gama: 'Acero clásica',
  }),
  variante({
    id: 5,
    sku: 'TIT-LAB-16-6',
    producto: 'Labret titanio',
    variante: '6 mm',
    precio: '650.00',
    stock: 1,
    gama: 'Titanio',
  }),
  variante({
    id: 20,
    sku: 'SRV-LOB',
    producto: 'Perforación Lóbulo',
    tipo: 'SERVICIO',
    precio: '300.00',
  }),
  variante({ id: 21, sku: 'PAQ-LOB', producto: 'Perforación Lóbulo con pieza', tipo: 'PAQUETE' }),
];

const TURNO = {
  id: 9,
  sucursal: TABLET.sucursal,
  caja: { id: 1, nombre: 'Caja 1' },
  abierto_por: { id: 3, nombre_completo: 'Ana Martínez' },
  fecha_apertura: '2026-10-09T14:05:00.000Z',
  cierre_pide_justificacion: false,
};

function ventaHecha(total: string, vuelto: string): VentaDetalle {
  return {
    id: 12,
    numero: 'LAM-00000012',
    fecha: '2026-10-09T21:42:00.000Z',
    estado: 'COMPLETADA',
    sucursal: TABLET.sucursal,
    turno_id: 9,
    vendedor: { id: 3, nombre_completo: 'Ana Martínez' },
    cliente_nombre: null,
    subtotal: total,
    descuento: '0.00',
    total,
    articulos: 1,
    origen: null,
    caja: { id: 1, nombre: 'Caja 1' },
    cliente_telefono: null,
    notas: null,
    tipo_cambio: '36.6243',
    promocion: null,
    lineas: [],
    pagos: [],
    vuelto,
    anulacion: null,
    cambio: null,
    cola: estadoEnCola ? { id: 31, estado: estadoEnCola } : null,
  };
}

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: 'error' });
  servidor.events.on('request:start', ({ request }) => {
    pedidas.push(`${request.method} ${new URL(request.url).pathname}`);
  });
  const conSimulacion = globalThis.fetch;
  globalThis.fetch = (entrada, opciones) =>
    conSimulacion(
      typeof entrada === 'string' && entrada.startsWith('/')
        ? `http://localhost${entrada}`
        : entrada,
      opciones,
    );
  // jsdom no sabe hacer direcciones para un archivo en memoria (el PDF del ticket digital)
  URL.createObjectURL = () => 'blob:ticket-de-prueba';
  URL.revokeObjectURL = () => {};
});

afterEach(() => {
  servidor.resetHandlers();
  pedidas.length = 0;
  ventasEnviadas.length = 0;
  turnoAbierto = true;
  fallosDeRed = 0;
  estadoEnCola = null;
  vi.mocked(imprimirConDialogo).mockClear();
  ponerToken(null);
  window.history.pushState({}, '', '/');
});

afterAll(() => servidor.close());

function preparar(donde: 'tablet' | 'celular') {
  sesion = sesionDeVendedora(donde);
  servidor.use(
    http.post('*/api/auth/refresh', () => HttpResponse.json(respuestaDeSesion(sesion))),
    http.get('*/api/alertas/sucursal', () =>
      HttpResponse.json({ alertas: [], total_pendientes: 0 }),
    ),
    http.get('*/api/tipo-cambio', () =>
      HttpResponse.json({
        tipo_cambio: { fecha: '2026-10-09', usd_a_nio: '36.6243', es_de_hoy: true },
      }),
    ),
    http.get('*/api/caja/turno', () => HttpResponse.json({ turno: turnoAbierto ? TURNO : null })),
    http.get('*/api/caja/abiertas', () =>
      HttpResponse.json({
        cajas: turnoAbierto
          ? [{ turno_id: 9, caja: { id: 1, nombre: 'Caja 1' }, sucursal: TABLET.sucursal }]
          : [],
      }),
    ),
    http.get('*/api/cola-impresion', () =>
      HttpResponse.json({ atendida: donde === 'tablet', automatica: false, tickets: [] }),
    ),
    http.get('*/api/perforaciones', () =>
      HttpResponse.json({
        perforaciones: [
          {
            id: 4,
            codigo: 'LOB',
            nombre: 'Lóbulo',
            piezas_por_paquete: 1,
            activa: true,
            servicio_variante_id: 20,
            paquete_variante_id: 21,
            precio_servicio: '300.00',
          },
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
    http.get('*/api/variantes/buscar', ({ request }) => {
      const texto = (new URL(request.url).searchParams.get('texto') ?? '').toLowerCase();
      return HttpResponse.json({
        variantes: CATALOGO.filter((v) =>
          `${v.producto} ${v.variante} ${v.sku}`.toLowerCase().includes(texto),
        ),
      });
    }),
    http.get('*/api/perforaciones/4/precio-paquete', () =>
      HttpResponse.json({ precio: '850.00', regla: 'SERVICIO_MAS_PIEZA', detalle: 'Titanio' }),
    ),
    http.get('*/api/promociones/disponibles', ({ request }) => {
      const subtotal = Number(new URL(request.url).searchParams.get('subtotal'));
      return HttpResponse.json({
        promociones: [
          {
            id: 2,
            nombre: 'Promo 10 %',
            tipo: 'PORCENTAJE',
            valor: '10.00',
            compra_minima: '1000.00',
            aplica: subtotal >= 1000,
            descuento: (subtotal / 10).toFixed(2),
          },
        ],
      });
    }),
    http.post('*/api/ventas', async ({ request }) => {
      ventasEnviadas.push((await request.json()) as Record<string, unknown>);
      if (fallosDeRed > 0) {
        fallosDeRed -= 1;
        return HttpResponse.error(); // la respuesta nunca llega
      }
      if (donde === 'celular') estadoEnCola = 'PENDIENTE';
      return HttpResponse.json(
        { venta: ventaHecha('650.00', '350.00'), repetida: false },
        { status: 201 },
      );
    }),
    http.get('*/api/ventas/12', () => HttpResponse.json({ venta: ventaHecha('650.00', '350.00') })),
    http.post('*/api/ventas/12/imprimir', () =>
      HttpResponse.arrayBuffer(new TextEncoder().encode('%PDF-ticket').buffer, {
        headers: { 'Content-Type': 'application/pdf' },
      }),
    ),
    http.get('*/api/ventas/12/ticket-digital', () =>
      HttpResponse.arrayBuffer(new TextEncoder().encode('%PDF-digital').buffer, {
        headers: { 'Content-Type': 'application/pdf' },
      }),
    ),
    http.post('*/api/cola-impresion/31/no-imprimir', () => {
      estadoEnCola = 'NO_IMPRESO';
      return new HttpResponse(null, { status: 204 });
    }),
  );
}

async function abrirVenta() {
  window.history.pushState({}, '', '/venta');
  const consultas = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={consultas}>
      <ProveedorSesion>
        <App />
      </ProveedorSesion>
    </QueryClientProvider>,
  );
  await screen.findByRole('heading', { name: 'Vender' });
  return userEvent.setup();
}

type Usuario = ReturnType<typeof userEvent.setup>;

/** El botón de un resultado de la búsqueda (no los del carrito, que llevan el mismo nombre). */
const resultado = (nombre: string | RegExp) =>
  waitFor(() =>
    within(screen.getByRole('list', { name: 'Resultados' })).getByRole('button', {
      name: typeof nombre === 'string' ? new RegExp(nombre) : nombre,
    }),
  );

/** Busca y toca el resultado: así entra un producto a la venta. */
async function agregar(usuario: Usuario, texto: string, nombre: string) {
  await usuario.type(await screen.findByRole('searchbox'), texto);
  await usuario.click(await resultado(nombre));
}

describe('vender en el equipo de la sucursal', () => {
  it('carrito con una perforación con pieza, promoción y pago mixto; al registrar sale el ticket', async () => {
    preparar('tablet');
    const usuario = await abrirVenta();
    expect(screen.getByText('Multicentro Las Américas · Caja 1')).toBeInTheDocument();
    expect(screen.getByText(/La venta está vacía/)).toBeInTheDocument();

    // un producto, dos unidades
    await agregar(usuario, 'aro', 'Aro acero — 8 mm');
    expect(screen.getByText('Agregado: Aro acero — 8 mm')).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Agregar uno de Aro acero — 8 mm' }));
    expect(screen.getByLabelText('Cantidad de Aro acero — 8 mm')).toHaveTextContent('2');

    // una perforación con pieza: primero la perforación, después su pieza; el precio lo da la API
    await agregar(usuario, 'lóbulo con', 'Perforación Lóbulo con pieza');
    expect(screen.getByText('Busque o escanee la pieza que se lleva.')).toBeInTheDocument();
    await usuario.type(screen.getByLabelText('Buscar la pieza por nombre o código'), 'ro');
    // de pieza solo sirve lo que tiene gama: la perforación sola no aparece
    await resultado('Aro acero');
    const piezas = screen.getByRole('list', { name: 'Resultados' });
    expect(within(piezas).queryByText(/Perforación/)).not.toBeInTheDocument();
    await usuario.clear(screen.getByRole('searchbox'));
    await agregar(usuario, 'labret', 'Labret titanio — 6 mm');
    expect(await screen.findByText('Precio con la pieza')).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Agregar a la venta' }));
    expect(screen.getByText('+ Labret titanio — 6 mm')).toBeInTheDocument();

    // la promoción: la rebaja la calcula la API para el subtotal de este momento
    const promocion = await screen.findByLabelText('Promoción');
    await usuario.selectOptions(promocion, 'Promo 10 % (−C$ 131.00)');
    expect(screen.getByText('C$ 1,310.00')).toBeInTheDocument(); // subtotal
    await usuario.click(await screen.findByRole('button', { name: 'Cobrar C$ 1,179.00' }));

    // cobro: US$ 20 en efectivo y el resto exacto con tarjeta
    await usuario.selectOptions(screen.getByLabelText('Forma de pago'), 'Efectivo en dólares');
    await usuario.type(screen.getByLabelText('Monto (US$)'), '20');
    expect(screen.getByText('Equivale a C$ 732.49')).toBeInTheDocument();
    expect(screen.getByText('C$ 446.51')).toBeInTheDocument(); // lo que falta
    const registrar = screen.getByRole('button', { name: 'Registrar la venta' });
    expect(registrar).toBeDisabled();
    await usuario.click(screen.getByRole('button', { name: /Agregar otra forma de pago/ }));
    await usuario.selectOptions(screen.getByLabelText('Forma de pago 2'), 'Tarjeta');
    await usuario.click(screen.getByRole('button', { name: 'Exacto' }));
    expect(screen.getByLabelText('Monto 2 (C$)')).toHaveValue('446.51');
    expect(registrar).toBeDisabled(); // la tarjeta pide su referencia
    expect(screen.getByText(/referencia del pago con tarjeta/)).toBeInTheDocument();
    await usuario.type(screen.getByLabelText(/^Referencia 2/), '784512');
    await usuario.click(registrar);

    expect(await screen.findByText('Venta registrada')).toBeInTheDocument();
    expect(screen.getByText('Factura LAM-00000012')).toBeInTheDocument();
    expect(ventasEnviadas).toEqual([
      {
        clave_idempotencia: expect.stringMatching(/^[0-9a-f-]{36}$/),
        items: [
          { variante_id: 7, cantidad: 2 },
          { variante_id: 21, cantidad: 1, piezas: [5] },
        ],
        pagos: [
          { metodo: 'EFECTIVO', moneda: 'USD', monto: '20' },
          { metodo: 'TARJETA', moneda: 'NIO', monto: '446.51', referencia: '784512' },
        ],
        promocion_id: 2,
      },
    ]);
    // en el equipo el ticket sale solo, una vez
    await waitFor(() => expect(imprimirConDialogo).toHaveBeenCalledTimes(1));
    expect(pedidas.filter((p) => p === 'POST /api/ventas/12/imprimir')).toHaveLength(1);
    expect(await screen.findByText('El ticket se envió a imprimir.')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Descargar el ticket digital/ })).toBeVisible();

    // y se sigue con otra venta, desde cero
    await usuario.click(screen.getByRole('button', { name: 'Nueva venta' }));
    expect(await screen.findByText(/La venta está vacía/)).toBeInTheDocument();
  });

  it('sin conexión la venta no se da por hecha: reintentar manda la misma clave y no duplica', async () => {
    preparar('tablet');
    fallosDeRed = 1;
    const usuario = await abrirVenta();
    await agregar(usuario, 'labret', 'Labret titanio — 6 mm');
    await usuario.click(await screen.findByRole('button', { name: 'Cobrar C$ 650.00' }));
    await usuario.type(screen.getByLabelText('Monto (C$)'), '1000');
    expect(screen.getByText('C$ 350.00')).toBeInTheDocument(); // el vuelto, antes de registrar
    await usuario.click(screen.getByRole('button', { name: 'Registrar la venta' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/No hay conexión con el servidor/);
    expect(screen.queryByText('Venta registrada')).not.toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Venta registrada')).toBeInTheDocument();
    expect(screen.getByText('Entregue de vuelto')).toBeInTheDocument();
    expect(ventasEnviadas).toHaveLength(2);
    expect(ventasEnviadas[1].clave_idempotencia).toBe(ventasEnviadas[0].clave_idempotencia);
    expect(ventasEnviadas[1]).toEqual(ventasEnviadas[0]);
  });

  it('el precio solo sube: por debajo del establecido no se acepta', async () => {
    preparar('tablet');
    const usuario = await abrirVenta();
    await agregar(usuario, 'aro', 'Aro acero — 8 mm');
    await usuario.click(screen.getByRole('button', { name: 'Cambiar precio' }));
    const precio = screen.getByLabelText('Precio por unidad de Aro acero — 8 mm (C$)');
    await usuario.clear(precio);
    await usuario.type(precio, '100');
    expect(
      screen.getByText(/No puede ser menor que el precio establecido \(C\$ 230.00\)/),
    ).toBeVisible();
    await usuario.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(screen.getByRole('button', { name: 'Cobrar C$ 230.00' })).toBeInTheDocument(); // no cambió

    await usuario.clear(precio);
    await usuario.type(precio, '300');
    await usuario.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(screen.getByText('Establecido C$ 230.00')).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Cobrar C$ 300.00' }));
    await usuario.click(screen.getByRole('button', { name: 'Exacto' }));
    await usuario.click(screen.getByRole('button', { name: 'Registrar la venta' }));
    await screen.findByText('Venta registrada');
    expect(ventasEnviadas[0].items).toEqual([{ variante_id: 7, cantidad: 1, precio: '300.00' }]);
  });

  it('no deja pasar de las existencias: la última pieza no se agrega dos veces', async () => {
    preparar('tablet');
    const usuario = await abrirVenta();
    await agregar(usuario, 'labret', 'Labret titanio — 6 mm'); // hay 1
    expect(
      screen.getByRole('button', { name: 'Agregar uno de Labret titanio — 6 mm' }),
    ).toBeDisabled();
    await usuario.type(screen.getByRole('searchbox'), 'labret');
    expect(await resultado(/Labret titanio/)).toBeDisabled();
    const resultados = screen.getByRole('list', { name: 'Resultados' });
    expect(within(resultados).getByText(/sin existencias/)).toBeInTheDocument();
  });

  it('con la caja cerrada no se vende: manda a abrirla', async () => {
    preparar('tablet');
    turnoAbierto = false;
    await abrirVenta();
    expect(await screen.findByText('La caja está cerrada.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a la caja' })).toHaveAttribute('href', '/caja');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });
});

describe('vender desde el celular', () => {
  it('la venta entra a la caja abierta de su sucursal y el ticket queda en la cola del equipo', async () => {
    preparar('celular');
    const usuario = await abrirVenta();
    expect(await screen.findByText('Multicentro Las Américas · Caja 1')).toBeInTheDocument();
    await agregar(usuario, 'labret', 'Labret titanio — 6 mm');
    await usuario.click(await screen.findByRole('button', { name: 'Cobrar C$ 650.00' }));
    await usuario.type(screen.getByLabelText('Monto (C$)'), '1000');
    await usuario.click(screen.getByRole('button', { name: 'Registrar la venta' }));

    expect(await screen.findByText('Venta registrada')).toBeInTheDocument();
    expect(screen.getByText('C$ 350.00')).toBeInTheDocument(); // el vuelto que entrega
    expect(ventasEnviadas[0]).toMatchObject({ caja_id: 1 });
    // desde el celular no se imprime en papel ni se pregunta por el turno de la caja
    expect(screen.queryByRole('button', { name: /Imprimir/ })).not.toBeInTheDocument();
    expect(imprimirConDialogo).not.toHaveBeenCalled();
    expect(pedidas).not.toContain('GET /api/caja/turno');
    expect(pedidas).not.toContain('POST /api/ventas/12/imprimir');
    expect(screen.getByText('El ticket está en «Tickets por imprimir»')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Descargar el ticket digital/ })).toBeVisible();

    // la clienta no quiere papel: quien vendió lo saca de la cola
    await usuario.click(screen.getByRole('button', { name: 'No hace falta imprimirlo' }));
    expect(await screen.findByText('El ticket no se imprimió en papel.')).toBeInTheDocument();
    expect(pedidas).toContain('POST /api/cola-impresion/31/no-imprimir');
  });

  it('sin ninguna caja abierta en su sucursal, avisa que se abre en el equipo', async () => {
    preparar('celular');
    turnoAbierto = false;
    await abrirVenta();
    expect(
      await screen.findByText('No hay ninguna caja abierta en su sucursal.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ir a la caja' })).not.toBeInTheDocument();
  });
});
