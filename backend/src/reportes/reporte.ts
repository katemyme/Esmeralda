/**
 * Forma común de todos los reportes: una o varias secciones (tablas) con sus columnas, sus filas
 * y su fila de totales. La misma estructura sale como JSON, como Excel y como PDF.
 */

/**
 * Cómo se muestra el valor de una columna:
 * - `monto`: texto con 2 decimales ("1250.00"), en córdobas salvo que el título diga otra cosa.
 * - `porcentaje`: texto con 1 decimal ("63.5").
 * - `fecha` y `mes`: día AAAA-MM-DD de Managua (en `mes`, el primer día del mes).
 * - `fecha_hora`: instante (se muestra en hora de Managua).
 * - `si_no`: booleano.
 */
export type TipoColumna =
  'texto' | 'entero' | 'monto' | 'porcentaje' | 'fecha' | 'mes' | 'fecha_hora' | 'si_no';

export interface Columna {
  clave: string;
  titulo: string;
  tipo: TipoColumna;
}

export type Valor = string | number | boolean | Date | null;
export type Fila = Record<string, Valor>;

export interface Seccion {
  clave: string;
  titulo: string;
  columnas: Columna[];
  filas: Fila[];
  /** Totales de las columnas que se suman, o null si la sección no lleva. */
  totales: Fila | null;
}

export interface Reporte {
  /** Nombre del reporte en la ruta (`ventas-por-vendedor`). */
  clave: string;
  titulo: string;
  /** Rango de días de Managua; null en los que son una foto (inventario, por reponer). */
  desde: string | null;
  hasta: string | null;
  /** La sucursal pedida, o null si son todas las que el usuario puede ver. */
  sucursal: { id: number; codigo: string; nombre: string } | null;
  generado_at: Date;
  /** Aclaraciones para quien lo lee (p. ej. que no incluye los turnos abiertos). */
  notas: string[];
  secciones: Seccion[];
}

/** Columna tal como la define el servicio: puede depender de un permiso. */
export interface ColumnaDefinida extends Columna {
  /** Solo para quien tiene REPORTES_COSTOS. */
  costo?: boolean;
  /** false: la columna no sale (p. ej. la cantidad en bodega para quien no puede verla). */
  visible?: boolean;
}

/** Los tipos que se pueden totalizar. */
const NUMERICOS = new Set<TipoColumna>(['entero', 'monto', 'porcentaje']);

/**
 * Arma una sección dejando solo las columnas que el usuario puede ver; de las filas y de los
 * totales solo pasan esas columnas (los valores ocultos ya vienen en null desde la consulta).
 * Los totales llevan únicamente columnas numéricas: el nombre o la fecha de una fila no se suma.
 */
export function seccion(
  clave: string,
  titulo: string,
  definidas: ColumnaDefinida[],
  filas: Fila[],
  totales: Fila | null,
  veCostos: boolean,
): Seccion {
  const columnas = definidas
    .filter((c) => c.visible !== false && (veCostos || !c.costo))
    .map(({ clave: claveColumna, titulo: tituloColumna, tipo }) => ({
      clave: claveColumna,
      titulo: tituloColumna,
      tipo,
    }));
  const soloVisibles = (fila: Fila): Fila =>
    Object.fromEntries(columnas.map((c) => [c.clave, fila[c.clave] ?? null]));
  return {
    clave,
    titulo,
    columnas,
    filas: filas.map(soloVisibles),
    totales:
      totales &&
      Object.fromEntries(
        columnas
          .filter((c) => NUMERICOS.has(c.tipo) && c.clave in totales)
          .map((c) => [c.clave, totales[c.clave] ?? null]),
      ),
  };
}
