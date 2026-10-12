import { expect, request, test, type Browser, type Page } from '@playwright/test';

// Devoluciones y cambios, parte 1 (solicitar y aprobar), con el backend de verdad:
// - en el celular del negocio de Las Américas, Ana solicita la devolución de una cadena buscando
//   la factura por su número corto, y encuentra otra con «No tiene el ticket»;
// - desde su propio celular solicita un cambio y le avisa al administrador por WhatsApp;
// - el administrador, desde su iPhone, aprueba una y rechaza la otra;
// - cada devolución muestra su monto y nunca hay sumas.
// Viene después de venta.spec.ts, que dejó la caja de Las Américas abierta con cinco facturas de
// Ana: 1 labret de titanio, 2 anulada, 3 NeilMed (C$ 520), 4 cadena (C$ 1,200) y 5 aro de acero.

const ADMIN = { usuario: 'admin', clave: 'Duena#2026' };
const ANA = { usuario: 'ana.martinez', clave: 'Ventas#2026' };

test.describe.configure({ mode: 'serial' });

let mostrador: Page;
let personal: Page;
let dueno: Page;

async function entrar(pagina: Page, quien: { usuario: string; clave: string }) {
  await pagina.getByLabel('Usuario').fill(quien.usuario);
  await pagina.getByLabel('Contraseña', { exact: true }).fill(quien.clave);
  await pagina.getByRole('button', { name: 'Entrar' }).click();
  await expect(pagina.getByRole('heading', { name: /^Hola, / })).toBeVisible();
}

/** El celular Android del negocio, registrado por el administrador en la sucursal. */
async function celularDelNegocio(
  browser: Browser,
  nombre: string,
  sucursal: string,
): Promise<Page> {
  const pagina = await (
    await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true })
  ).newPage();
  await pagina.goto('/');
  await entrar(pagina, ADMIN);
  await pagina.goto('/equipo');
  await pagina.getByLabel('Nombre del equipo').fill(nombre);
  await pagina.getByLabel('Qué es').selectOption({ label: 'Celular del negocio' });
  await pagina.getByLabel('Sucursal', { exact: true }).selectOption({ label: sucursal });
  await pagina.getByRole('button', { name: 'Registrar este equipo' }).click();
  await pagina.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(pagina.getByText(`${nombre} · ${sucursal}`)).toBeVisible();
  return pagina;
}

async function irA(pagina: Page, opcion: string) {
  // exacto: en la solicitud hay botones «Una más de…»
  await pagina.getByRole('button', { name: 'Más', exact: true }).click();
  await pagina
    .getByRole('dialog', { name: 'Menú completo' })
    .getByRole('link', { name: opcion })
    .click();
}

/** Abre la factura escribiendo su número, como lo haría la vendedora con el ticket en la mano. */
async function buscarFactura(pagina: Page, escrito: string, numero: string) {
  await irA(pagina, 'Devoluciones');
  await pagina.getByRole('link', { name: 'Nueva solicitud' }).click();
  await pagina.getByLabel('Número de factura').fill(escrito);
  await pagina.getByRole('button', { name: 'Buscar la factura' }).click();
  await expect(pagina.getByRole('heading', { name: `Factura ${numero}` })).toBeVisible();
}

async function sinDesborde(pagina: Page) {
  const desborde = await pagina.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(desborde).toBe(0);
}

/**
 * Para ver cómo quedan las pantallas: con `CAPTURAS=<carpeta>` (una carpeta fuera del repositorio)
 * el recorrido guarda una imagen de cada una. Sin esa variable no hace nada.
 */
async function captura(pagina: Page, nombre: string) {
  const carpeta = process.env.CAPTURAS;
  if (carpeta) await pagina.screenshot({ path: `${carpeta}/${nombre}.png`, fullPage: true });
}

async function parametro(clave: string, valor: string | null, baseURL: string | undefined) {
  const api = await request.newContext({ baseURL });
  const sesion = await api.post('/api/auth/login', {
    data: { username: ADMIN.usuario, password: ADMIN.clave },
  });
  const { access_token: token } = (await sesion.json()) as { access_token: string };
  const respuesta = await api.put(`/api/parametros/${clave}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { valor },
  });
  expect(respuesta.ok()).toBe(true);
  await api.dispose();
}

test.beforeAll(async ({ browser }) => {
  mostrador = await celularDelNegocio(
    browser,
    'Celular de devoluciones Las Américas',
    'Multicentro Las Américas',
  );
  personal = await (
    await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
  ).newPage();
  await personal.goto('/');
  // el iPhone del administrador: sin equipo registrado
  dueno = await (
    await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
  ).newPage();
  await dueno.goto('/');
});

test.afterAll(async ({ baseURL }) => {
  await parametro('WHATSAPP_ADMINISTRADOR', null, baseURL);
  for (const pagina of [mostrador, personal, dueno]) await pagina.context().close();
});

test('con la caja todavía abierta la venta se anula: no se puede solicitar su devolución', async () => {
  await entrar(mostrador, ANA);
  await buscarFactura(mostrador, '4', 'LAM-00000004');
  await expect(mostrador.getByText('Esta factura no se puede devolver.')).toBeVisible();
  await expect(mostrador.getByText(/turno que sigue abierto: se anula/)).toBeVisible();
  await expect(mostrador.getByRole('button', { name: 'Enviar la solicitud' })).toHaveCount(0);

  // Ana cierra la caja (el conteo no cuadra: un solo reconteo, con su justificación)
  await irA(mostrador, 'Caja');
  await mostrador.getByRole('button', { name: 'Cerrar la caja' }).click();
  await mostrador.getByRole('button', { name: 'Cerrar la caja' }).click();
  await mostrador.getByRole('button', { name: 'Sí, cerrar' }).click();
  await expect(mostrador.getByText(/Queda un solo reconteo/)).toBeVisible();
  await mostrador.getByLabel(/Justificación/).fill('Cierre para probar las devoluciones');
  await mostrador.getByRole('button', { name: 'Cerrar la caja' }).click();
  await mostrador.getByRole('button', { name: 'Sí, cerrar' }).click();
  await expect(mostrador.getByText(/La caja quedó cerrada/)).toBeVisible();
});

test('en el celular del negocio: solicita la devolución de la cadena escribiendo solo el número', async () => {
  await buscarFactura(mostrador, '4', 'LAM-00000004');
  await expect(mostrador.getByText(/Se puede devolver hasta el/)).toBeVisible();
  const enviar = mostrador.getByRole('button', { name: 'Enviar la solicitud' });
  await expect(enviar).toBeDisabled();

  await mostrador.getByRole('button', { name: /^Devolución/ }).click();
  await mostrador.getByRole('button', { name: /^Una más de Cadena cartier/ }).click();
  await expect(mostrador.getByText('Monto de esta solicitud (aprox.)')).toBeVisible();
  await mostrador.getByLabel('Motivo', { exact: true }).fill('No le gustó el largo');
  await mostrador.getByLabel('Nombre del cliente').fill('Carla Cliente');
  await mostrador.getByLabel('Teléfono del cliente').fill('8888-1234');
  await sinDesborde(mostrador);
  await captura(mostrador, '1-equipo-solicitud');
  await enviar.click();

  await expect(mostrador.getByText('Solicitud enviada.')).toBeVisible();
  await expect(mostrador.getByText('Esperando la aprobación del administrador.')).toBeVisible();
  // la factura se pagó en efectivo: lo previsto es que todo salga de la caja
  await expect(
    mostrador.getByRole('listitem').filter({ hasText: 'En efectivo, de la caja' }),
  ).toContainText('C$ 1,200.00');
  await expect(mostrador.getByText(/^Por transferencia/)).toHaveCount(0);
  // el administrador todavía no pone su número: no hay botón de aviso
  await expect(mostrador.getByRole('link', { name: 'Avisar al administrador' })).toHaveCount(0);
  await sinDesborde(mostrador);
  await captura(mostrador, '2-equipo-solicitud-enviada');
});

test('el administrador, desde su iPhone, la abre desde la alerta y la aprueba; en el equipo aparece sola', async () => {
  await entrar(dueno, ADMIN);
  await expect(dueno.getByText('Hay 1 por aprobar.')).toBeVisible();
  await dueno
    .getByRole('banner')
    .first()
    .getByRole('link', { name: /^Alertas/ })
    .click();
  await dueno
    .getByRole('listitem')
    .filter({ hasText: 'Devolución por aprobar: factura LAM-00000004' })
    .getByRole('link', { name: 'Ver la solicitud' })
    .click();

  await expect(dueno.getByRole('heading', { name: /Devolución n\.º \d+/ })).toBeVisible();
  await expect(dueno.getByText('1 × Cadena cartier — Plata 925 · 45 cm')).toBeVisible();
  await expect(dueno.getByText('No le gustó el largo')).toBeVisible();
  await expect(dueno.getByText('Carla Cliente · 8888-1234')).toBeVisible();
  await expect(dueno.getByText(/La solicitó Ana Martínez/)).toBeVisible();
  await sinDesborde(dueno);
  await captura(dueno, '3-administrador-solicitud');
  await dueno.getByRole('button', { name: 'Aprobar' }).click();
  await dueno.getByRole('button', { name: 'Sí, aprobar' }).click();
  await expect(dueno.getByText(/Aprobada por Administrador/)).toBeVisible();
  await expect(dueno.getByRole('button', { name: 'Aprobar' })).toHaveCount(0);

  // Ana sigue con la solicitud abierta en el celular del negocio: cambia sin que toque nada
  await expect(mostrador.getByText(/Aprobada por Administrador/)).toBeVisible({ timeout: 25_000 });
  await expect(mostrador.getByText(/Se puede ejecutar hasta el/)).toBeVisible();
});

test('el administrador pone su número de WhatsApp para que le avisen', async () => {
  await dueno.goto('/devoluciones');
  // ya no queda nada por aprobar
  await expect(dueno.getByText('No hay ninguna por aprobar.')).toBeVisible();
  await dueno.getByLabel('Su número de WhatsApp, con el código del país').fill('+505 8888 7777');
  await dueno.getByRole('button', { name: 'Guardar el número' }).click();
  await expect(dueno.getByText('Número guardado.')).toBeVisible();
  await sinDesborde(dueno);
  await captura(dueno, '4-administrador-lista-y-whatsapp');
});

test('desde su propio celular Ana solicita un cambio y le avisa al administrador por WhatsApp', async () => {
  await entrar(personal, ANA);
  await irA(personal, 'Devoluciones');
  await personal.getByRole('link', { name: 'Nueva solicitud' }).click();
  // «No tiene el ticket» es solo del equipo de la sucursal
  await expect(personal.getByLabel('Número de factura')).toBeVisible();
  await expect(personal.getByRole('button', { name: 'No tiene el ticket' })).toHaveCount(0);
  await expect(personal.getByText(/se busca por su día en el equipo de la sucursal/)).toBeVisible();

  await personal.getByLabel('Número de factura').fill('lam-3');
  await personal.getByRole('button', { name: 'Buscar la factura' }).click();
  await expect(personal.getByRole('heading', { name: 'Factura LAM-00000003' })).toBeVisible();
  await personal.getByRole('button', { name: /^Cambio/ }).click();
  await personal.getByRole('button', { name: /^Una más de NeilMed/ }).click();
  await personal.getByRole('button', { name: 'Defectuoso' }).click();
  await personal.getByLabel('Motivo', { exact: true }).fill('El frasco venía roto');
  await personal.getByLabel('Nombre del cliente').fill('Rosa Pérez');
  await personal.getByLabel('Teléfono del cliente').fill('7777-0000');
  await personal.getByRole('button', { name: 'Enviar la solicitud' }).click();

  await expect(personal.getByText('Solicitud enviada.')).toBeVisible();
  await expect(personal.getByRole('heading', { name: /Cambio n\.º \d+/ })).toBeVisible();
  await expect(personal.getByText('Defectuoso')).toBeVisible();
  await expect(
    personal.getByText(/Es un cambio: lo que se lleva el cliente se elige al ejecutarlo/),
  ).toBeVisible();

  // el aviso abre WhatsApp con el mensaje ya escrito: solicitud, factura, monto y sucursal
  const destino =
    (await personal.getByRole('link', { name: 'Avisar al administrador' }).getAttribute('href')) ??
    '';
  expect(destino.startsWith('https://wa.me/50588887777?text=')).toBe(true);
  const mensaje = decodeURIComponent(destino.split('?text=')[1]);
  expect(mensaje).toMatch(/^Solicitud de cambio n\.º \d+\n/);
  expect(mensaje).toContain('Factura: LAM-00000003');
  expect(mensaje).toContain('Monto: C$ 520.00');
  expect(mensaje).toContain('Sucursal: Multicentro Las Américas');
  expect(mensaje).not.toMatch(/Rosa|7777-0000/); // nada del cliente
  await sinDesborde(personal);
  await captura(personal, '5-celular-cambio-con-aviso');
});

test('el administrador rechaza el cambio con su comentario; a ella le aparece el motivo', async () => {
  await dueno.goto('/devoluciones');
  const fila = dueno.getByRole('link', { name: /Cambio · LAM-00000003/ });
  await expect(fila).toContainText('C$ 520.00');
  await fila.click();
  await expect(dueno.getByRole('button', { name: 'Rechazar' })).toBeDisabled();
  await dueno
    .getByLabel('Comentario (obligatorio para rechazar)')
    .fill('Los frascos abiertos no se cambian');
  await dueno.getByRole('button', { name: 'Rechazar' }).click();
  await dueno.getByRole('button', { name: 'Sí, rechazar' }).click();
  await expect(dueno.getByText(/Rechazada por Administrador/)).toBeVisible();

  await expect(personal.getByText('Motivo: Los frascos abiertos no se cambian')).toBeVisible({
    timeout: 25_000,
  });
  await expect(personal.getByRole('link', { name: 'Avisar al administrador' })).toHaveCount(0);
  await captura(personal, '6-celular-rechazada');
});

test('«No tiene el ticket» en el celular del negocio: sus ventas con su monto, sin sumas', async () => {
  await irA(mostrador, 'Devoluciones');
  await mostrador.getByRole('link', { name: 'Nueva solicitud' }).click();
  await mostrador.getByRole('button', { name: 'No tiene el ticket' }).click();
  await expect(mostrador.getByText(/en los últimos 7 días/)).toBeVisible();

  // las cuatro facturas de Ana que siguen en pie (la 2 se anuló), cada una con lo suyo
  await expect(mostrador.getByRole('link', { name: /LAM-0000000\d/ })).toHaveCount(4);
  await expect(mostrador.getByRole('link', { name: /LAM-00000002/ })).toHaveCount(0);
  const cadena = mostrador.getByRole('link', { name: /LAM-00000004/ });
  await expect(cadena).toContainText('C$ 1,200.00');
  await expect(cadena).toContainText('Cadena cartier — Plata 925 · 45 cm');
  await expect(mostrador.getByRole('link', { name: /LAM-00000003/ })).toContainText('C$ 520.00');
  // la caja ya está cerrada: ninguna dice que se anula
  await expect(mostrador.getByText('Caja abierta: se anula')).toHaveCount(0);
  // el arqueo es a ciegas: ninguna suma de lo vendido
  await expect(mostrador.locator('main')).not.toContainText(/total|suma|esperad|2,370/i);
  await sinDesborde(mostrador);
  await captura(mostrador, '7-equipo-no-tiene-el-ticket');

  // de ayer no hay nada
  const dia = mostrador.getByLabel('Día de la venta');
  await dia.selectOption({ label: 'Ayer' });
  await expect(mostrador.getByText('No hay ventas de ese día.')).toBeVisible();
  await dia.selectOption({ label: 'Hoy' });

  // el aro es una pieza de piercing: se encuentra, pero no se devuelve
  await mostrador.getByRole('link', { name: /LAM-00000005/ }).click();
  await expect(mostrador.getByRole('heading', { name: 'Factura LAM-00000005' })).toBeVisible();
  await expect(
    mostrador.getByText('La categoría "Piercing acero" no admite devoluciones'),
  ).toBeVisible();
  await expect(mostrador.getByRole('button', { name: 'Enviar la solicitud' })).toHaveCount(0);
});

test('Ana cancela la aprobada: la cadena vuelve a quedar disponible', async () => {
  await irA(mostrador, 'Devoluciones');
  // la sucursal entra por las aprobadas, que son las que se ejecutan en caja
  await expect(mostrador.getByRole('tab', { name: 'Aprobadas' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const aprobada = mostrador.getByRole('link', { name: /Devolución · LAM-00000004/ });
  await expect(aprobada).toContainText(/Vence el \d{2}\/\d{2}\/\d{4}/);
  await aprobada.click();
  await mostrador.getByLabel('Motivo de la cancelación').fill('La clienta se quedó con la cadena');
  await mostrador.getByRole('button', { name: 'Cancelar la solicitud' }).click();
  await mostrador.getByRole('button', { name: 'Sí, cancelarla' }).click();
  await expect(mostrador.getByText(/Cancelada por Ana Martínez/)).toBeVisible();

  await mostrador.getByRole('link', { name: 'LAM-00000004', exact: true }).click();
  await expect(mostrador.getByText(/Queda 1 por devolver/)).toBeVisible();
  await expect(mostrador.getByText('Solicitudes de esta factura')).toBeVisible();

  // en «Todas» quedan las dos, cada una con su monto y sin ninguna suma
  await irA(mostrador, 'Devoluciones');
  await mostrador.getByRole('tab', { name: 'Todas' }).click();
  await expect(mostrador.getByRole('link', { name: /LAM-0000000\d/ })).toHaveCount(2);
  await expect(mostrador.locator('main')).not.toContainText(/1,720|total|suma/i);
  await captura(mostrador, '8-equipo-lista-todas');
});
