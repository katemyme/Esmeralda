import { leerPdf, loQueSeSale } from '../../test/textos-pdf';
import { ticketPdf, type Renglon } from '../exportacion/ticket-pdf';
import type { DevolucionDetalle } from './devoluciones.service';
import { renglonesTicketDevolucion } from './ticket-devolucion';

/** Dos perfumes de una venta pagada 1/3 en efectivo: uno vuelve bueno y otro defectuoso. */
const devolucion: DevolucionDetalle = {
  id: 5,
  numero: 'DEV-LBR-000001',
  tipo: 'DEVOLUCION',
  estado: 'EJECUTADA',
  venta: {
    id: 31,
    numero: 'LAM-00000012',
    fecha: new Date('2026-10-05T21:42:00Z'),
    sucursal: { id: 1, codigo: 'LAM', nombre: 'Multicentro Las Américas' },
  },
  motivo: 'Uno venía con el atomizador roto',
  cliente_nombre: 'Luis Cliente',
  cliente_telefono: '7777-0000',
  monto_total: '800.00',
  sucursal_solicitud: { id: 1, codigo: 'LAM', nombre: 'Multicentro Las Américas' },
  solicitada_por: { id: 3, nombre_completo: 'Ana Martínez' },
  solicitada_at: new Date('2026-10-07T16:00:00Z'),
  vence_el: '2026-10-10',
  sucursal: { id: 2, codigo: 'LBR', nombre: 'Multicentro Las Brisas' },
  ejecutada_at: new Date('2026-10-08T15:10:00Z'), // 09:10 en Managua
  por_transferir: true,
  lineas: [
    {
      id: 1,
      detalle_id: 815,
      variante: { id: 9, sku: 'PERF-50', nombre: 'Perfume Oud — 50 ml' },
      cantidad: 1,
      estado_producto: 'BUENO',
      monto: '400.00',
    },
    {
      id: 2,
      detalle_id: 815,
      variante: { id: 9, sku: 'PERF-50', nombre: 'Perfume Oud — 50 ml' },
      cantidad: 1,
      estado_producto: 'DEFECTUOSO',
      monto: '400.00',
    },
  ],
  resolucion: {
    fecha: new Date('2026-10-07T18:00:00Z'),
    resuelta_por: { id: 1, nombre_completo: 'Administrador' },
    comentario: 'Proceda',
  },
  cancelacion: null,
  reembolso: { saldo: '0.00', efectivo: '266.67', transferencia: '533.33', definitivo: true },
  ejecucion: {
    fecha: new Date('2026-10-08T15:10:00Z'),
    ejecutada_por: { id: 4, nombre_completo: 'Carlos Ruiz' },
    turno_id: 12,
    caja: { id: 2, nombre: 'Caja 1' },
  },
  venta_cambio: null,
  transferencia: null,
  ticket: {
    negocio: 'Esmeralda Experience',
    ruc: 'J0310000000001',
    direccion: 'Multicentro Las Brisas, Managua',
    telefono: '2222-4444',
  },
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

describe('ticket de devolución', () => {
  it('el original: su número propio, la factura, lo devuelto y cómo lo recibe el cliente', () => {
    expect(comoTexto(renglonesTicketDevolucion(devolucion, 1))).toEqual([
      'Esmeralda Experience',
      'RUC J0310000000001',
      'Multicentro Las Brisas', // la sucursal donde se ejecutó, no la de la venta
      'Multicentro Las Brisas, Managua',
      'Tel. 2222-4444',
      '---',
      'DEVOLUCIÓN',
      'DEV-LBR-000001 | 08/10/2026 09:10',
      'Factura LAM-00000012 del 05/10/2026',
      'Caja: Caja 1',
      'Atendió: Carlos Ruiz',
      'Cliente: Luis Cliente (7777-0000)',
      'Motivo: Uno venía con el atomizador roto',
      '---',
      '1 x Perfume Oud — 50 ml | 400.00',
      '1 x Perfume Oud — 50 ml | 400.00',
      '    Defectuoso',
      '---',
      'TOTAL DEVUELTO C$ | 800.00',
      '',
      'Entregado en efectivo C$ | 266.67',
      'Por transferencia C$ | 533.33',
      '    La transferencia la hace la administración',
      '---',
      '',
      'Recibí conforme:',
      '',
      'Firma: ______________________________',
    ]);
    const renglones = renglonesTicketDevolucion(devolucion, 1);
    expect(renglones.find((r) => r.tipo === 'texto' && r.texto === 'DEVOLUCIÓN')).toMatchObject({
      centrado: true,
      negrita: true,
      grande: true,
    });
    expect(JSON.stringify(renglones)).not.toMatch(/COPIA|costo|Proceda/i);
  });

  it('desde la segunda impresión lleva COPIA; con la transferencia hecha, su referencia', () => {
    const transferida: DevolucionDetalle = {
      ...devolucion,
      por_transferir: false,
      transferencia: {
        referencia: 'BAC-778899',
        fecha: new Date('2026-10-08T20:00:00Z'),
        transferida_por: { id: 1, nombre_completo: 'Administrador' },
      },
    };
    const texto = comoTexto(renglonesTicketDevolucion(transferida, 2));
    expect(texto.slice(6, 9)).toEqual(['COPIA', 'DEVOLUCIÓN', 'DEV-LBR-000001 | 08/10/2026 09:10']);
    expect(texto).toContain('    Transferido, ref. BAC-778899');
    expect(texto.join('\n')).not.toMatch(/la hace la administración/);
  });

  it('un cambio dice a qué factura se aplicó lo devuelto y solo muestra lo que se entregó', () => {
    const cambio: DevolucionDetalle = {
      ...devolucion,
      numero: 'DEV-LBR-000002',
      tipo: 'CAMBIO',
      monto_total: '600.00',
      lineas: [{ ...devolucion.lineas[0], monto: '600.00' }],
      reembolso: { saldo: '400.00', efectivo: '200.00', transferencia: '0.00', definitivo: true },
      venta_cambio: { id: 40, numero: 'LBR-00000031', total: '400.00' },
      ticket: { negocio: null, ruc: null, direccion: null, telefono: null },
    };
    const texto = comoTexto(renglonesTicketDevolucion(cambio, 1));
    expect(texto.slice(0, 4)).toEqual([
      'Multicentro Las Brisas',
      '---',
      'CAMBIO',
      'DEV-LBR-000002 | 08/10/2026 09:10',
    ]);
    expect(texto.slice(texto.indexOf('TOTAL DEVUELTO C$ | 600.00'), -5)).toEqual([
      'TOTAL DEVUELTO C$ | 600.00',
      '',
      'Aplicado a la factura LBR-00000031 | 400.00',
      'Entregado en efectivo C$ | 200.00',
    ]);
    expect(texto.join('\n')).not.toMatch(/transferencia|RUC|Tel\./i);
  });

  it('sale en una página de 72 mm de ancho, como los demás tickets', async () => {
    const pdf = (await ticketPdf(renglonesTicketDevolucion(devolucion, 1), 'Devolución')).toString(
      'latin1',
    );
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf).toMatch(/\/MediaBox \[0 0 204\.09\d* [\d.]+\]/);
    expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(1);
  });

  it('en el PDF ningún texto pasa de 72 mm, por largos que sean los nombres y los montos', async () => {
    const larga: DevolucionDetalle = {
      ...devolucion,
      tipo: 'CAMBIO',
      motivo:
        'El perfume venía con el atomizador roto y la caja abierta; la clienta prefiere llevarse otra cosa',
      cliente_nombre: 'Luis Fernando Castillo Montenegro de la Concepción',
      monto_total: '1234567.89',
      sucursal: {
        id: 2,
        codigo: 'LBR',
        nombre: 'Multicentro Las Brisas, primer piso junto a la entrada del supermercado',
      },
      lineas: [
        {
          ...devolucion.lineas[0],
          cantidad: 12,
          variante: {
            id: 9,
            sku: 'PERF-50',
            nombre: 'Perfume Oud Royal Intense edición limitada de aniversario — 50 ml',
          },
          monto: '1234167.89',
        },
        devolucion.lineas[1],
      ],
      reembolso: {
        saldo: '1000000.00',
        efectivo: '100000.00',
        transferencia: '134567.89',
        definitivo: true,
      },
      ejecucion: {
        ...devolucion.ejecucion!,
        ejecutada_por: { id: 4, nombre_completo: 'Carlos Alberto Ruiz Hernández del Socorro' },
        caja: { id: 2, nombre: 'Caja principal del mostrador de joyería y perforaciones' },
      },
      venta_cambio: { id: 40, numero: 'LBR-00000031', total: '1000000.00' },
      transferencia: {
        referencia: `BAC-${'7'.repeat(60)}`,
        fecha: new Date('2026-10-08T20:00:00Z'),
        transferida_por: { id: 1, nombre_completo: 'Administrador' },
      },
    };
    for (const caso of [devolucion, larga]) {
      const pagina = leerPdf(await ticketPdf(renglonesTicketDevolucion(caso, 2), 'Devolución'));
      expect(pagina.ancho).toBeCloseTo(72, 2);
      expect(loQueSeSale(pagina)).toEqual([]);
      // la fecha y la hora, enteras y pegadas al margen derecho
      const hora = pagina.textos.find((t) => t.texto === '08/10/2026 09:10');
      expect(hora?.derecha).toBeCloseTo(70, 1);
    }

    const pagina = leerPdf(await ticketPdf(renglonesTicketDevolucion(larga, 1), 'Devolución'));
    const escrito = pagina.textos.map((t) => t.texto);
    const total = pagina.textos.find((t) => t.texto === '1,234,567.89');
    expect(total).toMatchObject({ fuente: 'Helvetica-Bold' });
    expect(total?.derecha).toBeCloseTo(70, 1);
    expect(escrito).toEqual(
      expect.arrayContaining([
        'TOTAL DEVUELTO C$',
        '1,234,167.89',
        '1,000,000.00',
        'Entregado en efectivo C$',
        '100,000.00',
        'Por transferencia C$',
        '134,567.89',
      ]),
    );
    // el motivo no cabe en un renglón: sigue en los de abajo, sin perder nada
    const motivo = escrito.findIndex((t) => t.startsWith('Motivo:'));
    const primerArticulo = escrito.findIndex((t) => t.startsWith('12 x '));
    expect(primerArticulo - motivo).toBeGreaterThan(1);
    expect(escrito.slice(motivo, primerArticulo).join(' ')).toBe(`Motivo: ${larga.motivo}`);
  });
});
