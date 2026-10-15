import { expect, request, test, type Browser, type Page } from '@playwright/test';

// La venta de punta a punta en Las Américas, con el backend de verdad:
// - el celular del negocio (Android, con la impresora por USB) abre la caja, vende y saca el ticket;
// - Ana vende también desde su propio celular: su ticket queda en la cola y sale en el del negocio,
//   con un toque o solo, incluso con la pantalla bloqueada;
// - el administrador, desde su computadora, anula una venta.
// La impresora es de mentira: guarda lo que el navegador le manda por USB, para leer el ticket.
// Viene después de caja.spec.ts, que dejó las dos cajas cerradas y el tipo de cambio en 36.70.

const ADMIN = { usuario: 'admin', clave: 'Duena#2026' };
const ANA = { usuario: 'ana.martinez', clave: 'Ventas#2026' };
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

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

/** Una impresora USB de mentira: lo que recibe queda, como texto, en `window.__impreso`. */
function impresoraDePrueba() {
  const ventana = window as unknown as { __impreso: string };
  ventana.__impreso = '';
  const alterna = {
    interfaceClass: 7,
    alternateSetting: 0,
    endpoints: [{ direction: 'out', type: 'bulk', endpointNumber: 1 }],
  };
  const configuracion = { interfaces: [{ interfaceNumber: 0, alternates: [alterna] }] };
  const impresora = {
    productName: 'Impresora de prueba',
    configuration: configuracion,
    configurations: [configuracion],
    open: () => Promise.resolve(),
    close: () => Promise.resolve(),
    selectConfiguration: () => Promise.resolve(),
    claimInterface: () => Promise.resolve(),
    transferOut: (_salida: number, datos: Uint8Array) => {
      ventana.__impreso += new TextDecoder('latin1').decode(datos);
      return Promise.resolve({ status: 'ok' });
    },
  };
  Object.defineProperty(navigator, 'usb', {
    configurable: true,
    value: {
      getDevices: () => Promise.resolve([impresora]),
      requestDevice: () => Promise.resolve(impresora),
    },
  });
}

const impreso = (pagina: Page) =>
  pagina.evaluate(() => (window as unknown as { __impreso: string }).__impreso);

/** El celular Android del negocio, registrado en la sucursal y con su impresora por USB. */
async function celularDelNegocio(
  browser: Browser,
  nombre: string,
  sucursal: string,
): Promise<Page> {
  const contexto = await browser.newContext({
    viewport: { width: 412, height: 915 },
    userAgent: ANDROID,
    hasTouch: true,
  });
  await contexto.addInitScript(impresoraDePrueba);
  const pagina = await contexto.newPage();
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
  await pagina.getByRole('button', { name: 'Más' }).click();
  await pagina
    .getByRole('dialog', { name: 'Menú completo' })
    .getByRole('link', { name: opcion })
    .click();
}

/** Busca y toca el resultado: así entra un producto (o la pieza de una perforación) a la venta. */
async function agregar(pagina: Page, texto: string, nombre: RegExp) {
  await pagina.getByRole('searchbox').fill(texto);
  await pagina
    .getByRole('list', { name: 'Resultados' })
    .getByRole('button', { name: nombre })
    .click();
}

/** Una venta de un solo producto, pagada exacta en efectivo. Devuelve el número de factura. */
async function venderExacto(pagina: Page, texto: string, nombre: RegExp): Promise<string> {
  await agregar(pagina, texto, nombre);
  await pagina.getByRole('button', { name: /^Cobrar C\$/ }).click();
  await pagina.getByRole('button', { name: 'Exacto' }).click();
  await pagina.getByRole('button', { name: 'Registrar la venta' }).click();
  await expect(pagina.getByText('Venta registrada')).toBeVisible();
  const factura = await pagina.getByText(/^Factura LAM-\d{8}$/).innerText();
  return factura.replace('Factura ', '');
}

async function parametro(clave: string, valor: string, baseURL: string | undefined) {
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
    'Celular de ventas Las Américas',
    'Multicentro Las Américas',
  );
  personal = await (
    await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
  ).newPage();
  await personal.goto('/');
  dueno = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await dueno.goto('/');
});

test.afterAll(async ({ baseURL }) => {
  await parametro('IMPRESION_AUTOMATICA_COLA', 'NO', baseURL);
  for (const pagina of [mostrador, personal, dueno]) await pagina.context().close();
});

test('en el celular del negocio: abre la caja, vende en efectivo con vuelto y el ticket sale solo', async () => {
  await entrar(mostrador, ANA);
  await irA(mostrador, 'Vender');
  await expect(mostrador.getByText('La caja está cerrada.')).toBeVisible();
  await mostrador.getByRole('link', { name: 'Ir a la caja' }).click();
  await mostrador.getByLabel('Efectivo en córdobas (C$)').fill('500');
  await mostrador.getByRole('button', { name: 'Abrir turno' }).click();
  await expect(mostrador.getByText('Turno abierto')).toBeVisible();

  // con la caja abierta, «Vender» ya está abajo, a un toque
  await mostrador
    .getByRole('navigation', { name: 'Menú' })
    .last()
    .getByRole('link', { name: 'Vender' })
    .click();
  await expect(mostrador.getByText('Multicentro Las Américas · Caja 1')).toBeVisible();
  await agregar(mostrador, 'labret rosca', /16G · 6 mm/);
  await mostrador.getByRole('button', { name: 'Cobrar C$ 650.00' }).click();
  await mostrador.getByLabel('Monto (C$)').fill('1000');
  await expect(mostrador.getByText('C$ 350.00')).toBeVisible(); // el vuelto, antes de registrar
  await mostrador.getByRole('button', { name: 'Registrar la venta' }).click();

  await expect(mostrador.getByText('Venta registrada')).toBeVisible();
  await expect(mostrador.getByText('Factura LAM-00000001')).toBeVisible();
  await expect(mostrador.getByText('Entregue de vuelto')).toBeVisible();
  await expect(mostrador.getByText('C$ 350.00')).toBeVisible();
  // el ticket salió por la impresora sin tocar nada: el original, con su número y su total
  await expect(mostrador.getByText('El ticket se envió a la impresora.')).toBeVisible();
  const ticket = await impreso(mostrador);
  expect(ticket).toContain('Factura LAM-00000001');
  expect(ticket).toContain('TOTAL C$');
  expect(ticket).toContain('650.00');
  expect(ticket).not.toContain('COPIA');
});

test('perforación con pieza, promoción y tarjeta: el precio del paquete lo pone la base', async () => {
  await mostrador.getByRole('button', { name: 'Nueva venta' }).click();
  await agregar(mostrador, 'Lóbulo con', /Perforación Lóbulo con pieza/);
  await expect(mostrador.getByText('Busque o escanee la pieza que se lleva.')).toBeVisible();
  await agregar(mostrador, 'aro', /Aro segmento/);
  // lóbulo con una pieza de acero clásica: C$ 350 de la tabla, no servicio + pieza
  await expect(mostrador.getByText('Precio con la pieza')).toBeVisible();
  await expect(mostrador.getByText('C$ 350.00')).toBeVisible();
  await mostrador.getByRole('button', { name: 'Agregar a la venta' }).click();
  await agregar(mostrador, 'neilmed', /NeilMed/);

  const promocion = mostrador.getByLabel('Promoción');
  const diezPorCiento = await promocion
    .locator('option', { hasText: 'Promo 10 %' })
    .getAttribute('value');
  await promocion.selectOption(diezPorCiento);
  await expect(mostrador.getByText('C$ 870.00')).toBeVisible(); // subtotal
  await mostrador.getByRole('button', { name: 'Cobrar C$ 783.00' }).click();
  await mostrador.getByLabel('Forma de pago').selectOption({ label: 'Tarjeta' });
  await mostrador.getByRole('button', { name: 'Exacto' }).click();
  await expect(mostrador.getByRole('button', { name: 'Registrar la venta' })).toBeDisabled();
  await mostrador.getByLabel(/^Referencia/).fill('784512');
  await mostrador.getByRole('button', { name: 'Registrar la venta' }).click();

  await expect(mostrador.getByText('Factura LAM-00000002')).toBeVisible();
  await expect(mostrador.getByText('Sin vuelto')).toBeVisible();
  await expect.poll(() => impreso(mostrador)).toContain('Factura LAM-00000002');
  const ticket = (await impreso(mostrador)).split('Factura LAM-00000002')[1];
  expect(ticket).toContain('Promo 10 %');
  expect(ticket).toContain('783.00');
  expect(ticket).toContain('ref. 784512');
});

test('desde su propio celular vende en la caja abierta; el ticket espera en el celular del negocio', async () => {
  await entrar(personal, ANA);
  await expect(personal.getByText('Está en su celular')).toBeVisible();
  await personal
    .getByRole('navigation', { name: 'Menú' })
    .last()
    .getByRole('link', { name: 'Vender' })
    .click();
  await expect(personal.getByText('Multicentro Las Américas · Caja 1')).toBeVisible();
  const factura = await venderExacto(personal, 'neilmed', /NeilMed/);
  expect(factura).toBe('LAM-00000003');

  // desde el celular no se imprime en papel: queda en la cola, y se puede compartir en PDF
  await expect(personal.getByText('El ticket está en «Tickets por imprimir»')).toBeVisible();
  await expect(personal.getByRole('button', { name: /Imprimir/ })).toHaveCount(0);
  // (en un celular de verdad el botón es «Compartir»; este navegador de prueba solo descarga)
  await expect(
    personal
      .getByRole('button', { name: 'Compartir el ticket digital' })
      .or(personal.getByRole('link', { name: 'Descargar el ticket digital' })),
  ).toBeVisible();
  const desborde = await personal.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(desborde).toBe(0);

  // en el celular del negocio aparece el aviso; con un toque sale, y es el original
  await mostrador.getByRole('link', { name: '1 ticket por imprimir' }).click({ timeout: 20_000 });
  await expect(mostrador.getByRole('heading', { name: 'Tickets por imprimir' })).toBeVisible();
  await expect(mostrador.getByText(factura)).toBeVisible();
  await expect(mostrador.getByText(/vendió Ana Martínez/)).toBeVisible();
  await mostrador.getByRole('button', { name: 'Imprimir', exact: true }).click();
  await expect(mostrador.getByText('No hay ningún ticket esperando.')).toBeVisible();
  const ticket = (await impreso(mostrador)).split(`Factura ${factura}`)[1];
  expect(ticket).toContain('520.00');
  expect(await impreso(mostrador)).not.toContain('COPIA');

  // y a ella, en su celular, le avisa de que ya salió
  await expect(personal.getByText('El ticket ya salió impreso en la sucursal.')).toBeVisible({
    timeout: 15_000,
  });
});

test('«No imprimir»: el ticket sale de la cola sin gastar papel', async () => {
  await personal.getByRole('button', { name: 'Nueva venta' }).click();
  const factura = await venderExacto(personal, 'cadena', /Cadena cartier/);

  await expect(mostrador.getByText(factura)).toBeVisible({ timeout: 20_000 });
  await mostrador.getByRole('button', { name: 'No imprimir' }).click();
  await mostrador.getByRole('button', { name: 'No imprimirlo' }).click();
  await expect(mostrador.getByText('No hay ningún ticket esperando.')).toBeVisible();
  expect(await impreso(mostrador)).not.toContain(factura);
  await expect(personal.getByText('El ticket no se imprimió en papel.')).toBeVisible({
    timeout: 15_000,
  });
});

test('con la cola automática el ticket sale solo, aunque la pantalla esté bloqueada', async ({
  baseURL,
}) => {
  // Ana ya tiene PIN (lo creó en tablet.spec.ts): bloqueado, el equipo muestra la pantalla de PIN
  const bloqueada = mostrador.getByRole('heading', { name: '¿Quién va a usar el equipo?' });
  await parametro('IMPRESION_AUTOMATICA_COLA', 'SI', baseURL);
  await mostrador.getByRole('button', { name: 'Bloquear la pantalla' }).click();
  await expect(bloqueada).toBeVisible();

  await personal.getByRole('button', { name: 'Nueva venta' }).click();
  const factura = await venderExacto(personal, 'aro', /Aro segmento/);

  // nadie ha entrado en el celular del negocio: imprime con la cookie del equipo
  await expect.poll(() => impreso(mostrador), { timeout: 30_000 }).toContain(`Factura ${factura}`);
  await expect(bloqueada).toBeVisible();
  await expect(mostrador.getByText(/por imprimir/)).toHaveCount(0);
  expect(await impreso(mostrador)).not.toContain('COPIA');
  await expect(personal.getByText('El ticket ya salió impreso en la sucursal.')).toBeVisible({
    timeout: 15_000,
  });
});

test('el administrador anula una venta desde su computadora; la vendedora la ve anulada', async () => {
  await entrar(dueno, ADMIN);
  await dueno
    .getByRole('navigation', { name: 'Menú' })
    .first()
    .getByRole('link', { name: 'Vender' })
    .click();
  await dueno.getByRole('link', { name: 'Ventas del turno' }).click();
  await expect(dueno.getByRole('heading', { name: 'Últimas ventas' })).toBeVisible();
  // solo él ve cuáles se hicieron desde un celular
  await expect(
    dueno.getByRole('listitem').filter({ hasText: 'LAM-00000003' }).getByText('Desde celular'),
  ).toBeVisible();
  await expect(
    dueno.getByRole('listitem').filter({ hasText: 'LAM-00000001' }).getByText('Desde celular'),
  ).toHaveCount(0);

  await dueno.getByRole('link', { name: /LAM-00000002/ }).click();
  await expect(
    dueno.getByText('1 × Perforación Lóbulo con pieza — Con pieza incluida'),
  ).toBeVisible();
  await expect(dueno.getByText('+ Aro segmento — Acero · 16G · 8 mm')).toBeVisible();
  await dueno.getByLabel('Motivo de la anulación').fill('La clienta se arrepintió');
  await dueno.getByRole('button', { name: 'Anular la venta' }).click();
  await dueno.getByRole('button', { name: 'Sí, anularla' }).click();
  await expect(dueno.getByText(/Anulada el .* por Administrador/)).toBeVisible();

  // Ana vuelve a entrar en el celular del negocio con su PIN: sus ventas del turno, sin sumas
  await mostrador.getByRole('button', { name: 'Ana Martínez' }).click();
  for (const digito of '2580') {
    await mostrador.getByRole('button', { name: digito, exact: true }).click();
  }
  await expect(mostrador.getByRole('heading', { name: 'Hola, Ana' })).toBeVisible();
  await mostrador
    .getByRole('navigation', { name: 'Menú' })
    .last()
    .getByRole('link', { name: 'Vender' })
    .click();
  await mostrador.getByRole('link', { name: 'Ventas del turno' }).click();
  await expect(mostrador.getByRole('listitem').filter({ hasText: 'LAM-00000002' })).toContainText(
    'Anulada',
  );
  await expect(mostrador.getByRole('listitem').filter({ hasText: 'LAM-0000000' })).toHaveCount(5);
  await expect(mostrador.getByText('Desde celular')).toHaveCount(0);
  await expect(mostrador.locator('main')).not.toContainText(
    /esperad|diferencia|vendido|total del/i,
  );
  // la vendedora no anula: en la venta no tiene ese botón
  await mostrador.getByRole('link', { name: /LAM-00000001/ }).click();
  await expect(mostrador.getByRole('heading', { name: /Factura LAM-00000001/ })).toBeVisible();
  await expect(mostrador.getByRole('button', { name: 'Imprimir el ticket' })).toBeVisible();
  await expect(mostrador.getByRole('button', { name: 'Anular la venta' })).toHaveCount(0);
});
