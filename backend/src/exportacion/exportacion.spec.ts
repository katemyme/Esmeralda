import ExcelJS from 'exceljs';
import type { Reporte } from '../reportes/reporte';
import { reporteExcel } from './excel';
import { entero, fechaCorta, fechaHora, horaDeManaguaEnUtc, mesCorto, monto } from './formato';
import { reportePdf } from './pdf';
import { lineasDeEncabezado, nombreDeArchivo, textoDeCelda } from './reporte-texto';

const reporte: Reporte = {
  clave: 'ventas-por-vendedor',
  titulo: 'Ventas por vendedor',
  desde: '2026-10-01',
  hasta: '2026-10-07',
  sucursal: { id: 1, codigo: 'LAM', nombre: 'Multicentro Las Américas' },
  generado_at: new Date('2026-10-08T03:30:00Z'), // 21:30 del día 7 en Managua
  notas: ['No incluye las ventas de los turnos de caja que siguen abiertos.'],
  secciones: [
    {
      clave: 'vendedores',
      titulo: 'Ventas por vendedor',
      columnas: [
        { clave: 'vendedor', titulo: 'Vendedor', tipo: 'texto' },
        { clave: 'ventas', titulo: 'Ventas', tipo: 'entero' },
        { clave: 'venta_neta', titulo: 'Venta neta', tipo: 'monto' },
        { clave: 'margen_pct', titulo: 'Margen %', tipo: 'porcentaje' },
        { clave: 'ultima', titulo: 'Última venta', tipo: 'fecha_hora' },
        { clave: 'dia', titulo: 'Día', tipo: 'fecha' },
        { clave: 'activo', titulo: 'Activo', tipo: 'si_no' },
      ],
      filas: [
        {
          vendedor: 'Ana Martínez',
          ventas: 12,
          venta_neta: '15250.50',
          margen_pct: '63.5',
          ultima: new Date('2026-10-07T21:42:00Z'),
          dia: '2026-10-07',
          activo: true,
        },
        {
          vendedor: 'Carlos Ruiz',
          ventas: 0,
          venta_neta: '0.00',
          margen_pct: null,
          ultima: null,
          dia: null,
          activo: false,
        },
      ],
      totales: { ventas: 12, venta_neta: '15250.50' },
    },
    {
      clave: 'vacia',
      titulo: 'Sin movimientos / [prueba]',
      columnas: [{ clave: 'mes', titulo: 'Mes', tipo: 'mes' }],
      filas: [],
      totales: null,
    },
  ],
};

describe('formato de fechas y montos (hora de Managua)', () => {
  it('fechas', () => {
    expect(fechaCorta('2026-10-07')).toBe('07/10/2026');
    expect(mesCorto('2026-10-01')).toBe('10/2026');
    expect(mesCorto('2026-10')).toBe('10/2026');
    // 03:30 UTC del día 8 son las 21:30 del día 7 en Managua
    expect(fechaHora(new Date('2026-10-08T03:30:00Z'))).toBe('07/10/2026 21:30');
    expect(fechaHora(new Date('2026-10-07T06:05:00Z'))).toBe('07/10/2026 00:05');
    expect(horaDeManaguaEnUtc(new Date('2026-10-08T03:30:00Z'))).toEqual(
      new Date('2026-10-07T21:30:00Z'),
    );
  });

  it('montos y enteros con separador de miles', () => {
    expect(monto('1250.5')).toBe('1,250.50');
    expect(monto(0)).toBe('0.00');
    expect(monto('-283.76')).toBe('-283.76');
    expect(entero(12500)).toBe('12,500');
  });

  it('el texto de cada tipo de celda', () => {
    expect(textoDeCelda('1250.5', 'monto')).toBe('1,250.50');
    expect(textoDeCelda('63.5', 'porcentaje')).toBe('63.5 %');
    expect(textoDeCelda(1200, 'entero')).toBe('1,200');
    expect(textoDeCelda('2026-10-07', 'fecha')).toBe('07/10/2026');
    expect(textoDeCelda('2026-10-01', 'mes')).toBe('10/2026');
    // una fecha con hora llega como Date o, ya pasada por JSON, como texto
    expect(textoDeCelda(new Date('2026-10-08T03:30:00Z'), 'fecha_hora')).toBe('07/10/2026 21:30');
    expect(textoDeCelda('2026-10-08T03:30:00.000Z', 'fecha_hora')).toBe('07/10/2026 21:30');
    expect(textoDeCelda(true, 'si_no')).toBe('Sí');
    expect(textoDeCelda(false, 'si_no')).toBe('No');
    expect(textoDeCelda(null, 'monto')).toBe('');
  });

  it('encabezado y nombre del archivo de un reporte', () => {
    expect(lineasDeEncabezado(reporte)).toEqual([
      'Del 01/10/2026 al 07/10/2026',
      'Sucursal: Multicentro Las Américas',
      'Generado el 07/10/2026 21:30',
      'No incluye las ventas de los turnos de caja que siguen abiertos.',
    ]);
    expect(nombreDeArchivo(reporte, 'xlsx')).toBe('ventas-por-vendedor_2026-10-01_2026-10-07.xlsx');
    const deUnDia = { ...reporte, hasta: '2026-10-01', sucursal: null, notas: [] };
    expect(lineasDeEncabezado(deUnDia).slice(0, 2)).toEqual(['Día: 01/10/2026', 'Sucursal: todas']);
    expect(nombreDeArchivo(deUnDia, 'pdf')).toBe('ventas-por-vendedor_2026-10-01.pdf');
    // un reporte que es una foto lleva el día (de Managua) en que se generó
    const foto = { ...reporte, clave: 'por-reponer', desde: null, hasta: null };
    expect(lineasDeEncabezado(foto)[0]).toBe('Sucursal: Multicentro Las Américas');
    expect(nombreDeArchivo(foto, 'pdf')).toBe('por-reponer_2026-10-07.pdf');
  });
});

describe('reporteExcel', () => {
  it('una hoja por sección, con números y fechas como tales', async () => {
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load((await reporteExcel(reporte)) as unknown as ExcelJS.Buffer);
    // el nombre de la hoja no admite / [ ]
    expect(libro.worksheets.map((h) => h.name)).toEqual([
      'Ventas por vendedor',
      'Sin movimientos    prueba',
    ]);

    const hoja = libro.worksheets[0];
    const filas: unknown[][] = [];
    hoja.eachRow({ includeEmpty: true }, (fila) => filas.push((fila.values as unknown[]).slice(1)));
    expect(filas).toEqual([
      ['Ventas por vendedor'],
      ['Del 01/10/2026 al 07/10/2026'],
      ['Sucursal: Multicentro Las Américas'],
      ['Generado el 07/10/2026 21:30'],
      ['No incluye las ventas de los turnos de caja que siguen abiertos.'],
      [],
      ['Vendedor', 'Ventas', 'Venta neta', 'Margen %', 'Última venta', 'Día', 'Activo'],
      [
        'Ana Martínez',
        12,
        15250.5,
        63.5,
        new Date('2026-10-07T15:42:00Z'), // las 15:42 de Managua, como hora "de pared"
        new Date('2026-10-07T00:00:00Z'),
        'Sí',
      ],
      ['Carlos Ruiz', 0, 0, undefined, undefined, undefined, 'No'],
      ['Total', 12, 15250.5],
    ]);
    expect(hoja.getCell('C8').numFmt).toBe('#,##0.00');
    expect(hoja.getCell('E8').numFmt).toBe('dd/mm/yyyy hh:mm');
    expect(hoja.getCell('A10').font?.bold).toBe(true);
    expect(hoja.views[0]).toMatchObject({ state: 'frozen', ySplit: 7 });

    const vacia: unknown[] = [];
    libro.worksheets[1].eachRow((fila) => vacia.push((fila.values as unknown[])[1]));
    expect(vacia.slice(0, 2)).toEqual(['Ventas por vendedor', 'Sin movimientos / [prueba]']);
    expect(vacia.at(-1)).toBe('Sin datos en este periodo.');
  });
});

describe('reportePdf', () => {
  const paginas = (pdf: Buffer) => pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;

  it('un PDF tamaño carta; vertical con pocas columnas, horizontal con muchas', async () => {
    const pdf = await reportePdf(reporte);
    const texto = pdf.toString('latin1');
    expect(texto.startsWith('%PDF-')).toBe(true);
    expect(texto.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(texto).toMatch(/\/MediaBox \[0 0 612 792\]/);
    expect(paginas(pdf)).toBe(1);

    const ancho: Reporte = {
      ...reporte,
      secciones: [
        {
          ...reporte.secciones[0],
          columnas: Array.from({ length: 12 }, (_, i) => ({
            clave: `c${i}`,
            titulo: `Columna ${i}`,
            tipo: 'monto' as const,
          })),
          filas: [],
          totales: null,
        },
      ],
    };
    expect((await reportePdf(ancho)).toString('latin1')).toMatch(/\/MediaBox \[0 0 792 612\]/);
  });

  it('una tabla larga sigue en las páginas que haga falta', async () => {
    const largo: Reporte = {
      ...reporte,
      secciones: [
        {
          ...reporte.secciones[0],
          filas: Array.from({ length: 150 }, (_, i) => ({
            ...reporte.secciones[0].filas[0],
            vendedor: `Vendedor número ${i + 1} con un nombre largo que ocupa más de una línea`,
          })),
        },
      ],
    };
    expect(paginas(await reportePdf(largo))).toBeGreaterThan(3);
  });
});
