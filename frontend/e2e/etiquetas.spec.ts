import { chromium, expect, request, test, type Browser, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Etiquetas con QR (F3b), con el backend de verdad. El administrador crea una pieza sin código (el
// sistema le pone PTI-…), le saca etiquetas en la pantalla y descarga el PDF. Después, con una
// cámara de mentira que muestra el QR de la etiqueta (el mismo que dibuja el PDF: solo el código),
// la consulta de precios y la venta encuentran la pieza al escanearlo, con el lector de la app (el
// mismo que usa la webcam de la PC). Viene después de devoluciones-caja.spec.ts, que dejó abierta la
// caja de Las Américas.

const ADMIN = { usuario: 'admin', clave: 'Duena#2026' };

// El QR, como lo arma el backend (lo compila e2e/servidor-api.mjs antes de las pruebas)
const requerir = createRequire(import.meta.url);
const { matrizQr } = requerir('../../backend/dist/exportacion/qr.js') as {
  matrizQr: (contenido: string) => boolean[][];
};

/**
 * Un video de la cámara de mentira: el QR del código, negro sobre blanco, quieto en el centro
 * (formato Y4M, el que Chrome sabe reproducir como cámara).
 */
function videoConQr(codigo: string): string {
  const [ancho, alto, modulo] = [640, 480, 10];
  const matriz = matrizQr(codigo);
  const lado = (matriz.length + 8) * modulo; // 4 módulos en blanco alrededor
  const [x0, y0] = [(ancho - lado) / 2, (alto - lado) / 2];
  const luz = Buffer.alloc(ancho * alto, 255);
  matriz.forEach((fila, f) =>
    fila.forEach((negro, c) => {
      if (!negro) return;
      for (let y = 0; y < modulo; y++) {
        const desde = (y0 + (f + 4) * modulo + y) * ancho + x0 + (c + 4) * modulo;
        luz.fill(0, desde, desde + modulo);
      }
    }),
  );
  const color = Buffer.alloc((ancho / 2) * (alto / 2) * 2, 128); // sin color
  const cuadro = Buffer.concat([Buffer.from('FRAME\n'), luz, color]);
  const archivo = join(tmpdir(), `esmeralda-camara-${codigo}.y4m`);
  writeFileSync(
    archivo,
    Buffer.concat([
      Buffer.from(`YUV4MPEG2 W${ancho} H${alto} F10:1 Ip A1:1 C420jpeg\n`),
      ...Array.from({ length: 10 }, () => cuadro),
    ]),
  );
  return archivo;
}

/** Un Chrome cuya cámara muestra ese video (la persona ya dio el permiso). */
function navegadorConCamara(video: string): Promise<Browser> {
  return chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${video}`,
    ],
  });
}

async function entrar(pagina: Page, quien: { usuario: string; clave: string }) {
  await pagina.getByLabel('Usuario').fill(quien.usuario);
  await pagina.getByLabel('Contraseña', { exact: true }).fill(quien.clave);
  await pagina.getByRole('button', { name: 'Entrar' }).click();
  await expect(pagina.getByRole('heading', { name: /^Hola, / })).toBeVisible();
}

/** El administrador, sin equipo, en el navegador con la cámara de mentira. */
async function administradorConCamara(
  navegador: Browser,
  baseURL: string | undefined,
): Promise<Page> {
  const contexto = await navegador.newContext({
    baseURL,
    locale: 'es-NI',
    timezoneId: 'America/Managua',
    permissions: ['camera'],
  });
  const pagina = await contexto.newPage();
  await pagina.goto('/');
  await entrar(pagina, ADMIN);
  return pagina;
}

/** En la venta, el administrador sin equipo elige la caja de Las Américas si hay más de una abierta. */
async function venderEnLasAmericas(pagina: Page) {
  await pagina.goto('/venta');
  const caja = pagina.getByLabel('Caja donde entra la venta');
  await expect(pagina.getByRole('searchbox').or(caja)).toBeVisible();
  if (await caja.isVisible()) {
    const valor = await caja
      .locator('option', { hasText: 'Multicentro Las Américas' })
      .getAttribute('value');
    await caja.selectOption(valor ?? '');
  }
  await expect(pagina.getByRole('searchbox')).toBeVisible();
}

/** La pieza nueva, sin código: el sistema le pone el siguiente de su categoría. */
const nueva = { id: 0, codigo: '' };

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ baseURL }) => {
  const api = await request.newContext({ baseURL });
  const sesion = await api.post('/api/auth/login', {
    data: { username: ADMIN.usuario, password: ADMIN.clave },
  });
  const { access_token: token } = (await sesion.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${token}` };
  const { categorias } = (await (await api.get('/api/categorias', { headers })).json()) as {
    categorias: { id: number; nombre: string; prefijo: string | null }[];
  };
  const titanio = categorias.find((c) => c.nombre === 'Piercing titanio');
  expect(titanio?.prefijo).toBe('PTI');
  const { gamas } = (await (await api.get('/api/gamas', { headers })).json()) as {
    gamas: { id: number; nombre: string }[];
  };
  const creada = await api.post('/api/productos', {
    headers,
    data: {
      categoria_id: titanio?.id,
      nombre: 'Labret QR',
      variantes: [
        {
          nombre: 'Titanio · 16G · 10 mm',
          precio_venta: 720,
          gama_id: gamas.find((g) => g.nombre === 'Titanio')?.id,
        },
      ],
    },
  });
  expect(creada.status()).toBe(201);
  const { producto } = (await creada.json()) as {
    producto: { variantes: { id: number; sku: string }[] };
  };
  nueva.id = producto.variantes[0].id;
  nueva.codigo = producto.variantes[0].sku;
  expect(nueva.codigo).toMatch(/^PTI-\d{5}$/);
  await api.dispose();
});

test('el administrador le saca etiquetas a la pieza nueva: una por página, en PDF', async ({
  page,
}) => {
  await page.goto('/');
  await entrar(page, ADMIN);
  await page
    .getByRole('navigation', { name: 'Menú' })
    .first()
    .getByRole('link', { name: 'Etiquetas' })
    .click();
  await expect(page.getByRole('heading', { name: 'Etiquetas' })).toBeVisible();

  await page.getByLabel('Buscar la pieza por nombre o código').fill('labret qr');
  await page
    .getByRole('list', { name: 'Resultados' })
    .getByRole('button', { name: /Labret QR · Titanio · 16G · 10 mm/ })
    .click();
  const lista = page.getByRole('list', { name: 'Para imprimir' });
  await expect(lista).toContainText(nueva.codigo);
  await lista.getByRole('button', { name: /^Una más de Labret QR/ }).click();
  await lista.getByRole('button', { name: /^Una más de Labret QR/ }).click();
  await page.getByRole('radio', { name: /Una por página/ }).check();
  await expect(page.getByText('3 etiquetas en 3 páginas')).toBeVisible();

  await page.getByRole('button', { name: 'Preparar el PDF' }).click();
  const [descarga] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Abrir el PDF' }).click(),
  ]);
  expect(descarga.suggestedFilename()).toBe('etiquetas.pdf');
  const pdf = readFileSync(await descarga.path()).toString('latin1');
  // tres páginas de 50 × 30 mm (141.73 × 85.04 puntos)
  expect(pdf.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(3);
  expect(pdf).toMatch(/\/MediaBox \[0 0 141\.73\d* 85\.03\d*\]/);

  // primero para celular: en el ancho de un teléfono nada se sale
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Etiquetas' })).toBeVisible();
  const desborde = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(desborde).toBe(0);
});

test('la consulta de precios y la venta leen con la cámara el QR de la etiqueta de la pieza nueva', async ({
  baseURL,
}) => {
  const navegador = await navegadorConCamara(videoConQr(nueva.codigo));
  try {
    const pagina = await administradorConCamara(navegador, baseURL);
    await pagina.goto('/consulta');
    await pagina.getByRole('button', { name: 'Escanear' }).click();
    // lee el código y lo busca: la pieza, con su precio; en la sucursal todavía no hay
    await expect(pagina.getByLabel('Buscar por nombre o código')).toHaveValue(nueva.codigo, {
      timeout: 20_000,
    });
    await expect(pagina.getByText('Labret QR — Titanio · 16G · 10 mm')).toBeVisible();
    await expect(pagina.getByText(`${nueva.codigo} · Piercing titanio · Titanio`)).toBeVisible();
    await expect(pagina.getByText('Sin existencias aquí')).toBeVisible();

    // en la venta la reconoce, y avisa que en la sucursal no hay
    await venderEnLasAmericas(pagina);
    await pagina.getByRole('button', { name: 'Escanear' }).click();
    await expect(pagina.getByText(/No quedan existencias de Labret QR/)).toBeVisible({
      timeout: 20_000,
    });
  } finally {
    await navegador.close();
  }
});

test('la venta agrega con un toque lo que se escanea: el QR con el código de antes de una pieza', async ({
  baseURL,
}) => {
  // las piezas de antes se quedan con su código (ACE-ARO-16-8) y su etiqueta lleva ese mismo
  const navegador = await navegadorConCamara(videoConQr('ACE-ARO-16-8'));
  try {
    const pagina = await administradorConCamara(navegador, baseURL);
    await venderEnLasAmericas(pagina);
    await pagina.getByRole('button', { name: 'Escanear' }).click();
    await expect(pagina.getByText(/^Agregado: Aro segmento/)).toBeVisible({ timeout: 20_000 });
    await pagina.getByRole('button', { name: 'Cerrar cámara' }).click();
    // ya está en la venta, lista para cobrar (no se cobra: la venta queda sin registrar)
    await expect(pagina.getByRole('button', { name: /^Cobrar C\$/ })).toBeVisible();
  } finally {
    await navegador.close();
  }
});
