import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ponerToken } from './api/cliente';
import type { DatosSesion, PantallaPin } from './api/tipos';
import { App } from './App';
import {
  SIN_EQUIPO,
  TABLET,
  TABLET_ABIERTA,
  respuestaDeSesion,
  sesionDeAdmin,
  sesionDeVendedora,
} from './pruebas/datos';
import { ProveedorSesion } from './sesion/sesion';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }),
}));

// La API simulada: cada prueba dice qué sesión hay y qué responde cada ruta
const servidor = setupServer();
const pedidas: string[] = [];

interface Escenario {
  /** La sesión que la cookie recupera al abrir la app (null: no hay). */
  recuperada?: DatosSesion | null;
  pantalla?: PantallaPin;
  pendientes?: number;
}

function preparar({ recuperada = null, pantalla = SIN_EQUIPO, pendientes = 0 }: Escenario) {
  // Una respuesta nueva cada vez: el refresh se reintenta y un cuerpo no se lee dos veces
  const sinSesion = () =>
    HttpResponse.json(
      { codigo: 'SESION_NO_VALIDA', mensaje: 'Su sesión terminó. Inicie sesión de nuevo.' },
      { status: 401 },
    );
  servidor.use(
    http.post('*/api/auth/refresh', () =>
      recuperada ? HttpResponse.json(respuestaDeSesion(recuperada)) : sinSesion(),
    ),
    http.get('*/api/auth/pin/usuarios', () => HttpResponse.json(pantalla)),
    http.post('*/api/auth/login', async ({ request }) => {
      const { password } = (await request.json()) as { password: string };
      return password === 'Buena#2026'
        ? HttpResponse.json(respuestaDeSesion(sesionDeAdmin()))
        : HttpResponse.json(
            { codigo: 'CREDENCIALES_INVALIDAS', mensaje: 'Usuario o contraseña incorrectos' },
            { status: 401 },
          );
    }),
    http.post('*/api/auth/pin', async ({ request }) => {
      const { pin } = (await request.json()) as { pin: string };
      return pin === '2580'
        ? HttpResponse.json(respuestaDeSesion(sesionDeVendedora('tablet')))
        : HttpResponse.json(
            { codigo: 'PIN_INCORRECTO', mensaje: 'PIN incorrecto. Le quedan 4 intentos.' },
            { status: 401 },
          );
    }),
    http.post('*/api/auth/logout', () => new HttpResponse(null, { status: 204 })),
    http.get('*/api/alertas', () =>
      HttpResponse.json({ alertas: [], total_pendientes: pendientes }),
    ),
    http.get('*/api/alertas/sucursal', () =>
      HttpResponse.json({ alertas: [], total_pendientes: pendientes }),
    ),
    http.get('*/api/tipo-cambio', () =>
      HttpResponse.json({
        tipo_cambio: { fecha: '2026-10-08', usd_a_nio: '36.6243', es_de_hoy: true },
      }),
    ),
    http.get('*/api/caja/turno', () =>
      HttpResponse.json({
        turno: {
          id: 9,
          sucursal: TABLET.sucursal,
          caja: { id: 1, nombre: 'Caja 1' },
          abierto_por: { id: 4, nombre_completo: 'María López' },
          fecha_apertura: '2026-10-08T14:05:00.000Z',
        },
      }),
    ),
  );
}

function montar() {
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

/** El menú lateral (el de abajo, del celular, repite algunas opciones). */
const menu = () => within(screen.getAllByRole('navigation', { name: 'Menú' })[0]);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: 'error' });
  servidor.events.on('request:start', ({ request }) => {
    pedidas.push(`${request.method} ${new URL(request.url).pathname}`);
  });
  // En las pruebas las direcciones relativas («/api/…») necesitan un servidor al que apuntar
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
  ponerToken(null);
  window.history.pushState({}, '', '/');
});

afterAll(() => {
  servidor.close();
});

describe('entrar con usuario y contraseña', () => {
  it('con la contraseña mala muestra el mensaje de la API; con la buena, entra y arma el menú del rol', async () => {
    preparar({ pendientes: 2 });
    const usuario = montar();

    await usuario.type(await screen.findByLabelText('Usuario'), 'admin');
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Escriba su contraseña')).toBeInTheDocument();

    await usuario.type(screen.getByLabelText('Contraseña'), 'Mala#2026');
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Usuario o contraseña incorrectos');

    await usuario.clear(screen.getByLabelText('Contraseña'));
    await usuario.type(screen.getByLabelText('Contraseña'), 'Buena#2026');
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('heading', { name: 'Hola, Víctor' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Alertas: 2 pendientes' })).toBeInTheDocument();
    // Lo que todavía no se construye sale en el menú, marcado
    expect(menu().getByRole('link', { name: /Administración.*Pronto/ })).toBeInTheDocument();
    expect(menu().getByRole('link', { name: 'Inicio' })).toHaveAttribute('aria-current', 'page');
    // El administrador sin equipo no tiene pantalla que bloquear ni una caja propia que mostrar
    expect(screen.queryByRole('button', { name: 'Bloquear la pantalla' })).not.toBeInTheDocument();
    expect(pedidas).not.toContain('GET /api/caja/turno');
  });
});

describe('en una tablet registrada y abierta', () => {
  it('se entra con PIN; la barra muestra la sucursal, la caja y el tipo de cambio; bloquear vuelve a la pantalla de PIN', async () => {
    preparar({ pantalla: TABLET_ABIERTA });
    const usuario = montar();

    expect(await screen.findByText('¿Quién va a usar el equipo?')).toBeInTheDocument();
    expect(screen.getByText(/Tablet Las Américas · Multicentro Las Américas/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /María López.*PIN bloqueado/ })).toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: 'Ana Martínez' }));
    for (const digito of '1112') await usuario.click(screen.getByRole('button', { name: digito }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'PIN incorrecto. Le quedan 4 intentos.',
    );
    expect(screen.getByRole('status', { name: /PIN de Ana Martínez: 0 de 4/ })).toBeInTheDocument();

    for (const digito of '2580') await usuario.click(screen.getByRole('button', { name: digito }));
    expect(await screen.findByRole('heading', { name: 'Hola, Ana' })).toBeInTheDocument();

    // Con el turno abierto: sucursal, caja y tipo de cambio del día, siempre a la vista
    const barra = within(screen.getAllByRole('banner')[0]); // la barra superior
    expect(await barra.findByText('Caja 1')).toBeInTheDocument();
    expect(barra.getByText('Multicentro Las Américas')).toBeInTheDocument();
    expect(barra.getByText('US$ 1 = C$ 36.62')).toBeInTheDocument();
    expect(menu().getByRole('link', { name: /Caja/ })).toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: 'Bloquear la pantalla' }));
    expect(await screen.findByText('¿Quién va a usar el equipo?')).toBeInTheDocument();
    expect(pedidas).toContain('POST /api/auth/logout');
  });

  it('quien tiene el PIN bloqueado ve qué hacer, y puede entrar con su contraseña', async () => {
    preparar({ pantalla: TABLET_ABIERTA });
    const usuario = montar();
    await usuario.click(await screen.findByRole('button', { name: /María López/ }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Su PIN está bloqueado/);
    expect(screen.queryByRole('button', { name: '1' })).not.toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Entrar con usuario y contraseña' }));
    expect(screen.getByLabelText('Usuario')).toBeInTheDocument();
  });

  it('una tablet cerrada pide la contraseña y explica por qué', async () => {
    preparar({ pantalla: { equipo: TABLET, abierto: false, usuarios: [] } });
    montar();
    expect(await screen.findByLabelText('Usuario')).toBeInTheDocument();
    expect(screen.getByText(/Este equipo está cerrado/)).toBeInTheDocument();
    expect(screen.queryByText('Entrar con mi PIN')).not.toBeInTheDocument();
  });
});

describe('desde el celular', () => {
  it('la sesión guardada se recupera sola; el menú es el del celular y no hay nada de la caja', async () => {
    preparar({ recuperada: sesionDeVendedora('celular'), pendientes: 1 });
    montar();

    expect(await screen.findByRole('heading', { name: 'Hola, Ana' })).toBeInTheDocument();
    expect(screen.getByText('Está en su celular')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Alertas: 1 pendientes' })).toBeInTheDocument();
    expect(menu().getByRole('link', { name: /Vender/ })).toBeInTheDocument();
    expect(menu().queryByRole('link', { name: /Caja/ })).not.toBeInTheDocument();
    expect(menu().queryByRole('link', { name: /Mermas/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bloquear la pantalla' })).not.toBeInTheDocument();
    // los avisos son los de su sucursal, y el turno de la caja ni se pregunta
    expect(pedidas).toContain('GET /api/alertas/sucursal');
    expect(pedidas).not.toContain('GET /api/alertas');
    expect(pedidas).not.toContain('GET /api/caja/turno');
  });
});

describe('con una contraseña temporal', () => {
  it('no se pasa de crear la propia, y se valida antes de enviarla', async () => {
    const temporal = sesionDeVendedora('tablet');
    temporal.usuario.debe_cambiar_password = true;
    preparar({ recuperada: temporal });
    const usuario = montar();

    expect(await screen.findByRole('heading', { name: 'Cree su contraseña' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    await usuario.type(screen.getByLabelText('Contraseña temporal'), 'k7mx-9qdw-t3hp');
    await usuario.type(screen.getByLabelText('Contraseña nueva'), 'corta1');
    await usuario.type(screen.getByLabelText('Repita la contraseña nueva'), 'otra');
    await usuario.click(screen.getByRole('button', { name: 'Guardar y continuar' }));
    expect(await screen.findByText('Debe tener al menos 8 caracteres')).toBeInTheDocument();
    expect(screen.getByText('Las dos contraseñas nuevas no son iguales')).toBeInTheDocument();
    expect(pedidas).not.toContain('POST /api/auth/cambiar-password');
  });
});
