import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ponerToken } from '../api/cliente';
import type { DatosSesion, DevolucionDetalle } from '../api/tipos';
import { App } from '../App';
import { respuestaDeSesion, sesionDeAdmin, sesionDeVendedora } from '../pruebas/datos';
import { FACTURA, solicitud } from '../pruebas/devoluciones';
import { ProveedorSesion } from '../sesion/sesion';
import { hoyEnManagua, sumarDias } from '../util/formato';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }),
}));

// Devoluciones, parte 1, con la API simulada: buscar la factura, «No tiene el ticket», solicitar,
// aprobar o rechazar, cancelar y el aviso por WhatsApp. Cada devolución con su monto, nunca sumas.

const servidor = setupServer();
const pedidas: string[] = [];
const enviados: { ruta: string; cuerpo: unknown }[] = [];
/** La solicitud n.º 12 tal como la tiene «el servidor»: las pruebas la van cambiando. */
let guardada: DevolucionDetalle | null = null;
let whatsapp: string | null = null;

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
});

afterEach(() => {
  servidor.resetHandlers();
  pedidas.length = 0;
  enviados.length = 0;
  guardada = null;
  whatsapp = null;
  ponerToken(null);
  window.history.pushState({}, '', '/');
});

afterAll(() => servidor.close());

const ADMIN = { id: 1, nombre_completo: 'Víctor Alcocer' };

function preparar(sesion: DatosSesion) {
  const anotar = async (request: Request) => {
    const cuerpo: unknown = await request.json();
    enviados.push({ ruta: new URL(request.url).pathname, cuerpo });
    return cuerpo;
  };
  const laGuardada = () =>
    guardada
      ? HttpResponse.json({ devolucion: guardada })
      : HttpResponse.json({ codigo: 'NO_ENCONTRADO', mensaje: 'No existe' }, { status: 404 });
  servidor.use(
    http.post('*/api/auth/refresh', () => HttpResponse.json(respuestaDeSesion(sesion))),
    http.get('*/api/alertas', () =>
      HttpResponse.json({
        alertas: [
          {
            id: 70,
            tipo: 'DEVOLUCION_PENDIENTE',
            titulo: 'Devolución por aprobar: factura LAM-00000012, C$ 1200.00',
            detalle: { devolucion_id: 12, venta_id: 31 },
            sucursal: FACTURA.sucursal,
            creada_at: '2026-10-12T16:30:00.000Z',
            atendida_at: null,
            atendida_por: null,
          },
        ],
        total_pendientes: 1,
      }),
    ),
    http.get('*/api/alertas/sucursal', () =>
      HttpResponse.json({ alertas: [], total_pendientes: 0 }),
    ),
    http.get('*/api/tipo-cambio', () =>
      HttpResponse.json({
        tipo_cambio: { fecha: '2026-10-12', usd_a_nio: '36.6243', registrado_por: null },
      }),
    ),
    http.get('*/api/cola-impresion', () =>
      HttpResponse.json({ atendida: false, automatica: false, tickets: [] }),
    ),
    http.get('*/api/caja/turno', () => HttpResponse.json({ turno: null })),
    http.get('*/api/parametros', () =>
      HttpResponse.json({
        parametros: [
          {
            clave: 'WHATSAPP_ADMINISTRADOR',
            valor: whatsapp,
            tipo_valor: 'TEXTO',
            permite_vacio: true,
            descripcion: 'Número de WhatsApp del administrador',
          },
        ],
      }),
    ),
    http.put('*/api/parametros/WHATSAPP_ADMINISTRADOR', async ({ request }) => {
      whatsapp = ((await anotar(request)) as { valor: string | null }).valor;
      return HttpResponse.json({ parametro: { clave: 'WHATSAPP_ADMINISTRADOR', valor: whatsapp } });
    }),
    http.get('*/api/devoluciones', ({ request }) => {
      const estado = new URL(request.url).searchParams.get('estado');
      const todas = guardada ? [guardada] : [];
      return HttpResponse.json({
        devoluciones: todas.filter((d) => estado === null || d.estado === estado),
      });
    }),
    http.get('*/api/devoluciones/venta', ({ request }) =>
      new URL(request.url).searchParams.get('numero') === FACTURA.numero
        ? HttpResponse.json({ venta: FACTURA })
        : HttpResponse.json(
            { codigo: 'NO_ENCONTRADO', mensaje: 'La factura LAM-00000099 no existe' },
            { status: 404 },
          ),
    ),
    http.get('*/api/devoluciones/ventas-recientes', ({ request }) => {
      const dia = new URL(request.url).searchParams.get('fecha');
      const deHoy = [
        {
          id: 31,
          numero: 'LAM-00000012',
          fecha: '2026-10-10T20:15:00.000Z',
          sucursal: FACTURA.sucursal,
          vendedor: 'Ana Martínez',
          cliente_nombre: null,
          total: '1800.00',
          articulos: 5,
          productos: ['Cadena plata — 45 cm', 'Perfume — Rosas', 'Labret titanio — 6 mm'],
          motivo_no: null,
        },
        {
          id: 32,
          numero: 'LAM-00000013',
          fecha: '2026-10-10T21:40:00.000Z',
          sucursal: FACTURA.sucursal,
          vendedor: 'María López',
          cliente_nombre: 'Rosa Pérez',
          total: '450.00',
          articulos: 1,
          productos: ['Aretes — Perla'],
          motivo_no:
            'La venta LAM-00000013 es de un turno que sigue abierto: se anula, no se devuelve',
        },
      ];
      return HttpResponse.json({
        dias: 7,
        desde: sumarDias(hoyEnManagua(), -7),
        ventas: dia === hoyEnManagua() ? deHoy : [],
      });
    }),
    http.post('*/api/devoluciones', async ({ request }) => {
      await anotar(request);
      guardada = solicitud({ aviso_whatsapp: whatsapp });
      return HttpResponse.json({ devolucion: guardada }, { status: 201 });
    }),
    http.get('*/api/devoluciones/12', laGuardada),
    http.post('*/api/devoluciones/12/resolver', async ({ request }) => {
      const { aprobar, comentario } = (await anotar(request)) as {
        aprobar: boolean;
        comentario?: string;
      };
      guardada = solicitud({
        estado: aprobar ? 'APROBADA' : 'RECHAZADA',
        vence_el: aprobar ? '2026-10-15' : null,
        resolucion: {
          fecha: '2026-10-12T17:00:00.000Z',
          resuelta_por: ADMIN,
          comentario: comentario ?? null,
        },
        reembolso: aprobar ? solicitud().reembolso : null,
      });
      return laGuardada();
    }),
    http.post('*/api/devoluciones/12/cancelar', async ({ request }) => {
      const { motivo } = (await anotar(request)) as { motivo: string };
      guardada = solicitud({
        estado: 'CANCELADA',
        reembolso: null,
        cancelacion: {
          fecha: '2026-10-12T17:05:00.000Z',
          motivo,
          cancelada_por: { id: 3, nombre_completo: 'Ana Martínez' },
        },
      });
      return laGuardada();
    }),
  );
}

/** Abre la app ya en una dirección, con la sesión que se le diga. */
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

describe('solicitar una devolución en el equipo de la sucursal', () => {
  it('busca la factura por su número corto, marca lo que devuelve y envía la solicitud', async () => {
    whatsapp = '50588887777';
    const usuario = await abrir('/devoluciones', sesionDeVendedora('tablet'));
    // la sucursal ve primero las aprobadas (son las que se ejecutan en caja)
    expect(await screen.findByText('No hay ninguna aprobada por ejecutar.')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Aprobadas' })).toHaveAttribute('aria-selected', 'true');
    // la vendedora no administra parámetros: el número del aviso no es cosa suya
    expect(screen.queryByText('Aviso por WhatsApp')).not.toBeInTheDocument();

    await usuario.click(screen.getByRole('link', { name: 'Nueva solicitud' }));
    await usuario.type(await screen.findByLabelText('Número de factura'), '12');
    await usuario.click(screen.getByRole('button', { name: 'Buscar la factura' }));
    expect(
      await screen.findByRole('heading', { name: 'Factura LAM-00000012' }),
    ).toBeInTheDocument();
    expect(pedidas).toContain('GET /api/devoluciones/venta?numero=LAM-00000012');
    expect(screen.getByText('Se puede devolver hasta el 17/10/2026.')).toBeInTheDocument();
    // lo que no se devuelve sale con su motivo, sin nada que marcar
    expect(
      screen.getByText('La categoría "Piezas de titanio" no admite devoluciones'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Una más de Labret titanio — 6 mm' }),
    ).not.toBeInTheDocument();

    const enviar = screen.getByRole('button', { name: 'Enviar la solicitud' });
    expect(enviar).toBeDisabled();
    expect(screen.getByText('Elija si es una devolución o un cambio.')).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: /^Devolución/ }));

    // la cadena, defectuosa; y los dos perfumes que quedan (el tercero ya está en otra solicitud)
    await usuario.click(screen.getByRole('button', { name: 'Una más de Cadena plata — 45 cm' }));
    await usuario.click(screen.getByRole('button', { name: 'Defectuoso' }));
    const masPerfume = screen.getByRole('button', { name: 'Una más de Perfume — Rosas' });
    await usuario.click(masPerfume);
    await usuario.click(masPerfume);
    expect(masPerfume).toBeDisabled();
    expect(screen.getByText('Quedan 2 por devolver · C$ 300.00 c/u')).toBeInTheDocument();
    await usuario.click(
      screen.getByRole('button', { name: 'Una más de Perfume — Rosas defectuosas' }),
    );
    expect(screen.getByText('C$ 1,200.00')).toBeInTheDocument(); // lo de esta solicitud

    await usuario.type(screen.getByLabelText('Motivo'), 'No le quedó la cadena');
    await usuario.type(screen.getByLabelText('Nombre del cliente'), 'Carla Cliente');
    expect(screen.getByText(/Escriba el teléfono del cliente/)).toBeInTheDocument();
    await usuario.type(screen.getByLabelText('Teléfono del cliente'), '8888-1234');
    expect(enviar).toBeEnabled();
    await usuario.click(enviar);

    expect(await screen.findByText('Solicitud enviada.')).toBeInTheDocument();
    expect(enviados).toEqual([
      {
        ruta: '/api/devoluciones',
        cuerpo: {
          venta_id: 31,
          tipo: 'DEVOLUCION',
          motivo: 'No le quedó la cadena',
          cliente_nombre: 'Carla Cliente',
          cliente_telefono: '8888-1234',
          lineas: [
            { detalle_id: 101, cantidad: 1, estado: 'DEFECTUOSO' },
            { detalle_id: 102, cantidad: 1, estado: 'BUENO' },
            { detalle_id: 102, cantidad: 1, estado: 'DEFECTUOSO' },
          ],
        },
      },
    ]);

    // queda esperando; se ve lo previsto: cuánto en efectivo y cuánto por transferencia
    expect(screen.getByRole('heading', { name: /Devolución n\.º 12/ })).toBeInTheDocument();
    expect(screen.getByText('Esperando la aprobación del administrador.')).toBeInTheDocument();
    expect(screen.getByText('En efectivo, de la caja').closest('li')).toHaveTextContent(
      'C$ 800.00',
    );
    expect(
      screen.getByText('Por transferencia (la hace la administración)').closest('li'),
    ).toHaveTextContent('C$ 400.00');

    // y el aviso: abre WhatsApp con el mensaje ya escrito, sin nada del cliente
    const aviso = screen.getByRole('link', { name: 'Avisar al administrador' });
    const destino = aviso.getAttribute('href') ?? '';
    expect(destino.startsWith('https://wa.me/50588887777?text=')).toBe(true);
    const mensaje = decodeURIComponent(destino.split('?text=')[1]);
    expect(mensaje).toContain('Solicitud de devolución n.º 12');
    expect(mensaje).toContain('Factura: LAM-00000012');
    expect(mensaje).toContain('Monto: C$ 1,200.00');
    expect(mensaje).toContain('Sucursal: Multicentro Las Américas');
    expect(mensaje).not.toMatch(/Carla|8888-1234/);
    // la vendedora no aprueba
    expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
  });

  it('sin el número del administrador no sale el botón de aviso; quien la solicitó la puede cancelar', async () => {
    guardada = solicitud();
    const usuario = await abrir('/devoluciones/12', sesionDeVendedora('tablet'));
    expect(
      await screen.findByText('Esperando la aprobación del administrador.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Avisar al administrador' })).not.toBeInTheDocument();
    expect(screen.queryByText('Solicitud enviada.')).not.toBeInTheDocument(); // no viene de enviarla

    const cancelar = screen.getByRole('button', { name: 'Cancelar la solicitud' });
    expect(cancelar).toBeDisabled(); // pide el motivo
    await usuario.type(screen.getByLabelText('Motivo de la cancelación'), 'Ya no la quiso');
    await usuario.click(cancelar);
    const pregunta = await screen.findByRole('alertdialog', { name: '¿Cancelar esta solicitud?' });
    await usuario.click(within(pregunta).getByRole('button', { name: 'Sí, cancelarla' }));
    expect(await screen.findByText(/Cancelada por Ana Martínez/)).toBeInTheDocument();
    expect(screen.getByText('Motivo: Ya no la quiso')).toBeInTheDocument();
    expect(enviados).toEqual([
      { ruta: '/api/devoluciones/12/cancelar', cuerpo: { motivo: 'Ya no la quiso' } },
    ]);
    expect(screen.queryByRole('button', { name: 'Cancelar la solicitud' })).not.toBeInTheDocument();
  });

  it('la solicitud de otra persona no la cancela', async () => {
    guardada = solicitud({ solicitada_por: { id: 4, nombre_completo: 'María López' } });
    await abrir('/devoluciones/12', sesionDeVendedora('tablet'));
    expect(await screen.findByText(/La solicitó María López/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar la solicitud' })).not.toBeInTheDocument();
  });

  it('una factura que no existe o que no se puede devolver dice por qué, sin formulario', async () => {
    const usuario = await abrir('/devoluciones/nueva', sesionDeVendedora('tablet'));
    const numero = await screen.findByLabelText('Número de factura');
    await usuario.type(numero, 'cadena de plata');
    await usuario.click(screen.getByRole('button', { name: 'Buscar la factura' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Eso no es un número de factura');

    await usuario.clear(numero);
    await usuario.type(numero, 'lam-99');
    await usuario.click(screen.getByRole('button', { name: 'Buscar la factura' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La factura LAM-00000099 no existe');
    expect(screen.queryByRole('button', { name: 'Enviar la solicitud' })).not.toBeInTheDocument();
  });
});

describe('«No tiene el ticket»', () => {
  it('en el equipo: las ventas de los últimos días, cada una con su monto y sin sumas', async () => {
    const usuario = await abrir('/devoluciones/nueva', sesionDeVendedora('tablet'));
    await usuario.click(await screen.findByRole('button', { name: 'No tiene el ticket' }));
    const hoy = hoyEnManagua();
    const dia = await screen.findByLabelText('Día de la venta');
    expect(
      await screen.findByText(/se puede devolver lo vendido en los últimos 7 días/),
    ).toBeInTheDocument();
    expect(pedidas).toContain(`GET /api/devoluciones/ventas-recientes?limite=200&fecha=${hoy}`);
    // el día de hoy y los 7 del plazo
    expect(
      within(dia)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(expect.arrayContaining(['Hoy', 'Ayer']));
    expect(within(dia).getAllByRole('option')).toHaveLength(8);

    const primera = screen.getByRole('link', { name: /LAM-00000012/ });
    expect(primera).toHaveTextContent('C$ 1,800.00');
    expect(primera).toHaveTextContent(
      'Cadena plata — 45 cm, Perfume — Rosas, Labret titanio — 6 mm y 2 más',
    );
    const abierta = screen.getByRole('link', { name: /LAM-00000013/ });
    expect(abierta).toHaveTextContent('C$ 450.00');
    expect(abierta).toHaveTextContent('Caja abierta: se anula');
    // el arqueo es a ciegas: ni el total del día ni ninguna otra suma
    expect(document.body).not.toHaveTextContent(/2,250\.00|total|suma/i);

    await usuario.selectOptions(dia, sumarDias(hoy, -1));
    expect(await screen.findByText('No hay ventas de ese día.')).toBeInTheDocument();
    expect(pedidas).toContain(
      `GET /api/devoluciones/ventas-recientes?limite=200&fecha=${sumarDias(hoy, -1)}`,
    );

    await usuario.selectOptions(dia, hoy);
    await usuario.click(await screen.findByRole('link', { name: /LAM-00000012/ }));
    expect(
      await screen.findByRole('heading', { name: 'Factura LAM-00000012' }),
    ).toBeInTheDocument();
  });

  it('desde el celular personal no está: la factura se busca por su número', async () => {
    await abrir('/devoluciones/nueva', sesionDeVendedora('celular'));
    expect(await screen.findByLabelText('Número de factura')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'No tiene el ticket' })).not.toBeInTheDocument();
    expect(screen.getByText(/se busca por su día en el equipo de la sucursal/)).toBeInTheDocument();
    expect(pedidas.some((p) => p.includes('ventas-recientes'))).toBe(false);
  });
});

describe('el administrador, desde su celular', () => {
  it('llega a la solicitud desde la alerta y la aprueba', async () => {
    guardada = solicitud({ aviso_whatsapp: '50588887777' });
    const usuario = await abrir('/', sesionDeAdmin());
    expect(await screen.findByText('Hay 1 por aprobar.')).toBeInTheDocument();

    await usuario.click(screen.getByRole('link', { name: /Alertas: 1 pendientes/ }));
    await usuario.click(await screen.findByRole('link', { name: 'Ver la solicitud' }));
    expect(await screen.findByRole('heading', { name: /Devolución n\.º 12/ })).toBeInTheDocument();
    expect(screen.getByText('1 × Cadena plata — 45 cm').closest('li')).toHaveTextContent(
      'Defectuoso',
    );
    expect(screen.getByText('Carla Cliente · 8888-1234')).toBeInTheDocument();
    // a sí mismo no se avisa
    expect(screen.queryByRole('link', { name: 'Avisar al administrador' })).not.toBeInTheDocument();
    // rechazar pide decir por qué
    expect(screen.getByRole('button', { name: 'Rechazar' })).toBeDisabled();

    await usuario.click(screen.getByRole('button', { name: 'Aprobar' }));
    const pregunta = await screen.findByRole('alertdialog', { name: '¿Aprobar esta devolución?' });
    expect(pregunta).toHaveTextContent('Factura LAM-00000012, C$ 1,200.00');
    await usuario.click(within(pregunta).getByRole('button', { name: 'Sí, aprobar' }));

    expect(await screen.findByText(/Aprobada por Víctor Alcocer/)).toBeInTheDocument();
    expect(screen.getByText(/Se puede ejecutar hasta el 15\/10\/2026/)).toBeInTheDocument();
    expect(enviados).toEqual([
      { ruta: '/api/devoluciones/12/resolver', cuerpo: { aprobar: true } },
    ]);
    expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
  });

  it('en «Por aprobar» ve cada solicitud con su monto; la rechaza con su comentario', async () => {
    guardada = solicitud();
    const usuario = await abrir('/devoluciones', sesionDeAdmin());
    expect(screen.getByRole('tab', { name: 'Por aprobar' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const fila = await screen.findByRole('link', { name: /Devolución · LAM-00000012/ });
    expect(fila).toHaveTextContent('Esperando aprobación');
    expect(fila).toHaveTextContent('C$ 1,200.00');
    expect(pedidas).toContain('GET /api/devoluciones?limite=50&estado=PENDIENTE');
    await usuario.click(fila);

    await usuario.type(
      await screen.findByLabelText('Comentario (obligatorio para rechazar)'),
      'Ya pasó por agua',
    );
    await usuario.click(screen.getByRole('button', { name: 'Rechazar' }));
    const pregunta = await screen.findByRole('alertdialog', { name: '¿Rechazar esta devolución?' });
    await usuario.click(within(pregunta).getByRole('button', { name: 'Sí, rechazar' }));

    const rechazo = await screen.findByText(/Rechazada por Víctor Alcocer/);
    expect(rechazo.closest('[role="alert"]')).toHaveTextContent('Motivo: Ya pasó por agua');
    expect(enviados).toEqual([
      {
        ruta: '/api/devoluciones/12/resolver',
        cuerpo: { aprobar: false, comentario: 'Ya pasó por agua' },
      },
    ]);
  });

  it('pone su número de WhatsApp para el aviso, solo con dígitos; uno que no es un número no se guarda', async () => {
    const usuario = await abrir('/devoluciones', sesionDeAdmin());
    const numero = await screen.findByLabelText('Su número de WhatsApp, con el código del país');
    const guardar = screen.getByRole('button', { name: 'Guardar el número' });
    await usuario.type(numero, '8888');
    expect(screen.getByText(/Escriba el número con el código del país/)).toBeInTheDocument();
    expect(guardar).toBeDisabled();

    await usuario.clear(numero);
    await usuario.type(numero, '+505 8888-7777');
    await usuario.click(guardar);
    expect(await screen.findByText('Número guardado.')).toBeInTheDocument();
    expect(enviados).toEqual([
      { ruta: '/api/parametros/WHATSAPP_ADMINISTRADOR', cuerpo: { valor: '50588887777' } },
    ]);
    expect(numero).toHaveValue('50588887777');
  });
});
