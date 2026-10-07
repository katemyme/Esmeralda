import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { z } from 'zod';
import { generarPasswordTemporal, hashearPassword } from '../autenticacion/seguridad';
import { BaseDatosService, type Trx } from '../base-datos/base-datos.service';
import { esquemaCategoria } from '../categorias/esquemas';
import { traducirError } from '../comun/errores';
import { esquemaCrearPerforacion } from '../perforaciones/esquemas';
import { esquemaCrearVariante } from '../productos/esquemas';
import { esquemaPromocion } from '../promociones/esquemas';
import { esquemaProveedor } from '../proveedores/esquemas';
import { esquemaCrearUsuario } from '../usuarios/esquemas';
import { leerPlantilla, normalizar, type Plantilla } from './plantilla';

/** Algo que la persona debe saber o corregir, ubicado en su hoja y fila de la plantilla. */
export interface Observacion {
  hoja: string;
  fila: number | null;
  mensaje: string;
}

export interface ResultadoCarga {
  /** true solo si se pidió aplicar y no hubo ningún error: entonces todo quedó guardado. */
  aplicada: boolean;
  simulacion: boolean;
  /** Lo que se creó o se actualizó (o se haría, en una simulación). */
  resumen: {
    categorias: number;
    perforaciones: number;
    precios_paquete: number;
    precios_especiales: number;
    productos: number;
    variantes: number;
    /** Productos que ya existían y cuyo precio de venta cambió con esta carga. */
    precios_actualizados: number;
    piezas_en_inventario: number;
    envios: number;
    proveedores: number;
    usuarios: number;
    promociones: number;
  };
  /** Contraseñas temporales de los usuarios creados: solo se muestran aquí, una vez. */
  usuarios: { nombre_completo: string; username: string; password_temporal: string }[];
  /** Lo que se omitió (ya existía, fila de ejemplo) o conviene revisar; no impide la carga. */
  avisos: Observacion[];
  /** Con un solo error no se guarda nada. */
  errores: Observacion[];
}

/** Para deshacer la transacción al final de una simulación o cuando hubo errores. */
class Deshacer extends Error {}

/** Una variante que ya estaba en el sistema, con su precio y el que trae la plantilla. */
interface VarianteExistente {
  id: number;
  tipo: string;
  precio: string;
  precio_nuevo: string;
}

// Restricciones de la base con un mensaje más claro que el genérico
const RESTRICCIONES: Record<string, string> = {
  variante_sku_key: 'ese SKU ya existe (o está repetido en la plantilla)',
  variante_codigo_barras_key: 'ese código de barras ya lo tiene otra pieza',
  usuario_username_key: 'ese nombre de usuario ya existe (o está repetido en la plantilla)',
  ux_usuario_email: 'ese correo ya lo tiene otro usuario',
  perforacion_codigo_key: 'ese código de perforación ya existe (o está repetido en la plantilla)',
  perforacion_nombre_key: 'ya hay una perforación con ese nombre',
  categoria_nombre_key: 'esa categoría ya existe',
  proveedor_nombre_key: 'ese proveedor ya existe',
  promocion_nombre_key: 'ya hay una promoción con ese nombre',
};

function mensajeDe(error: unknown): string {
  const { cuerpo } = traducirError(error);
  const claro = cuerpo.restriccion ? RESTRICCIONES[cuerpo.restriccion] : undefined;
  return claro ? `No se pudo guardar: ${claro}` : cuerpo.mensaje;
}

/** Número de una celda como texto para los esquemas (los montos se redondean a centavos). */
function monto(celda: string | number | null): string | number | null {
  return typeof celda === 'number' ? Math.round(celda * 100) / 100 : celda;
}

/** Precio escrito en una celda (número, o texto con punto o coma decimal): mayor que 0, o null. */
function precioPositivo(celda: string | number | null): number | null {
  const n = typeof celda === 'number' ? celda : Number(String(celda ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function entero(celda: string | number | null): number | null | 'invalido' {
  if (celda === null) return null;
  const n = typeof celda === 'number' ? celda : Number(celda);
  return Number.isInteger(n) && n >= 0 && n <= 100_000 ? n : 'invalido';
}

/**
 * Carga inicial desde la plantilla de Excel (docs/plantilla-carga-inicial.xlsx). Cada fila se
 * valida con el mismo esquema que usa la API y se guarda con la misma función fn_* de la base,
 * todo dentro de una sola transacción: si hay un error, o si es una simulación, no queda nada.
 * Solo crea lo que falta: lo que ya existe se omite con un aviso (así el mismo archivo se puede
 * volver a cargar sin duplicar nada). Los precios sí quedan como diga el archivo: la tabla de
 * precios, los precios especiales y el precio de venta de los productos que ya existen (su costo
 * no: es el promedio de las compras).
 */
@Injectable()
export class CargaInicialService {
  constructor(private readonly bd: BaseDatosService) {}

  async cargar(adminId: number, contenido: Buffer, aplicar: boolean): Promise<ResultadoCarga> {
    const plantilla = await leerPlantilla(contenido);
    const carga = new Carga(adminId, plantilla);
    let aplicada = false;
    try {
      await this.bd.transaccion(adminId, async (trx) => {
        await carga.ejecutar(trx);
        if (!aplicar || carga.errores.length > 0) throw new Deshacer();
      });
      aplicada = true;
    } catch (error) {
      if (!(error instanceof Deshacer)) throw error;
    }
    const porFila = (a: Observacion, b: Observacion) =>
      a.hoja.localeCompare(b.hoja) || (a.fila ?? 0) - (b.fila ?? 0);
    return {
      aplicada,
      simulacion: !aplicar,
      resumen: carga.resumen,
      usuarios: aplicada ? carga.usuarios : [],
      avisos: carga.avisos.sort(porFila),
      errores: carga.errores.sort(porFila),
    };
  }
}

/** El trabajo de una carga: va hoja por hoja acumulando lo creado, los avisos y los errores. */
class Carga {
  readonly resumen: ResultadoCarga['resumen'] = {
    categorias: 0,
    perforaciones: 0,
    precios_paquete: 0,
    precios_especiales: 0,
    productos: 0,
    variantes: 0,
    precios_actualizados: 0,
    piezas_en_inventario: 0,
    envios: 0,
    proveedores: 0,
    usuarios: 0,
    promociones: 0,
  };
  readonly usuarios: ResultadoCarga['usuarios'] = [];
  readonly avisos: Observacion[] = [];
  readonly errores: Observacion[] = [];

  private trx!: Trx;
  /** SKU de las filas de ejemplo o que ya existían: su inventario tampoco se carga. */
  private readonly skuOmitidos = new Map<string, string>();
  /** SKU creados en esta carga → id de la variante. */
  private readonly skuCreados = new Map<string, number>();
  /** SKU que ya existían y ya salieron en una fila de Productos de este archivo. */
  private readonly skuExistentes = new Set<string>();
  /** Lo creado en esta carga, para distinguir "ya existía" de "está dos veces en la plantilla". */
  private readonly creados = new Set<string>();

  constructor(
    private readonly adminId: number,
    private readonly plantilla: Plantilla,
  ) {}

  async ejecutar(trx: Trx): Promise<void> {
    this.trx = trx;
    await this.categorias();
    await this.perforaciones();
    await this.productos();
    await this.preciosEspeciales();
    await this.inventario();
    await this.proveedores();
    await this.usuariosDelSistema();
    await this.promociones();
  }

  private aviso(hoja: string, fila: number | null, mensaje: string): void {
    this.avisos.push({ hoja, fila, mensaje });
  }

  private error(hoja: string, fila: number | null, mensaje: string): void {
    this.errores.push({ hoja, fila, mensaje });
  }

  /** Valida la fila con el esquema de la API; si no cumple, anota el error y devuelve null. */
  private validar<T extends z.ZodType>(
    esquema: T,
    hoja: string,
    fila: number,
    datos: unknown,
  ): z.output<T> | null {
    const resultado = esquema.safeParse(datos);
    if (resultado.success) return resultado.data;
    const mensajes = [...new Set(resultado.error.issues.map((problema) => problema.message))];
    this.error(hoja, fila, mensajes.join('. '));
    return null;
  }

  /**
   * Ejecuta un paso contra la base. Si falla, deshace solo ese paso (savepoint), anota el error
   * de la fila y la carga sigue, para reportar todos los errores de una vez.
   */
  private async intentar<T>(
    hoja: string,
    fila: number | null,
    paso: () => Promise<T>,
  ): Promise<T | undefined> {
    await sql`savepoint paso`.execute(this.trx);
    try {
      const resultado = await paso();
      await sql`release savepoint paso`.execute(this.trx);
      return resultado;
    } catch (error) {
      await sql`rollback to savepoint paso`.execute(this.trx);
      await sql`release savepoint paso`.execute(this.trx);
      this.error(hoja, fila, mensajeDe(error));
      return undefined;
    }
  }

  private async unId(
    consulta: ReturnType<typeof sql<{ id: number }>>,
  ): Promise<number | undefined> {
    return (await consulta.execute(this.trx)).rows[0]?.id;
  }

  /**
   * true (y anota el error) si eso mismo ya se creó en una fila anterior de este archivo. Lo que
   * existía desde antes es solo un aviso; lo repetido dentro de la plantilla sí es un error.
   */
  private repetido(hoja: string, fila: number, clase: string, clave: string): boolean {
    if (!this.creados.has(`${clase}|${normalizar(clave)}`)) return false;
    this.error(hoja, fila, `${clave} está repetido en la plantilla`);
    return true;
  }

  private anotarCreado(clase: string, clave: string): void {
    this.creados.add(`${clase}|${normalizar(clave)}`);
  }

  // -------------------------------------------------------------------- Categorias
  private async categorias(): Promise<void> {
    for (const { fila, datos } of this.plantilla.categorias) {
      const valida = this.validar(esquemaCategoria, 'Categorias', fila, datos);
      if (!valida) continue;
      const existe = await this.unId(
        sql`select id from categoria where lower(nombre) = lower(${valida.nombre})`,
      );
      if (existe) continue; // la plantilla ya trae las categorías del sistema: no es novedad
      const creada = await this.intentar('Categorias', fila, () =>
        sql`select fn_guardar_categoria(${this.adminId}, null, ${valida.nombre},
                   ${valida.descripcion})`.execute(this.trx),
      );
      if (creada) this.resumen.categorias++;
    }
  }

  // ------------------------------------------------- Perforaciones y PreciosPaquete
  private async perforaciones(): Promise<void> {
    const gamas = (
      await sql<{ id: number; nombre: string; modo_precio: string }>`
        select id, nombre, modo_precio from gama`.execute(this.trx)
    ).rows;
    const gamaPorNombre = (nombre: string) =>
      gamas.find((g) => normalizar(g.nombre) === normalizar(nombre));

    for (const { fila, datos } of this.plantilla.perforaciones) {
      if (/^ejemplo/i.test(datos.notas)) {
        this.aviso('Perforaciones', fila, 'Fila de ejemplo de la plantilla: se omitió');
        continue;
      }
      const valida = this.validar(esquemaCrearPerforacion, 'Perforaciones', fila, {
        codigo: datos.codigo,
        nombre: datos.nombre,
        precio_servicio: monto(datos.precio_servicio),
        piezas_por_paquete:
          typeof datos.piezas === 'string' ? Number(datos.piezas) : (datos.piezas ?? undefined),
      });
      if (!valida) continue;
      const acepta = (gama: string) =>
        Object.entries(datos.acepta).find(
          ([nombre]) => normalizar(nombre) === normalizar(gama),
        )?.[1];

      if (this.repetido('Perforaciones', fila, 'perforación', valida.codigo)) continue;
      let id = await this.unId(sql`select id from perforacion where codigo = ${valida.codigo}`);
      if (id) {
        this.aviso(
          'Perforaciones',
          fila,
          `La perforación ${valida.codigo} ya existe: no se modificó`,
        );
      } else {
        const aceptadas = Object.entries(datos.acepta).filter(([, acepta]) => acepta);
        if (aceptadas.length === 0) {
          this.error(
            'Perforaciones',
            fila,
            'Indique al menos una gama que acepte la perforación (o deje las tres en "Sí")',
          );
          continue;
        }
        id = await this.intentar('Perforaciones', fila, async () => {
          const nueva = await this.unId(
            sql`select fn_crear_perforacion(${this.adminId}, ${valida.codigo}, ${valida.nombre},
                       ${valida.precio_servicio}::numeric, ${valida.piezas_por_paquete}::smallint) as id`,
          );
          // Sin reglas, la perforación acepta cualquier pieza con gama: solo se limita si dijo "No" a alguna
          if (aceptadas.length < Object.keys(datos.acepta).length) {
            for (const [nombre] of aceptadas) {
              const gama = gamaPorNombre(nombre);
              if (!gama) throw new Error(`No existe la gama "${nombre}"`);
              await sql`select fn_set_pieza_permitida(${this.adminId}, ${nueva}, ${gama.id}, null, null, true)`.execute(
                this.trx,
              );
            }
          }
          return nueva;
        });
        if (!id) continue;
        this.resumen.perforaciones++;
        this.anotarCreado('perforación', valida.codigo);
      }

      // Tabla perforación × gama (hoja PreciosPaquete, misma fila)
      for (const [nombreGama, precio] of Object.entries(datos.precios)) {
        const gama = gamaPorNombre(nombreGama);
        if (!gama) {
          this.error('PreciosPaquete', fila, `No existe la gama "${nombreGama}"`);
          continue;
        }
        if (precio === null) {
          if (acepta(gama.nombre) !== false) {
            this.aviso(
              'PreciosPaquete',
              fila,
              `Falta el precio de ${valida.codigo} con ${gama.nombre}: ese paquete no se podrá vender hasta fijarlo`,
            );
          }
          continue;
        }
        const valor = precioPositivo(precio);
        if (valor === null) {
          this.error(
            'PreciosPaquete',
            fila,
            `El precio con ${gama.nombre} debe ser un monto mayor que 0`,
          );
          continue;
        }
        const guardado = await this.intentar('PreciosPaquete', fila, () =>
          sql`select fn_set_precio_gama(${this.adminId}, ${id}, ${gama.id}, ${valor}::numeric)`.execute(
            this.trx,
          ),
        );
        if (guardado) this.resumen.precios_paquete++;
      }
    }
  }

  // ---------------------------------------------------------------------- Productos
  private async productos(): Promise<void> {
    const sucursales = (
      await sql<{ id: number; nombre: string }>`
        select id, nombre from sucursal where tipo = 'SUCURSAL' and activa`.execute(this.trx)
    ).rows;
    /** Productos ya resueltos en esta carga: "categoría|nombre" → id. */
    const productos = new Map<string, number>();

    for (const { fila, datos } of this.plantilla.productos) {
      const skuFila = datos.sku.toUpperCase();
      if (/^ejemplo/i.test(datos.notas)) {
        this.aviso('Productos', fila, 'Fila de ejemplo de la plantilla: se omitió');
        this.skuOmitidos.set(skuFila, 'es la fila de ejemplo de Productos');
        continue;
      }
      const gama = datos.gama
        ? await this.unId(sql`select id from gama where lower(nombre) = lower(${datos.gama})`)
        : null;
      if (datos.gama && !gama) {
        this.error('Productos', fila, `No existe la gama "${datos.gama}"`);
        continue;
      }
      const atributos = Object.fromEntries(
        Object.entries({
          material: datos.material,
          calibre: datos.calibre,
          medida_mm: datos.medida_mm,
        }).filter(([, valor]) => valor !== null),
      );
      const valida = this.validar(esquemaCrearVariante, 'Productos', fila, {
        sku: datos.sku || undefined,
        nombre: datos.variante === null ? null : String(datos.variante),
        precio_venta: monto(datos.precio) ?? undefined,
        costo: monto(datos.costo) ?? undefined,
        codigo_barras: datos.codigo_barras === null ? null : String(datos.codigo_barras),
        gama_id: gama ?? null,
        atributos,
      });
      if (!valida) continue;
      if (!datos.producto || !datos.categoria) {
        this.error('Productos', fila, 'Indique la categoría y el nombre del producto');
        continue;
      }
      const categoria = await this.unId(
        sql`select id from categoria where lower(nombre) = lower(${datos.categoria})`,
      );
      if (!categoria) {
        this.error(
          'Productos',
          fila,
          `No existe la categoría "${datos.categoria}" (agréguela en la hoja Categorias)`,
        );
        continue;
      }
      if (this.skuCreados.has(valida.sku) || this.skuExistentes.has(valida.sku)) {
        this.error('Productos', fila, `El SKU ${valida.sku} está repetido en la plantilla`);
        continue;
      }
      const existente = (
        await sql<VarianteExistente>`
          select v.id, p.tipo, v.precio_venta as precio,
                 ${valida.precio_venta}::numeric(12,2) as precio_nuevo
            from variante v join producto p on p.id = v.producto_id
           where v.sku = ${valida.sku}`.execute(this.trx)
      ).rows[0];
      if (existente) {
        this.skuExistentes.add(valida.sku);
        this.skuOmitidos.set(valida.sku, 'ya existía en el sistema');
        await this.actualizarPrecio(fila, valida.sku, existente);
        continue;
      }
      const minimos: [number, number][] = [];
      let minimosValidos = true;
      for (const [encabezado, celda] of Object.entries(datos.minimos)) {
        const minimo = entero(celda);
        if (minimo === null) continue;
        const sucursal = sucursales.find((s) =>
          normalizar(s.nombre).endsWith(normalizar(encabezado)),
        );
        if (minimo === 'invalido' || !sucursal) {
          this.error(
            'Productos',
            fila,
            minimo === 'invalido'
              ? `El stock mínimo de ${encabezado} debe ser un número entero de 0 en adelante`
              : `No existe la sucursal "${encabezado}"`,
          );
          minimosValidos = false;
        } else {
          minimos.push([sucursal.id, minimo]);
        }
      }
      if (!minimosValidos) continue;

      const clave = `${categoria}|${normalizar(datos.producto)}`;
      const creada = await this.intentar('Productos', fila, async () => {
        let producto =
          productos.get(clave) ??
          (await this.unId(
            sql`select id from producto
                 where categoria_id = ${categoria} and tipo = 'PRODUCTO'
                   and lower(nombre) = lower(${datos.producto})`,
          ));
        const productoNuevo = !producto;
        producto ??= await this.unId(
          sql`select fn_guardar_producto(${this.adminId}, null, ${categoria}, ${datos.producto}) as id`,
        );
        const variante = await this.unId(
          sql`select fn_crear_variante(${this.adminId}, ${producto}, ${valida.sku},
                     ${valida.precio_venta}::numeric, ${valida.nombre}, ${valida.costo}::numeric,
                     ${valida.codigo_barras}, ${valida.gama_id}::integer,
                     ${JSON.stringify(valida.atributos)}::jsonb, null) as id`,
        );
        for (const [sucursal, minimo] of minimos) {
          await sql`select fn_set_stock_minimo(${this.adminId}, ${sucursal}, ${variante}, ${minimo})`.execute(
            this.trx,
          );
        }
        return { producto, productoNuevo, variante };
      });
      if (!creada?.producto || !creada.variante) continue;
      productos.set(clave, creada.producto);
      if (creada.productoNuevo) this.resumen.productos++;
      this.resumen.variantes++;
      this.skuCreados.set(valida.sku, creada.variante);
    }
  }

  /**
   * Un producto que ya existe no se vuelve a crear, pero su precio de venta queda como diga el
   * archivo (el cambio pasa por fn_set_precio_variante y queda en el historial de precios). El
   * costo y los demás datos no se tocan.
   */
  private async actualizarPrecio(
    fila: number,
    sku: string,
    variante: VarianteExistente,
  ): Promise<void> {
    if (variante.tipo !== 'PRODUCTO') {
      this.aviso('Productos', fila, `El SKU ${sku} es de una perforación: no se modificó`);
      return;
    }
    if (variante.precio === variante.precio_nuevo) {
      this.aviso('Productos', fila, `El SKU ${sku} ya existe: no se modificó`);
      return;
    }
    const actualizado = await this.intentar('Productos', fila, () =>
      sql`select fn_set_precio_variante(${this.adminId}, ${variante.id},
                 ${variante.precio_nuevo}::numeric)`.execute(this.trx),
    );
    if (!actualizado) return;
    this.resumen.precios_actualizados++;
    this.aviso(
      'Productos',
      fila,
      `El SKU ${sku} ya existe: se actualizó su precio de C$ ${variante.precio} a C$ ${variante.precio_nuevo} (lo demás no se modificó)`,
    );
  }

  // -------------------------------------------------------------- PreciosEspeciales
  private async preciosEspeciales(): Promise<void> {
    for (const { fila, datos } of this.plantilla.preciosEspeciales) {
      const hoja = 'PreciosEspeciales';
      if (/^ejemplo/i.test(datos.motivo)) {
        this.aviso(hoja, fila, 'Fila de ejemplo de la plantilla: se omitió');
        continue;
      }
      const precio = precioPositivo(datos.precio);
      if (precio === null) {
        this.error(hoja, fila, 'El precio del paquete debe ser un monto mayor que 0');
        continue;
      }
      if (!!datos.sku === !!datos.gama) {
        this.error(hoja, fila, 'Indique el SKU de una pieza o una gama, no las dos');
        continue;
      }
      const perforacion = await this.unId(
        sql`select id from perforacion where codigo = ${datos.perforacion.toUpperCase()}`,
      );
      if (!perforacion) {
        this.error(hoja, fila, `No existe la perforación "${datos.perforacion}"`);
        continue;
      }
      const variante = datos.sku
        ? await this.unId(sql`select id from variante where sku = ${datos.sku.toUpperCase()}`)
        : null;
      const gama = datos.gama
        ? await this.unId(sql`select id from gama where lower(nombre) = lower(${datos.gama})`)
        : null;
      if (datos.sku && !variante) {
        this.error(hoja, fila, `No existe una pieza con el SKU "${datos.sku}"`);
        continue;
      }
      if (datos.gama && !gama) {
        this.error(hoja, fila, `No existe la gama "${datos.gama}"`);
        continue;
      }
      const guardado = await this.intentar(hoja, fila, () =>
        sql`select fn_set_precio_especial(${this.adminId}, ${perforacion}, ${variante ?? null}::bigint,
                   ${gama ?? null}::integer, ${precio}::numeric, ${datos.motivo || null})`.execute(
          this.trx,
        ),
      );
      if (guardado) this.resumen.precios_especiales++;
    }
  }

  // -------------------------------------------------------------- InventarioInicial
  private async inventario(): Promise<void> {
    const hoja = 'InventarioInicial';
    const ubicaciones = (
      await sql<{ id: number; nombre: string; tipo: string }>`
        select id, nombre, tipo from sucursal where activa`.execute(this.trx)
    ).rows;
    const bodega = ubicaciones.find((u) => u.tipo === 'BODEGA');
    const ubicacionDe = (encabezado: string) =>
      ubicaciones.find(
        (u) =>
          normalizar(u.nombre) === normalizar(encabezado) ||
          (u.tipo === 'SUCURSAL' && normalizar(u.nombre).endsWith(normalizar(encabezado))),
      );
    /** Lo que va a cada sucursal: id de sucursal → [variante, cantidad][]. */
    const reparto = new Map<number, [number, number][]>();

    for (const { fila, datos } of this.plantilla.inventario) {
      const sku = datos.sku.toUpperCase();
      const omitido = this.skuOmitidos.get(sku);
      if (omitido) {
        this.aviso(hoja, fila, `El SKU ${sku} ${omitido}: su inventario no se cargó`);
        continue;
      }
      const variante = this.skuCreados.get(sku);
      if (!variante) {
        this.error(
          hoja,
          fila,
          `El SKU "${datos.sku}" no está en la hoja Productos de este archivo`,
        );
        continue;
      }
      if (!bodega) {
        this.error(hoja, fila, 'No hay una bodega central activa');
        continue;
      }
      let total = 0;
      let valida = true;
      const destinos: [number, number][] = [];
      for (const [encabezado, celda] of Object.entries(datos.cantidades)) {
        const cantidad = entero(celda);
        if (cantidad === null || cantidad === 0) continue;
        const ubicacion = ubicacionDe(encabezado);
        if (cantidad === 'invalido' || !ubicacion) {
          this.error(
            hoja,
            fila,
            cantidad === 'invalido'
              ? `La cantidad de ${encabezado} debe ser un número entero de 0 en adelante`
              : `No existe la ubicación "${encabezado}"`,
          );
          valida = false;
          continue;
        }
        total += cantidad;
        if (ubicacion.id !== bodega.id) destinos.push([ubicacion.id, cantidad]);
      }
      if (!valida || total === 0) continue;

      // Toda la mercadería entra por la bodega; a las sucursales llega con un envío
      const entrada = await this.intentar(hoja, fila, () =>
        sql`select fn_movimiento_inventario(${this.adminId}, ${bodega.id}, ${variante}, 'ENTRADA',
                   ${total}, 'Inventario inicial')`.execute(this.trx),
      );
      if (!entrada) continue;
      this.resumen.piezas_en_inventario += total;
      for (const [sucursal, cantidad] of destinos) {
        reparto.set(sucursal, [...(reparto.get(sucursal) ?? []), [variante, cantidad]]);
      }
    }

    for (const [sucursal, lineas] of reparto) {
      const enviado = await this.intentar(hoja, null, async () => {
        const envio = await this.unId(
          sql`select fn_crear_envio(${this.adminId}, ${bodega?.id}, ${sucursal}, 'Inventario inicial') as id`,
        );
        for (const [variante, cantidad] of lineas) {
          await sql`select fn_envio_set_linea(${this.adminId}, ${envio}, ${variante}, ${cantidad})`.execute(
            this.trx,
          );
        }
        await sql`select fn_enviar(${this.adminId}, ${envio})`.execute(this.trx);
        const recibido = lineas.map(([variante_id, cantidad]) => ({ variante_id, cantidad }));
        await sql`select * from fn_recibir_envio(${this.adminId}, ${envio}, ${JSON.stringify(recibido)}::jsonb)`.execute(
          this.trx,
        );
        return envio;
      });
      if (enviado) this.resumen.envios++;
    }
  }

  // -------------------------------------------------------------------- Proveedores
  private async proveedores(): Promise<void> {
    for (const { fila, datos } of this.plantilla.proveedores) {
      if (/ejemplo/i.test(datos.nombre)) {
        this.aviso('Proveedores', fila, 'Fila de ejemplo de la plantilla: se omitió');
        continue;
      }
      const valida = this.validar(esquemaProveedor, 'Proveedores', fila, {
        nombre: datos.nombre || undefined,
        pais: datos.pais === null ? null : String(datos.pais),
        moneda_habitual: datos.moneda ?? undefined,
        contacto: datos.contacto === null ? null : String(datos.contacto),
        telefono: datos.telefono === null ? null : String(datos.telefono),
        email: datos.email === null ? null : String(datos.email),
      });
      if (!valida) continue;
      if (this.repetido('Proveedores', fila, 'proveedor', valida.nombre)) continue;
      const existe = await this.unId(
        sql`select id from proveedor where lower(nombre) = lower(${valida.nombre})`,
      );
      if (existe) {
        this.aviso(
          'Proveedores',
          fila,
          `El proveedor "${valida.nombre}" ya existe: no se modificó`,
        );
        continue;
      }
      const creado = await this.intentar('Proveedores', fila, () =>
        sql`select fn_crear_proveedor(${this.adminId}, ${valida.nombre}, ${valida.pais},
                   ${valida.moneda_habitual}, ${valida.contacto}, ${valida.telefono},
                   ${valida.email})`.execute(this.trx),
      );
      if (!creado) continue;
      this.resumen.proveedores++;
      this.anotarCreado('proveedor', valida.nombre);
    }
  }

  // ----------------------------------------------------------------------- Usuarios
  private async usuariosDelSistema(): Promise<void> {
    const roles = (
      await sql<{ codigo: string; nombre: string }>`select codigo, nombre from rol`.execute(
        this.trx,
      )
    ).rows;
    const sucursales = (
      await sql<{ id: number; nombre: string }>`
        select id, nombre from sucursal where tipo = 'SUCURSAL' and activa order by id`.execute(
        this.trx,
      )
    ).rows;

    for (const { fila, datos } of this.plantilla.usuarios) {
      if (datos.username === 'maria.lopez' && datos.nombre === 'María López') {
        this.aviso('Usuarios', fila, 'Fila de ejemplo de la plantilla: se omitió');
        continue;
      }
      // "Encargado" → el rol "Encargado de sucursal"; también vale el código (ENCARGADO)
      const rol = roles.find(
        (r) =>
          r.codigo === datos.rol.toUpperCase() ||
          normalizar(r.nombre) === normalizar(datos.rol) ||
          (datos.rol !== '' && normalizar(r.nombre).startsWith(`${normalizar(datos.rol)} `)),
      );
      if (!rol) {
        this.error('Usuarios', fila, `No existe el rol "${datos.rol}"`);
        continue;
      }
      const todas = ['ambas', 'todas'].includes(normalizar(datos.sucursal));
      const asignadas = todas
        ? sucursales
        : sucursales.filter(
            (s) =>
              datos.sucursal !== '' && normalizar(s.nombre).endsWith(normalizar(datos.sucursal)),
          );
      if (asignadas.length === 0 && rol.codigo !== 'ADMIN') {
        this.error(
          'Usuarios',
          fila,
          datos.sucursal
            ? `No existe la sucursal "${datos.sucursal}"`
            : 'Indique la sucursal del usuario',
        );
        continue;
      }
      const valida = this.validar(esquemaCrearUsuario, 'Usuarios', fila, {
        nombre_completo: datos.nombre || undefined,
        username: datos.username || undefined,
        rol: rol.codigo,
        sucursales: asignadas.map((s) => s.id),
        email: datos.email === null ? null : String(datos.email),
        telefono: datos.telefono === null ? null : String(datos.telefono),
      });
      if (!valida) continue;
      if (this.repetido('Usuarios', fila, 'usuario', valida.username)) continue;
      const existe = await this.unId(
        sql`select id from usuario where username = ${valida.username}`,
      );
      if (existe) {
        this.aviso('Usuarios', fila, `El usuario ${valida.username} ya existe: no se modificó`);
        continue;
      }
      const passwordTemporal = generarPasswordTemporal();
      const hash = await hashearPassword(passwordTemporal);
      const creado = await this.intentar('Usuarios', fila, () =>
        sql`select fn_crear_usuario(${this.adminId}, ${valida.nombre_completo}, ${valida.username},
                   ${hash}, ${valida.rol}, ${valida.sucursales}::integer[], ${valida.email},
                   ${valida.telefono})`.execute(this.trx),
      );
      if (!creado) continue;
      this.resumen.usuarios++;
      this.anotarCreado('usuario', valida.username);
      this.usuarios.push({
        nombre_completo: valida.nombre_completo,
        username: valida.username,
        password_temporal: passwordTemporal,
      });
    }
  }

  // -------------------------------------------------------------------- Promociones
  private async promociones(): Promise<void> {
    for (const { fila, datos } of this.plantilla.promociones) {
      if (datos.nombre === 'Promo 10 %' && datos.descripcion === '10 % en toda la venta') {
        this.aviso('Promociones', fila, 'Fila de ejemplo de la plantilla: se omitió');
        continue;
      }
      const valida = this.validar(esquemaPromocion, 'Promociones', fila, {
        nombre: datos.nombre || undefined,
        tipo: datos.tipo ?? undefined,
        valor: monto(datos.valor) ?? undefined,
        compra_minima: monto(datos.compra_minima) ?? undefined,
        vigente_desde: datos.desde === null ? null : String(datos.desde),
        vigente_hasta: datos.hasta === null ? null : String(datos.hasta),
        descripcion: datos.descripcion === null ? null : String(datos.descripcion),
      });
      if (!valida) continue;
      if (this.repetido('Promociones', fila, 'promoción', valida.nombre)) continue;
      const existe = await this.unId(
        sql`select id from promocion where lower(nombre) = lower(${valida.nombre})`,
      );
      if (existe) {
        this.aviso(
          'Promociones',
          fila,
          `La promoción "${valida.nombre}" ya existe: no se modificó`,
        );
        continue;
      }
      const creada = await this.intentar('Promociones', fila, async () => {
        const id = await this.unId(
          sql`select fn_guardar_promocion(${this.adminId}, null, ${valida.nombre}, ${valida.tipo},
                     ${valida.valor}::numeric, ${valida.compra_minima}::numeric,
                     ${valida.vigente_desde}::date, ${valida.vigente_hasta}::date,
                     ${valida.descripcion}) as id`,
        );
        if (normalizar(datos.activa) === 'si') {
          await sql`select fn_set_promocion_activa(${this.adminId}, ${id}, true)`.execute(this.trx);
        }
        return id;
      });
      if (!creada) continue;
      this.resumen.promociones++;
      this.anotarCreado('promoción', valida.nombre);
    }
  }
}
