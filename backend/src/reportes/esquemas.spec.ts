import type { z } from 'zod';
import {
  esquemaInventarioValorizado,
  esquemaReporte,
  esquemaReporteProductos,
  esquemaReporteVentas,
} from './esquemas';

function errores(esquema: z.ZodType, datos: unknown): Record<string, string> {
  const resultado = esquema.safeParse(datos);
  return Object.fromEntries(
    (resultado.error?.issues ?? []).map((problema) => [problema.path.join('.'), problema.message]),
  );
}

describe('filtros de los reportes', () => {
  it('sin nada: JSON; el rango lo resuelve el servicio (hoy)', () => {
    expect(esquemaReporte.parse({})).toEqual({ formato: 'json' });
    expect(esquemaReporteVentas.parse({})).toEqual({ formato: 'json', agrupar: 'dia' });
    expect(esquemaReporteProductos.parse({ limite: '5' })).toEqual({ formato: 'json', limite: 5 });
  });

  it('periodo con fecha, o desde con hasta', () => {
    expect(
      esquemaReporte.parse({ periodo: 'semana', fecha: '2026-10-07', sucursal_id: '3' }),
    ).toEqual({ periodo: 'semana', fecha: '2026-10-07', sucursal_id: 3, formato: 'json' });
    expect(
      esquemaReporteVentas.parse({
        desde: '2026-01-01',
        hasta: '2026-12-31',
        agrupar: 'mes',
        formato: 'xlsx',
      }),
    ).toEqual({ desde: '2026-01-01', hasta: '2026-12-31', agrupar: 'mes', formato: 'xlsx' });
  });

  it('rangos mal formados', () => {
    expect(errores(esquemaReporte, { desde: '2026-10-01' })).toEqual({
      hasta: 'Indique desde y hasta juntos',
    });
    expect(errores(esquemaReporte, { hasta: '2026-10-01' })).toEqual({
      desde: 'Indique desde y hasta juntos',
    });
    expect(errores(esquemaReporte, { desde: '2026-10-02', hasta: '2026-10-01' })).toEqual({
      hasta: 'hasta no puede ser anterior a desde',
    });
    // 2028 es bisiesto: del 1 de enero al 31 de diciembre son 366 días, y eso sí se acepta
    expect(errores(esquemaReporte, { desde: '2028-01-01', hasta: '2028-12-31' })).toEqual({});
    expect(errores(esquemaReporte, { desde: '2026-01-01', hasta: '2027-01-02' })).toEqual({
      hasta: 'El rango no puede pasar de 366 días',
    });
    expect(
      errores(esquemaReporte, { desde: '2026-10-01', hasta: '2026-10-02', fecha: '2026-10-01' }),
    ).toEqual({ fecha: 'Use periodo y fecha, o desde y hasta: no los dos' });
    expect(errores(esquemaReporte, { fecha: '2026-02-30' })).toEqual({
      fecha: 'fecha debe ser una fecha con el formato AAAA-MM-DD',
    });
  });

  it('valores que no existen', () => {
    expect(
      errores(esquemaReporteVentas, { periodo: 'año', agrupar: 'hora', formato: 'doc' }),
    ).toEqual({
      periodo: 'periodo debe ser dia, semana o mes',
      agrupar: 'agrupar debe ser dia, semana o mes',
      formato: 'formato debe ser json, xlsx o pdf',
    });
    expect(errores(esquemaReporteProductos, { limite: '201' })).toEqual({
      limite: 'limite debe ser un número entre 1 y 200',
    });
  });

  it('el mes de la foto del inventario es AAAA-MM', () => {
    expect(esquemaInventarioValorizado.parse({ mes: '2026-09' })).toEqual({
      mes: '2026-09',
      formato: 'json',
    });
    for (const mes of ['2026-9', '2026-13', '2026-00', 'septiembre', '2026-09-01']) {
      expect(errores(esquemaInventarioValorizado, { mes })).toEqual({
        mes: 'mes debe tener el formato AAAA-MM',
      });
    }
  });
});
