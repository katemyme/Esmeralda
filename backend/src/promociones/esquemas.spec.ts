import { esquemaGama } from '../gamas/esquemas';
import { esquemaPromocion, esquemaSubtotal } from './esquemas';

function mensajes(datos: unknown): Record<string, string> {
  const resultado = esquemaPromocion.safeParse(datos);
  return Object.fromEntries(
    (resultado.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]),
  );
}

describe('esquemaPromocion', () => {
  it('lo mínimo: nombre, tipo y valor; sin fechas vale siempre', () => {
    expect(
      esquemaPromocion.parse({ nombre: ' Promo 10 % ', tipo: 'porcentaje', valor: 10 }),
    ).toEqual({
      nombre: 'Promo 10 %',
      descripcion: null,
      tipo: 'PORCENTAJE',
      valor: '10',
      compra_minima: '0',
      vigente_desde: null,
      vigente_hasta: null,
    });
  });

  it('acepta compra mínima y fechas (vacías → sin límite)', () => {
    expect(
      esquemaPromocion.parse({
        nombre: 'Aniversario',
        tipo: 'MONTO',
        valor: '100.50',
        compra_minima: 1000,
        vigente_desde: '2026-11-01',
        vigente_hasta: '',
        descripcion: ' Semana del aniversario ',
      }),
    ).toMatchObject({
      valor: '100.50',
      compra_minima: '1000',
      vigente_desde: '2026-11-01',
      vigente_hasta: null,
      descripcion: 'Semana del aniversario',
    });
  });

  it('mensajes en español por campo', () => {
    expect(mensajes({})).toEqual({
      nombre: 'Escriba el nombre de la promoción',
      tipo: 'Indique el tipo: PORCENTAJE o MONTO',
      valor: 'El valor debe ser mayor que 0, con 2 decimales como máximo',
    });
    expect(
      mensajes({ nombre: 'Rara', tipo: 'regalo', valor: 0, vigente_desde: '2026-13-40' }),
    ).toEqual({
      tipo: 'El tipo debe ser PORCENTAJE o MONTO',
      valor: 'El valor debe ser mayor que 0, con 2 decimales como máximo',
      vigente_desde: 'La fecha debe tener el formato AAAA-MM-DD',
    });
  });

  it('un porcentaje no pasa de 100 y las fechas van en orden', () => {
    expect(mensajes({ nombre: 'Imposible', tipo: 'PORCENTAJE', valor: 150 })).toEqual({
      valor: 'Un porcentaje no puede pasar de 100',
    });
    expect(
      esquemaPromocion.safeParse({ nombre: 'Grande', tipo: 'MONTO', valor: 150 }).success,
    ).toBe(true);
    expect(
      mensajes({
        nombre: 'Al revés',
        tipo: 'MONTO',
        valor: 50,
        vigente_desde: '2026-12-10',
        vigente_hasta: '2026-12-01',
      }),
    ).toEqual({ vigente_hasta: 'La fecha final no puede ser anterior a la inicial' });
  });
});

describe('esquemaSubtotal', () => {
  it('el subtotal es opcional y debe ser un monto', () => {
    expect(esquemaSubtotal.parse({})).toEqual({});
    expect(esquemaSubtotal.parse({ subtotal: '1200.50' })).toEqual({ subtotal: '1200.50' });
    expect(esquemaSubtotal.safeParse({ subtotal: 'mil' }).error?.issues[0].message).toBe(
      'subtotal debe ser un monto de 0 en adelante',
    );
  });
});

describe('esquemaGama', () => {
  it('normaliza el modo de precio y por defecto el orden es 0', () => {
    expect(esquemaGama.parse({ nombre: ' Oro 14k ', modo_precio: 'pieza' })).toEqual({
      nombre: 'Oro 14k',
      modo_precio: 'PIEZA',
      orden: 0,
    });
  });

  it('el modo de precio es TABLA o PIEZA', () => {
    expect(
      esquemaGama.safeParse({ nombre: 'Rara', modo_precio: 'otro' }).error?.issues[0].message,
    ).toBe('El modo de precio debe ser TABLA o PIEZA');
    expect(esquemaGama.safeParse({ nombre: 'Rara' }).error?.issues[0].message).toBe(
      'Indique el modo de precio: TABLA o PIEZA',
    );
  });
});
