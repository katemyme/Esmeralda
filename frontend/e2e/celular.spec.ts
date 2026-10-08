import { expect, test } from '@playwright/test';

// Un celular: pantalla angosta y sin la cookie de ningún equipo registrado. Carlos Ruiz (vendedor
// de Las Brisas, de los datos de demostración) entra desde el suyo.

test('desde su celular entra con el acceso limitado: sin caja, con el menú abajo', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Usuario').fill('carlos.ruiz');
  await page.getByLabel('Contraseña', { exact: true }).fill('Demo#2026');
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page.getByRole('heading', { name: 'Cree su contraseña' })).toBeVisible();
  await page.getByLabel('Contraseña temporal').fill('Demo#2026');
  await page.getByLabel('Contraseña nueva', { exact: true }).fill('Brisas#2026');
  await page.getByLabel('Repita la contraseña nueva').fill('Brisas#2026');
  await page.getByRole('button', { name: 'Guardar y continuar' }).click();

  await expect(page.getByRole('heading', { name: 'Hola, Carlos' })).toBeVisible();
  await expect(page.getByText('Está en su celular')).toBeVisible();
  // No hay botón de bloquear (no es un equipo registrado) ni estado de la caja
  await expect(page.getByRole('button', { name: 'Bloquear la pantalla' })).toHaveCount(0);
  await expect(page.getByText(/turno abierto/)).toHaveCount(0);

  // El menú va abajo; lo completo, en «Más»
  await page.getByRole('button', { name: 'Más' }).click();
  const completo = page.getByRole('dialog', { name: 'Menú completo' });
  await expect(completo.getByRole('link', { name: /Vender/ })).toBeVisible();
  await expect(completo.getByRole('link', { name: /Precios y existencias/ })).toBeVisible();
  await expect(completo.getByRole('link', { name: /Caja/ })).toHaveCount(0);
  await expect(completo.getByRole('link', { name: /Mermas/ })).toHaveCount(0);
  await expect(completo.getByRole('link', { name: /Reportes/ })).toHaveCount(0);

  await completo.getByRole('link', { name: 'Este equipo' }).click();
  await expect(page.getByText(/Por eso tiene el acceso del celular/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrar este equipo' })).toHaveCount(0);

  // Los avisos son los de su sucursal
  await page
    .getByRole('navigation', { name: 'Menú' })
    .last()
    .getByRole('link', { name: 'Alertas' })
    .click();
  await expect(page.getByRole('heading', { name: 'Avisos de mi sucursal' })).toBeVisible();

  // No cabe nada fuera de la pantalla: sin desplazamiento horizontal
  const desborde = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(desborde).toBeLessThanOrEqual(0);
});
