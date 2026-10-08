import { fechaHora, monto } from '../exportacion/formato';
import type { Renglon } from '../exportacion/ticket-pdf';
import type { MontoPorMetodo, TicketCierre } from './caja.service';

const SIMBOLO: Record<string, string> = { NIO: 'C$', USD: 'US$' };

/**
 * Lo que lleva impreso el ticket de cierre, renglón por renglón. Imprime lo que trae el ticket y
 * nada más: qué recibe cada quien ya lo decidió la base (fn_ticket_cierre), así que el de quien
 * cerró solo tiene lo contado, el retiro y el fondo, y ninguno trae lo esperado ni la diferencia.
 * `impresion` es cuántas veces se ha impreso contando esta: desde la segunda lleva COPIA.
 */
export function renglonesTicketCierre(
  ticket: TicketCierre,
  impresion: number,
  negocio: string | null,
): Renglon[] {
  const renglones: Renglon[] = [];
  const centrado = (texto: string, grande = false) =>
    renglones.push({ tipo: 'texto', texto, centrado: true, negrita: true, grande });
  const texto = (contenido: string, negrita = false) =>
    renglones.push({ tipo: 'texto', texto: contenido, negrita });
  const par = (izquierda: string, derecha: string) =>
    renglones.push({ tipo: 'par', izquierda, derecha });
  const linea = () => renglones.push({ tipo: 'linea' });
  const porMetodo = (montos: MontoPorMetodo[]) => {
    for (const m of montos) par(`${m.metodo} ${SIMBOLO[m.moneda] ?? m.moneda}`, monto(m.monto));
  };

  if (negocio) centrado(negocio, true);
  centrado('CIERRE DE CAJA');
  linea();
  if (impresion > 1) centrado('COPIA', true);
  if (ticket.cierre_forzado) centrado('CIERRE FORZADO (sin conteo)');

  par(`Turno ${ticket.turno_id}`, ticket.cierre ? fechaHora(ticket.cierre) : '');
  texto(`${ticket.sucursal} · ${ticket.caja}`);
  texto(`Abrió: ${ticket.abierto_por} (${fechaHora(ticket.apertura)})`);
  if (ticket.cerrado_por) texto(`Cerró: ${ticket.cerrado_por}`);

  if (ticket.contado) {
    linea();
    texto('Contado', true);
    porMetodo(ticket.contado);
    renglones.push({ tipo: 'espacio' });
    par('Retiro C$', monto(ticket.retiro_nio ?? 0));
    if (Number(ticket.retiro_usd) > 0) par('Retiro US$', monto(ticket.retiro_usd ?? 0));
    par('Fondo que queda C$', monto(ticket.fondo_siguiente_nio ?? 0));
    if (Number(ticket.fondo_siguiente_usd) > 0) {
      par('Fondo que queda US$', monto(ticket.fondo_siguiente_usd ?? 0));
    }
  }

  // Solo para quien tiene CAJA_VER_DIFERENCIAS: lo vendido y lo cobrado en el turno
  if (ticket.cobros) {
    linea();
    texto('Ventas del turno', true);
    par('Ventas', String(ticket.ventas ?? 0));
    par('Anuladas', String(ticket.anuladas ?? 0));
    par('Total vendido C$', monto(ticket.total_vendido ?? 0));
    if (Number(ticket.descuentos_promociones) > 0) {
      par('Rebajas de promociones C$', monto(ticket.descuentos_promociones ?? 0));
    }
    renglones.push({ tipo: 'espacio' });
    texto('Cobrado', true);
    porMetodo(ticket.cobros);
    // Lo devuelto en un cambio que pagó parte de una venta: no es dinero que haya entrado
    if (Number(ticket.saldo_cambio) > 0)
      par('Saldo por cambio C$', monto(ticket.saldo_cambio ?? 0));
    if ((ticket.devoluciones ?? 0) > 0) {
      renglones.push({ tipo: 'espacio' });
      texto('Devoluciones y cambios', true);
      par('Ejecutados en el turno', String(ticket.devoluciones));
      par('Efectivo devuelto C$', monto(ticket.devuelto_efectivo ?? 0));
    }
  }

  linea();
  renglones.push({ tipo: 'espacio' });
  texto('Firma: ______________________________');
  return renglones;
}
