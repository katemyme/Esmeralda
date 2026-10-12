import type { DevolucionDetalle } from '../api/tipos';
import { formatoMonto } from '../util/formato';

// El aviso por WhatsApp al administrador cuando se solicita una devolución. La app no envía nada
// por su cuenta: abre WhatsApp con el mensaje ya escrito y la persona lo manda.

/**
 * El mensaje: el número de la solicitud, la factura, el monto y la sucursal. Nunca el nombre ni el
 * teléfono del cliente.
 */
export function textoDeAviso(devolucion: DevolucionDetalle): string {
  return [
    `Solicitud de ${devolucion.tipo === 'CAMBIO' ? 'cambio' : 'devolución'} n.º ${devolucion.id}`,
    `Factura: ${devolucion.venta.numero}`,
    `Monto: ${formatoMonto(devolucion.monto_total)}`,
    `Sucursal: ${devolucion.sucursal_solicitud.nombre}`,
    'Está esperando su aprobación en el sistema.',
  ].join('\n');
}

/** El enlace que abre WhatsApp con el mensaje; null si no hay a quién avisar o ya no hace falta. */
export function enlaceDeAviso(devolucion: DevolucionDetalle): string | null {
  if (devolucion.estado !== 'PENDIENTE' || !devolucion.aviso_whatsapp) return null;
  return `https://wa.me/${devolucion.aviso_whatsapp}?text=${encodeURIComponent(textoDeAviso(devolucion))}`;
}

/**
 * El número de WhatsApp como se guarda: solo dígitos, con el código del país. Vacío es «sin
 * número» (el botón no sale). null: lo escrito no es un número de 8 a 15 dígitos.
 */
export function numeroDeWhatsapp(texto: string): string | null {
  if (texto.trim() === '') return '';
  const digitos = texto.replace(/\D/g, '');
  return digitos.length >= 8 && digitos.length <= 15 ? digitos : null;
}
