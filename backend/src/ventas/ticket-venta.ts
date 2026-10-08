import { fechaHora, monto } from '../exportacion/formato';
import type { Renglon } from '../exportacion/ticket-pdf';
import type { VentaDetalle } from './ventas.service';

/**
 * Lo que lleva impreso el ticket de una venta, renglón por renglón. `impresion` es cuántas veces
 * se ha impreso contando esta: la primera es el original y desde la segunda lleva la palabra COPIA.
 * Una venta anulada lo dice arriba, con quién la anuló y por qué. Nunca lleva costos. Al pie va el
 * número de factura en un código QR.
 */
export function renglonesTicketVenta(venta: VentaDetalle, impresion: number): Renglon[] {
  const renglones: Renglon[] = [];
  const centrado = (texto: string, destacado = false) =>
    renglones.push({ tipo: 'texto', texto, centrado: true, negrita: destacado, grande: destacado });
  const texto = (contenido: string) => renglones.push({ tipo: 'texto', texto: contenido });
  const par = (izquierda: string, derecha: string, negrita = false) =>
    renglones.push({ tipo: 'par', izquierda, derecha, negrita });
  const linea = () => renglones.push({ tipo: 'linea' });

  if (venta.ticket.negocio) centrado(venta.ticket.negocio, true);
  if (venta.ticket.ruc) centrado(`RUC ${venta.ticket.ruc}`);
  centrado(venta.sucursal.nombre);
  if (venta.ticket.direccion) centrado(venta.ticket.direccion);
  if (venta.ticket.telefono) centrado(`Tel. ${venta.ticket.telefono}`);
  linea();
  if (impresion > 1) centrado('COPIA', true);
  if (venta.estado === 'ANULADA') centrado('VENTA ANULADA', true);

  par(`Factura ${venta.numero}`, fechaHora(venta.fecha));
  if (venta.cambio) texto(`Por el cambio ${venta.cambio.numero}`);
  texto(`Caja: ${venta.caja.nombre}`);
  texto(`Atendió: ${venta.vendedor.nombre_completo}`);
  if (venta.cliente_nombre) {
    const telefono = venta.cliente_telefono ? ` (${venta.cliente_telefono})` : '';
    texto(`Cliente: ${venta.cliente_nombre}${telefono}`);
  }
  linea();

  for (const item of venta.lineas) {
    par(`${item.cantidad} x ${item.variante.nombre}`, monto(item.subtotal));
    if (item.cantidad > 1) texto(`    c/u ${monto(item.precio_unitario)}`);
    // Las piezas que se llevó dentro del paquete
    for (const pieza of item.piezas) {
      const cuantas = pieza.cantidad > 1 ? `${pieza.cantidad} x ` : '';
      texto(`    + ${cuantas}${pieza.variante.nombre}`);
    }
  }
  linea();

  par('Subtotal', monto(venta.subtotal));
  if (Number(venta.descuento) > 0) {
    const promocion = venta.promocion ? ` (${venta.promocion.nombre})` : '';
    par(`Descuento${promocion}`, `-${monto(venta.descuento)}`);
  }
  par('TOTAL C$', monto(venta.total), true);
  renglones.push({ tipo: 'espacio' });
  for (const pago of venta.pagos) {
    const enDolares =
      pago.moneda === 'USD' ? ` US$ ${monto(pago.monto)} (T/C ${pago.tipo_cambio})` : '';
    const referencia = pago.referencia ? ` ref. ${pago.referencia}` : '';
    par(`${pago.metodo.nombre}${enDolares}${referencia}`, monto(pago.monto_nio));
  }
  if (Number(venta.vuelto) > 0) par('Vuelto C$', monto(venta.vuelto));

  if (venta.anulacion) {
    linea();
    texto(
      `Anulada el ${fechaHora(venta.anulacion.fecha)} por ${venta.anulacion.anulada_por.nombre_completo}`,
    );
    texto(`Motivo: ${venta.anulacion.motivo}`);
  }
  if (venta.ticket.leyenda) {
    linea();
    centrado(venta.ticket.leyenda);
  }
  // El número de factura en un QR: se escanea para buscar la venta si el cliente vuelve a devolver
  // o cambiar algo. Una venta anulada no se devuelve: no lo lleva.
  if (venta.estado !== 'ANULADA') {
    linea();
    renglones.push({ tipo: 'qr', contenido: venta.ticket.qr });
    centrado(venta.ticket.qr);
  }
  return renglones;
}
