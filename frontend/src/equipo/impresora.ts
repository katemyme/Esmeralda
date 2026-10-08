import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';

/**
 * Impresora térmica de tickets por USB, directo desde el navegador (WebUSB) y en ESC/POS.
 * Solo existe en Chrome (tablet Android con adaptador OTG, o computadora): en iPhone no hay WebUSB.
 *
 * El envío es propio y no de una librería: así se acepta cualquier impresora USB de tickets (la
 * Xprinter XP-T80A no reporta siempre los mismos identificadores) y, sobre todo, un envío que
 * falla lanza un error. Eso es lo que permite reintentar el mismo ticket sin marcarlo como copia.
 * Lo que el navegador no puede saber es si el papel salió: solo que los datos llegaron.
 */

const CLASE_IMPRESORA = 7; // clase USB «printer»
const TROZO = 4096;

export interface Impresora {
  /** Lo que la impresora dice de sí misma («POS80 Printer»). */
  nombre: string;
  /** Envía los datos tal cual. Lanza un error si la impresora no los recibe. */
  enviar: (datos: Uint8Array) => Promise<void>;
  desconectar: () => Promise<void>;
}

export function navegadorImprimePorUsb(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator;
}

/** La interfaz de impresora de un equipo USB y su salida de datos, si las tiene. */
function salidaDeImpresora(dispositivo: USBDevice) {
  for (const interfaz of dispositivo.configuration?.interfaces ?? []) {
    for (const alterna of interfaz.alternates) {
      if (alterna.interfaceClass !== CLASE_IMPRESORA) continue;
      const salida = alterna.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
      if (salida) return { interfaz, alterna, salida };
    }
  }
  return null;
}

async function abrir(dispositivo: USBDevice): Promise<Impresora> {
  await dispositivo.open();
  try {
    if (dispositivo.configuration === null) await dispositivo.selectConfiguration(1);
    const encontrada = salidaDeImpresora(dispositivo);
    if (!encontrada) throw new Error('Ese equipo USB no es una impresora de tickets.');
    const { interfaz, alterna, salida } = encontrada;
    await dispositivo.claimInterface(interfaz.interfaceNumber);
    if (interfaz.alternates.length > 1) {
      await dispositivo.selectAlternateInterface(
        interfaz.interfaceNumber,
        alterna.alternateSetting,
      );
    }
    return {
      nombre: dispositivo.productName?.trim() || 'Impresora USB',
      enviar: async (datos) => {
        for (let desde = 0; desde < datos.length; desde += TROZO) {
          const trozo = datos.slice(desde, desde + TROZO);
          const resultado = await dispositivo.transferOut(salida.endpointNumber, trozo);
          if (resultado.status !== 'ok') {
            throw new Error('La impresora no recibió el ticket completo.');
          }
        }
      },
      desconectar: () => dispositivo.close(),
    };
  } catch (error) {
    await dispositivo.close().catch(() => {});
    throw error;
  }
}

/**
 * Pide elegir la impresora. Tiene que llamarse desde un toque (el navegador muestra su lista y
 * Android pregunta si Chrome puede usar el equipo USB).
 */
export async function elegirImpresora(): Promise<Impresora> {
  const dispositivo = await navigator.usb.requestDevice({
    filters: [{ classCode: CLASE_IMPRESORA }],
  });
  return abrir(dispositivo);
}

/** La impresora que ya se autorizó antes en este equipo, si sigue conectada (sin preguntar). */
export async function impresoraAutorizada(): Promise<Impresora | null> {
  if (!navegadorImprimePorUsb()) return null;
  for (const dispositivo of await navigator.usb.getDevices()) {
    const esImpresora = dispositivo.configurations.some((c) =>
      c.interfaces.some((i) => i.alternates.some((a) => a.interfaceClass === CLASE_IMPRESORA)),
    );
    if (esImpresora) return abrir(dispositivo);
  }
  return null;
}

/** Por qué no se pudo conectar o imprimir, en palabras para quien está frente a la tablet. */
export function mensajeDeImpresora(error: unknown): string {
  const nombre = error instanceof Error ? error.name : '';
  if (nombre === 'NotFoundError') return 'No se eligió ninguna impresora.';
  if (nombre === 'SecurityError' || nombre === 'NotAllowedError') {
    return 'El navegador no dio permiso para usar la impresora.';
  }
  if (nombre === 'NetworkError') {
    return 'Se perdió la conexión con la impresora. Revise el cable y que esté encendida.';
  }
  if (error instanceof Error && error.message) return error.message;
  return 'No se pudo usar la impresora.';
}

/** Codificador para papel de 80 mm (48 columnas) en una Xprinter. */
export function codificador(): ReceiptPrinterEncoder {
  return new ReceiptPrinterEncoder({
    language: 'esc-pos',
    codepageMapping: 'xprinter',
    columns: 48,
    feedBeforeCut: 4,
  });
}

/**
 * Página de prueba: lo que hay que ver en el papel antes de confiarle los tickets. Acentos y «ñ»
 * (dependen de cómo venga configurada la impresora), el QR de una factura, el corte y, si se pide,
 * el pulso que abre la gaveta.
 */
export function paginaDePrueba(opciones: {
  equipo: string;
  fecha: string;
  gaveta: boolean;
}): Uint8Array {
  const ticket = codificador()
    .initialize()
    .codepage('auto')
    .align('center')
    .bold(true)
    .size(2, 2)
    .line('Esmeralda')
    .size(1, 1)
    .line('Experience')
    .bold(false)
    .newline()
    .line('PÁGINA DE PRUEBA')
    .rule()
    .align('left')
    .line('Acentos: á é í ó ú ü ñ Ñ ¿? ¡!')
    .line('Montos:  C$ 1,250.00   US$ 20.00')
    .line(`Equipo:  ${opciones.equipo}`)
    .line(`Fecha:   ${opciones.fecha}`)
    .rule()
    .align('center')
    .line('Código QR de una factura')
    .qrcode('LAM-00000001', { model: 2, size: 6, errorlevel: 'm' })
    .line('LAM-00000001')
    .newline()
    .line('Si esta hoja salió completa, con los')
    .line('acentos bien y el papel cortado,')
    .line('la impresora está lista.');
  if (opciones.gaveta) ticket.pulse();
  return ticket.cut().encode();
}
