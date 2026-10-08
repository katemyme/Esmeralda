import { afterEach, describe, expect, it } from 'vitest';
import type { Renglon } from '../api/tipos';
import { aCentavos, deCentavos, esMonto, totalContado } from '../util/dinero';
import { comandosDeTicket, modoDeImpresion } from './imprimir';

const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/141.0 Mobile';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) Version/19.0 Mobile Safari';

function conWebUsb(tiene: boolean) {
  if (tiene) Object.defineProperty(navigator, 'usb', { value: {}, configurable: true });
  else delete (navigator as { usb?: unknown }).usb;
}

describe('cómo imprime cada equipo', () => {
  afterEach(() => conWebUsb(false));

  it('el celular o la tablet Android con Chrome: directo por USB', () => {
    conWebUsb(true);
    expect(modoDeImpresion(ANDROID)).toBe('usb');
  });

  it('la PC de caja con Windows: por el diálogo, aunque Chrome tenga WebUSB (el driver ocupa la impresora)', () => {
    conWebUsb(true);
    expect(modoDeImpresion(WINDOWS)).toBe('dialogo');
  });

  it('un iPhone, o cualquier navegador sin WebUSB: por el diálogo', () => {
    conWebUsb(false);
    expect(modoDeImpresion(IPHONE)).toBe('dialogo');
    expect(modoDeImpresion(ANDROID)).toBe('dialogo');
  });
});

describe('el ticket en comandos de la impresora (ESC/POS)', () => {
  const renglones: Renglon[] = [
    { tipo: 'texto', texto: 'Esmeralda Experience', centrado: true, negrita: true, grande: true },
    { tipo: 'linea' },
    { tipo: 'par', izquierda: 'Efectivo C$', derecha: '1,250.00' },
    { tipo: 'espacio' },
    { tipo: 'qr', contenido: 'LAM-00000012' },
  ];
  const texto = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);
  const contiene = (bytes: Uint8Array, secuencia: number[]) =>
    bytes.some((_, i) => secuencia.every((b, j) => bytes[i + j] === b));

  it('lleva los mismos renglones del PDF, el QR de la factura y termina cortando el papel', () => {
    const bytes = comandosDeTicket(renglones);
    const impreso = texto(bytes);
    expect(impreso).toContain('Esmeralda Experience');
    expect(impreso).toContain('LAM-00000012');
    // lo de la izquierda y el monto, en un mismo renglón de 48 columnas
    expect(impreso).toContain(`Efectivo C$${' '.repeat(48 - 11 - 8)}1,250.00`);
    expect(contiene(bytes, [0x1d, 0x56])).toBe(true); // GS V: corte
    expect(contiene(bytes, [0x1b, 0x70])).toBe(false); // sin pulso de gaveta
  });

  it('abre la gaveta solo cuando se le pide', () => {
    expect(contiene(comandosDeTicket(renglones, { gaveta: true }), [0x1b, 0x70])).toBe(true);
  });

  it('si el texto y el monto no caben en un renglón, el monto baja al siguiente', () => {
    const largo = 'Transferencia bancaria de la clienta frecuente del lunes';
    const impreso = texto(comandosDeTicket([{ tipo: 'par', izquierda: largo, derecha: '99.00' }]));
    // el texto largo se parte en renglones de 48 columnas; el monto va aparte, a la derecha
    expect(impreso).toContain('Transferencia bancaria de la clienta');
    expect(impreso).toContain(`${' '.repeat(43)}99.00`);
  });
});

describe('cuentas en centavos', () => {
  it('convierte sin perder centavos', () => {
    expect(aCentavos('1250.5')).toBe(125050);
    expect(aCentavos('0.1') + aCentavos('0.2')).toBe(30);
    expect(deCentavos(125050)).toBe('1250.50');
  });

  it('reconoce un monto válido: de 0 en adelante, con 2 decimales como máximo', () => {
    for (const bueno of ['0', '1500', '1500.5', ' 36.62 ']) expect(esMonto(bueno)).toBe(true);
    for (const malo of ['', '-5', '1,500', '10.123', 'cien']) expect(esMonto(malo)).toBe(false);
  });

  it('suma lo contado: valor por cantidad de cada billete y moneda', () => {
    expect(
      totalContado([
        { valor: '500', cantidad: 2 },
        { valor: '0.25', cantidad: 3 },
        { valor: '100', cantidad: 0 },
      ]),
    ).toBe(100075);
  });
});
