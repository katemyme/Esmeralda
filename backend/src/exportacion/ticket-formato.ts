import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ticketPdf, type Renglon } from './ticket-pdf';

/**
 * Un ticket sale de dos formas, con el mismo contenido y la misma cuenta de impresiones:
 * - `pdf` (por defecto): la página de 80 mm, para el diálogo de imprimir (la PC de caja con su
 *   driver) y para verlo en pantalla;
 * - `renglones`: la lista de renglones en JSON, para que la pantalla la traduzca a ESC/POS y la
 *   mande directo a la impresora por USB (el celular o la tablet del mostrador).
 */
export const esquemaFormatoTicket = z.object({
  formato: z
    .enum(['pdf', 'renglones'], { error: 'formato debe ser pdf o renglones' })
    .default('pdf'),
});
export type FormatoTicket = z.output<typeof esquemaFormatoTicket>['formato'];

export interface TicketListo {
  /** Cuál impresión es: 1 = original; de 2 en adelante, copia. */
  impresion: number;
  renglones: Renglon[];
  /** null cuando se pidieron los renglones. */
  pdf: Buffer | null;
}

export interface TicketEnRenglones {
  impresion: number;
  renglones: Renglon[];
}

/** Arma el ticket en el formato pedido (el PDF solo se dibuja si hace falta). */
export async function armarTicket(
  renglones: Renglon[],
  impresion: number,
  titulo: string,
  formato: FormatoTicket,
): Promise<TicketListo> {
  return {
    impresion,
    renglones,
    pdf: formato === 'pdf' ? await ticketPdf(renglones, titulo) : null,
  };
}

/** La respuesta de una ruta `.../imprimir`: el PDF, o los renglones en JSON. */
export function entregarTicket(
  respuesta: Response,
  ticket: TicketListo,
  archivo: string,
): StreamableFile | TicketEnRenglones {
  respuesta.setHeader('X-Ticket-Impresion', String(ticket.impresion));
  if (!ticket.pdf) return { impresion: ticket.impresion, renglones: ticket.renglones };
  return new StreamableFile(ticket.pdf, {
    type: 'application/pdf',
    disposition: `inline; filename="${archivo}.pdf"`,
    length: ticket.pdf.length,
  });
}
