import { HttpException, HttpStatus } from '@nestjs/common';
import ExcelJS from 'exceljs';

/**
 * Lector de docs/plantilla-carga-inicial.xlsx. Solo saca lo que hay escrito en cada hoja, fila por
 * fila; qué es válido y qué no lo deciden después los mismos esquemas y funciones que usa la API.
 * No depende de que las fórmulas estén calculadas: de las hojas que se llenan solas (PreciosPaquete,
 * InventarioInicial) se leen únicamente las celdas que se escriben a mano.
 */

/** Una fila de la plantilla con su número (como lo ve la persona en Excel). */
export interface Fila<T> {
  fila: number;
  datos: T;
}

type Celda = string | number | null;

export interface FilaCategoria {
  nombre: string;
  descripcion: Celda;
}

export interface FilaPerforacion {
  codigo: string;
  nombre: Celda;
  precio_servicio: Celda;
  piezas: Celda;
  /** ¿Acepta piezas de esa gama? (vacío = sí). Clave: nombre de la gama. */
  acepta: Record<string, boolean>;
  /** Precio del paquete con cada gama de tabla (hoja PreciosPaquete, misma fila). */
  precios: Record<string, Celda>;
  notas: string;
}

export interface FilaPrecioEspecial {
  perforacion: string;
  sku: string;
  gama: string;
  precio: Celda;
  motivo: string;
}

export interface FilaProducto {
  sku: string;
  codigo_barras: Celda;
  categoria: string;
  producto: string;
  variante: Celda;
  material: Celda;
  calibre: Celda;
  medida_mm: Celda;
  gama: string;
  precio: Celda;
  costo: Celda;
  /** Stock mínimo por sucursal. Clave: el nombre que trae el encabezado ("Las Américas"). */
  minimos: Record<string, Celda>;
  notas: string;
}

export interface FilaInventario {
  sku: string;
  /** Cantidad por ubicación. Clave: el encabezado de la columna ("Bodega central", "Las Brisas"). */
  cantidades: Record<string, Celda>;
}

export interface FilaProveedor {
  nombre: string;
  pais: Celda;
  moneda: Celda;
  contacto: Celda;
  telefono: Celda;
  email: Celda;
}

export interface FilaUsuario {
  nombre: string;
  username: string;
  rol: string;
  sucursal: string;
  email: Celda;
  telefono: Celda;
}

export interface FilaPromocion {
  nombre: string;
  tipo: Celda;
  valor: Celda;
  compra_minima: Celda;
  desde: Celda;
  hasta: Celda;
  activa: string;
  descripcion: Celda;
}

export interface Plantilla {
  categorias: Fila<FilaCategoria>[];
  perforaciones: Fila<FilaPerforacion>[];
  preciosEspeciales: Fila<FilaPrecioEspecial>[];
  productos: Fila<FilaProducto>[];
  inventario: Fila<FilaInventario>[];
  proveedores: Fila<FilaProveedor>[];
  usuarios: Fila<FilaUsuario>[];
  promociones: Fila<FilaPromocion>[];
}

const HOJAS = [
  'Categorias',
  'Perforaciones',
  'PreciosPaquete',
  'PreciosEspeciales',
  'Productos',
  'InventarioInicial',
  'Proveedores',
  'Usuarios',
  'Promociones',
] as const;

function archivoInvalido(mensaje: string): HttpException {
  return new HttpException({ codigo: 'ARCHIVO_INVALIDO', mensaje }, HttpStatus.BAD_REQUEST);
}

/** El valor que se ve en la celda: texto sin espacios alrededor, número o fecha (AAAA-MM-DD). */
function valor(crudo: ExcelJS.CellValue): Celda {
  if (crudo === null || crudo === undefined) return null;
  if (typeof crudo === 'string') return crudo.trim() || null;
  if (typeof crudo === 'number') return Number.isFinite(crudo) ? crudo : null;
  if (typeof crudo === 'boolean') return crudo ? 'Sí' : 'No';
  if (crudo instanceof Date) return crudo.toISOString().slice(0, 10);
  if ('richText' in crudo)
    return (
      crudo.richText
        .map((parte) => parte.text)
        .join('')
        .trim() || null
    );
  if ('text' in crudo) return String(crudo.text).trim() || null; // hipervínculo (un correo, p. ej.)
  if ('result' in crudo) return valor(crudo.result as ExcelJS.CellValue); // fórmula ya calculada
  return null; // fórmula sin calcular o error (#N/A...)
}

function texto(celda: Celda): string {
  return celda === null ? '' : String(celda);
}

/** Texto para comparar nombres sin importar mayúsculas ni tildes. */
export function normalizar(nombre: string): string {
  return nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

class Hoja {
  constructor(private readonly hoja: ExcelJS.Worksheet) {}

  celda(fila: number, columna: number): Celda {
    return valor(this.hoja.getRow(fila).getCell(columna).value);
  }

  /** Encabezado (fila 1) en una sola línea. */
  encabezado(columna: number): string {
    return texto(this.celda(1, columna)).replace(/\s+/g, ' ');
  }

  /** Filas de datos (de la 2 en adelante) que tienen algo escrito en alguna de esas columnas. */
  filas(columnas: number[]): number[] {
    const conDatos: number[] = [];
    for (let fila = 2; fila <= this.hoja.rowCount; fila++) {
      if (columnas.some((columna) => this.celda(fila, columna) !== null)) conDatos.push(fila);
    }
    return conDatos;
  }

  /** Columnas cuyo encabezado cumple la condición: [número de columna, encabezado]. */
  columnas(condicion: (encabezado: string) => boolean): [number, string][] {
    const encontradas: [number, string][] = [];
    for (let columna = 1; columna <= this.hoja.columnCount; columna++) {
      const encabezado = this.encabezado(columna);
      if (encabezado && condicion(encabezado)) encontradas.push([columna, encabezado]);
    }
    return encontradas;
  }
}

export async function leerPlantilla(contenido: Buffer): Promise<Plantilla> {
  // Un .xlsx es un ZIP: empieza con "PK"
  if (contenido.length < 4 || contenido[0] !== 0x50 || contenido[1] !== 0x4b) {
    throw archivoInvalido('El archivo no es un libro de Excel (.xlsx)');
  }
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(contenido as unknown as ArrayBuffer);
  } catch {
    throw archivoInvalido('No se pudo leer el archivo: guárdelo como libro de Excel (.xlsx)');
  }
  const faltantes = HOJAS.filter((nombre) => !libro.getWorksheet(nombre));
  if (faltantes.length > 0) {
    throw archivoInvalido(
      `El archivo no es la plantilla de carga inicial: faltan las hojas ${faltantes.join(', ')}`,
    );
  }
  const hoja = (nombre: (typeof HOJAS)[number]) => new Hoja(libro.getWorksheet(nombre)!);

  const categorias = hoja('Categorias');
  const perforaciones = hoja('Perforaciones');
  const precios = hoja('PreciosPaquete');
  const especiales = hoja('PreciosEspeciales');
  const productos = hoja('Productos');
  const inventario = hoja('InventarioInicial');
  const proveedores = hoja('Proveedores');
  const usuarios = hoja('Usuarios');
  const promociones = hoja('Promociones');

  // "¿Acepta Acero clásica?" → gama "Acero clásica"; "Con pieza ACERO CLÁSICA (C$)" → la misma
  const columnasAcepta = perforaciones.columnas((e) => /^¿Acepta /i.test(e));
  const columnasPrecio = precios
    .columnas((e) => /^Con pieza /i.test(e) && /\(C\$\)/.test(e))
    .map(
      ([columna, e]) => [columna, e.replace(/^Con pieza /i, '').replace(/\s*\(C\$\)/, '')] as const,
    );
  const columnasMinimo = productos.columnas((e) => /^Stock mínimo /i.test(e));
  // En InventarioInicial las ubicaciones van entre "Producto" y "Total"
  const columnasCantidad = inventario
    .columnas(() => true)
    .filter(([columna]) => columna >= 3)
    .filter(([, e]) => !/^(Total|Costo|Valor)/i.test(e));

  return {
    categorias: categorias.filas([1]).map((fila) => ({
      fila,
      datos: { nombre: texto(categorias.celda(fila, 1)), descripcion: categorias.celda(fila, 2) },
    })),
    perforaciones: perforaciones.filas([1, 2, 3]).map((fila) => ({
      fila,
      datos: {
        codigo: texto(perforaciones.celda(fila, 1)),
        nombre: perforaciones.celda(fila, 2),
        precio_servicio: perforaciones.celda(fila, 3),
        piezas: perforaciones.celda(fila, 4),
        acepta: Object.fromEntries(
          columnasAcepta.map(([columna, encabezado]) => [
            encabezado.replace(/^¿Acepta /i, '').replace(/\?$/, ''),
            normalizar(texto(perforaciones.celda(fila, columna))) !== 'no',
          ]),
        ),
        precios: Object.fromEntries(
          columnasPrecio.map(([columna, gama]) => [gama, precios.celda(fila, columna)]),
        ),
        notas: texto(perforaciones.celda(fila, 8)),
      },
    })),
    preciosEspeciales: especiales.filas([1, 2, 3, 4]).map((fila) => ({
      fila,
      datos: {
        perforacion: texto(especiales.celda(fila, 1)),
        sku: texto(especiales.celda(fila, 2)),
        gama: texto(especiales.celda(fila, 3)),
        precio: especiales.celda(fila, 4),
        motivo: texto(especiales.celda(fila, 5)),
      },
    })),
    // (la columna N, "Margen", es una fórmula: no cuenta como dato escrito)
    productos: productos.filas([1, 2, 3, 4, 5, 10]).map((fila) => ({
      fila,
      datos: {
        sku: texto(productos.celda(fila, 1)),
        codigo_barras: productos.celda(fila, 2),
        categoria: texto(productos.celda(fila, 3)),
        producto: texto(productos.celda(fila, 4)),
        variante: productos.celda(fila, 5),
        material: productos.celda(fila, 6),
        calibre: productos.celda(fila, 7),
        medida_mm: productos.celda(fila, 8),
        gama: texto(productos.celda(fila, 9)),
        precio: productos.celda(fila, 10),
        costo: productos.celda(fila, 11),
        minimos: Object.fromEntries(
          columnasMinimo.map(([columna, encabezado]) => [
            encabezado.replace(/^Stock mínimo /i, ''),
            productos.celda(fila, columna),
          ]),
        ),
        notas: texto(productos.celda(fila, 15)),
      },
    })),
    inventario: inventario.filas([1]).map((fila) => ({
      fila,
      datos: {
        sku: texto(inventario.celda(fila, 1)),
        cantidades: Object.fromEntries(
          columnasCantidad.map(([columna, encabezado]) => [
            encabezado,
            inventario.celda(fila, columna),
          ]),
        ),
      },
    })),
    proveedores: proveedores.filas([1]).map((fila) => ({
      fila,
      datos: {
        nombre: texto(proveedores.celda(fila, 1)),
        pais: proveedores.celda(fila, 2),
        moneda: proveedores.celda(fila, 3),
        contacto: proveedores.celda(fila, 4),
        telefono: proveedores.celda(fila, 5),
        email: proveedores.celda(fila, 6),
      },
    })),
    usuarios: usuarios.filas([1, 2]).map((fila) => ({
      fila,
      datos: {
        nombre: texto(usuarios.celda(fila, 1)),
        username: texto(usuarios.celda(fila, 2)),
        rol: texto(usuarios.celda(fila, 3)),
        sucursal: texto(usuarios.celda(fila, 4)),
        email: usuarios.celda(fila, 5),
        telefono: usuarios.celda(fila, 6),
      },
    })),
    promociones: promociones.filas([1]).map((fila) => ({
      fila,
      datos: {
        nombre: texto(promociones.celda(fila, 1)),
        tipo: promociones.celda(fila, 2),
        valor: promociones.celda(fila, 3),
        compra_minima: promociones.celda(fila, 4),
        desde: promociones.celda(fila, 5),
        hasta: promociones.celda(fila, 6),
        activa: texto(promociones.celda(fila, 7)),
        descripcion: promociones.celda(fila, 8),
      },
    })),
  };
}
