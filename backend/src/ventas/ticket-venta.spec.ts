import type { Renglon } from '../exportacion/ticket-pdf';
import { renglonesTicketVenta } from './ticket-venta';
import type { VentaDetalle } from './ventas.service';

const venta: VentaDetalle = {
  id: 12,
  numero: 'LAM-00000012',
  fecha: new Date('2026-10-07T21:42:00Z'), // 15:42 en Managua
  estado: 'COMPLETADA',
  sucursal: { id: 1, codigo: 'LAM', nombre: 'Multicentro Las Américas' },
  turno_id: 4,
  vendedor: { id: 3, nombre_completo: 'Ana Martínez' },
  cliente_nombre: 'Lucía Pérez',
  subtotal: '1110.00',
  descuento: '111.00',
  total: '999.00',
  articulos: 3,
  caja: { id: 1, nombre: 'Caja 1' },
  cliente_telefono: '8888-0000',
  notas: 'Clienta frecuente',
  tipo_cambio: '36.6243',
  promocion: { id: 2, nombre: 'Promo 10 %' },
  lineas: [
    {
      id: 1,
      variante: {
        id: 9,
        sku: 'PAQ-LOB',
        nombre: 'Perforación Lóbulo con pieza — Con pieza incluida',
      },
      tipo: 'PAQUETE',
      cantidad: 1,
      precio_lista: '650.00',
      precio_unitario: '650.00',
      subtotal: '650.00',
      piezas: [
        { variante: { id: 5, sku: 'TIT-LAB-16-6', nombre: 'Labret titanio — 6 mm' }, cantidad: 1 },
      ],
    },
    {
      id: 2,
      variante: { id: 7, sku: 'ACE-ARO-16-8', nombre: 'Aro acero — 8 mm' },
      tipo: 'PRODUCTO',
      cantidad: 2,
      precio_lista: '230.00',
      precio_unitario: '230.00',
      subtotal: '460.00',
      piezas: [],
    },
  ],
  pagos: [
    {
      metodo: { codigo: 'EFECTIVO', nombre: 'Efectivo' },
      moneda: 'USD',
      monto: '20.00',
      tipo_cambio: '36.6243',
      monto_nio: '732.49',
      referencia: null,
    },
    {
      metodo: { codigo: 'TARJETA', nombre: 'Tarjeta' },
      moneda: 'NIO',
      monto: '300.00',
      tipo_cambio: '1.0000',
      monto_nio: '300.00',
      referencia: '784512',
    },
  ],
  vuelto: '33.49',
  anulacion: null,
  ticket: {
    negocio: 'Esmeralda Experience',
    ruc: 'J0310000000001',
    direccion: 'Multicentro Las Américas, Managua',
    telefono: '2222-3333',
    leyenda: 'Cambios dentro de los 3 días con su ticket.',
  },
};

/** Los renglones como texto, para compararlos de un vistazo. */
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

describe('ticket de venta', () => {
  it('el original: encabezado del negocio, líneas con sus piezas, totales, pagos y leyenda', () => {
    expect(comoTexto(renglonesTicketVenta(venta, 1))).toEqual([
      'Esmeralda Experience',
      'RUC J0310000000001',
      'Multicentro Las Américas',
      'Multicentro Las Américas, Managua',
      'Tel. 2222-3333',
      '---',
      'Factura LAM-00000012 | 07/10/2026 15:42',
      'Caja: Caja 1',
      'Atendió: Ana Martínez',
      'Cliente: Lucía Pérez (8888-0000)',
      '---',
      '1 x Perforación Lóbulo con pieza — Con pieza incluida | 650.00',
      '    + Labret titanio — 6 mm',
      '2 x Aro acero — 8 mm | 460.00',
      '    c/u 230.00',
      '---',
      'Subtotal | 1,110.00',
      'Descuento (Promo 10 %) | -111.00',
      'TOTAL C$ | 999.00',
      '',
      'Efectivo US$ 20.00 (T/C 36.6243) | 732.49',
      'Tarjeta ref. 784512 | 300.00',
      'Vuelto C$ | 33.49',
      '---',
      'Cambios dentro de los 3 días con su ticket.',
    ]);
    // el nombre del negocio y el total van destacados; las notas internas no se imprimen
    const renglones = renglonesTicketVenta(venta, 1);
    expect(renglones[0]).toMatchObject({ centrado: true, negrita: true, grande: true });
    expect(renglones.find((r) => r.tipo === 'par' && r.izquierda === 'TOTAL C$')).toMatchObject({
      negrita: true,
    });
    expect(JSON.stringify(renglones)).not.toMatch(/Clienta frecuente|COPIA|costo/i);
  });

  it('desde la segunda impresión lleva la palabra COPIA, bien visible', () => {
    for (const impresion of [2, 3, 10]) {
      const renglones = renglonesTicketVenta(venta, impresion);
      const copia = renglones.find((r) => r.tipo === 'texto' && r.texto === 'COPIA');
      expect(copia).toEqual({
        tipo: 'texto',
        texto: 'COPIA',
        centrado: true,
        negrita: true,
        grande: true,
      });
      // justo antes del número de factura
      expect(comoTexto(renglones).indexOf('COPIA')).toBe(6);
    }
  });

  it('sin RUC, leyenda, cliente, descuento ni vuelto, esos renglones no salen', () => {
    const sencilla: VentaDetalle = {
      ...venta,
      cliente_nombre: null,
      cliente_telefono: null,
      descuento: '0.00',
      total: '1110.00',
      promocion: null,
      pagos: [venta.pagos[1]],
      vuelto: '0.00',
      ticket: {
        negocio: 'Esmeralda Experience',
        ruc: null,
        direccion: null,
        telefono: null,
        leyenda: null,
      },
    };
    const texto = comoTexto(renglonesTicketVenta(sencilla, 1));
    expect(texto.slice(0, 4)).toEqual([
      'Esmeralda Experience',
      'Multicentro Las Américas',
      '---',
      'Factura LAM-00000012 | 07/10/2026 15:42',
    ]);
    expect(texto.join('\n')).not.toMatch(/RUC|Tel\.|Cliente|Descuento|Vuelto/);
    expect(texto.at(-1)).toBe('Tarjeta ref. 784512 | 300.00');
  });

  it('una venta anulada lo dice arriba, con quién la anuló y por qué', () => {
    const anulada: VentaDetalle = {
      ...venta,
      estado: 'ANULADA',
      anulacion: {
        fecha: new Date('2026-10-07T22:10:00Z'),
        motivo: 'La clienta se arrepintió',
        anulada_por: { id: 2, nombre_completo: 'María López' },
      },
    };
    const texto = comoTexto(renglonesTicketVenta(anulada, 2));
    expect(texto.slice(6, 8)).toEqual(['COPIA', 'VENTA ANULADA']);
    expect(texto).toEqual(
      expect.arrayContaining([
        'Anulada el 07/10/2026 16:10 por María López',
        'Motivo: La clienta se arrepintió',
      ]),
    );
  });
});
