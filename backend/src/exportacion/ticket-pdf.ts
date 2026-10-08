import PDFDocument from 'pdfkit';
import { aBuffer } from './pdf';
import { matrizQr } from './qr';

type Documento = InstanceType<typeof PDFDocument>;

/**
 * Un renglón de un ticket. Los tickets (de venta, de cierre y de devolución) se arman como una
 * lista de renglones y aquí se dibujan; así su contenido se prueba sin leer el PDF.
 */
export type Renglon =
  | { tipo: 'texto'; texto: string; centrado?: boolean; negrita?: boolean; grande?: boolean }
  /** Un texto a la izquierda y un monto (o un dato corto) a la derecha, en la misma línea. */
  | { tipo: 'par'; izquierda: string; derecha: string; negrita?: boolean }
  /** Un código QR centrado con ese texto (el número de factura, para escanearlo al devolver). */
  | { tipo: 'qr'; contenido: string }
  | { tipo: 'linea' }
  | { tipo: 'espacio' };

const PUNTOS_POR_MM = 72 / 25.4;
/** Rollo de papel térmico de 80 mm. */
const ANCHO = 80 * PUNTOS_POR_MM;
const MARGEN = 4 * PUNTOS_POR_MM;
const UTIL = ANCHO - 2 * MARGEN;
/** El QR mide 30 mm de lado, contando el borde en blanco que necesita el lector. */
const LADO_QR = 30 * PUNTOS_POR_MM;
const BORDE_QR = 4; // módulos en blanco alrededor

function fuente(doc: Documento, negrita = false, grande = false): void {
  doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(grande ? 11 : 8);
}

/** Dibuja el QR con su esquina superior izquierda en (x, y): cada tramo negro de una fila, de un trazo. */
function dibujarQr(doc: Documento, contenido: string, x: number, y: number): void {
  const matriz = matrizQr(contenido);
  const modulo = LADO_QR / (matriz.length + 2 * BORDE_QR);
  matriz.forEach((fila, f) => {
    let inicio = -1;
    for (let c = 0; c <= fila.length; c++) {
      const negro = c < fila.length && fila[c];
      if (negro && inicio < 0) inicio = c;
      if (!negro && inicio >= 0) {
        doc.rect(
          x + (BORDE_QR + inicio) * modulo,
          y + (BORDE_QR + f) * modulo,
          (c - inicio) * modulo,
          modulo,
        );
        inicio = -1;
      }
    }
  });
  doc.fillColor('black').fill();
}

/** Dibuja el renglón en `y` (o solo lo mide, si `dibujar` es false) y devuelve cuánto ocupa. */
function colocar(doc: Documento, renglon: Renglon, y: number, dibujar: boolean): number {
  switch (renglon.tipo) {
    case 'espacio':
      return 6;
    case 'qr':
      if (dibujar) dibujarQr(doc, renglon.contenido, (ANCHO - LADO_QR) / 2, y);
      return LADO_QR;
    case 'linea':
      if (dibujar) {
        doc
          .moveTo(MARGEN, y + 3)
          .lineTo(ANCHO - MARGEN, y + 3)
          .lineWidth(0.5)
          .dash(1.5, { space: 1.5 })
          .stroke()
          .undash();
      }
      return 7;
    case 'texto': {
      fuente(doc, renglon.negrita, renglon.grande);
      const opciones = { width: UTIL, align: renglon.centrado ? 'center' : 'left' } as const;
      if (dibujar) doc.text(renglon.texto, MARGEN, y, opciones);
      return doc.heightOfString(renglon.texto || ' ', opciones) + 1;
    }
    case 'par': {
      fuente(doc, renglon.negrita);
      const anchoDerecha = doc.widthOfString(renglon.derecha) + 1;
      const anchoIzquierda = UTIL - anchoDerecha - 6;
      if (dibujar) {
        doc.text(renglon.izquierda, MARGEN, y, { width: anchoIzquierda });
        doc.text(renglon.derecha, ANCHO - MARGEN - anchoDerecha, y, {
          width: anchoDerecha,
          align: 'right',
          lineBreak: false,
        });
      }
      return doc.heightOfString(renglon.izquierda || ' ', { width: anchoIzquierda }) + 1;
    }
  }
}

/**
 * El ticket como PDF de una sola página de 80 mm de ancho y tan larga como su contenido (así sale
 * en una impresora térmica sin cortes ni espacio en blanco).
 */
export function ticketPdf(renglones: Renglon[], titulo: string): Promise<Buffer> {
  // Primero se mide en un documento aparte: el alto de la página se fija al crearla
  const medida = new PDFDocument({ size: [ANCHO, 2000], margin: 0 });
  const alto = renglones.reduce((suma, r) => suma + colocar(medida, r, 0, false), 2 * MARGEN);

  const doc = new PDFDocument({
    size: [ANCHO, Math.ceil(alto) + 2],
    margin: 0,
    info: { Title: titulo, Author: 'Sistema Esmeralda' },
  });
  let y = MARGEN;
  for (const renglon of renglones) y += colocar(doc, renglon, y, true);
  return aBuffer(doc);
}

/** Ancho de la página del ticket, en puntos (para las pruebas). */
export const ANCHO_TICKET = ANCHO;
