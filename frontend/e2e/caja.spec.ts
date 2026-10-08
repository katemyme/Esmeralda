import { expect, test, type Browser, type Page } from '@playwright/test';

// Las dos sucursales a la vez, cada una con su celular del negocio registrado: Las Américas (Ana)
// y Las Brisas (Carlos). Cada equipo abre y cierra solo la caja de su sucursal, y ninguna vendedora
// ve lo esperado ni la diferencia. El administrador, desde otro equipo sin registrar, ve las dos.
// Viene después de tablet.spec.ts y celular.spec.ts, que dejaron las contraseñas definitivas.

const ADMIN = { usuario: 'admin', clave: 'Duena#2026' };
const ANA = { usuario: 'ana.martinez', clave: 'Ventas#2026' };
const CARLOS = { usuario: 'carlos.ruiz', clave: 'Brisas#2026' };

test.describe.configure({ mode: 'serial' });

let americas: Page;
let brisas: Page;
let dueno: Page;

async function entrar(pagina: Page, quien: { usuario: string; clave: string }) {
  await pagina.getByLabel('Usuario').fill(quien.usuario);
  await pagina.getByLabel('Contraseña', { exact: true }).fill(quien.clave);
  await pagina.getByRole('button', { name: 'Entrar' }).click();
  await expect(pagina.getByRole('heading', { name: /^Hola, / })).toBeVisible();
}

/** Un equipo nuevo (su propio navegador), registrado por el administrador en esa sucursal. */
async function celularDelNegocio(
  browser: Browser,
  nombre: string,
  sucursal: string,
): Promise<Page> {
  const pagina = await (
    await browser.newContext({ viewport: { width: 412, height: 915 } })
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
  await pagina.getByRole('button', { name: 'Más' }).click();
  await pagina
    .getByRole('dialog', { name: 'Menú completo' })
    .getByRole('link', { name: opcion })
    .click();
}

const barra = (pagina: Page) => pagina.getByRole('banner').first();

test.beforeAll(async ({ browser }) => {
  americas = await celularDelNegocio(browser, 'Celular Las Américas', 'Multicentro Las Américas');
  brisas = await celularDelNegocio(browser, 'Celular Las Brisas', 'Multicentro Las Brisas');
  dueno = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await dueno.goto('/');
  await entrar(dueno, ADMIN);
});

test.afterAll(async () => {
  for (const pagina of [americas, brisas, dueno]) await pagina.context().close();
});

test('cada celular del negocio abre la caja de su sucursal, las dos a la vez', async () => {
  await entrar(americas, ANA);
  await irA(americas, 'Caja');
  await americas.getByLabel('Efectivo en córdobas (C$)').fill('500');
  await americas.getByRole('button', { name: 'Abrir turno' }).click();
  await expect(americas.getByText('Turno abierto')).toBeVisible();

  await entrar(brisas, CARLOS);
  await irA(brisas, 'Caja');
  await brisas.getByLabel('Efectivo en córdobas (C$)').fill('300');
  await brisas.getByRole('button', { name: 'Abrir turno' }).click();
  await expect(brisas.getByText('Turno abierto')).toBeVisible();

  // Con el turno abierto, la barra de cada uno muestra su sucursal y su caja, no la de la otra
  await expect(barra(americas)).toContainText('Multicentro Las Américas');
  await expect(barra(americas)).toContainText('Caja 1');
  await expect(barra(americas)).not.toContainText('Las Brisas');
  await expect(barra(brisas)).toContainText('Multicentro Las Brisas');
  await expect(barra(brisas)).not.toContainText('Las Américas');
});

test('el administrador elige la caja desde su equipo y registra el tipo de cambio de hoy', async () => {
  await dueno
    .getByRole('navigation', { name: 'Menú' })
    .first()
    .getByRole('link', { name: 'Caja' })
    .click();
  await dueno
    .getByLabel('Caja con la que va a trabajar')
    .selectOption({ label: 'Multicentro Las Brisas · Caja 1' });
  await expect(dueno.getByText(/Turno abierto/)).toBeVisible();
  await expect(dueno.getByText(/por Carlos Ruiz/)).toBeVisible();

  await dueno.getByLabel(/[Cc]órdobas por dólar/).fill('36.70');
  await dueno.getByRole('button', { name: 'Guardar tipo de cambio' }).click();
  // si se aleja del último registrado, la base pide confirmarlo a propósito
  const confirmar = dueno.getByRole('button', { name: 'Sí, guardarlo' });
  await expect(dueno.getByText('Tipo de cambio guardado.').or(confirmar)).toBeVisible();
  if (await confirmar.isVisible()) await confirmar.click();
  await expect(dueno.getByText('Tipo de cambio guardado.')).toBeVisible();

  await americas.reload();
  await expect(barra(americas)).toContainText('US$ 1 = C$ 36.70');
});

test('precios y existencias: el buscador encuentra el producto con su precio', async () => {
  await irA(americas, 'Precios y existencias');
  await americas.getByLabel('Buscar por nombre o código').fill('labret');
  await expect(americas.getByText('C$ 650.00').first()).toBeVisible();
  await expect(americas.getByText(/TIT-LAB-16-6/)).toBeVisible();
  await expect(americas.getByRole('button', { name: 'Escanear' })).toBeVisible();
});

test('Las Américas cierra con el conteo correcto; la otra caja sigue abierta', async () => {
  await irA(americas, 'Caja');
  await americas.getByRole('button', { name: 'Cerrar la caja' }).click();
  await americas.getByRole('button', { name: 'Agregar uno de C$ 500', exact: true }).click();
  await expect(americas.getByText('C$ 500.00')).toBeVisible();
  await americas.getByRole('button', { name: 'Cerrar la caja' }).click();
  await americas.getByRole('button', { name: 'Sí, cerrar' }).click();

  await expect(americas.getByText(/La caja quedó cerrada/)).toBeVisible();
  await expect(americas.getByText('Fondo para mañana C$')).toBeVisible();
  await expect(americas.getByRole('button', { name: 'Imprimir el cierre' })).toBeVisible();
  // el arqueo es a ciegas: en la pantalla de la vendedora no hay esperado ni diferencia
  await expect(americas.locator('main')).not.toContainText(
    /esperad|diferencia|faltan|sobran|vendido/i,
  );

  await brisas.reload();
  await expect(barra(brisas)).toContainText('Multicentro Las Brisas');
  await brisas.goto('/caja');
  await expect(brisas.getByText('Turno abierto')).toBeVisible();
});

test('Las Brisas no cuadra: un solo reconteo con justificación, y solo el administrador ve cuánto faltó', async () => {
  await brisas.getByRole('button', { name: 'Cerrar la caja' }).click();
  await brisas.getByRole('button', { name: 'Cerrar la caja' }).click(); // sin contar nada
  await brisas.getByRole('button', { name: 'Sí, cerrar' }).click();
  await expect(brisas.getByText(/Queda un solo reconteo/)).toBeVisible();
  await expect(brisas.locator('main')).not.toContainText(/C\$ 300|faltan/i);

  await brisas.getByRole('button', { name: 'Agregar uno de C$ 100', exact: true }).click();
  await brisas.getByLabel(/Justificación/).fill('Se pagó el agua del mes sin anotarlo');
  await brisas.getByRole('button', { name: 'Cerrar la caja' }).click();
  await brisas.getByRole('button', { name: 'Sí, cerrar' }).click();
  await expect(brisas.getByText(/La caja quedó cerrada/)).toBeVisible();
  await expect(brisas.locator('main')).not.toContainText(/esperad|diferencia|faltan|sobran/i);

  // El administrador sí: en el historial, la diferencia en ámbar, y le llegó la alerta
  await dueno.goto('/caja/turnos');
  const deBrisas = dueno
    .getByRole('listitem')
    .filter({ hasText: 'Multicentro Las Brisas' })
    .first();
  await expect(deBrisas).toContainText('Faltan C$ 200.00');
  const deAmericas = dueno
    .getByRole('listitem')
    .filter({ hasText: 'Multicentro Las Américas' })
    .first();
  await expect(deAmericas).not.toContainText(/Faltan|Sobran/);
  await deBrisas.getByRole('link').click();
  await expect(dueno.getByText('Se pagó el agua del mes sin anotarlo')).toBeVisible();
  await expect(dueno.getByRole('columnheader', { name: 'Esperado' })).toBeVisible();
  await expect(dueno.getByRole('link', { name: /Alertas: \d+ pendientes/ })).toBeVisible();
});

test('la vendedora no entra al historial de turnos aunque escriba la dirección', async () => {
  await brisas.goto('/caja/turnos');
  await expect(brisas.getByRole('heading', { name: 'Hola, Carlos' })).toBeVisible();
});
