import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ponerToken } from '../api/cliente';
import type { CompraParaEtiquetas, DatosSesion, PiezaEtiqueta } from '../api/tipos';
import { App } from '../App';
import { imprimirConDialogo } from '../equipo/imprimir';
import { HOJA_DE_30 } from '../etiquetas/papel';
import { respuestaDeSesion, sesionDeAdmin, sesionDeVendedora } from '../pruebas/datos';
import { ProveedorSesion } from '../sesion/sesion';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }),
}));

// La cámara no existe en las pruebas: el «escáner» es un botón que lee el código de la etiqueta
vi.mock('../equipo/EscanerCamara', () => ({
  EscanerCamara: ({ alLeer }: { alLeer: (texto: string) => void }) => (
    <button type="button" onClick={() => alLeer('PTI-00001')}>
      Leer el QR de prueba
    </button>
  ),
}));

vi.mock('../equipo/imprimir', async (original) => ({
  ...(await original<typeof import('../equipo/imprimir')>()),
  imprimirConDialogo: vi.fn(() => Promise.resolve()),
}));

// Etiquetas con QR, para el administrador: piezas sueltas (buscando o escaneando), lo de la
// bodega y lo de una compra, cada una con sus copias; el papel; y el PDF, que arma la API.

const servidor = setupServer();
const pedidas: string[] = [];
const enviados: unknown[] = [];

const pieza = (
  variante_id: number,
  codigo: string,
  nombre: string,
  cantidad: number | null,
): PiezaEtiqueta => ({
  variante_id,
  codigo,
  producto: nombre.split(' · ')[0],
  variante: nombre.split(' · ')[1] ?? 'Única',
  categoria: 'Piercing titanio',
  nombre,
  cantidad,
});

const LABRET = pieza(31, 'PTI-00001', 'Labret · 6 mm', 8);
const ARO = pieza(32, 'PTI-00002', 'Aro · 8 mm', 5);
const PERFUME = pieza(40, '7501234500017', 'Perfume rosas', 2);

const COMPRA: CompraParaEtiquetas = {
  id: 7,
  proveedor: 'Body Jewelry Supply',
  factura_numero: 'F-120',
  fecha_factura: '2026-10-18',
  estado: 'CONFIRMADA',
  piezas: 13,
};

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
  URL.createObjectURL = () => 'blob:etiquetas-de-prueba';
  URL.revokeObjectURL = () => {};
});

afterEach(() => {
  servidor.resetHandlers();
  pedidas.length = 0;
  enviados.length = 0;
  vi.mocked(imprimirConDialogo).mockClear();
  localStorage.clear();
  ponerToken(null);
  window.history.pushState({}, '', '/');
});

afterAll(() => servidor.close());

async function abrir(sesion: DatosSesion) {
  servidor.use(
    http.post('*/api/auth/refresh', () => HttpResponse.json(respuestaDeSesion(sesion))),
    http.get('*/api/alertas', () => HttpResponse.json({ alertas: [], total_pendientes: 0 })),
    http.get('*/api/alertas/sucursal', () =>
      HttpResponse.json({ alertas: [], total_pendientes: 0 }),
    ),
    http.get('*/api/tipo-cambio', () => HttpResponse.json({ tipo_cambio: null })),
    http.get('*/api/cola-impresion', () =>
      HttpResponse.json({ atendida: false, automatica: false, tickets: [] }),
    ),
    http.get('*/api/devoluciones', () => HttpResponse.json({ devoluciones: [] })),
    http.get('*/api/etiquetas/piezas', ({ request }) => {
      const texto = new URL(request.url).searchParams.get('texto')?.toLowerCase() ?? '';
      return HttpResponse.json({
        piezas: [LABRET, ARO, PERFUME].filter(
          (p) => p.codigo.toLowerCase() === texto || p.nombre.toLowerCase().includes(texto),
        ),
      });
    }),
    http.get('*/api/etiquetas/bodega', () => HttpResponse.json({ piezas: [ARO, LABRET] })),
    http.get('*/api/etiquetas/compras', () => HttpResponse.json({ compras: [COMPRA] })),
    http.get('*/api/etiquetas/compras/7', () =>
      HttpResponse.json({ compra: COMPRA, piezas: [{ ...LABRET, cantidad: 10 }, ARO] }),
    ),
    http.post('*/api/etiquetas/pdf', async ({ request }) => {
      enviados.push(await request.json());
      return HttpResponse.arrayBuffer(new TextEncoder().encode('%PDF-etiquetas').buffer, {
        headers: { 'Content-Type': 'application/pdf' },
      });
    }),
  );
  window.history.pushState({}, '', '/etiquetas');
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ProveedorSesion>
        <App />
      </ProveedorSesion>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('heading', { name: 'Etiquetas' })).toBeInTheDocument();
  return userEvent.setup();
}

function delAdministrador(): DatosSesion {
  const sesion = sesionDeAdmin();
  sesion.usuario.permisos = [...sesion.usuario.permisos, 'INVENTARIO_ENTRADA'];
  return sesion;
}

const paraImprimir = () => screen.getByRole('list', { name: 'Para imprimir' });

describe('etiquetas de piezas sueltas', () => {
  it('se buscan o se escanean, se eligen las copias y se imprimen en la hoja carta', async () => {
    const usuario = await abrir(delAdministrador());
    expect(screen.getByRole('tab', { name: 'Piezas sueltas' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const imprimir = screen.getByRole('button', { name: 'Imprimir' });
    expect(imprimir).toBeDisabled();
    expect(screen.getByText('Elija las piezas y sus copias.')).toBeInTheDocument();

    // buscar por nombre y tocar
    await usuario.type(screen.getByLabelText('Buscar la pieza por nombre o código'), 'aro');
    const resultados = await screen.findByRole('list', { name: 'Resultados' });
    await usuario.click(within(resultados).getByRole('button', { name: /Aro · 8 mm/ }));
    expect(screen.getByText('Agregada: Aro · 8 mm (PTI-00002)')).toBeInTheDocument();

    // escanear el QR de una etiqueta: el código exacto entra sin más toques
    await usuario.click(screen.getByRole('button', { name: 'Escanear' }));
    await usuario.click(screen.getByRole('button', { name: 'Leer el QR de prueba' }));
    expect(await screen.findByText('Agregada: Labret · 6 mm (PTI-00001)')).toBeInTheDocument();
    expect(pedidas).toContain('GET /api/etiquetas/piezas?texto=PTI-00001');
    // otra vez la misma: una copia más
    await usuario.click(screen.getByRole('button', { name: 'Leer el QR de prueba' }));

    expect(within(paraImprimir()).getByLabelText('Copias de Labret · 6 mm')).toHaveValue(2);
    await usuario.click(screen.getByRole('button', { name: 'Una más de Aro · 8 mm' }));
    const copias = within(paraImprimir()).getByLabelText('Copias de Aro · 8 mm');
    await usuario.clear(copias);
    await usuario.type(copias, '4');
    expect(screen.getByText('6 etiquetas en 1 hoja carta')).toBeInTheDocument();

    // quitar una y volver a poner
    await usuario.click(screen.getByRole('button', { name: 'Quitar Labret · 6 mm' }));
    expect(within(paraImprimir()).queryByText('Labret · 6 mm')).not.toBeInTheDocument();
    expect(screen.getByText('4 etiquetas en 1 hoja carta')).toBeInTheDocument();

    await usuario.click(imprimir);
    expect(
      await screen.findByText('Se mandaron a imprimir 4 etiquetas en 1 hoja carta.'),
    ).toBeInTheDocument();
    expect(enviados).toEqual([
      { formato: 'HOJA', piezas: [{ variante_id: 32, copias: 4 }], hoja: HOJA_DE_30 },
    ]);
    expect(imprimirConDialogo).toHaveBeenCalledTimes(1);
    // lo mismo otra vez: no se vuelve a pedir el PDF
    await usuario.click(imprimir);
    expect(imprimirConDialogo).toHaveBeenCalledTimes(2);
    expect(enviados).toHaveLength(1);
  });

  it('una hoja empezada: las ya usadas se dejan en blanco; una cuadrícula que no cabe no deja imprimir', async () => {
    const usuario = await abrir(delAdministrador());
    await usuario.type(screen.getByLabelText('Buscar la pieza por nombre o código'), 'labret');
    await usuario.click(
      within(await screen.findByRole('list', { name: 'Resultados' })).getByRole('button', {
        name: /Labret · 6 mm/,
      }),
    );
    const usadas = screen.getByLabelText('Ya usadas en la primera hoja (se dejan en blanco)');
    await usuario.clear(usadas);
    await usuario.type(usadas, '29');
    expect(screen.getByText('1 etiqueta en 1 hoja carta')).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Una más de Labret · 6 mm' }));
    expect(screen.getByText('2 etiquetas en 2 hojas carta')).toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: 'Cambiar las medidas de la hoja' }));
    const columnas = screen.getByLabelText('Columnas');
    await usuario.clear(columnas);
    await usuario.type(columnas, '4');
    expect(
      screen.getByText('No caben a lo ancho de la hoja: ocupan 281.2 mm de 215.9'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeDisabled();
    expect(screen.getByText('Revise las medidas del papel.')).toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: 'Volver a la hoja de 30' }));
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeEnabled();
    expect(
      screen.getByText('3 × 10 etiquetas de 66.7 × 25.4 mm: 30 por hoja.'),
    ).toBeInTheDocument();
  });
});

describe('etiquetas de lo que hay en la bodega', () => {
  it('las copias son las existencias (se cambian; 0 es «esa no»), en una por página', async () => {
    const usuario = await abrir(delAdministrador());
    await usuario.click(screen.getByRole('tab', { name: 'La bodega' }));
    expect(await screen.findByText('Labret · 6 mm')).toBeInTheDocument();
    expect(within(paraImprimir()).getByLabelText('Copias de Labret · 6 mm')).toHaveValue(8);
    expect(within(paraImprimir()).getByLabelText('Copias de Aro · 8 mm')).toHaveValue(5);
    expect(screen.getByText('13 etiquetas')).toBeInTheDocument();
    // en la bodega no se quita: se baja a 0
    expect(screen.queryByRole('button', { name: /^Quitar/ })).not.toBeInTheDocument();
    const aro = within(paraImprimir()).getByLabelText('Copias de Aro · 8 mm');
    await usuario.clear(aro);
    await usuario.type(aro, '0');
    expect(screen.getByText(/PTI-00002 · no se imprime/)).toBeInTheDocument();

    await usuario.click(screen.getByRole('radio', { name: /Una por página/ }));
    const ancho = screen.getByLabelText('Ancho (mm)');
    await usuario.clear(ancho);
    await usuario.type(ancho, '40,5');
    expect(screen.getByText('8 etiquetas en 8 páginas')).toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: 'Preparar el PDF' }));
    const enlace = await screen.findByRole('link', { name: 'Abrir el PDF' });
    expect(enlace).toHaveAttribute('href', 'blob:etiquetas-de-prueba');
    expect(enlace).toHaveAttribute('download', 'etiquetas.pdf');
    expect(enviados).toEqual([
      {
        formato: 'ROLLO',
        piezas: [{ variante_id: 31, copias: 8 }],
        rollo: { ancho: 40.5, alto: 30 },
      },
    ]);
    // el equipo recuerda el papel para la próxima vez
    expect(JSON.parse(localStorage.getItem('esmeralda.etiquetas.papel') ?? '{}')).toMatchObject({
      formato: 'ROLLO',
      rollo: { ancho: 40.5, alto: 30 },
    });
    // si se cambia lo elegido, el PDF hay que prepararlo otra vez
    await usuario.click(screen.getByRole('button', { name: 'Una menos de Labret · 6 mm' }));
    expect(screen.queryByRole('link', { name: 'Abrir el PDF' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preparar el PDF' })).toBeEnabled();
  });
});

describe('etiquetas de una compra', () => {
  it('las copias son lo que entró con la compra', async () => {
    const usuario = await abrir(delAdministrador());
    await usuario.click(screen.getByRole('tab', { name: 'Una compra' }));
    const compra = await screen.findByLabelText('Compra');
    await usuario.selectOptions(compra, '7');
    expect(await screen.findByText('Labret · 6 mm')).toBeInTheDocument();
    expect(
      screen.getByRole('option', {
        name: /Body Jewelry Supply · factura F-120 · 18\/10\/2026 · 13 piezas/,
      }),
    ).toBeInTheDocument();
    expect(within(paraImprimir()).getByLabelText('Copias de Labret · 6 mm')).toHaveValue(10);
    expect(within(paraImprimir()).getByLabelText('Copias de Aro · 8 mm')).toHaveValue(5);
    expect(screen.getByText('15 etiquetas en 1 hoja carta')).toBeInTheDocument();
  });

  it('sin el permiso de las compras, esa pestaña no sale', async () => {
    await abrir(sesionDeAdmin());
    expect(screen.queryByRole('tab', { name: 'Una compra' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'La bodega' })).toBeInTheDocument();
  });
});

it('es solo de quien administra el catálogo: la vendedora vuelve al inicio', async () => {
  const sesion = sesionDeVendedora('tablet');
  servidor.use(
    http.post('*/api/auth/refresh', () => HttpResponse.json(respuestaDeSesion(sesion))),
    http.get('*/api/alertas/sucursal', () =>
      HttpResponse.json({ alertas: [], total_pendientes: 0 }),
    ),
    http.get('*/api/tipo-cambio', () => HttpResponse.json({ tipo_cambio: null })),
    http.get('*/api/caja/turno', () => HttpResponse.json({ turno: null })),
    http.get('*/api/cola-impresion', () =>
      HttpResponse.json({ atendida: true, automatica: false, tickets: [] }),
    ),
  );
  window.history.pushState({}, '', '/etiquetas');
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ProveedorSesion>
        <App />
      </ProveedorSesion>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('heading', { name: /^Hola, / })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Etiquetas' })).not.toBeInTheDocument();
  expect(pedidas.some((p) => p.startsWith('GET /api/etiquetas'))).toBe(false);
});
