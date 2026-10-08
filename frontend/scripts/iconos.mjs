// Genera los iconos PNG provisionales de la PWA (un diamante claro sobre esmeralda oscuro) sin
// dependencias: `node scripts/iconos.mjs`. Cuando el dueño entregue el logo se reemplazan los PNG.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const FONDO = [0x06, 0x4e, 0x3b];
const GEMA = [0x0b, 0x6e, 0x4f];
const LINEA = [0xf6, 0xee, 0xdc];

function crc32(datos) {
  let c = ~0;
  for (const byte of datos) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function bloque(tipo, datos) {
  const cabeza = Buffer.alloc(8);
  cabeza.writeUInt32BE(datos.length, 0);
  cabeza.write(tipo, 4, 'ascii');
  const fin = Buffer.alloc(4);
  fin.writeUInt32BE(crc32(Buffer.concat([cabeza.subarray(4), datos])), 0);
  return Buffer.concat([cabeza, datos, fin]);
}

/** Un diamante: ancho arriba (corona) y en punta abajo, con su borde claro. */
function color(x, y) {
  const cx = Math.abs(x - 0.5);
  if (y < 0.2 || y > 0.82) return FONDO;
  const mitad = y < 0.42 ? 0.14 + ((y - 0.2) / 0.22) * 0.13 : 0.27 * (1 - (y - 0.42) / 0.4);
  if (cx > mitad) return FONDO;
  const borde = mitad - cx < 0.022 || Math.abs(y - 0.42) < 0.012 || y - 0.2 < 0.02;
  return borde ? LINEA : GEMA;
}

function png(lado) {
  const filas = Buffer.alloc(lado * (lado * 3 + 1));
  for (let y = 0; y < lado; y++) {
    const inicio = y * (lado * 3 + 1);
    for (let x = 0; x < lado; x++) {
      filas.set(color((x + 0.5) / lado, (y + 0.5) / lado), inicio + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque('IHDR', ihdr),
    bloque('IDAT', deflateSync(filas)),
    bloque('IEND', Buffer.alloc(0)),
  ]);
}

for (const lado of [180, 192, 512]) {
  writeFileSync(new URL(`../public/iconos/icono-${lado}.png`, import.meta.url), png(lado));
}
console.log('Iconos generados en public/iconos');
