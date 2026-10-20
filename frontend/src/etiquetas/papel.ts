import type { PiezaEtiqueta } from '../api/tipos';

// Las etiquetas, sin React: el papel (hoja carta con cuadrícula o una por página), sus reglas —las
// mismas que pone la API— y lo que se le pide. El PDF lo arma la API: aquí solo se elige.

export type Formato = 'HOJA' | 'ROLLO';

/** Hoja carta con una cuadrícula de etiquetas (hojas adhesivas). Medidas en milímetros. */
export interface Cuadricula {
  filas: number;
  columnas: number;
  margen_superior: number;
  margen_izquierdo: number;
  ancho: number;
  alto: number;
  separacion_horizontal: number;
  separacion_vertical: number;
  /** Las ya usadas de la primera hoja: se dejan en blanco. */
  saltar: number;
  /** El contorno de cada etiqueta, para probar en papel normal. */
  bordes: boolean;
}

/** Una etiqueta por página (la impresora de etiquetas). Milímetros. */
export interface Tamano {
  ancho: number;
  alto: number;
}

export interface Papel {
  formato: Formato;
  hoja: Cuadricula;
  rollo: Tamano;
}

export const CARTA_MM = { ancho: 215.9, alto: 279.4 } as const;

/** Las hojas adhesivas más comunes: 30 por hoja carta (3 × 10 de 66.7 × 25.4 mm, como la Avery 5160). */
export const HOJA_DE_30: Cuadricula = {
  filas: 10,
  columnas: 3,
  margen_superior: 12.7,
  margen_izquierdo: 4.8,
  ancho: 66.7,
  alto: 25.4,
  separacion_horizontal: 3.2,
  separacion_vertical: 0,
  saltar: 0,
  bordes: false,
};

export const PAPEL_INICIAL: Papel = {
  formato: 'HOJA',
  hoja: HOJA_DE_30,
  rollo: { ancho: 50, alto: 30 },
};

/** Lo que admite cada medida (lo mismo que la API): [mínimo, máximo, entero]. */
export const LIMITES: Record<string, [number, number, boolean]> = {
  filas: [1, 30, true],
  columnas: [1, 10, true],
  margen_superior: [0, 100, false],
  margen_izquierdo: [0, 100, false],
  ancho: [15, 200, false],
  alto: [10, 270, false],
  separacion_horizontal: [0, 50, false],
  separacion_vertical: [0, 50, false],
  saltar: [0, 299, true],
  rollo_ancho: [15, 110, false],
  rollo_alto: [10, 200, false],
};

function fuera(valor: number, [minimo, maximo, entero]: [number, number, boolean]): boolean {
  return (
    !Number.isFinite(valor) ||
    valor < minimo ||
    valor > maximo ||
    (entero && !Number.isInteger(valor))
  );
}

/** Cuántas etiquetas lleva una hoja. */
export function porHoja(c: Cuadricula): number {
  return c.filas * c.columnas;
}

/**
 * Lo que impide pedir el PDF con este papel, por campo (vacío: se puede). Las mismas reglas que la
 * API: cada medida en su rango y la cuadrícula dentro de la hoja carta.
 */
export function problemasDelPapel(papel: Papel): Record<string, string> {
  const problemas: Record<string, string> = {};
  const revisar = (campo: string, valor: number, limite = campo) => {
    const rango = LIMITES[limite];
    if (fuera(valor, rango)) {
      problemas[campo] = rango[2]
        ? `Un número entero de ${rango[0]} a ${rango[1]}`
        : `De ${rango[0]} a ${rango[1]} mm`;
    }
  };
  if (papel.formato === 'ROLLO') {
    revisar('rollo_ancho', papel.rollo.ancho);
    revisar('rollo_alto', papel.rollo.alto);
    return problemas;
  }
  const c = papel.hoja;
  for (const campo of Object.keys(HOJA_DE_30)) {
    if (campo !== 'bordes') revisar(campo, c[campo as Exclude<keyof Cuadricula, 'bordes'>]);
  }
  if (Object.keys(problemas).length > 0) return problemas;
  const ancho =
    c.margen_izquierdo + c.columnas * c.ancho + (c.columnas - 1) * c.separacion_horizontal;
  const alto = c.margen_superior + c.filas * c.alto + (c.filas - 1) * c.separacion_vertical;
  if (ancho > CARTA_MM.ancho + 0.5) {
    problemas.columnas = `No caben a lo ancho de la hoja: ocupan ${ancho.toFixed(1)} mm de ${CARTA_MM.ancho}`;
  }
  if (alto > CARTA_MM.alto + 0.5) {
    problemas.filas = `No caben a lo alto de la hoja: ocupan ${alto.toFixed(1)} mm de ${CARTA_MM.alto}`;
  }
  if (c.saltar >= porHoja(c)) {
    problemas.saltar = `La hoja tiene ${porHoja(c)} etiquetas`;
  }
  return problemas;
}

/** Una pieza elegida y cuántas etiquetas le tocan (0: no se imprime). */
export interface Elegida {
  pieza: PiezaEtiqueta;
  copias: number;
}

export const COPIAS_MAXIMAS = 500;

/** Las copias que se proponen: lo que hay en la bodega o lo que entró con la compra (al menos 1). */
export function copiasIniciales(pieza: PiezaEtiqueta): number {
  return Math.min(Math.max(pieza.cantidad ?? 1, 1), COPIAS_MAXIMAS);
}

export function totalDeEtiquetas(lista: Elegida[]): number {
  return lista.reduce((suma, e) => suma + e.copias, 0);
}

/** Cuántas hojas (o páginas, una por etiqueta) salen. */
export function paginasDelPdf(total: number, papel: Papel): number {
  if (papel.formato === 'ROLLO') return total;
  return Math.ceil((total + papel.hoja.saltar) / porHoja(papel.hoja));
}

/** Lo que se le manda a `POST /api/etiquetas/pdf`: solo las piezas con copias. */
export function cuerpoDelPdf(lista: Elegida[], papel: Papel) {
  return {
    formato: papel.formato,
    piezas: lista
      .filter((e) => e.copias > 0)
      .map((e) => ({ variante_id: e.pieza.variante_id, copias: e.copias })),
    ...(papel.formato === 'HOJA' ? { hoja: papel.hoja } : { rollo: papel.rollo }),
  };
}

// Este equipo recuerda el papel que se usó la última vez (las ya usadas y los bordes, no: eso cambia
// con cada hoja). Si el navegador no deja guardarlo, se empieza con el de siempre.
const CLAVE = 'esmeralda.etiquetas.papel';

const esNumero = (valor: unknown): valor is number =>
  typeof valor === 'number' && Number.isFinite(valor);

export function papelGuardado(): Papel {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE) ?? 'null') as Partial<Papel> | null;
    if (!guardado) return PAPEL_INICIAL;
    const hoja = { ...HOJA_DE_30, ...guardado.hoja, saltar: 0, bordes: false };
    const rollo = { ...PAPEL_INICIAL.rollo, ...guardado.rollo };
    const papel: Papel = {
      formato: guardado.formato === 'ROLLO' ? 'ROLLO' : 'HOJA',
      hoja,
      rollo,
    };
    const numeros = [...Object.values(hoja), ...Object.values(rollo)].filter(
      (v) => typeof v !== 'boolean',
    );
    if (!numeros.every(esNumero)) return PAPEL_INICIAL;
    return Object.keys(problemasDelPapel(papel)).length === 0 ? papel : PAPEL_INICIAL;
  } catch {
    return PAPEL_INICIAL;
  }
}

export function guardarPapel(papel: Papel): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(papel));
  } catch {
    // sin permiso para guardar: la próxima vez empieza con el papel de siempre
  }
}
