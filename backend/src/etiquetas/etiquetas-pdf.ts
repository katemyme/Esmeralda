import PDFDocument from 'pdfkit';
import { aBuffer } from '../exportacion/pdf';
import { dibujarQr } from '../exportacion/qr';

type Documento = InstanceType<typeof PDFDocument>;

/** Lo que lleva una etiqueta: el QR con solo el código, el código y el nombre corto. Sin precio. */
export interface Etiqueta {
  codigo: string;
  nombre: string;
}

/** Hoja carta con una cuadrícula de etiquetas (hojas adhesivas). Medidas en milímetros. */
export interface Cuadricula {
  filas: number;
  columnas: number;
  margen_superior: number;
  margen_izquierdo: number;
  /** De cada etiqueta. */
  ancho: number;
  alto: number;
  /** Entre una columna y la siguiente, y entre una fila y la siguiente. */
  separacion_horizontal: number;
  separacion_vertical: number;
  /** Etiquetas de la primera hoja que ya se usaron: se dejan en blanco (para aprovechar una hoja empezada). */
  saltar: number;
  /** El contorno de cada etiqueta, para probar la cuadrícula en papel normal antes de usar las adhesivas. */
  bordes: boolean;
}

/** Una etiqueta por página (impresora de etiquetas). Medidas en milímetros. */
export interface TamanoEtiqueta {
  ancho: number;
  alto: number;
}

/** Hoja carta: 8.5 × 11 pulgadas. */
export const CARTA_MM = { ancho: 215.9, alto: 279.4 } as const;

const PUNTOS_POR_MM = 72 / 25.4;
const mm = (valor: number) => valor * PUNTOS_POR_MM;
/** Módulos en blanco alrededor del QR: con el margen de la etiqueta, el lector lo separa del resto. */
const BORDE_QR = 2;
const LETRA_CODIGO = 9;
const LETRA_NOMBRE = 7.5;
/** Por debajo de esto no se lee: lo que no cabe se corta con «…». */
const LETRA_MINIMA = 5;
const GRIS = '#9AA5A0';

/** Lo que pdfkit guarda en la raíz del PDF y no declara en sus tipos. */
type ConRaiz = { _root: { data: Record<string, unknown> } };

function nuevoDocumento(titulo: string): Documento {
  const doc = new PDFDocument({
    autoFirstPage: false,
    margin: 0,
    info: { Title: titulo, Author: 'Sistema Esmeralda' },
  });
  // Se imprime a tamaño real: los programas que lo respetan (Chrome, Adobe) no lo encogen ni lo
  // estiran para «ajustarlo» a la hoja (la etiqueta tiene que caer donde está la adhesiva)
  (doc as unknown as ConRaiz)._root.data.ViewerPreferences = doc.ref({ PrintScaling: 'None' });
  return doc;
}

/** La letra más grande (de `desde` a `hasta`) con la que el texto cabe en el ancho y el alto. */
function letraQueCabe(
  doc: Documento,
  texto: string,
  ancho: number,
  alto: number,
  desde: number,
): number | null {
  for (let letra = desde; letra >= LETRA_MINIMA; letra -= 0.5) {
    doc.fontSize(letra);
    if (doc.heightOfString(texto, { width: ancho }) <= alto) return letra;
  }
  return null;
}

/**
 * El código (en negrita, en una línea si cabe) y debajo el nombre, achicando la letra hasta que
 * quepan en el recuadro; lo que ni así cabe se corta con «…». Nada sale del recuadro.
 */
function dibujarTextos(
  doc: Documento,
  etiqueta: Etiqueta,
  x: number,
  y: number,
  ancho: number,
  alto: number,
  alineacion: 'left' | 'center',
  centrarEnAlto: boolean,
): void {
  // El código, en una sola línea mientras quepa (uno de fábrica muy largo se parte)
  doc.font('Helvetica-Bold');
  let letraCodigo = LETRA_MINIMA;
  for (let letra = LETRA_CODIGO; letra >= LETRA_MINIMA; letra -= 0.5) {
    doc.fontSize(letra);
    if (doc.widthOfString(etiqueta.codigo) <= ancho && doc.currentLineHeight() <= alto) {
      letraCodigo = letra;
      break;
    }
  }
  doc.fontSize(letraCodigo);
  const altoCodigo = Math.min(doc.heightOfString(etiqueta.codigo, { width: ancho }), alto);

  const separacion = mm(0.4);
  const queda = alto - altoCodigo - separacion;
  doc.font('Helvetica');
  let letraNombre: number | null = null;
  let altoNombre = 0;
  if (etiqueta.nombre && queda >= LETRA_MINIMA * 1.2) {
    letraNombre =
      letraQueCabe(doc, etiqueta.nombre, ancho, queda, Math.min(LETRA_NOMBRE, letraCodigo)) ??
      LETRA_MINIMA;
    doc.fontSize(letraNombre);
    altoNombre = Math.min(doc.heightOfString(etiqueta.nombre, { width: ancho }), queda);
  }

  const total = altoCodigo + (letraNombre === null ? 0 : separacion + altoNombre);
  let arriba = centrarEnAlto ? y + (alto - total) / 2 : y;
  doc
    .font('Helvetica-Bold')
    .fontSize(letraCodigo)
    .fillColor('black')
    .text(etiqueta.codigo, x, arriba, {
      width: ancho,
      height: altoCodigo,
      align: alineacion,
      ellipsis: true,
    });
  if (letraNombre === null) return;
  arriba += altoCodigo + separacion;
  doc.font('Helvetica').fontSize(letraNombre).text(etiqueta.nombre, x, arriba, {
    width: ancho,
    height: altoNombre,
    align: alineacion,
    ellipsis: true,
  });
}

/**
 * Una etiqueta en el recuadro (x, y, ancho, alto), en puntos. Apaisada (como las de 50 × 30 mm):
 * el QR a la izquierda y el texto a su lado. Alta o cuadrada: el QR arriba y el texto debajo.
 */
function dibujarEtiqueta(
  doc: Documento,
  etiqueta: Etiqueta,
  x: number,
  y: number,
  ancho: number,
  alto: number,
): void {
  const relleno = Math.min(mm(1.5), Math.min(ancho, alto) * 0.08);
  if (ancho >= alto * 1.3) {
    const lado = Math.min(alto - 2 * relleno, ancho * 0.45);
    dibujarQr(doc, etiqueta.codigo, x + relleno, y + (alto - lado) / 2, lado, BORDE_QR);
    const izquierda = x + relleno + lado + mm(0.8);
    dibujarTextos(
      doc,
      etiqueta,
      izquierda,
      y + relleno,
      x + ancho - relleno - izquierda,
      alto - 2 * relleno,
      'left',
      true,
    );
    return;
  }
  const lado = Math.min(ancho - 2 * relleno, (alto - 2 * relleno) * 0.62);
  dibujarQr(doc, etiqueta.codigo, x + (ancho - lado) / 2, y + relleno, lado, BORDE_QR);
  const arriba = y + relleno + lado + mm(0.4);
  dibujarTextos(
    doc,
    etiqueta,
    x + relleno,
    arriba,
    ancho - 2 * relleno,
    y + alto - relleno - arriba,
    'center',
    false,
  );
}

/** Dónde queda cada etiqueta de la cuadrícula, en milímetros desde la esquina superior izquierda. */
export function posicionEnHoja(c: Cuadricula, posicion: number): { x: number; y: number } {
  const enLaHoja = posicion % (c.filas * c.columnas);
  const fila = Math.floor(enLaHoja / c.columnas);
  const columna = enLaHoja % c.columnas;
  return {
    x: c.margen_izquierdo + columna * (c.ancho + c.separacion_horizontal),
    y: c.margen_superior + fila * (c.alto + c.separacion_vertical),
  };
}

/** Las etiquetas en hojas carta (adhesivas), llenando la cuadrícula fila por fila. */
export function etiquetasEnHoja(etiquetas: Etiqueta[], c: Cuadricula): Promise<Buffer> {
  const doc = nuevoDocumento('Etiquetas');
  const porHoja = c.filas * c.columnas;
  const hojas = Math.max(1, Math.ceil((etiquetas.length + c.saltar) / porHoja));
  for (let hoja = 0; hoja < hojas; hoja++) {
    doc.addPage({ size: 'LETTER', margin: 0 });
    if (c.bordes) {
      for (let posicion = 0; posicion < porHoja; posicion++) {
        const { x, y } = posicionEnHoja(c, posicion);
        doc.rect(mm(x), mm(y), mm(c.ancho), mm(c.alto));
      }
      doc.lineWidth(0.3).strokeColor(GRIS).stroke();
    }
    for (let posicion = hoja * porHoja; posicion < (hoja + 1) * porHoja; posicion++) {
      const etiqueta = etiquetas[posicion - c.saltar];
      if (posicion < c.saltar || !etiqueta) continue;
      const { x, y } = posicionEnHoja(c, posicion);
      dibujarEtiqueta(doc, etiqueta, mm(x), mm(y), mm(c.ancho), mm(c.alto));
    }
  }
  return aBuffer(doc);
}

/** Una etiqueta por página, del tamaño de la etiqueta (para la impresora de etiquetas). */
export function etiquetasEnRollo(etiquetas: Etiqueta[], tamano: TamanoEtiqueta): Promise<Buffer> {
  const doc = nuevoDocumento('Etiquetas');
  const pagina: [number, number] = [mm(tamano.ancho), mm(tamano.alto)];
  for (const etiqueta of etiquetas) {
    doc.addPage({ size: pagina, margin: 0 });
    dibujarEtiqueta(doc, etiqueta, 0, 0, pagina[0], pagina[1]);
  }
  return aBuffer(doc);
}
