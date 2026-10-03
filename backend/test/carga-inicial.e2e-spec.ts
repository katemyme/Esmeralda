import type { NestExpressApplication } from '@nestjs/platform-express';
import ExcelJS from 'exceljs';
import { join } from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { verificarPassword } from '../src/autenticacion/seguridad';
import { BaseDatosService } from '../src/base-datos/base-datos.service';
import type { Observacion, ResultadoCarga } from '../src/carga-inicial/carga-inicial.service';
import type { EnvioResumen } from '../src/envios/envios.service';
import type { Existencia } from '../src/inventario/inventario.service';
import type { PerforacionCatalogo } from '../src/perforaciones/perforaciones.service';
import type { ExistenciaUbicacion, ProductoCatalogo } from '../src/productos/productos.service';
import type { PromocionAdmin } from '../src/promociones/promociones.service';
import type { UsuarioAdmin } from '../src/usuarios/usuarios.service';
import { crearApp, crearUsuarioDePrueba, registrarTablet, tokenDeAcceso } from './utilidades';

// Carga inicial desde la plantilla de Excel real (docs/plantilla-carga-inicial.xlsx): se llena como
// lo haría el dueño, se simula, se prueba con errores y se aplica. Todo lo que crea lleva "CI" en
// el nombre o en el código para no mezclarse con los datos de las otras pruebas.

const RUTA_PLANTILLA = join(__dirname, '..', '..', 'docs', 'plantilla-carga-inicial.xlsx');

type Llenar = (hoja: (nombre: string) => ExcelJS.Worksheet) => void;

/** Escribe una fila a partir de la columna A (las celdas `undefined` se dejan como están). */
function escribir(hoja: ExcelJS.Worksheet, fila: number, valores: unknown[]): void {
  valores.forEach((valor, i) => {
    if (valor !== undefined) hoja.getRow(fila).getCell(i + 1).value = valor as ExcelJS.CellValue;
  });
}

/** La plantilla tal como se entrega (con sus filas de ejemplo), más lo que se le escriba. */
async function plantilla(...cambios: Llenar[]): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.readFile(RUTA_PLANTILLA);
  for (const llenar of cambios) llenar((nombre) => libro.getWorksheet(nombre)!);
  return Buffer.from(await libro.xlsx.writeBuffer());
}

/** Lo que llenaría el dueño: una categoría, dos perforaciones, tres piezas, inventario, etc. */
const datosValidos: Llenar = (hoja) => {
  escribir(hoja('Categorias'), 13, ['Barras CI', 'Piezas de la carga de prueba']);
  escribir(hoja('Categorias'), 14, ['Relojes CI']);

  //                              código  nombre           servicio piezas clásica lujo  titanio
  escribir(hoja('Perforaciones'), 3, ['cix', 'Industrial CI', 400, 1, 'Sí', 'Sí', 'No']);
  escribir(hoja('Perforaciones'), 4, ['CIY', 'Daith CI', 380, 1]); // sin marcar: acepta todas
  // PreciosPaquete: las columnas A–C son fórmulas; se escriben los precios (D clásica, E lujo)
  escribir(hoja('PreciosPaquete'), 3, [undefined, undefined, undefined, 520, 620]);
  escribir(hoja('PreciosPaquete'), 4, [undefined, undefined, undefined, 500]);
  escribir(hoja('PreciosEspeciales'), 3, ['CIY', 'CI-TIT-01', null, 950, 'Lanzamiento']);

  const productos = hoja('Productos');
  //                     SKU          barras           categoría    producto    variante          material   cal.   mm gama       precio costo mínLAM mínLBR
  escribir(productos, 3, [
    'ci-tit-01',
    '7700000000011',
    'Barras CI',
    'Barra CI',
    'Titanio · 6 mm',
    'Titanio',
    '16G',
    6,
    'Titanio',
    700,
    250,
    4,
    2,
  ]);
  escribir(productos, 4, [
    'CI-TIT-02',
    null,
    'Barras CI',
    'Barra CI',
    '8 mm',
    'Titanio',
    '16G',
    8,
    'Titanio',
    720.5,
  ]);
  escribir(productos, 5, [
    'CI-REL-01',
    null,
    'Relojes CI',
    'Reloj CI',
    null,
    null,
    null,
    null,
    null,
    1500,
    600,
  ]);

  //                                  SKU          (fórmula)  bodega LAM LBR
  escribir(hoja('InventarioInicial'), 3, ['CI-TIT-01', undefined, 10, 6, 4]);
  escribir(hoja('InventarioInicial'), 4, ['CI-REL-01', undefined, 3, 0, 0]);

  escribir(hoja('Proveedores'), 3, [
    'Proveedor CI',
    'México',
    'USD',
    'Ana',
    '555-1234',
    'ana@ci.example',
  ]);
  escribir(hoja('Usuarios'), 3, [
    'Carla Ibarra',
    'carla.ci',
    'Vendedor',
    'Las Brisas',
    'carla@ci.example',
    '8888-1111',
  ]);
  escribir(hoja('Usuarios'), 4, ['Diego Ibarra', 'diego.ci', 'Encargado', 'Ambas']);
  escribir(hoja('Promociones'), 3, [
    'Promo CI',
    'PORCENTAJE',
    12,
    300,
    new Date(Date.UTC(2030, 0, 1)),
    new Date(Date.UTC(2030, 11, 31)),
    'Sí',
    'Promoción de prueba',
  ]);
};

/** Errores de varias clases, cada uno en su fila. */
const datosConErrores: Llenar = (hoja) => {
  const productos = hoja('Productos');
  escribir(productos, 6, [
    'CI MAL',
    null,
    'Barras CI',
    'Barra CI',
    'x',
    null,
    null,
    null,
    null,
    -5,
  ]);
  escribir(productos, 7, [
    'CI-TIT-01',
    null,
    'Barras CI',
    'Barra CI',
    'Repetida',
    null,
    null,
    null,
    null,
    100,
  ]);
  escribir(productos, 8, [
    'CI-SIN-CAT',
    null,
    'No existe CI',
    'Otra',
    'x',
    null,
    null,
    null,
    null,
    100,
  ]);
  escribir(hoja('InventarioInicial'), 5, ['NO-EXISTE-CI', undefined, 1, 0, 0]);
  escribir(hoja('Usuarios'), 5, ['Pepe Grillo', 'Pepe Grillo', 'Gerente', 'Las Brisas']);
  escribir(hoja('Promociones'), 4, ['Imposible CI', 'PORCENTAJE', 150]);
};

function ubicadas(observaciones: Observacion[]): string[] {
  return observaciones.map((o) => `${o.hoja}:${o.fila ?? '-'}`);
}

describe('Carga inicial desde la plantilla de Excel', () => {
  let app: NestExpressApplication;
  let http: App;
  let bd: BaseDatosService;
  const ids = { lam: 0, lbr: 0, bod: 0 };
  const jefa = { acceso: '' };
  const vera = { acceso: '' };
  let valida: Buffer;

  function cargar(archivo: Buffer, consulta = '', acceso = jefa.acceso) {
    return request(http)
      .post(`/api/carga-inicial${consulta}`)
      .set('Authorization', `Bearer ${acceso}`)
      .attach('archivo', archivo, 'plantilla-carga-inicial.xlsx');
  }

  function comoJefa(ruta: string) {
    return request(http).get(ruta).set('Authorization', `Bearer ${jefa.acceso}`);
  }

  async function productosCI(): Promise<ProductoCatalogo[]> {
    return (await comoJefa('/api/productos?buscar=CI-&estado=todos').expect(200)).body.productos;
  }

  beforeAll(async () => {
    app = await crearApp();
    http = app.getHttpServer();
    bd = app.get(BaseDatosService);
    const sucursales = await bd.db.selectFrom('sucursal').select(['id', 'codigo']).execute();
    ids.lam = sucursales.find((s) => s.codigo === 'LAM')?.id ?? 0;
    ids.lbr = sucursales.find((s) => s.codigo === 'LBR')?.id ?? 0;
    ids.bod = sucursales.find((s) => s.codigo === 'BOD')?.id ?? 0;
    await crearUsuarioDePrueba(app, {
      nombre: 'Jefa de la carga',
      username: 'jefa.carga',
      password: 'CargaInicial#2026',
      rol: 'ADMIN',
    });
    jefa.acceso = await tokenDeAcceso(app, 'jefa.carga', 'CargaInicial#2026');
    await crearUsuarioDePrueba(app, {
      nombre: 'Vera Carga',
      username: 'vera.carga',
      password: 'Vendedora#2026',
      rol: 'VENDEDOR',
      sucursales: [ids.lam],
    });
    const tablet = await registrarTablet(app, jefa.acceso, 'Tablet de la carga', ids.lam);
    vera.acceso = await tokenDeAcceso(app, 'vera.carga', 'Vendedora#2026', tablet);
    valida = await plantilla(datosValidos);
  });

  afterAll(() => app.close());

  it('por defecto es una simulación: dice qué se crearía y no guarda nada', async () => {
    const { body } = await cargar(valida).expect(200);
    const resultado = body as ResultadoCarga;
    expect(resultado).toMatchObject({
      aplicada: false,
      simulacion: true,
      resumen: {
        categorias: 2,
        perforaciones: 2,
        precios_paquete: 3,
        precios_especiales: 1,
        productos: 2,
        variantes: 3,
        piezas_en_inventario: 23,
        envios: 2, // uno a cada sucursal
        proveedores: 1,
        usuarios: 2,
        promociones: 1,
      },
      usuarios: [], // las contraseñas solo se entregan cuando la carga se aplica
      errores: [],
    });
    // Las filas de ejemplo de la plantilla se omiten, y se avisa lo que conviene revisar
    expect(ubicadas(resultado.avisos)).toEqual([
      'InventarioInicial:2',
      'Perforaciones:2',
      'PreciosEspeciales:2',
      'PreciosPaquete:4',
      'Productos:2',
      'Promociones:2',
      'Proveedores:2',
      'Usuarios:2',
    ]);
    expect(resultado.avisos.find((a) => a.hoja === 'PreciosPaquete')?.mensaje).toBe(
      'Falta el precio de CIY con Acero de lujo: ese paquete no se podrá vender hasta fijarlo',
    );
    expect(resultado.avisos.find((a) => a.hoja === 'InventarioInicial')?.mensaje).toBe(
      'El SKU TIT-LAB-16-6 es la fila de ejemplo de Productos: su inventario no se cargó',
    );

    expect(await productosCI()).toEqual([]);
    const perforaciones = await comoJefa('/api/perforaciones').expect(200);
    expect(
      (perforaciones.body.perforaciones as PerforacionCatalogo[]).map((p) => p.codigo),
    ).not.toContain('CIX');
  });

  it('con errores no se guarda nada, y cada error dice su hoja y su fila', async () => {
    const conErrores = await plantilla(datosValidos, datosConErrores);
    const { body } = await cargar(conErrores, '?aplicar=true').expect(422);
    expect(body).toMatchObject({
      codigo: 'CARGA_CON_ERRORES',
      mensaje: 'La plantilla tiene 6 errores: no se guardó nada. Corríjala y vuelva a cargarla.',
      aplicada: false,
      simulacion: false,
      usuarios: [],
    });
    expect((body as ResultadoCarga).errores).toEqual([
      {
        hoja: 'InventarioInicial',
        fila: 5,
        mensaje: 'El SKU "NO-EXISTE-CI" no está en la hoja Productos de este archivo',
      },
      {
        hoja: 'Productos',
        fila: 6,
        mensaje:
          'El SKU debe tener de 1 a 40 caracteres, sin espacios. El precio debe ser un monto de 0 en adelante, con 2 decimales como máximo',
      },
      {
        hoja: 'Productos',
        fila: 7,
        mensaje: 'El SKU CI-TIT-01 está repetido en la plantilla',
      },
      {
        hoja: 'Productos',
        fila: 8,
        mensaje: 'No existe la categoría "No existe CI" (agréguela en la hoja Categorias)',
      },
      { hoja: 'Promociones', fila: 4, mensaje: 'Un porcentaje no puede pasar de 100' },
      { hoja: 'Usuarios', fila: 5, mensaje: 'No existe el rol "Gerente"' },
    ]);
    // ni lo que estaba bien quedó guardado
    expect(await productosCI()).toEqual([]);
    const usuarios = await comoJefa('/api/usuarios').expect(200);
    expect((usuarios.body.usuarios as UsuarioAdmin[]).map((u) => u.username)).not.toContain(
      'carla.ci',
    );
  });

  describe('con ?aplicar=true', () => {
    let resultado: ResultadoCarga;
    let barra: ProductoCatalogo | undefined;

    it('guarda todo y entrega las contraseñas temporales de los usuarios', async () => {
      resultado = (await cargar(valida, '?aplicar=true').expect(200)).body;
      expect(resultado).toMatchObject({
        aplicada: true,
        simulacion: false,
        resumen: { productos: 2, variantes: 3, usuarios: 2, piezas_en_inventario: 23, envios: 2 },
        errores: [],
      });
      expect(resultado.usuarios).toEqual([
        {
          nombre_completo: 'Carla Ibarra',
          username: 'carla.ci',
          password_temporal: expect.stringMatching(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/),
        },
        {
          nombre_completo: 'Diego Ibarra',
          username: 'diego.ci',
          password_temporal: expect.any(String),
        },
      ]);
    });

    it('productos y variantes quedan como en la plantilla', async () => {
      const productos = await productosCI();
      expect(productos.map((p) => [p.nombre, p.categoria.nombre, p.variantes.length])).toEqual([
        ['Barra CI', 'Barras CI', 2],
        ['Reloj CI', 'Relojes CI', 1],
      ]);
      barra = productos[0];
      expect(barra.variantes.find((v) => v.sku === 'CI-TIT-01')).toMatchObject({
        codigo_barras: '7700000000011',
        nombre: 'Titanio · 6 mm',
        atributos: { material: 'Titanio', calibre: '16G', medida_mm: 6 },
        precio_venta: '700.00',
        costo: '250.00',
        gama: { nombre: 'Titanio' },
        activo: true,
      });
      expect(barra.variantes.find((v) => v.sku === 'CI-TIT-02')).toMatchObject({
        nombre: '8 mm',
        precio_venta: '720.50',
        costo: '0.00',
      });
      expect(productos[1].variantes[0]).toMatchObject({
        nombre: 'Única',
        gama: null,
        costo: '600.00',
      });
    });

    it('perforaciones con su tabla de precios, sus precios especiales y sus piezas permitidas', async () => {
      const { body } = await comoJefa('/api/perforaciones').expect(200);
      const perforaciones = body.perforaciones as PerforacionCatalogo[];
      const industrial = perforaciones.find((p) => p.codigo === 'CIX');
      expect(industrial).toMatchObject({
        nombre: 'Industrial CI',
        precio_servicio: '400.00',
        piezas_por_paquete: 1,
        precios_especiales: [],
      });
      const precio = (p: PerforacionCatalogo | undefined, gama: string) =>
        p?.precios_gama.find((t) => t.gama.nombre === gama)?.precio;
      expect(precio(industrial, 'Acero clásica')).toBe('520.00');
      expect(precio(industrial, 'Acero de lujo')).toBe('620.00');
      // dijo "No" a titanio: solo acepta las dos de acero
      expect(industrial?.piezas_permitidas.map((r) => r.gama?.nombre)).toEqual([
        'Acero clásica',
        'Acero de lujo',
      ]);

      const daith = perforaciones.find((p) => p.codigo === 'CIY');
      expect(precio(daith, 'Acero clásica')).toBe('500.00');
      expect(precio(daith, 'Acero de lujo')).toBeNull();
      expect(daith?.piezas_permitidas).toEqual([]); // acepta cualquier pieza con gama
      expect(daith?.precios_especiales).toEqual([
        expect.objectContaining({
          variante: expect.objectContaining({ sku: 'CI-TIT-01' }),
          precio: '950.00',
          motivo: 'Lanzamiento',
        }),
      ]);
    });

    it('el inventario entra por la bodega y llega a cada sucursal con un envío ya recibido', async () => {
      const titanio = barra?.variantes.find((v) => v.sku === 'CI-TIT-01');
      const { body } = await comoJefa(`/api/variantes/${titanio?.id}/existencias`).expect(200);
      const cantidad = (sucursal: number) =>
        (body.existencias as ExistenciaUbicacion[]).find((e) => e.sucursal_id === sucursal)
          ?.cantidad;
      expect([cantidad(ids.bod), cantidad(ids.lam), cantidad(ids.lbr)]).toEqual([10, 6, 4]);

      const enLam = await comoJefa(
        `/api/inventario/existencias?sucursal_id=${ids.lam}&buscar=CI-TIT-01`,
      ).expect(200);
      expect((enLam.body.existencias as Existencia[])[0]).toMatchObject({
        cantidad: 6,
        stock_minimo: 4,
        valor_costo: '1500.00', // 6 × C$250
      });
      const envios = await comoJefa('/api/envios?estado=RECIBIDO&limite=2').expect(200);
      expect(
        (envios.body.envios as EnvioResumen[]).map((e) => [e.notas, e.destino.codigo, e.faltantes]),
      ).toEqual([
        ['Inventario inicial', 'LBR', 0],
        ['Inventario inicial', 'LAM', 0],
      ]);
    });

    it('proveedores, usuarios y promociones', async () => {
      const proveedores = await comoJefa('/api/proveedores').expect(200);
      expect(proveedores.body.proveedores).toContainEqual(
        expect.objectContaining({
          nombre: 'Proveedor CI',
          pais: 'México',
          moneda_habitual: 'USD',
          email: 'ana@ci.example',
        }),
      );
      const usuarios = (await comoJefa('/api/usuarios').expect(200)).body
        .usuarios as UsuarioAdmin[];
      expect(usuarios.find((u) => u.username === 'carla.ci')).toMatchObject({
        nombre_completo: 'Carla Ibarra',
        rol: { codigo: 'VENDEDOR' },
        sucursales: [{ codigo: 'LBR' }],
        debe_cambiar_password: true,
        telefono: '8888-1111',
      });
      const diego = usuarios.find((u) => u.username === 'diego.ci');
      expect(diego?.rol.codigo).toBe('ENCARGADO');
      expect(diego?.sucursales.map((s) => s.codigo)).toEqual(
        expect.arrayContaining(['LAM', 'LBR']),
      );
      // la contraseña temporal entregada es la que quedó guardada (solo su hash)
      const guardado = await bd.db
        .selectFrom('usuario')
        .select('password_hash')
        .where('username', '=', 'carla.ci')
        .executeTakeFirstOrThrow();
      expect(
        await verificarPassword(resultado.usuarios[0].password_temporal, guardado.password_hash),
      ).toBe(true);

      const promociones = await comoJefa('/api/promociones').expect(200);
      expect(
        (promociones.body.promociones as PromocionAdmin[]).find((p) => p.nombre === 'Promo CI'),
      ).toMatchObject({
        tipo: 'PORCENTAJE',
        valor: '12.00',
        compra_minima: '300.00',
        vigente_desde: '2030-01-01',
        vigente_hasta: '2030-12-31',
        activa: true,
        estado: 'PROGRAMADA',
      });
    });

    it('volver a cargar el mismo archivo no duplica nada', async () => {
      const { body } = await cargar(valida, '?aplicar=true').expect(200);
      const repetida = body as ResultadoCarga;
      expect(repetida).toMatchObject({
        aplicada: true,
        resumen: {
          categorias: 0,
          perforaciones: 0,
          productos: 0,
          variantes: 0,
          piezas_en_inventario: 0,
          envios: 0,
          proveedores: 0,
          usuarios: 0,
          promociones: 0,
          // los precios sí quedan como diga el archivo
          precios_paquete: 3,
          precios_especiales: 1,
        },
        usuarios: [],
        errores: [],
      });
      expect(repetida.avisos.map((a) => a.mensaje)).toEqual(
        expect.arrayContaining([
          'La perforación CIX ya existe: no se modificó',
          'El SKU CI-TIT-01 ya existe: no se modificó',
          'El SKU CI-TIT-01 ya existía en el sistema: su inventario no se cargó',
          'El proveedor "Proveedor CI" ya existe: no se modificó',
          'El usuario carla.ci ya existe: no se modificó',
          'La promoción "Promo CI" ya existe: no se modificó',
        ]),
      );
      const titanio = barra?.variantes.find((v) => v.sku === 'CI-TIT-01');
      const { body: existencias } = await comoJefa(
        `/api/variantes/${titanio?.id}/existencias`,
      ).expect(200);
      expect(
        (existencias.existencias as ExistenciaUbicacion[]).find((e) => e.sucursal_id === ids.bod)
          ?.cantidad,
      ).toBe(10);
    });
  });

  it('archivos que no son la plantilla → 400', async () => {
    await cargar(Buffer.from('nombre,precio\nAro,100')).expect(400).expect({
      codigo: 'ARCHIVO_INVALIDO',
      mensaje: 'El archivo no es un libro de Excel (.xlsx)',
    });
    await request(http)
      .post('/api/carga-inicial')
      .set('Authorization', `Bearer ${jefa.acceso}`)
      .expect(400)
      .expect({
        codigo: 'ARCHIVO_INVALIDO',
        mensaje: 'Adjunte la plantilla de Excel en el campo "archivo"',
      });
    const otroLibro = new ExcelJS.Workbook();
    otroLibro.addWorksheet('Hoja1').addRow(['algo']);
    const otro = await cargar(Buffer.from(await otroLibro.xlsx.writeBuffer())).expect(400);
    expect(otro.body.mensaje).toMatch(/^El archivo no es la plantilla de carga inicial: faltan/);
    const opcion = await cargar(valida, '?aplicar=quizas').expect(400);
    expect(opcion.body.errores).toEqual([
      { campo: 'aplicar', mensaje: 'aplicar debe ser true o false' },
    ]);
  });

  it('solo quien administra el catálogo puede cargar la plantilla', async () => {
    await cargar(valida, '', vera.acceso).expect(403).expect({
      codigo: 'PERMISO_DENEGADO',
      mensaje: 'Permiso denegado: se requiere PRODUCTOS_GESTIONAR',
    });
    await request(http).post('/api/carga-inicial').attach('archivo', valida, 'p.xlsx').expect(401);
  });
});
