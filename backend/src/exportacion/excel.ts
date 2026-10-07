import ExcelJS from 'exceljs';
import type { Reporte, Seccion, TipoColumna, Valor } from '../reportes/reporte';
import { horaDeManaguaEnUtc } from './formato';
import { aInstante, lineasDeEncabezado } from './reporte-texto';

const FORMATO_NUMERO: Partial<Record<TipoColumna, string>> = {
  entero: '#,##0',
  monto: '#,##0.00',
  porcentaje: '0.0"%"',
  fecha: 'dd/mm/yyyy',
  mes: 'mm/yyyy',
  fecha_hora: 'dd/mm/yyyy hh:mm',
};

const ANCHO: Record<TipoColumna, number> = {
  texto: 30,
  entero: 12,
  monto: 18,
  porcentaje: 12,
  fecha: 14,
  mes: 12,
  fecha_hora: 19,
  si_no: 11,
};

const NUMERICAS = new Set<TipoColumna>(['entero', 'monto', 'porcentaje']);

/** Los números van como números y las fechas como fechas, para poder sumar y ordenar en Excel. */
function celda(valor: Valor, tipo: TipoColumna): ExcelJS.CellValue {
  if (valor === null) return null;
  switch (tipo) {
    case 'entero':
    case 'monto':
    case 'porcentaje':
      return Number(valor);
    case 'fecha':
    case 'mes':
      return new Date(`${String(valor)}T00:00:00Z`);
    case 'fecha_hora':
      return horaDeManaguaEnUtc(aInstante(valor));
    case 'si_no':
      return valor ? 'Sí' : 'No';
    default:
      return String(valor);
  }
}

/** Nombre de hoja válido en Excel: hasta 31 caracteres, sin \ / ? * [ ] : y sin repetir. */
function nombreDeHoja(titulo: string, usados: Set<string>): string {
  const limpio =
    titulo
      .replace(/[\\/?*[\]:]/g, ' ')
      .trim()
      .slice(0, 31)
      .trim() || 'Reporte';
  let nombre = limpio;
  for (let n = 2; usados.has(nombre.toLowerCase()); n++) {
    nombre = `${limpio.slice(0, 28)} ${n}`;
  }
  usados.add(nombre.toLowerCase());
  return nombre;
}

function escribirSeccion(hoja: ExcelJS.Worksheet, reporte: Reporte, seccion: Seccion): void {
  hoja.addRow([reporte.titulo]).font = { bold: true, size: 14 };
  if (seccion.titulo !== reporte.titulo) hoja.addRow([seccion.titulo]).font = { bold: true };
  for (const linea of lineasDeEncabezado(reporte)) hoja.addRow([linea]);
  hoja.addRow([]);

  const encabezado = hoja.addRow(seccion.columnas.map((c) => c.titulo));
  encabezado.font = { bold: true };
  encabezado.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECEA' } };
    c.border = { bottom: { style: 'thin' } };
  });
  hoja.views = [{ state: 'frozen', ySplit: encabezado.number }];

  const escribir = (valores: Record<string, Valor>, total: boolean) => {
    const fila = hoja.addRow(
      seccion.columnas.map((c, i) => {
        const valor = c.clave in valores ? celda(valores[c.clave] ?? null, c.tipo) : null;
        return total && i === 0 && valor === null ? 'Total' : valor;
      }),
    );
    if (total) {
      fila.font = { bold: true };
      fila.eachCell((c) => (c.border = { top: { style: 'thin' } }));
    }
  };
  for (const fila of seccion.filas) escribir(fila, false);
  if (seccion.filas.length === 0) hoja.addRow(['Sin datos en este periodo.']);
  else if (seccion.totales) escribir(seccion.totales, true);

  seccion.columnas.forEach((c, i) => {
    const columna = hoja.getColumn(i + 1);
    columna.width = ANCHO[c.tipo];
    const formato = FORMATO_NUMERO[c.tipo];
    if (formato) columna.numFmt = formato;
    if (NUMERICAS.has(c.tipo)) columna.alignment = { horizontal: 'right' };
  });
  // El título y las líneas del encabezado están en la primera columna: que no se corten
  for (let n = 1; n < encabezado.number; n++) {
    hoja.getRow(n).getCell(1).alignment = { horizontal: 'left' };
    hoja.getRow(n).getCell(1).numFmt = '@';
  }
}

/** El reporte como libro de Excel: una hoja por sección. */
export async function reporteExcel(reporte: Reporte): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Sistema Esmeralda';
  libro.created = reporte.generado_at;
  const usados = new Set<string>();
  for (const seccion of reporte.secciones) {
    escribirSeccion(libro.addWorksheet(nombreDeHoja(seccion.titulo, usados)), reporte, seccion);
  }
  return Buffer.from(await libro.xlsx.writeBuffer());
}
