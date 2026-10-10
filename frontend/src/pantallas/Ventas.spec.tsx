import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ponerToken } from '../api/cliente';
import type { DatosSesion, VentaDetalle } from '../api/tipos';
import { App } from '../App';
import { TABLET, respuestaDeSesion, sesionDeVendedora } from '../pruebas/datos';
import { ProveedorSesion } from '../sesion/sesion';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }),
}));

// Las ventas del turno y el detalle de una: se ve cada venta con su monto, nunca una suma; anular
// es solo de quien tiene el permiso, con su motivo.

const servidor = setupServer();
const pedidas: string[] = [];
let sesion: DatosSesion;
let anulada = false;
let motivoEnviado: unknown = null;

const VENTA: VentaDetalle = {
  id: 12,
  numero: 'LAM-00000012',
  fecha: '2026-10-09T21:42:00.000Z',
  estado: 'COMPLETADA',
  sucursal: TABLET.sucursal,
  turno_id: 9,
  vendedor: { id: 3, nombre_completo: 'Ana Martínez' },
  cliente_nombre: 'Lucía Pérez',
  subtotal: '1110.00',
  descuento: '111.00',
  total: '999.00',
  articulos: 3,
  origen: null,
  caja: { id: 1, nombre: 'Caja 1' },
  cliente_telefono: '8888-0000',
  notas: null,
  tipo_cambio: '36.6243',
  promocion: { id: 2, nombre: 'Promo 10 %' },
  lineas: [
    {
      id: 1,
      variante: { id: 21, sku: 'PAQ-LOB', nombre: 'Perforación Lóbulo con pieza — Con pieza' },
      tipo: 'PAQUETE',
      cantidad: 1,
      precio_lista: '650.00',
      precio_unitario: '650.00',
      subtotal: '650.00',
      piezas: [
        { variante: { id: 5, sku: 'TIT-LAB-16-6', nombre: 'Labret titanio — 6 mm' }, cantidad: 1 },
      ],
    },
    {
      id: 2,
      variante: { id: 7, sku: 'ACE-ARO-16-8', nombre: 'Aro acero — 8 mm' },
      tipo: 'PRODUCTO',
      cantidad: 2,
      precio_lista: '230.00',
      precio_unitario: '230.00',
      subtotal: '460.00',
      piezas: [],
    },
  ],
  pagos: [
    {
      metodo: { codigo: 'EFECTIVO', nombre: 'Efectivo' },
      moneda: 'USD',
      monto: '20.00',
      tipo_cambio: '36.6243',
      monto_nio: '732.49',
      referencia: null,
    },
    {
      metodo: { codigo: 'TARJETA', nombre: 'Tarjeta' },
      moneda: 'NIO',
      monto: '300.00',
      tipo_cambio: '1.0000',
      monto_nio: '300.00',
      referencia: '784512',
    },
  ],
  vuelto: '33.49',
  anulacion: null,
  cambio: null,
  cola: null,
};

const comoAnulada = (): VentaDetalle => ({
  ...VENTA,
  estado: 'ANULADA',
  anulacion: {
    fecha: '2026-10-09T22:10:00.000Z',
    motivo: 'La clienta se arrepintió',
    anulada_por: { id: 4, nombre_completo: 'María López' },
  },
});

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
  anulada = false;
  motivoEnviado = null;
  ponerToken(null);
  window.history.pushState({}, '', '/');
});

afterAll(() => servidor.close());

function abrir(direccion: string, donde: 'tablet' | 'celular', permisosDeMas: string[] = []) {
  sesion = sesionDeVendedora(donde);
  sesion.usuario.permisos = [...sesion.usuario.permisos, ...permisosDeMas];
  servidor.use(
    http.post('*/api/auth/refresh', () => HttpResponse.json(respuestaDeSesion(sesion))),
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
      HttpResponse.json({ atendida: donde === 'tablet', automatica: false, tickets: [] }),
    ),
    http.get('*/api/ventas', () =>
      HttpResponse.json({
        ventas: [
          anulada ? comoAnulada() : VENTA,
          { ...VENTA, id: 11, numero: 'LAM-00000011', total: '650.00', articulos: 1 },
        ],
      }),
    ),
    http.get('*/api/ventas/12', () =>
      HttpResponse.json({ venta: anulada ? comoAnulada() : VENTA }),
    ),
    http.get('*/api/ventas/12/ticket-digital', () =>
      HttpResponse.arrayBuffer(new TextEncoder().encode('%PDF-digital').buffer, {
        headers: { 'Content-Type': 'application/pdf' },
      }),
    ),
    http.post('*/api/ventas/12/anular', async ({ request }) => {
      motivoEnviado = await request.json();
      anulada = true;
      return HttpResponse.json({ venta: comoAnulada() });
    }),
  );
  window.history.pushState({}, '', direccion);
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

describe('ventas del turno', () => {
  it('en el equipo: las del turno abierto de su caja, cada una con su monto y sin ninguna suma', async () => {
    const usuario = abrir('/venta/del-turno', 'tablet');
    expect(await screen.findByRole('heading', { name: 'Ventas del turno' })).toBeVisible();
    expect(await screen.findByText('LAM-00000012')).toBeInTheDocument();
    expect(screen.getByText('C$ 999.00')).toBeInTheDocument();
    expect(screen.getByText('C$ 650.00')).toBeInTheDocument();
    expect(screen.getByText(/Ana · 3 artículos/)).toBeInTheDocument();
    expect(pedidas).toContain('GET /api/ventas?turno_id=9&limite=100');
    // el arqueo es a ciegas: ni el total del turno ni cuánto se ha vendido
    expect(document.body).not.toHaveTextContent(/1,649|total del turno|vendido/i);

    await usuario.click(screen.getByRole('link', { name: /LAM-00000012/ }));
    expect(await screen.findByRole('heading', { name: /Factura LAM-00000012/ })).toBeVisible();
  });

  it('desde el celular: las propias, sin preguntar por el turno de la caja', async () => {
    abrir('/venta/del-turno', 'celular');
    expect(await screen.findByText('LAM-00000012')).toBeInTheDocument();
    expect(screen.getByText('Las que usted hizo en el turno que sigue abierto.')).toBeVisible();
    expect(pedidas).toContain('GET /api/ventas?limite=100');
    expect(pedidas.some((p) => p.startsWith('GET /api/caja/turno'))).toBe(false);
  });
});

describe('una venta', () => {
  it('muestra lo que se llevó, cómo se pagó y su ticket; la vendedora no la puede anular', async () => {
    abrir('/venta/del-turno/12', 'tablet');
    expect(await screen.findByRole('heading', { name: /Factura LAM-00000012/ })).toBeVisible();
    expect(screen.getByText('1 × Perforación Lóbulo con pieza — Con pieza')).toBeInTheDocument();
    expect(screen.getByText('+ Labret titanio — 6 mm')).toBeInTheDocument();
    expect(screen.getByText('2 × Aro acero — 8 mm')).toBeInTheDocument();
    expect(screen.getByText('Promo 10 %')).toBeInTheDocument();
    expect(screen.getByText('−C$ 111.00')).toBeInTheDocument();
    expect(screen.getByText('C$ 999.00')).toBeInTheDocument();
    expect(screen.getByText('US$ 20.00')).toBeInTheDocument();
    expect(screen.getByText(/ref\. 784512/)).toBeInTheDocument();
    expect(screen.getByText('C$ 33.49')).toBeInTheDocument(); // el vuelto
    expect(screen.getByText(/Cliente: Lucía Pérez \(8888-0000\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Imprimir el ticket' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Descargar el ticket digital/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Anular la venta' })).not.toBeInTheDocument();
  });

  it('desde el celular no se imprime en papel: solo el ticket digital', async () => {
    abrir('/venta/del-turno/12', 'celular');
    expect(await screen.findByRole('heading', { name: /Factura LAM-00000012/ })).toBeVisible();
    expect(await screen.findByRole('link', { name: /Descargar el ticket digital/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Imprimir/ })).not.toBeInTheDocument();
  });

  it('con el permiso se anula: pide el motivo y una confirmación', async () => {
    const usuario = abrir('/venta/del-turno/12', 'tablet', ['VENTAS_ANULAR']);
    const anular = await screen.findByRole('button', { name: 'Anular la venta' });
    expect(anular).toBeDisabled(); // sin motivo no
    await usuario.type(screen.getByLabelText('Motivo de la anulación'), 'La clienta se arrepintió');
    await usuario.click(anular);
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/¿Anular la factura LAM-00000012\?/);
    await usuario.click(screen.getByRole('button', { name: 'Sí, anularla' }));

    expect(await screen.findByText(/Anulada el .* por María López/)).toBeInTheDocument();
    expect(screen.getByText('Motivo: La clienta se arrepintió')).toBeInTheDocument();
    expect(motivoEnviado).toEqual({ motivo: 'La clienta se arrepintió' });
    // una venta anulada ya no se anula otra vez
    expect(screen.queryByRole('button', { name: 'Anular la venta' })).not.toBeInTheDocument();
  });
});
