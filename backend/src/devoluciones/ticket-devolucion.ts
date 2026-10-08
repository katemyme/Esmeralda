import { fechaHora, monto } from '../exportacion/formato';
import type { Renglon } from '../exportacion/ticket-pdf';
import type { DevolucionDetalle } from './devoluciones.service';

/**
 * Lo que lleva impreso el ticket de una devolución o de un cambio ya ejecutado, renglón por
 * renglón: su número propio, la factura de la que viene, lo devuelto con lo que se pagó por ello y
 * cómo lo recibe el cliente (saldo aplicado a la venta nueva, efectivo y transferencia). Termina
 * con la firma del cliente. `impresion` es cuántas veces se ha impreso contando esta: desde la
 * segunda lleva COPIA. Nunca lleva costos.
 */
export function renglonesTicketDevolucion(
  devolucion: DevolucionDetalle,
  impresion: number,
): Renglon[] {
  const renglones: Renglon[] = [];
  const centrado = (texto: string, destacado = false) =>
    renglones.push({ tipo: 'texto', texto, centrado: true, negrita: destacado, grande: destacado });
  const texto = (contenido: string) => renglones.push({ tipo: 'texto', texto: contenido });
  const par = (izquierda: string, derecha: string, negrita = false) =>
    renglones.push({ tipo: 'par', izquierda, derecha, negrita });
  const linea = () => renglones.push({ tipo: 'linea' });
  const espacio = () => renglones.push({ tipo: 'espacio' });

  const { ticket, reembolso } = devolucion;
  if (ticket.negocio) centrado(ticket.negocio, true);
  if (ticket.ruc) centrado(`RUC ${ticket.ruc}`);
  if (devolucion.sucursal) centrado(devolucion.sucursal.nombre);
  if (ticket.direccion) centrado(ticket.direccion);
  if (ticket.telefono) centrado(`Tel. ${ticket.telefono}`);
  linea();
  if (impresion > 1) centrado('COPIA', true);
  centrado(devolucion.tipo === 'CAMBIO' ? 'CAMBIO' : 'DEVOLUCIÓN', true);

  par(devolucion.numero ?? '', devolucion.ejecutada_at ? fechaHora(devolucion.ejecutada_at) : '');
  texto(`Factura ${devolucion.venta.numero} del ${fechaHora(devolucion.venta.fecha).slice(0, 10)}`);
  if (devolucion.ejecucion) {
    texto(`Caja: ${devolucion.ejecucion.caja.nombre}`);
    texto(`Atendió: ${devolucion.ejecucion.ejecutada_por.nombre_completo}`);
  }
  texto(`Cliente: ${devolucion.cliente_nombre} (${devolucion.cliente_telefono})`);
  texto(`Motivo: ${devolucion.motivo}`);
  linea();

  for (const item of devolucion.lineas) {
    par(`${item.cantidad} x ${item.variante.nombre}`, monto(item.monto));
    if (item.estado_producto === 'DEFECTUOSO') texto('    Defectuoso');
  }
  linea();
  par('TOTAL DEVUELTO C$', monto(devolucion.monto_total), true);

  if (reembolso) {
    espacio();
    if (Number(reembolso.saldo) > 0) {
      const factura = devolucion.venta_cambio
        ? ` a la factura ${devolucion.venta_cambio.numero}`
        : '';
      par(`Aplicado${factura}`, monto(reembolso.saldo));
    }
    if (Number(reembolso.efectivo) > 0) par('Entregado en efectivo C$', monto(reembolso.efectivo));
    if (Number(reembolso.transferencia) > 0) {
      par('Por transferencia C$', monto(reembolso.transferencia));
      texto(
        devolucion.transferencia
          ? `    Transferido, ref. ${devolucion.transferencia.referencia}`
          : '    La transferencia la hace la administración',
      );
    }
  }

  linea();
  espacio();
  texto('Recibí conforme:');
  espacio();
  texto('Firma: ______________________________');
  return renglones;
}
