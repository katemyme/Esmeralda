import { expect, request, test, type Browser, type Page } from '@playwright/test';

// Devoluciones y cambios, parte 2 (ejecutar en caja), con el backend de verdad. En el celular del
// negocio de Las Américas (Android, con la impresora por USB de mentira), Ana vende cuatro facturas
// y cierra la caja; el administrador aprueba sus devoluciones y, con la caja abierta otra vez, Ana
// las ejecuta:
//   - la de efectivo (llega defectuosa): sale de la caja, abre la gaveta y la copia dice COPIA;
//   - la de tarjeta: nada sale de la caja, todo queda por transferir;
//   - un cambio de la venta mixta por algo más barato: antes de ejecutar dice cuánto se le devuelve
//     y cómo; salen el ticket del cambio y la factura nueva;
//   - un cambio por algo más caro: se cobra la diferencia.
// Después el administrador, desde su iPhone, anota una de las transferencias.
// Viene después de devoluciones.spec.ts, que dejó la caja de Las Américas cerrada y sin ninguna
// devolución aprobada.

const ADMIN = { usuario: 'admin', clave: 'Duena#2026' };
const ANA = { usuario: 'ana.martinez', clave: 'Ventas#2026' };
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const GAVETA = '\x1bp\x00'; // ESC p 0: el pulso que abre la gaveta

test.describe.configure({ mode: 'serial' });

let mostrador: Page;
let dueno: Page;
/** Las facturas del día, por cómo se pagaron, y sus solicitudes ya aprobadas. */
const factura = { efectivo: '', tarjeta: '', mixta: '', otra: '' };
const solicitud = { efectivo: 0, tarjeta: 0, mixta: 0, otra: 0 };

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

/** Lo que salió por la impresora desde que se tomó la marca `desde`. */
async function impresoDesde(pagina: Page, desde: number): Promise<string> {
  return (await impreso(pagina)).slice(desde);
}

async function celularDelNegocio(browser: Browser): Promise<Page> {
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
  await pagina.getByLabel('Nombre del equipo').fill('Celular de caja Las Américas');
  await pagina.getByLabel('Qué es').selectOption({ label: 'Celular del negocio' });
  await pagina
    .getByLabel('Sucursal', { exact: true })
    .selectOption({ label: 'Multicentro Las Américas' });
  await pagina.getByRole('button', { name: 'Registrar este equipo' }).click();
  await pagina.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(
    pagina.getByText('Celular de caja Las Américas · Multicentro Las Américas'),
  ).toBeVisible();
  return pagina;
}

async function irA(pagina: Page, opcion: string) {
  await pagina.getByRole('button', { name: 'Más', exact: true }).click();
  await pagina
    .getByRole('dialog', { name: 'Menú completo' })
    .getByRole('link', { name: opcion })
    .click();
}

async function sinDesborde(pagina: Page) {
  const desborde = await pagina.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(desborde).toBe(0);
}

/** Busca y toca el resultado: así entra un producto a la venta (o al cambio). */
async function agregar(pagina: Page, texto: string, nombre: RegExp) {
  await pagina.getByRole('searchbox').fill(texto);
  await pagina
    .getByRole('list', { name: 'Resultados' })
    .getByRole('button', { name: nombre })
    .click();
}

/**
 * Una venta de un producto. `pagos`: lo que va en cada forma de pago (el último, «Exacto»); con
 * tarjeta, su referencia. Devuelve el número de factura.
 */
async function vender(
  pagina: Page,
  texto: string,
  nombre: RegExp,
  pagos: { forma: string; monto?: string }[],
): Promise<string> {
  await agregar(pagina, texto, nombre);
  await pagina.getByRole('button', { name: /^Cobrar C\$/ }).click();
  for (const [i, pago] of pagos.entries()) {
    // el primero se llena cuando todavía es el único (su etiqueta no lleva número)
    const numero = i > 0 ? ` ${i + 1}` : '';
    if (i > 0) await pagina.getByRole('button', { name: /Agregar otra forma de pago/ }).click();
    await pagina.getByLabel(`Forma de pago${numero}`).selectOption({ label: pago.forma });
    if (pago.monto) await pagina.getByLabel(new RegExp(`^Monto${numero} \\(`)).fill(pago.monto);
    // «Exacto» del pago que se está llenando (el último): el de antes también lo ofrece
    else await pagina.getByRole('button', { name: 'Exacto' }).last().click();
    if (pago.forma === 'Tarjeta') {
      await pagina
        .getByLabel(new RegExp(`^Referencia${numero}`))
        .fill(`V-${i}${Date.now() % 1000}`);
    }
  }
  await pagina.getByRole('button', { name: 'Registrar la venta' }).click();
  await expect(pagina.getByText('Venta registrada')).toBeVisible();
  const texto_ = await pagina.getByText(/^Factura LAM-\d{8}$/).innerText();
  await pagina.getByRole('button', { name: 'Nueva venta' }).click();
  return texto_.replace('Factura ', '');
}

/** El administrador, por la API: solicita (desde la sucursal de la venta) y aprueba. */
async function solicitarYAprobar(
  numero: string,
  tipo: 'DEVOLUCION' | 'CAMBIO',
  baseURL: string | undefined,
): Promise<number> {
  const api = await request.newContext({ baseURL });
  const sesion = await api.post('/api/auth/login', {
    data: { username: ADMIN.usuario, password: ADMIN.clave },
  });
  const { access_token: token } = (await sesion.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${token}` };
  const buscada = await api.get(`/api/devoluciones/venta?numero=${numero}`, { headers });
  const { venta } = (await buscada.json()) as {
    venta: { id: number; sucursal: { id: number }; lineas: { detalle_id: number }[] };
  };
  const creada = await api.post('/api/devoluciones', {
    headers,
    data: {
      venta_id: venta.id,
      tipo,
      motivo: 'Pruebas de ejecutar en caja',
      cliente_nombre: 'Lía Cliente',
      cliente_telefono: '8555-1212',
      sucursal_id: venta.sucursal.id,
      lineas: [{ detalle_id: venta.lineas[0].detalle_id, cantidad: 1, estado: 'BUENO' }],
    },
  });
  expect(creada.status()).toBe(201);
  const { devolucion } = (await creada.json()) as { devolucion: { id: number } };
  const aprobada = await api.post(`/api/devoluciones/${devolucion.id}/resolver`, {
    headers,
    data: { aprobar: true },
  });
  expect(aprobada.ok()).toBe(true);
  await api.dispose();
  return devolucion.id;
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

/** Abre una devolución aprobada desde la lista de la sucursal y entra a ejecutarla. */
async function abrirParaEjecutar(pagina: Page, numeroFactura: string) {
  await irA(pagina, 'Devoluciones');
  await expect(pagina.getByRole('tab', { name: 'Aprobadas' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await pagina.getByRole('link', { name: new RegExp(`· ${numeroFactura}`) }).click();
  await pagina.getByRole('link', { name: 'Ejecutar en caja' }).click();
}

test.beforeAll(async ({ browser }) => {
  mostrador = await celularDelNegocio(browser);
  // el iPhone del administrador: sin equipo registrado
  dueno = await (
    await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
  ).newPage();
  await dueno.goto('/');
});

test.afterAll(async ({ baseURL }) => {
  await parametro('IMPRESION_ABRIR_GAVETA', 'NO', baseURL);
  for (const pagina of [mostrador, dueno]) await pagina.context().close();
});

test('Ana vende en efectivo, con tarjeta, mixto y otra en efectivo, y cierra la caja', async ({
  baseURL,
}) => {
  await entrar(mostrador, ANA);
  await irA(mostrador, 'Caja');
  await mostrador.getByLabel('Efectivo en córdobas (C$)').fill('2000');
  await mostrador.getByRole('button', { name: 'Abrir turno' }).click();
  await expect(mostrador.getByText('Turno abierto')).toBeVisible();

  await irA(mostrador, 'Vender');
  factura.efectivo = await vender(mostrador, 'neilmed', /NeilMed/, [
    { forma: 'Efectivo en córdobas' },
  ]);
  factura.tarjeta = await vender(mostrador, 'cadena', /Cadena cartier/, [{ forma: 'Tarjeta' }]);
  factura.mixta = await vender(mostrador, 'neilmed', /NeilMed/, [
    { forma: 'Efectivo en córdobas', monto: '300' },
    { forma: 'Tarjeta' },
  ]);
  factura.otra = await vender(mostrador, 'neilmed', /NeilMed/, [{ forma: 'Efectivo en córdobas' }]);

  // se cierra (no cuadra: un solo reconteo con su justificación)
  await irA(mostrador, 'Caja');
  await mostrador.getByRole('button', { name: 'Cerrar la caja' }).click();
  await mostrador.getByRole('button', { name: 'Cerrar la caja' }).click();
  await mostrador.getByRole('button', { name: 'Sí, cerrar' }).click();
  await expect(mostrador.getByText(/Queda un solo reconteo/)).toBeVisible();
  await mostrador.getByLabel(/Justificación/).fill('Cierre para probar las devoluciones en caja');
  await mostrador.getByRole('button', { name: 'Cerrar la caja' }).click();
  await mostrador.getByRole('button', { name: 'Sí, cerrar' }).click();
  await expect(mostrador.getByText(/La caja quedó cerrada/)).toBeVisible();

  // las solicitudes, ya aprobadas por el administrador; la gaveta, encendida
  solicitud.efectivo = await solicitarYAprobar(factura.efectivo, 'DEVOLUCION', baseURL);
  solicitud.tarjeta = await solicitarYAprobar(factura.tarjeta, 'DEVOLUCION', baseURL);
  solicitud.mixta = await solicitarYAprobar(factura.mixta, 'CAMBIO', baseURL);
  solicitud.otra = await solicitarYAprobar(factura.otra, 'CAMBIO', baseURL);
  await parametro('IMPRESION_ABRIR_GAVETA', 'SI', baseURL);
});

test('con la caja cerrada no se ejecuta: hay que abrirla primero', async () => {
  await abrirParaEjecutar(mostrador, factura.efectivo);
  await expect(mostrador.getByText('La caja está cerrada.')).toBeVisible();
  await mostrador.getByRole('link', { name: 'Ir a la caja' }).click();
  await mostrador.getByLabel('Efectivo en córdobas (C$)').fill('2000');
  await mostrador.getByRole('button', { name: 'Abrir turno' }).click();
  await expect(mostrador.getByText('Turno abierto')).toBeVisible();
});

test('la devolución en efectivo: llega defectuosa, sale de la caja, abre la gaveta y la copia dice COPIA', async () => {
  await abrirParaEjecutar(mostrador, factura.efectivo);
  await expect(
    mostrador.getByRole('heading', { name: /Ejecutar la devolución n\.º \d+/ }),
  ).toBeVisible();
  await expect(mostrador.getByText('En efectivo, de la caja').locator('..')).toContainText(
    'C$ 520.00',
  );
  await expect(
    mostrador.getByText('Por transferencia (la hace la administración)').locator('..'),
  ).toContainText('C$ 0.00');
  await mostrador.getByRole('button', { name: 'Defectuoso' }).click();
  await expect(mostrador.getByText('Se pidió en buen estado.')).toBeVisible();
  await sinDesborde(mostrador);

  const antes = (await impreso(mostrador)).length;
  await mostrador.getByRole('button', { name: 'Ejecutar la devolución' }).click();
  await mostrador.getByRole('button', { name: 'Sí, ejecutarla' }).click();
  await expect(mostrador.getByText('Devolución ejecutada')).toBeVisible();
  await expect(mostrador.getByText('DEV-LAM-000001')).toBeVisible();
  await expect(mostrador.getByText('Entregue en efectivo').locator('..')).toContainText(
    'C$ 520.00',
  );
  // el ticket que firma el cliente sale solo, con la gaveta
  await expect.poll(() => impresoDesde(mostrador, antes)).toContain('DEV-LAM-000001');
  const original = await impresoDesde(mostrador, antes);
  expect(original).toContain('DEVOLUCI');
  expect(original).toContain('Defectuoso');
  expect(original).toContain('Firma: ____');
  expect(original).toContain(GAVETA);
  expect(original).not.toContain('COPIA');
  await sinDesborde(mostrador);

  const antesDeLaCopia = (await impreso(mostrador)).length;
  await mostrador.getByRole('button', { name: 'Copia para el cliente' }).click();
  await expect.poll(() => impresoDesde(mostrador, antesDeLaCopia)).toContain('COPIA');
  expect(await impresoDesde(mostrador, antesDeLaCopia)).not.toContain(GAVETA);
  await mostrador.getByRole('link', { name: 'Listo' }).click();
  await expect(mostrador.getByText(/Ejecutada: DEV-LAM-000001/)).toBeVisible();
  await expect(
    mostrador.getByText(/Se pidió en buen estado y se recibió defectuoso/),
  ).toBeVisible();
});

test('la devolución con tarjeta: no sale efectivo de la caja, todo queda por transferir', async () => {
  await abrirParaEjecutar(mostrador, factura.tarjeta);
  await expect(mostrador.getByText('En efectivo, de la caja').locator('..')).toContainText(
    'C$ 0.00',
  );
  await expect(
    mostrador.getByText('Por transferencia (la hace la administración)').locator('..'),
  ).toContainText('C$ 1,200.00');
  const antes = (await impreso(mostrador)).length;
  await mostrador.getByRole('button', { name: 'Ejecutar la devolución' }).click();
  await mostrador.getByRole('button', { name: 'Sí, ejecutarla' }).click();
  await expect(mostrador.getByText('No sale efectivo de la caja.')).toBeVisible();
  await expect(
    mostrador.getByText('Por transferencia: la hace la administración').locator('..'),
  ).toContainText('C$ 1,200.00');
  await expect.poll(() => impresoDesde(mostrador, antes)).toContain('DEV-LAM-000002');
  // no sale efectivo: la gaveta no se abre ni con el original
  expect(await impresoDesde(mostrador, antes)).not.toContain(GAVETA);
});

test('cambio de la venta mixta por algo más barato: antes de ejecutar dice cuánto se le devuelve y cómo', async () => {
  await abrirParaEjecutar(mostrador, factura.mixta);
  await expect(
    mostrador.getByRole('heading', { name: /Ejecutar el cambio n\.º \d+/ }),
  ).toBeVisible();
  await agregar(mostrador, 'piedra', /Labret con piedra/);
  await expect(mostrador.getByLabel('Promoción')).toHaveCount(0);
  // lo devuelto (C$ 520, pagado C$ 300 en efectivo y C$ 220 con tarjeta) paga los C$ 350; sobran 170
  await expect(mostrador.getByText('En efectivo, de la caja').locator('..')).toContainText(
    'C$ 98.08',
  );
  await expect(
    mostrador.getByText('Por transferencia (la hace la administración)').locator('..'),
  ).toContainText('C$ 71.92');
  await sinDesborde(mostrador);
  const antes = (await impreso(mostrador)).length;
  await mostrador.getByRole('button', { name: 'Ejecutar el cambio' }).click();
  await expect(mostrador.getByRole('alertdialog')).toContainText(
    'Se le devuelven C$ 170.00: C$ 98.08 en efectivo de la caja y C$ 71.92 por transferencia.',
  );
  await mostrador.getByRole('button', { name: 'Sí, ejecutarlo' }).click();
  await expect(mostrador.getByText('Cambio ejecutado')).toBeVisible();
  const nueva = await mostrador.getByText(/^Factura nueva LAM-\d{8}$/).innerText();
  // primero el ticket del cambio (con la gaveta: sale efectivo) y después la factura nueva
  await expect
    .poll(() => impresoDesde(mostrador, antes))
    .toContain(nueva.replace('Factura nueva ', ''));
  const salido = await impresoDesde(mostrador, antes);
  expect(salido.indexOf('DEV-LAM-000003')).toBeGreaterThanOrEqual(0);
  expect(salido.indexOf('DEV-LAM-000003')).toBeLessThan(
    salido.indexOf(nueva.replace('Factura nueva ', '')),
  );
  expect(salido).toContain(GAVETA);
});

test('cambio por algo más caro: se cobra la diferencia con el cobro de siempre', async () => {
  await abrirParaEjecutar(mostrador, factura.otra);
  await agregar(mostrador, 'cadena', /Cadena cartier/);
  await mostrador.getByRole('button', { name: 'Cobrar la diferencia C$ 680.00' }).click();
  await expect(mostrador.getByText('Diferencia a cobrar').locator('..')).toContainText('C$ 680.00');
  await mostrador.getByRole('button', { name: 'Exacto' }).click();
  await mostrador.getByRole('button', { name: 'Ejecutar el cambio' }).click();
  await expect(mostrador.getByText('Cambio ejecutado')).toBeVisible();
  await expect(mostrador.getByText('No sale efectivo de la caja.')).toBeVisible();
  await expect(mostrador.getByText(/^Factura nueva LAM-\d{8}$/)).toBeVisible();
});

test('el administrador, desde su iPhone, ve las transferencias pendientes y anota una', async () => {
  await entrar(dueno, ADMIN);
  const acceso = dueno.getByRole('link', { name: /Transferencias pendientes/ });
  await expect(acceso).toContainText('Hay 2 por hacer.');
  await acceso.click();

  const lista = dueno.getByRole('list', { name: 'Por transferir' });
  await expect(lista.getByRole('listitem')).toHaveCount(2);
  const tarjeta = lista.getByRole('listitem').filter({ hasText: factura.tarjeta });
  await expect(tarjeta).toContainText('Lía Cliente');
  await expect(tarjeta.getByRole('link', { name: '8555-1212' })).toHaveAttribute(
    'href',
    'tel:85551212',
  );
  await expect(tarjeta).toContainText('C$ 1,200.00');
  await expect(lista.getByRole('listitem').filter({ hasText: factura.mixta })).toContainText(
    'C$ 71.92',
  );
  // cada una con su monto: ninguna suma
  await expect(dueno.locator('main')).not.toContainText(/1,271\.92|total/i);
  await sinDesborde(dueno);

  await tarjeta.getByLabel(/^Referencia de la transferencia/).fill('BAC-123456');
  await tarjeta.getByRole('button', { name: 'Anotar la transferencia' }).click();
  await expect(
    dueno.getByText(/Transferencia de DEV-LAM-000002 anotada \(ref\. BAC-123456\)/),
  ).toBeVisible();
  await expect(lista.getByRole('listitem')).toHaveCount(1);
});
