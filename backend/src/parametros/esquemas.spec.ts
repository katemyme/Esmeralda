import { esquemaPermisosRol } from '../roles/esquemas';
import { esquemaValorParametro } from './esquemas';

describe('esquemaValorParametro', () => {
  it('acepta texto, número (lo pasa a texto) y null', () => {
    expect(esquemaValorParametro.parse({ valor: '21:30' })).toEqual({ valor: '21:30' });
    expect(esquemaValorParametro.parse({ valor: 12.5 })).toEqual({ valor: '12.5' });
    expect(esquemaValorParametro.parse({ valor: null })).toEqual({ valor: null });
  });

  it('exige enviar "valor": dejarlo vacío es una decisión explícita (null)', () => {
    for (const malo of [{}, { valor: true }, { valor: ['1'] }]) {
      expect(esquemaValorParametro.safeParse(malo).error?.issues[0].message).toBe(
        'Envíe "valor": un texto, un número, o null para dejarlo vacío',
      );
    }
    expect(
      esquemaValorParametro.safeParse({ valor: 'x'.repeat(201) }).error?.issues[0].message,
    ).toBe('El valor es demasiado largo');
  });
});

describe('esquemaPermisosRol', () => {
  it('normaliza los códigos a mayúsculas', () => {
    expect(esquemaPermisosRol.parse({ permisos: [' ventas_registrar ', 'CAJA_ABRIR'] })).toEqual({
      permisos: ['VENTAS_REGISTRAR', 'CAJA_ABRIR'],
    });
    expect(esquemaPermisosRol.parse({ permisos: [] })).toEqual({ permisos: [] });
  });

  it('exige la lista y códigos con formato válido', () => {
    expect(esquemaPermisosRol.safeParse({}).error?.issues[0].message).toBe(
      'Envíe la lista completa de permisos del rol',
    );
    const resultado = esquemaPermisosRol.safeParse({ permisos: ['CAJA_ABRIR', 'caja abrir', 7] });
    expect(resultado.error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([
      ['permisos.1', 'Código de permiso no válido'],
      ['permisos.2', 'Cada permiso se indica con su código'],
    ]);
  });
});
