import QRCode from 'qrcode';

/**
 * El código QR de un texto corto (el número de una factura) como cuadrícula: `true` es un módulo
 * negro. La fila 0 es la de arriba y la columna 0 la de la izquierda.
 */
export function matrizQr(contenido: string): boolean[][] {
  // Nivel M: aguanta un ticket térmico algo arrugado o rayado
  const { modules } = QRCode.create(contenido, { errorCorrectionLevel: 'M' });
  return Array.from({ length: modules.size }, (_, fila) =>
    Array.from({ length: modules.size }, (__, columna) => Boolean(modules.get(fila, columna))),
  );
}
