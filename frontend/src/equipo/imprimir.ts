import type { Renglon } from '../api/tipos';
import {
  codificador,
  elegirImpresora,
  impresoraAutorizada,
  navegadorImprimePorUsb,
  type Impresora,
} from './impresora';

/**
 * Cómo imprime este equipo los tickets:
 * - `usb`: el celular o la tablet Android del mostrador, directo a la impresora por USB (ESC/POS),
 *   sin diálogo, con corte de papel.
 * - `dialogo`: la PC de caja con Windows (el driver de la impresora ocupa el puerto USB, así que el
 *   navegador no puede hablarle directo) y cualquier otro equipo: el PDF de 80 mm por el diálogo de
 *   imprimir. Con Chrome abierto en modo quiosco (--kiosk-printing) sale solo, sin diálogo.
 * El diálogo siempre queda de respaldo, también en Android.
 */
export type ModoImpresion = 'usb' | 'dialogo';

export function modoDeImpresion(agente: string = navigator.userAgent): ModoImpresion {
  return navegadorImprimePorUsb() && /Android/i.test(agente) ? 'usb' : 'dialogo';
}

const COLUMNAS = 48;

/** `Efectivo C$ ........ 1,250.00`: lo de la izquierda y lo de la derecha en un mismo renglón. */
function enDosColumnas(izquierda: string, derecha: string): string[] {
  const hueco = COLUMNAS - izquierda.length - derecha.length;
  if (hueco >= 1) return [izquierda + ' '.repeat(hueco) + derecha];
  return [izquierda, derecha.padStart(COLUMNAS)]; // no cabe: el monto baja a su propio renglón
}

/** Traduce los renglones de un ticket (los mismos del PDF) a los comandos de la impresora. */
export function comandosDeTicket(
  renglones: Renglon[],
  opciones: { gaveta?: boolean } = {},
): Uint8Array {
  const ticket = codificador().initialize().codepage('auto');
  for (const renglon of renglones) {
    switch (renglon.tipo) {
      case 'texto':
        ticket.align(renglon.centrado ? 'center' : 'left').bold(renglon.negrita === true);
        if (renglon.grande) ticket.size(2, 2);
        ticket.line(renglon.texto);
        if (renglon.grande) ticket.size(1, 1);
        ticket.bold(false).align('left');
        break;
      case 'par':
        ticket.bold(renglon.negrita === true);
        for (const linea of enDosColumnas(renglon.izquierda, renglon.derecha)) ticket.line(linea);
        ticket.bold(false);
        break;
      case 'qr':
        ticket
          .align('center')
          .qrcode(renglon.contenido, { model: 2, size: 6, errorlevel: 'm' })
          .align('left');
        break;
      case 'linea':
        ticket.rule();
        break;
      case 'espacio':
        ticket.newline();
        break;
    }
  }
  if (opciones.gaveta) ticket.pulse();
  return ticket.cut().encode();
}

let conectada: Impresora | null = null;

/** La impresora ya conectada o, si no, la que se autorizó antes en este equipo (sin preguntar). */
export async function impresoraLista(): Promise<Impresora | null> {
  conectada ??= await impresoraAutorizada().catch(() => null);
  return conectada;
}

/** Pide elegir la impresora (desde un toque) y la deja conectada para los tickets siguientes. */
export async function conectarImpresora(): Promise<Impresora> {
  await conectada?.desconectar().catch(() => {});
  conectada = await elegirImpresora();
  return conectada;
}

/**
 * Envía a la impresora por USB. Si el envío falla lanza el error y suelta la conexión: el mismo
 * ticket se puede volver a enviar (sin pedirlo otra vez a la API, para que no cuente como copia).
 */
export async function imprimirPorUsb(datos: Uint8Array): Promise<void> {
  const impresora = (await impresoraLista()) ?? (await conectarImpresora());
  try {
    await impresora.enviar(datos);
  } catch (error) {
    await impresora.desconectar().catch(() => {});
    conectada = null;
    throw error;
  }
}

/**
 * Imprime un PDF por el diálogo del sistema, desde un marco oculto. En la PC de caja con Chrome en
 * modo quiosco de impresión sale directo por la impresora predeterminada.
 */
export function imprimirConDialogo(pdf: Blob): Promise<void> {
  return new Promise((resolver, rechazar) => {
    const direccion = URL.createObjectURL(pdf);
    const marco = document.createElement('iframe');
    marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    marco.src = direccion;
    marco.onload = () => {
      try {
        marco.contentWindow?.focus();
        marco.contentWindow?.print();
        resolver();
      } catch {
        // El navegador no deja imprimir el marco: se abre el PDF para imprimirlo desde ahí
        window.open(direccion, '_blank');
        resolver();
      }
      // el marco se deja un minuto: quitarlo antes cancelaría la impresión
      window.setTimeout(() => {
        marco.remove();
        URL.revokeObjectURL(direccion);
      }, 60_000);
    };
    marco.onerror = () => rechazar(new Error('No se pudo abrir el ticket para imprimirlo.'));
    document.body.append(marco);
  });
}
