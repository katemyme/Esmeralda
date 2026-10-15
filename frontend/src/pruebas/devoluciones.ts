import type { DevolucionDetalle, VentaParaDevolver } from '../api/tipos';
import { TABLET } from './datos';

// Una factura y una solicitud de ejemplo para las pruebas de devoluciones: lo que entrega la API.

/** Una cadena, tres perfumes (uno ya está en otra solicitud) y una pieza de piercing, que no se devuelve. */
export const FACTURA: VentaParaDevolver = {
  id: 31,
  numero: 'LAM-00000012',
  fecha: '2026-10-10T20:15:00.000Z',
  estado: 'COMPLETADA',
  sucursal: TABLET.sucursal,
  vendedor: 'Ana Martínez',
  cliente_nombre: null,
  cliente_telefono: null,
  total: '1800.00',
  motivo_no: null,
  limite: '2026-10-17',
  lineas: [
    {
      detalle_id: 101,
      variante: { id: 7, sku: 'JOY-CAD', nombre: 'Cadena plata — 45 cm' },
      categoria: 'Joyería',
      cantidad: 1,
      devuelta: 0,
      apartada: 0,
      disponible: 1,
      monto_unitario: '600.00',
      admite: true,
      motivo_no: null,
    },
    {
      detalle_id: 102,
      variante: { id: 8, sku: 'PER-ROS', nombre: 'Perfume — Rosas' },
      categoria: 'Perfumería',
      cantidad: 3,
      devuelta: 0,
      apartada: 1,
      disponible: 2,
      monto_unitario: '300.00',
      admite: true,
      motivo_no: null,
    },
    {
      detalle_id: 103,
      variante: { id: 9, sku: 'PTI-00001', nombre: 'Labret titanio — 6 mm' },
      categoria: 'Piezas de titanio',
      cantidad: 1,
      devuelta: 0,
      apartada: 0,
      disponible: 1,
      monto_unitario: '300.00',
      admite: false,
      motivo_no: 'La categoría "Piezas de titanio" no admite devoluciones',
    },
  ],
  solicitudes: [],
};

/** La solicitud n.º 12 de esa factura, pendiente: C$ 1,200 que saldrían 800 en efectivo y 400 por transferencia. */
export function solicitud(parcial: Partial<DevolucionDetalle> = {}): DevolucionDetalle {
  return {
    id: 12,
    numero: null,
    tipo: 'DEVOLUCION',
    estado: 'PENDIENTE',
    venta: {
      id: FACTURA.id,
      numero: FACTURA.numero,
      fecha: FACTURA.fecha,
      sucursal: FACTURA.sucursal,
    },
    motivo: 'No le quedó la cadena',
    cliente_nombre: 'Carla Cliente',
    cliente_telefono: '8888-1234',
    monto_total: '1200.00',
    sucursal_solicitud: TABLET.sucursal,
    solicitada_por: { id: 3, nombre_completo: 'Ana Martínez' },
    solicitada_at: '2026-10-12T16:30:00.000Z',
    vence_el: null,
    sucursal: null,
    ejecutada_at: null,
    monto_transferencia: null,
    por_transferir: false,
    lineas: [
      {
        id: 1,
        detalle_id: 101,
        variante: FACTURA.lineas[0].variante,
        cantidad: 1,
        estado_producto: 'DEFECTUOSO',
        estado_recibido: null,
        monto: '600.00',
      },
      {
        id: 2,
        detalle_id: 102,
        variante: FACTURA.lineas[1].variante,
        cantidad: 2,
        estado_producto: 'BUENO',
        estado_recibido: null,
        monto: '600.00',
      },
    ],
    resolucion: null,
    cancelacion: null,
    reembolso: { saldo: '0.00', efectivo: '800.00', transferencia: '400.00', definitivo: false },
    ejecucion: null,
    venta_cambio: null,
    transferencia: null,
    aviso_whatsapp: null,
    ...parcial,
  };
}
