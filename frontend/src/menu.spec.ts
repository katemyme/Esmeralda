import { describe, expect, it } from 'vitest';
import { MENU, estaLista, opcionesPara } from './menu';
import { sesionDeAdmin, sesionDeVendedora } from './pruebas/datos';

const titulos = (sesion: Parameters<typeof opcionesPara>[0]) =>
  opcionesPara(sesion).map((o) => o.titulo);

describe('menú según los permisos de la sesión', () => {
  it('la vendedora en la tablet ve lo de su rol', () => {
    expect(titulos(sesionDeVendedora('tablet'))).toEqual([
      'Inicio',
      'Vender',
      'Caja',
      'Precios y existencias',
      'Devoluciones',
      'Envíos',
      'Conteos',
      'Mermas',
      'Alertas',
      'Este equipo',
    ]);
  });

  it('desde su celular no ve la caja ni las mermas, pero sí vender', () => {
    const delCelular = titulos(sesionDeVendedora('celular'));
    expect(delCelular).toContain('Vender');
    expect(delCelular).toContain('Precios y existencias');
    expect(delCelular).not.toContain('Caja');
    expect(delCelular).not.toContain('Mermas');
    expect(delCelular).not.toContain('Reportes');
    expect(delCelular).not.toContain('Administración');
  });

  it('el administrador ve también la administración, los reportes y las etiquetas', () => {
    const delAdmin = titulos(sesionDeAdmin());
    expect(delAdmin).toEqual(expect.arrayContaining(['Administración', 'Reportes', 'Etiquetas']));
  });

  it('están hechas la base, la caja y la consulta de precios: lo demás sale marcado «Pronto»', () => {
    expect(MENU.filter(estaLista).map((o) => o.titulo)).toEqual([
      'Inicio',
      'Caja',
      'Precios y existencias',
      'Alertas',
      'Este equipo',
    ]);
  });

  it('no hay dos opciones con la misma dirección', () => {
    const rutas = MENU.map((o) => o.ruta);
    expect(new Set(rutas).size).toBe(rutas.length);
  });
});
