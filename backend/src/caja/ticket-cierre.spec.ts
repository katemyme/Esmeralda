import type { Renglon } from '../exportacion/ticket-pdf';
import { ANCHO_TICKET, ticketPdf } from '../exportacion/ticket-pdf';
import type { TicketCierre } from './caja.service';
import { renglonesTicketCierre } from './ticket-cierre';

/** El ticket de quien cerró: lo que contó, lo que retiró y el fondo que dejó. */
const reducido: TicketCierre = {
  turno_id: 7,
  sucursal: 'Multicentro Las Brisas',
  caja: 'Caja 1',
  abierto_por: 'Carlos Ruiz',
  apertura: new Date('2026-10-07T14:05:00Z'), // 08:05 en Managua
  cerrado_por: 'Carlos Ruiz',
  cierre: new Date('2026-10-08T03:35:00Z'), // 21:35 del día 7
  cierre_forzado: false,
  contado: [
    { metodo: 'Efectivo', moneda: 'NIO', monto: '3250.00' },
    { metodo: 'Efectivo', moneda: 'USD', monto: '40.00' },
    { metodo: 'Tarjeta', moneda: 'NIO', monto: '1100.00' },
  ],
  retiro_nio: '2250.00',
  retiro_usd: '40.00',
  fondo_siguiente_nio: '1000.00',
  fondo_siguiente_usd: '0.00',
};

/** El de quien tiene CAJA_VER_DIFERENCIAS: además, lo vendido y lo cobrado. */
const completo: TicketCierre = {
  ...reducido,
  ventas: 9,
  anuladas: 1,
  total_vendido: '4830.00',
  descuentos_promociones: '120.00',
  cobros: [
    { metodo: 'Efectivo', moneda: 'NIO', monto: '2265.03' },
    { metodo: 'Efectivo', moneda: 'USD', monto: '40.00' },
    { metodo: 'Tarjeta', moneda: 'NIO', monto: '1100.00' },
  ],
};

function comoTexto(renglones: Renglon[]): string[] {
  return renglones.map((r) =>
    r.tipo === 'texto'
      ? r.texto
      : r.tipo === 'par'
        ? `${r.izquierda} | ${r.derecha}`
        : r.tipo === 'linea'
          ? '---'
          : '',
  );
}

describe('ticket de cierre de caja', () => {
  it('el de quien cerró: lo contado, el retiro y el fondo que queda', () => {
    expect(comoTexto(renglonesTicketCierre(reducido, 1, 'Esmeralda Experience'))).toEqual([
      'Esmeralda Experience',
      'CIERRE DE CAJA',
      '---',
      'Turno 7 | 07/10/2026 21:35',
      'Multicentro Las Brisas · Caja 1',
      'Abrió: Carlos Ruiz (07/10/2026 08:05)',
      'Cerró: Carlos Ruiz',
      '---',
      'Contado',
      'Efectivo C$ | 3,250.00',
      'Efectivo US$ | 40.00',
      'Tarjeta C$ | 1,100.00',
      '',
      'Retiro C$ | 2,250.00',
      'Retiro US$ | 40.00',
      'Fondo que queda C$ | 1,000.00',
      '---',
      '',
      'Firma: ______________________________',
    ]);
  });

  it('el completo agrega las ventas del turno y lo cobrado por método', () => {
    const texto = comoTexto(renglonesTicketCierre(completo, 1, null));
    expect(texto[0]).toBe('CIERRE DE CAJA'); // sin nombre del negocio no hay renglón vacío
    expect(texto.slice(texto.indexOf('Ventas del turno'), -3)).toEqual([
      'Ventas del turno',
      'Ventas | 9',
      'Anuladas | 1',
      'Total vendido C$ | 4,830.00',
      'Rebajas de promociones C$ | 120.00',
      '',
      'Cobrado',
      'Efectivo C$ | 2,265.03',
      'Efectivo US$ | 40.00',
      'Tarjeta C$ | 1,100.00',
    ]);
  });

  it('con devoluciones o cambios en el turno, el completo dice cuántos y el efectivo que salió', () => {
    const conCambios: TicketCierre = {
      ...completo,
      saldo_cambio: '940.00',
      devoluciones: 3,
      devuelto_efectivo: '366.67',
    };
    const texto = comoTexto(renglonesTicketCierre(conCambios, 1, null));
    expect(texto.slice(texto.indexOf('Cobrado'), -3)).toEqual([
      'Cobrado',
      'Efectivo C$ | 2,265.03',
      'Efectivo US$ | 40.00',
      'Tarjeta C$ | 1,100.00',
      'Saldo por cambio C$ | 940.00',
      '',
      'Devoluciones y cambios',
      'Ejecutados en el turno | 3',
      'Efectivo devuelto C$ | 366.67',
    ]);
    // sin devoluciones ni saldo, esos renglones no salen; y el de quien cerró nunca los trae
    const sinCambios = { ...completo, saldo_cambio: '0.00', devoluciones: 0 };
    for (const ticket of [sinCambios, { ...reducido, devoluciones: 3, saldo_cambio: '940.00' }]) {
      expect(comoTexto(renglonesTicketCierre(ticket, 1, null)).join('\n')).not.toMatch(
        /Saldo por cambio|Devoluciones|devuelto/,
      );
    }
  });

  it('ninguno trae lo esperado ni la diferencia', () => {
    for (const ticket of [reducido, completo]) {
      const texto = comoTexto(renglonesTicketCierre(ticket, 1, 'Esmeralda Experience')).join('\n');
      expect(texto).not.toMatch(/esperad|diferencia|faltante|sobrante/i);
    }
  });

  it('la reimpresión lleva COPIA; un cierre forzado lo dice y no trae montos', () => {
    const copia = comoTexto(renglonesTicketCierre(reducido, 2, 'Esmeralda Experience'));
    expect(copia.slice(2, 5)).toEqual(['---', 'COPIA', 'Turno 7 | 07/10/2026 21:35']);

    const forzado: TicketCierre = {
      turno_id: 8,
      sucursal: 'Multicentro Las Brisas',
      caja: 'Caja 1',
      abierto_por: 'Carlos Ruiz',
      apertura: new Date('2026-10-07T14:05:00Z'),
      cerrado_por: 'Administrador',
      cierre: new Date('2026-10-08T15:00:00Z'),
      cierre_forzado: true,
    };
    const texto = comoTexto(renglonesTicketCierre(forzado, 1, null));
    expect(texto).toContain('CIERRE FORZADO (sin conteo)');
    expect(texto.join('\n')).not.toMatch(/Contado|Retiro|Fondo|Ventas del turno|\d\.\d{2}/);
  });
});

describe('ticketPdf', () => {
  const alto = (pdf: Buffer) =>
    Number(/\/MediaBox \[0 0 [\d.]+ ([\d.]+)\]/.exec(pdf.toString('latin1'))?.[1]);

  it('una sola página de 80 mm de ancho, tan larga como el contenido', async () => {
    expect(ANCHO_TICKET).toBeCloseTo(226.77, 2); // 80 mm en puntos
    const corto = await ticketPdf(
      renglonesTicketCierre(reducido, 1, 'Esmeralda Experience'),
      'Cierre',
    );
    const largo = await ticketPdf(
      renglonesTicketCierre(completo, 2, 'Esmeralda Experience'),
      'Cierre',
    );
    for (const pdf of [corto, largo]) {
      const texto = pdf.toString('latin1');
      expect(texto.startsWith('%PDF-')).toBe(true);
      expect(texto.trimEnd().endsWith('%%EOF')).toBe(true);
      expect(texto).toMatch(/\/MediaBox \[0 0 226\.77\d* [\d.]+\]/);
      expect(texto.match(/\/Type \/Page\b/g)).toHaveLength(1);
    }
    expect(alto(largo)).toBeGreaterThan(alto(corto));
    // un texto que no cabe en una línea alarga el ticket en vez de salirse del papel
    const conLeyenda = await ticketPdf(
      [
        ...renglonesTicketCierre(reducido, 1, 'Esmeralda Experience'),
        { tipo: 'texto', texto: 'Gracias por su compra. '.repeat(12), centrado: true },
      ],
      'Cierre',
    );
    expect(alto(conLeyenda)).toBeGreaterThan(alto(corto) + 20);
  });
});
