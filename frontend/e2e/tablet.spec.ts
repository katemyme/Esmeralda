import { expect, test, type Page } from '@playwright/test';

// La base tal como queda recién instalada, con los datos de demostración: «admin» con su
// contraseña inicial (temporal) y Ana Martínez, vendedora de Las Américas. Las pruebas van en
// orden y comparten el navegador: la cookie del equipo registrado tiene que seguir ahí.

const CLAVE_ADMIN = 'Duena#2026';
const CLAVE_ANA = 'Ventas#2026';

test.describe.configure({ mode: 'serial' });

let pagina: Page;

async function entrar(usuario: string, password: string) {
  await pagina.getByLabel('Usuario').fill(usuario);
  await pagina.getByLabel('Contraseña', { exact: true }).fill(password);
  await pagina.getByRole('button', { name: 'Entrar' }).click();
}

async function crearPassword(temporal: string, nueva: string) {
  await expect(pagina.getByRole('heading', { name: 'Cree su contraseña' })).toBeVisible();
  await pagina.getByLabel('Contraseña temporal').fill(temporal);
  await pagina.getByLabel('Contraseña nueva', { exact: true }).fill(nueva);
  await pagina.getByLabel('Repita la contraseña nueva').fill(nueva);
  await pagina.getByRole('button', { name: 'Guardar y continuar' }).click();
}

async function escribirPin(pin: string) {
  for (const digito of pin) await pagina.getByRole('button', { name: digito, exact: true }).click();
}

const menu = () => pagina.getByRole('navigation', { name: 'Menú' }).first();

test.beforeAll(async ({ browser }) => {
  pagina = await (await browser.newContext()).newPage();
  await pagina.goto('/');
});

test.afterAll(async () => {
  await pagina.context().close();
});

test('el administrador entra, crea su contraseña y ve el menú completo', async () => {
  await expect(pagina.getByText('Esmeralda Experience')).toBeVisible();
  await entrar('admin', 'incorrecta');
  await expect(pagina.getByRole('alert')).toHaveText('Usuario o contraseña incorrectos');

  await entrar('admin', 'Esmeralda#2026');
  await crearPassword('Esmeralda#2026', CLAVE_ADMIN);
  await expect(pagina.getByRole('heading', { name: /^Hola, / })).toBeVisible();

  for (const opcion of ['Inicio', 'Vender', 'Caja', 'Administración', 'Reportes', 'Alertas']) {
    await expect(menu().getByRole('link', { name: new RegExp(opcion) })).toBeVisible();
  }
  await menu()
    .getByRole('link', { name: /Reportes/ })
    .click();
  await expect(pagina.getByText('Esta pantalla llega con la fase de reportes.')).toBeVisible();
});

test('el centro de alertas del administrador abre con sus pestañas', async () => {
  await pagina
    .getByRole('link', { name: /^Alertas/ })
    .first()
    .click();
  await expect(pagina.getByRole('heading', { name: 'Alertas' })).toBeVisible();
  await expect(pagina.getByRole('tab', { name: 'Pendientes' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await pagina.getByRole('tab', { name: 'Atendidas' }).click();
  await expect(pagina.getByRole('alert')).toHaveCount(0);
});

test('registra este navegador como la tablet de Las Américas', async () => {
  await menu().getByRole('link', { name: 'Este equipo' }).click();
  await expect(pagina.getByText('Este navegador no es un equipo registrado.')).toBeVisible();

  await pagina.getByRole('button', { name: 'Registrar este equipo' }).click();
  await expect(pagina.getByText('Póngale un nombre (mínimo 3 letras)')).toBeVisible();
  await pagina.getByLabel('Nombre del equipo').fill('Tablet Las Américas');
  await pagina
    .getByLabel('Sucursal', { exact: true })
    .selectOption({ label: 'Multicentro Las Américas' });
  await pagina.getByRole('button', { name: 'Registrar este equipo' }).click();
  await expect(pagina.getByText(/Equipo registrado\. Cierre su sesión/)).toBeVisible();

  await pagina.getByRole('button', { name: 'Cerrar sesión' }).click();
  // El equipo ya está registrado, pero nadie lo ha abierto hoy: pide una contraseña
  await expect(pagina.getByText('Tablet Las Américas · Multicentro Las Américas')).toBeVisible();
  await expect(pagina.getByText(/Este equipo está cerrado/)).toBeVisible();
});

test('la primera del día entra con su contraseña, con todo lo de su rol, y crea su PIN', async () => {
  await entrar('ana.martinez', 'Demo#2026');
  await crearPassword('Demo#2026', CLAVE_ANA);
  await expect(pagina.getByRole('heading', { name: 'Hola, Ana' })).toBeVisible();
  // En la tablet tiene la caja; no hay turno abierto todavía
  await expect(menu().getByRole('link', { name: /Caja/ })).toBeVisible();
  await expect(menu().getByRole('link', { name: /Administración/ })).toHaveCount(0);
  await expect(pagina.getByText('No hay un turno abierto en este equipo.')).toBeVisible();

  await pagina.getByRole('link', { name: /Cree su PIN/ }).click();
  await pagina.getByLabel('Su contraseña').fill(CLAVE_ANA);
  await pagina.getByLabel('PIN nuevo').fill('1234');
  await pagina.getByLabel('Repita el PIN').fill('1234');
  await pagina.getByRole('button', { name: 'Guardar mi PIN' }).click();
  await expect(pagina.getByText(/Ese PIN es muy fácil de adivinar/)).toBeVisible();

  await pagina.getByLabel('PIN nuevo').fill('2580');
  await pagina.getByLabel('Repita el PIN').fill('2580');
  await pagina.getByRole('button', { name: 'Guardar mi PIN' }).click();
  await expect(pagina.getByText('PIN guardado. Ya puede usarlo en la tablet.')).toBeVisible();
});

test('bloquea la pantalla y vuelve a entrar con su PIN', async () => {
  await pagina.getByRole('button', { name: 'Bloquear la pantalla' }).click();
  await expect(pagina.getByText('¿Quién va a usar el equipo?')).toBeVisible();

  await pagina.getByRole('button', { name: 'Ana Martínez' }).click();
  await escribirPin('1111');
  await expect(pagina.getByRole('alert')).toHaveText('PIN incorrecto. Le quedan 4 intentos.');
  await escribirPin('2580');
  await expect(pagina.getByRole('heading', { name: 'Hola, Ana' })).toBeVisible();

  // Recargar la página no saca a nadie: la sesión se recupera con su cookie
  await pagina.reload();
  await expect(pagina.getByRole('heading', { name: 'Hola, Ana' })).toBeVisible();
  await menu().getByRole('link', { name: 'Este equipo' }).click();
  await expect(pagina.getByText('Equipo registrado', { exact: true })).toBeVisible();
});

test('al cerrar el equipo el PIN deja de servir hasta que alguien entre con su contraseña', async () => {
  await pagina.getByRole('button', { name: /^Menú de / }).click();
  await pagina.getByRole('menuitem', { name: 'Cerrar el equipo' }).click();
  await expect(pagina.getByRole('alertdialog', { name: '¿Cerrar el equipo?' })).toBeVisible();
  await pagina.getByRole('button', { name: 'Cerrar el equipo' }).click();

  await expect(pagina.getByText(/Este equipo está cerrado/)).toBeVisible();
  await expect(pagina.getByText('¿Quién va a usar el equipo?')).toHaveCount(0);
  await expect(pagina.getByLabel('Usuario')).toBeVisible();
});
