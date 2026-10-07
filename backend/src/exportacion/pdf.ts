import PDFDocument from 'pdfkit';
import type { Reporte, Seccion, TipoColumna } from '../reportes/reporte';
import { lineasDeEncabezado, textoDeCelda } from './reporte-texto';

type Documento = InstanceType<typeof PDFDocument>;

const MARGEN = 36; // media pulgada
const PIE = 16; // espacio reservado para "Página 1 de 3"
const RELLENO = 3;
const GRIS = '#E8ECEA';
const LINEA = '#C8CECB';

/** Ancho relativo de cada tipo de columna. */
const PESO: Record<TipoColumna, number> = {
  texto: 2.4,
  entero: 1,
  monto: 1.5,
  porcentaje: 1.1,
  fecha: 1.4,
  mes: 1.1,
  fecha_hora: 1.9,
  si_no: 0.9,
};

const A_LA_DERECHA = new Set<TipoColumna>(['entero', 'monto', 'porcentaje']);

/** Junta lo que el documento va escribiendo y lo entrega cuando termina. */
export function aBuffer(doc: Documento): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    doc.on('data', (parte: Buffer) => partes.push(parte));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    doc.end();
  });
}

function dibujarTabla(doc: Documento, seccion: Seccion): void {
  const x0 = MARGEN;
  const ancho = doc.page.width - 2 * MARGEN;
  const pesoTotal = seccion.columnas.reduce((suma, c) => suma + PESO[c.tipo], 0);
  const anchos = seccion.columnas.map((c) => (PESO[c.tipo] / pesoTotal) * ancho);
  const letra = seccion.columnas.length > 11 ? 6.5 : seccion.columnas.length > 8 ? 7.5 : 8.5;
  const titulos = seccion.columnas.map((c) => c.titulo);

  const fila = (textos: string[], opciones: { negrita?: boolean; fondo?: boolean } = {}) => {
    doc.font(opciones.negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(letra);
    const alto =
      Math.max(
        ...textos.map((t, i) => doc.heightOfString(t || ' ', { width: anchos[i] - 2 * RELLENO })),
      ) +
      2 * RELLENO;
    // Si no cabe, sigue en otra página repitiendo los títulos de las columnas
    if (doc.y + alto > doc.page.height - MARGEN - PIE) {
      doc.addPage();
      if (textos !== titulos) {
        fila(titulos, { negrita: true, fondo: true });
        doc.font(opciones.negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(letra);
      }
    }
    const y = doc.y;
    if (opciones.fondo) doc.rect(x0, y, ancho, alto).fill(GRIS);
    doc.fillColor('black');
    let x = x0;
    textos.forEach((t, i) => {
      doc.text(t, x + RELLENO, y + RELLENO, {
        width: anchos[i] - 2 * RELLENO,
        align: A_LA_DERECHA.has(seccion.columnas[i].tipo) ? 'right' : 'left',
      });
      x += anchos[i];
    });
    doc
      .moveTo(x0, y + alto)
      .lineTo(x0 + ancho, y + alto)
      .lineWidth(0.5)
      .strokeColor(LINEA)
      .stroke();
    doc.x = x0;
    doc.y = y + alto;
  };

  fila(titulos, { negrita: true, fondo: true });
  if (seccion.filas.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(letra).fillColor('black');
    doc.text('Sin datos en este periodo.', x0 + RELLENO, doc.y + RELLENO, { width: ancho });
    return;
  }
  for (const valores of seccion.filas) {
    fila(seccion.columnas.map((c) => textoDeCelda(valores[c.clave] ?? null, c.tipo)));
  }
  const totales = seccion.totales;
  if (totales) {
    fila(
      seccion.columnas.map((c, i) => {
        const texto = c.clave in totales ? textoDeCelda(totales[c.clave] ?? null, c.tipo) : '';
        return i === 0 && texto === '' ? 'Total' : texto;
      }),
      { negrita: true, fondo: true },
    );
  }
}

/** El reporte como PDF tamaño carta (horizontal si alguna tabla tiene muchas columnas). */
export function reportePdf(reporte: Reporte): Promise<Buffer> {
  const columnas = Math.max(0, ...reporte.secciones.map((s) => s.columnas.length));
  const doc = new PDFDocument({
    size: 'LETTER',
    layout: columnas > 7 ? 'landscape' : 'portrait',
    margin: MARGEN,
    bufferPages: true,
    info: { Title: reporte.titulo, Author: 'Sistema Esmeralda' },
  });
  const ancho = doc.page.width - 2 * MARGEN;

  doc.font('Helvetica-Bold').fontSize(14).text(reporte.titulo, { width: ancho });
  doc.font('Helvetica').fontSize(9);
  for (const linea of lineasDeEncabezado(reporte)) doc.text(linea, { width: ancho });

  for (const seccion of reporte.secciones) {
    doc.moveDown(0.8);
    // El título de una sección no se queda solo al pie de una página
    if (doc.y > doc.page.height - MARGEN - PIE - 60) doc.addPage();
    if (reporte.secciones.length > 1 || seccion.titulo !== reporte.titulo) {
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor('black');
      doc.text(seccion.titulo, MARGEN, doc.y, { width: ancho });
      doc.moveDown(0.3);
    }
    dibujarTabla(doc, seccion);
  }

  // Numeración, ya con todas las páginas escritas
  const { start, count } = doc.bufferedPageRange();
  for (let n = 0; n < count; n++) {
    doc.switchToPage(start + n);
    doc.page.margins.bottom = 0; // para escribir en el margen sin que agregue otra página
    doc.font('Helvetica').fontSize(7.5).fillColor('#5A6B64');
    doc.text(`Página ${n + 1} de ${count}`, MARGEN, doc.page.height - MARGEN - 2, {
      width: doc.page.width - 2 * MARGEN,
      align: 'right',
      lineBreak: false,
    });
  }
  return aBuffer(doc);
}
