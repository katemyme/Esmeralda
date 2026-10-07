import { diasDelRango, hoyEnManagua, rangoDelPeriodo, resolverRango, sumarDias } from './periodo';

describe('periodos de los reportes', () => {
  it('el día de hoy es el de Managua, no el del servidor', () => {
    // 03:00 UTC del día 8 todavía son las 21:00 del día 7 en Managua
    expect(hoyEnManagua(new Date('2026-10-08T03:00:00Z'))).toBe('2026-10-07');
    expect(hoyEnManagua(new Date('2026-10-08T06:00:00Z'))).toBe('2026-10-08');
  });

  it('la semana va de lunes a domingo', () => {
    const semana = { desde: '2026-10-05', hasta: '2026-10-11' };
    expect(rangoDelPeriodo('semana', '2026-10-05')).toEqual(semana); // lunes
    expect(rangoDelPeriodo('semana', '2026-10-07')).toEqual(semana); // miércoles
    expect(rangoDelPeriodo('semana', '2026-10-11')).toEqual(semana); // domingo
    expect(rangoDelPeriodo('semana', '2026-10-12').desde).toBe('2026-10-12');
    // una semana a caballo entre dos años
    expect(rangoDelPeriodo('semana', '2027-01-01')).toEqual({
      desde: '2026-12-28',
      hasta: '2027-01-03',
    });
  });

  it('el mes va de su primer día al último', () => {
    expect(rangoDelPeriodo('mes', '2026-10-07')).toEqual({
      desde: '2026-10-01',
      hasta: '2026-10-31',
    });
    expect(rangoDelPeriodo('mes', '2028-02-29')).toEqual({
      desde: '2028-02-01',
      hasta: '2028-02-29',
    });
    expect(rangoDelPeriodo('mes', '2026-12-31').hasta).toBe('2026-12-31');
    expect(rangoDelPeriodo('dia', '2026-10-07')).toEqual({
      desde: '2026-10-07',
      hasta: '2026-10-07',
    });
  });

  it('sin filtros es el día de hoy; con desde y hasta manda el rango', () => {
    const hoy = '2026-10-07';
    expect(resolverRango({}, hoy)).toEqual({ desde: hoy, hasta: hoy });
    expect(resolverRango({ periodo: 'mes' }, hoy)).toEqual({
      desde: '2026-10-01',
      hasta: '2026-10-31',
    });
    expect(resolverRango({ periodo: 'semana', fecha: '2026-09-01' }, hoy)).toEqual({
      desde: '2026-08-31',
      hasta: '2026-09-06',
    });
    expect(resolverRango({ fecha: '2026-09-15' }, hoy)).toEqual({
      desde: '2026-09-15',
      hasta: '2026-09-15',
    });
    expect(resolverRango({ desde: '2026-01-01', hasta: '2026-03-31' }, hoy)).toEqual({
      desde: '2026-01-01',
      hasta: '2026-03-31',
    });
  });

  it('suma días y cuenta los de un rango', () => {
    expect(sumarDias('2026-10-07', -8)).toBe('2026-09-29');
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(diasDelRango({ desde: '2026-10-07', hasta: '2026-10-07' })).toBe(1);
    expect(diasDelRango({ desde: '2026-01-01', hasta: '2026-12-31' })).toBe(365);
  });
});
