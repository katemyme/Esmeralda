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
/**
 * La página mide lo que de verdad imprime una impresora térmica de 80 mm: 72 mm (el cabezal deja
 * 4 mm de papel sin imprimir a cada lado). El driver de Windows de la Xprinter declara justo esa
 * hoja («80(72.1) x … mm»: 72,07 mm de ancho, sin márgenes) y Chrome, a escala 100 %, pone la
 * página del PDF en su esquina superior izquierda: con una página de 80 mm se perdían los 8 mm de
 * la derecha, donde van los montos.
 */
const ANCHO = 72 * PUNTOS_POR_MM;
/** Un respiro a cada lado, para que ninguna letra quede pegada al borde de lo imprimible. */
const MARGEN = 2 * PUNTOS_POR_MM;
const UTIL = ANCHO - 2 * MARGEN;
/**
 * La página nunca es más ancha que alta: Chrome gira al imprimir los PDF apaisados, y un ticket
 * corto (un cierre forzado) saldría de lado. Lo que sobra abajo queda en blanco.
 */
const ALTO_MINIMO = ANCHO + PUNTOS_POR_MM;
/** El QR mide 30 mm de lado, contando el borde en blanco que necesita el lector. */
const LADO_QR = 30 * PUNTOS_POR_MM;
const BORDE_QR = 4; // módulos en blanco alrededor
/** Espacio entre lo de la izquierda y lo de la derecha de un `par`. */
const SEPARACION = 6;
/** Lo de la izquierda de un `par` se queda al lado mientras le toque al menos esta parte del ancho. */
const MINIMO_IZQUIERDA = 0.45;

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
      // Lo que no cabe en el ancho sigue en el renglón de abajo (una palabra sola más ancha que
      // el ticket se parte): nunca se sale
      fuente(doc, renglon.negrita, renglon.grande);
      const opciones = { width: UTIL, align: renglon.centrado ? 'center' : 'left' } as const;
      if (dibujar) doc.text(renglon.texto, MARGEN, y, opciones);
      return doc.heightOfString(renglon.texto || ' ', opciones) + 1;
    }
    case 'par': {
      fuente(doc, renglon.negrita);
      const anchoDerecha = doc.widthOfString(renglon.derecha);
      const columna = UTIL - anchoDerecha - SEPARACION;
      const alLado =
        doc.widthOfString(renglon.izquierda) <= columna || columna >= UTIL * MINIMO_IZQUIERDA;
      if (alLado) {
        // Lo de la derecha termina justo en el margen; lo de la izquierda se parte en su columna
        if (dibujar) {
          doc.text(renglon.izquierda, MARGEN, y, { width: columna });
          doc.text(renglon.derecha, ANCHO - MARGEN - anchoDerecha, y, { lineBreak: false });
        }
        return doc.heightOfString(renglon.izquierda || ' ', { width: columna }) + 1;
      }
      // Lo de la derecha es tan largo que no deja sitio: baja a su propio renglón, a la derecha
      const izquierda = { width: UTIL } as const;
      const derecha = { width: UTIL, align: 'right' } as const;
      const altoIzquierda = renglon.izquierda
        ? doc.heightOfString(renglon.izquierda, izquierda)
        : 0;
      if (dibujar) {
        doc.text(renglon.izquierda, MARGEN, y, izquierda);
        doc.text(renglon.derecha, MARGEN, y + altoIzquierda, derecha);
      }
      return altoIzquierda + doc.heightOfString(renglon.derecha, derecha) + 1;
    }
  }
}

/** Lo que pdfkit guarda en la raíz del PDF y no declara en sus tipos. */
type ConRaiz = { _root: { data: Record<string, unknown> } };

/**
 * El ticket como PDF de una sola página de 72 mm de ancho (lo imprimible en un rollo de 80 mm) y
 * tan larga como su contenido, para que la impresora térmica no avance papel en blanco.
 */
export function ticketPdf(renglones: Renglon[], titulo: string): Promise<Buffer> {
  // Primero se mide en un documento aparte: el alto de la página se fija al crearla
  const medida = new PDFDocument({ size: [ANCHO, 2000], margin: 0 });
  const contenido = renglones.reduce((suma, r) => suma + colocar(medida, r, 0, false), 0);

  const doc = new PDFDocument({
    size: [ANCHO, Math.max(Math.ceil(contenido + 2 * MARGEN), ALTO_MINIMO)],
    margin: 0,
    info: { Title: titulo, Author: 'Sistema Esmeralda' },
  });
  // El documento pide imprimirse a tamaño real: los programas que lo respetan (Chrome, Adobe) no
  // lo encogen ni lo estiran para «ajustarlo» a la hoja
  (doc as unknown as ConRaiz)._root.data.ViewerPreferences = doc.ref({ PrintScaling: 'None' });
  let y = MARGEN;
  for (const renglon of renglones) y += colocar(doc, renglon, y, true);
  return aBuffer(doc);
}

/** Ancho de la página del ticket, en puntos (para las pruebas). */
export const ANCHO_TICKET = ANCHO;
/** Margen a cada lado, en puntos (para las pruebas). */
export const MARGEN_TICKET = MARGEN;
