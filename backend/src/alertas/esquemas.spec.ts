import { esquemaFiltroAlertas } from './esquemas';

describe('esquemaFiltroAlertas', () => {
  it('sin filtros: las 50 pendientes más recientes', () => {
    expect(esquemaFiltroAlertas.parse({})).toEqual({ estado: 'pendientes', limite: 50 });
  });

  it('convierte los números que llegan como texto y normaliza el tipo', () => {
    expect(
      esquemaFiltroAlertas.parse({
        estado: 'todas',
        tipo: ' margen_bajo ',
        sucursal_id: '2',
        antes_de: '120',
        limite: '200',
      }),
    ).toEqual({ estado: 'todas', tipo: 'MARGEN_BAJO', sucursal_id: 2, antes_de: 120, limite: 200 });
  });

  it('rechaza valores inválidos con mensajes en español', () => {
    const resultado = esquemaFiltroAlertas.safeParse({
      estado: 'viejas',
      tipo: 'margen bajo',
      sucursal_id: 'lam',
      antes_de: ['1', '2'],
      limite: '201',
    });
    expect(
      Object.fromEntries((resultado.error?.issues ?? []).map((i) => [i.path[0], i.message])),
    ).toEqual({
      estado: 'estado debe ser pendientes, atendidas o todas',
      tipo: 'El tipo de alerta no es válido',
      sucursal_id: 'sucursal_id debe ser el id de una sucursal',
      antes_de: 'antes_de debe ser el id de una alerta',
      limite: 'limite debe ser un número entre 1 y 200',
    });
  });
});
