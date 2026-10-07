import { seccion, type ColumnaDefinida, type Fila } from './reporte';

describe('seccion() de un reporte', () => {
  const columnas: ColumnaDefinida[] = [
    { clave: 'vendedor', titulo: 'Vendedor', tipo: 'texto' },
    { clave: 'venta_neta', titulo: 'Venta neta', tipo: 'monto' },
    { clave: 'margen', titulo: 'Margen', tipo: 'monto', costo: true },
    { clave: 'en_bodega', titulo: 'En bodega', tipo: 'entero', visible: false },
  ];
  const filas: Fila[] = [
    { vendedor: 'Ana', venta_neta: '100.00', margen: '60.00', en_bodega: 3, otra: 'x' },
    { vendedor: 'Luis', venta_neta: '50.00', margen: null, en_bodega: 1 },
  ];
  const totales = { vendedor: null, venta_neta: '150.00', margen: '60.00', en_bodega: 4 };

  it('con REPORTES_COSTOS salen las columnas de costo; las no visibles, nunca', () => {
    const s = seccion('vendedores', 'Ventas por vendedor', columnas, filas, totales, true);
    expect(s.columnas).toEqual([
      { clave: 'vendedor', titulo: 'Vendedor', tipo: 'texto' },
      { clave: 'venta_neta', titulo: 'Venta neta', tipo: 'monto' },
      { clave: 'margen', titulo: 'Margen', tipo: 'monto' },
    ]);
    // de cada fila solo pasan las columnas del reporte
    expect(s.filas).toEqual([
      { vendedor: 'Ana', venta_neta: '100.00', margen: '60.00' },
      { vendedor: 'Luis', venta_neta: '50.00', margen: null },
    ]);
    // los totales solo llevan columnas numéricas
    expect(s.totales).toEqual({ venta_neta: '150.00', margen: '60.00' });
  });

  it('sin el permiso las columnas de costo no existen, ni en las filas ni en los totales', () => {
    const s = seccion('vendedores', 'Ventas por vendedor', columnas, filas, totales, false);
    expect(s.columnas.map((c) => c.clave)).toEqual(['vendedor', 'venta_neta']);
    expect(s.filas[0]).toEqual({ vendedor: 'Ana', venta_neta: '100.00' });
    expect(s.totales).toEqual({ venta_neta: '150.00' });
  });

  it('una sección puede no llevar totales, o llevar solo algunos', () => {
    expect(seccion('x', 'X', columnas, filas, null, true).totales).toBeNull();
    expect(seccion('x', 'X', columnas, filas, { margen: '60.00' }, true).totales).toEqual({
      margen: '60.00',
    });
  });
});
