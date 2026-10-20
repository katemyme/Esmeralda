import type PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

type Documento = InstanceType<typeof PDFDocument>;

/**
 * El código QR de un texto corto (el número de una factura, el código de una pieza) como
 * cuadrícula: `true` es un módulo negro. La fila 0 es la de arriba y la columna 0 la de la izquierda.
 */
export function matrizQr(contenido: string): boolean[][] {
  // Nivel M: aguanta un ticket térmico algo arrugado o rayado
  const { modules } = QRCode.create(contenido, { errorCorrectionLevel: 'M' });
  return Array.from({ length: modules.size }, (_, fila) =>
    Array.from({ length: modules.size }, (__, columna) => Boolean(modules.get(fila, columna))),
  );
}

/**
 * Dibuja el QR en un cuadrado de `lado` puntos con su esquina superior izquierda en (x, y),
 * contando `borde` módulos en blanco alrededor (los que necesita el lector): cada tramo negro de
 * una fila, de un trazo.
 */
export function dibujarQr(
  doc: Documento,
  contenido: string,
  x: number,
  y: number,
  lado: number,
  borde: number,
): void {
  const matriz = matrizQr(contenido);
  const modulo = lado / (matriz.length + 2 * borde);
  matriz.forEach((fila, f) => {
    let inicio = -1;
    for (let c = 0; c <= fila.length; c++) {
      const negro = c < fila.length && fila[c];
      if (negro && inicio < 0) inicio = c;
      if (!negro && inicio >= 0) {
        doc.rect(
          x + (borde + inicio) * modulo,
          y + (borde + f) * modulo,
          (c - inicio) * modulo,
          modulo,
        );
        inicio = -1;
      }
    }
  });
  doc.fillColor('black').fill();
}
