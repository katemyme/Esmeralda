import { inflateSync } from 'node:zlib';
import PDFDocument from 'pdfkit';

const MM_POR_PUNTO = 25.4 / 72;

/** Lo que imprime de ancho una impresora térmica de 80 mm (576 puntos del cabezal). */
export const ANCHO_IMPRIMIBLE_MM = 72;

/** Una línea de texto tal como quedó dibujada en el PDF (ya partida). Medidas en milímetros. */
export interface TextoPdf {
  texto: string;
  /** `Helvetica` o `Helvetica-Bold`. */
  fuente: string;
  /** Tamaño de la letra, en puntos. */
  letra: number;
  /** Dónde empieza y dónde termina, desde el borde izquierdo de la página. */
  izquierda: number;
  derecha: number;
  /** La línea de base, desde el borde de arriba de la página. */
  y: number;
}

export interface PaginaPdf {
  ancho: number;
  alto: number;
  textos: TextoPdf[];
  /** Lo dibujado que no es texto (las líneas punteadas y los cuadros del QR): de dónde a dónde va. */
  trazos: { izquierda: number; derecha: number }[];
}

/** El contenido de las páginas, sin comprimir (pdfkit lo guarda con Flate). */
function contenido(pdf: Buffer): string {
  const crudo = pdf.toString('latin1');
  const [abre, cierra] = ['stream\n', '\nendstream'];
  const partes: string[] = [];
  for (let desde = 0; ;) {
    const inicio = crudo.indexOf(abre, desde);
    if (inicio < 0) break;
    const fin = crudo.indexOf(cierra, inicio);
    partes.push(inflateSync(pdf.subarray(inicio + abre.length, fin)).toString('latin1'));
    desde = fin + cierra.length;
  }
  return partes.join('\n');
}

/** `F1` → `Helvetica`: el nombre con que la página llama a cada fuente y cuál es. */
function fuentes(crudo: string): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const [, nombre, objeto] of crudo.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
    const base = new RegExp(`\\n${objeto} 0 obj\\n<<[^>]*?/BaseFont /([\\w-]+)`).exec(crudo)?.[1];
    if (!base) throw new Error(`No se encontró la fuente ${nombre} en el PDF`);
    mapa.set(nombre, base);
  }
  return mapa;
}

/**
 * Lee un PDF de una página hecho con pdfkit y dice dónde quedó cada cosa: sirve para probar que
 * nada se sale de lo imprimible. Entiende solo lo que pdfkit escribe para texto con las fuentes
 * estándar (una operación por línea: `Tm` la posición, `Tf` la fuente y `TJ` el texto), los
 * rectángulos (`re`) y las líneas (`m`, `l`); cualquier otra forma de escribir texto la rechaza,
 * para que la prueba no pase por no haber leído nada.
 */
export function leerPdf(pdf: Buffer): PaginaPdf {
  const crudo = pdf.toString('latin1');
  const caja = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(crudo);
  if (!caja) throw new Error('El PDF no trae el tamaño de su página');
  const altoEnPuntos = Number(caja[2]);
  const fuentePorNombre = fuentes(crudo);
  const medidor = new PDFDocument();
  const latino = new TextDecoder('windows-1252');

  const pagina: PaginaPdf = {
    ancho: Number(caja[1]) * MM_POR_PUNTO,
    alto: altoEnPuntos * MM_POR_PUNTO,
    textos: [],
    trazos: [],
  };
  let x = 0;
  let y = 0;
  let fuente = '';
  let letra = 0;
  for (const linea of contenido(pdf).split('\n')) {
    const posicion = /^1 0 0 1 (\S+) (\S+) Tm$/.exec(linea);
    const tipo = /^\/(F\d+) (\S+) Tf$/.exec(linea);
    const escrito = /^\[(.*)\] TJ$/.exec(linea);
    const rectangulo = /^(\S+) \S+ (\S+) \S+ re$/.exec(linea);
    const punto = /^(\S+) \S+ [ml]$/.exec(linea);
    if (posicion) {
      x = Number(posicion[1]);
      y = Number(posicion[2]);
    } else if (tipo) {
      fuente = fuentePorNombre.get(tipo[1]) ?? '';
      letra = Number(tipo[2]);
    } else if (escrito) {
      const bytes = [...escrito[1].matchAll(/<([0-9a-f]*)>/g)].map(([, hex]) =>
        Buffer.from(hex, 'hex'),
      );
      const texto = latino.decode(Buffer.concat(bytes));
      // Un espacio al final de una línea partida no imprime nada: no cuenta para el ancho
      const ancho = medidor.font(fuente).fontSize(letra).widthOfString(texto.trimEnd());
      pagina.textos.push({
        texto: texto.trimEnd(),
        fuente,
        letra,
        izquierda: x * MM_POR_PUNTO,
        derecha: (x + ancho) * MM_POR_PUNTO,
        y: (altoEnPuntos - y) * MM_POR_PUNTO,
      });
    } else if (rectangulo) {
      const izquierda = Number(rectangulo[1]) * MM_POR_PUNTO;
      pagina.trazos.push({ izquierda, derecha: izquierda + Number(rectangulo[2]) * MM_POR_PUNTO });
    } else if (punto) {
      const donde = Number(punto[1]) * MM_POR_PUNTO;
      pagina.trazos.push({ izquierda: donde, derecha: donde });
    } else if (/ (Tj|'|"|Td|TD|T\*|Tc|Tw|Tz)$/.test(linea)) {
      throw new Error(`Texto escrito de una forma que esta lectura no entiende: ${linea}`);
    }
  }
  return pagina;
}

/**
 * Lo que queda fuera de la franja `desde`–`hasta` (en milímetros desde el borde izquierdo; por
 * defecto, los 72 mm que imprime el rollo de 80). Una lista vacía quiere decir que todo cabe.
 */
export function loQueSeSale(
  pagina: PaginaPdf,
  { desde = 0, hasta = ANCHO_IMPRIMIBLE_MM }: { desde?: number; hasta?: number } = {},
): string[] {
  const holgura = 0.01; // redondeo de los números del PDF
  const fuera = (algo: { izquierda: number; derecha: number }) =>
    algo.izquierda < desde - holgura || algo.derecha > hasta + holgura;
  const medidas = (algo: { izquierda: number; derecha: number }) =>
    `de ${algo.izquierda.toFixed(2)} a ${algo.derecha.toFixed(2)} mm`;
  return [
    ...pagina.textos.filter(fuera).map((t) => `«${t.texto}» va ${medidas(t)}`),
    ...pagina.trazos.filter(fuera).map((t) => `un trazo va ${medidas(t)}`),
  ];
}
