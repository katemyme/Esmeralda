import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { BaseDatosService } from '../src/base-datos/base-datos.service';
import type { CompraParaEtiquetas, PiezaEtiqueta } from '../src/etiquetas/etiquetas.service';
import type { ProductoCatalogo } from '../src/productos/productos.service';
import { leerPaginas } from './textos-pdf';
import {
  comoBytes,
  crearApp,
  crearUsuarioDePrueba,
  registrarTablet,
  tokenDeAcceso,
} from './utilidades';

// Etiquetas con QR (F3b): buscar piezas, lo de la bodega y lo de una compra, y el PDF. Usa su propia
// categoría (prefijo ETQ), su proveedor y su compra: las existencias de los datos demo no se tocan.

type Metodo = 'get' | 'post' | 'put';

function hoyEnManagua(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Managua' }).format(new Date());
}

describe('Etiquetas con QR', () => {
  let app: NestExpressApplication;
  let http: App;
  let bd: BaseDatosService;
  const jefa = { acceso: '' };
  const vera = { acceso: '' };
  const ids = { lam: 0, servicio: 0, compra: 0, cancelada: 0, categoria: 0 };
  const pieza = { rojo: 0, azul: 0, verde: 0 };

  function conSesion(metodo: Metodo, ruta: string, acceso: string) {
    return request(http)[metodo](ruta).set('Authorization', `Bearer ${acceso}`);
  }

  function comoJefa(metodo: Metodo, ruta: string) {
    return conSesion(metodo, ruta, jefa.acceso);
  }

  function pdf(cuerpo: object, acceso = jefa.acceso) {
    return conSesion('post', '/api/etiquetas/pdf', acceso)
      .send(cuerpo)
      .buffer(true)
      .parse(comoBytes);
  }

  /** Solo las piezas de estas pruebas (la bodega tiene también las de las otras). */
  const propias = (piezas: PiezaEtiqueta[]) => piezas.filter((p) => p.categoria === 'Llaveros ETQ');

  beforeAll(async () => {
    app = await crearApp();
    http = app.getHttpServer();
    bd = app.get(BaseDatosService);
    const sucursales = await bd.db.selectFrom('sucursal').select(['id', 'codigo']).execute();
    ids.lam = sucursales.find((s) => s.codigo === 'LAM')?.id ?? 0;
    const servicio = await bd.db
      .selectFrom('variante')
      .select('id')
      .where('sku', '=', 'SRV-LOB')
      .executeTakeFirstOrThrow();
    ids.servicio = servicio.id;

    await crearUsuarioDePrueba(app, {
      nombre: 'Jefa de las etiquetas',
      username: 'jefa.etiquetas',
      password: 'Etiquetas#2026',
      rol: 'ADMIN',
    });
    jefa.acceso = await tokenDeAcceso(app, 'jefa.etiquetas', 'Etiquetas#2026');
    await crearUsuarioDePrueba(app, {
      nombre: 'Vera Etiquetas',
      username: 'vera.etiquetas',
      password: 'Vendedora#2026',
      rol: 'VENDEDOR',
      sucursales: [ids.lam],
    });
    const tablet = await registrarTablet(app, jefa.acceso, 'Tablet de las etiquetas', ids.lam);
    vera.acceso = await tokenDeAcceso(app, 'vera.etiquetas', 'Vendedora#2026', tablet);

    // Dos piezas sin código (el sistema les pone ETQ-00001 y ETQ-00002) y una con el de fábrica
    const categoria = await comoJefa('post', '/api/categorias')
      .send({ nombre: 'Llaveros ETQ', prefijo: 'ETQ' })
      .expect(201);
    ids.categoria = categoria.body.categoria.id;
    const producto = await comoJefa('post', '/api/productos')
      .send({
        categoria_id: ids.categoria,
        nombre: 'Llavero ETQ',
        variantes: [
          { nombre: 'Rojo', precio_venta: 150 },
          { nombre: 'Azul', precio_venta: 150 },
          { sku: '7509999000017', nombre: 'Verde', precio_venta: 160 },
        ],
      })
      .expect(201);
    const variantes = (producto.body.producto as ProductoCatalogo).variantes;
    const por = (nombre: string) => variantes.find((v) => v.nombre === nombre);
    expect([por('Rojo')?.sku, por('Azul')?.sku, por('Verde')?.sku]).toEqual([
      'ETQ-00001',
      'ETQ-00002',
      '7509999000017',
    ]);
    pieza.rojo = por('Rojo')?.id ?? 0;
    pieza.azul = por('Azul')?.id ?? 0;
    pieza.verde = por('Verde')?.id ?? 0;

    // Una compra que entra a la bodega (de los rojos llegaron 8 de 10) y otra cancelada
    const proveedor = await comoJefa('post', '/api/proveedores')
      .send({ nombre: 'Proveedor ETQ', moneda_habitual: 'NIO' })
      .expect(201);
    const compra = await comoJefa('post', '/api/compras')
      .send({
        proveedor_id: proveedor.body.proveedor.id,
        factura_numero: 'ETQ-001',
        fecha_factura: hoyEnManagua(),
        moneda: 'NIO',
        lineas: [
          {
            variante_id: pieza.rojo,
            cantidad_facturada: 10,
            cantidad_recibida: 8,
            costo_unitario: 40,
          },
          { variante_id: pieza.azul, cantidad_facturada: 5, costo_unitario: 40 },
        ],
      })
      .expect(201);
    ids.compra = compra.body.compra.id;
    await comoJefa('post', `/api/compras/${ids.compra}/confirmar`).expect(200);
    const otra = await comoJefa('post', '/api/compras')
      .send({
        proveedor_id: proveedor.body.proveedor.id,
        factura_numero: 'ETQ-002',
        fecha_factura: hoyEnManagua(),
        moneda: 'NIO',
        lineas: [{ variante_id: pieza.verde, cantidad_facturada: 3, costo_unitario: 50 }],
      })
      .expect(201);
    ids.cancelada = otra.body.compra.id;
    await comoJefa('post', `/api/compras/${ids.cancelada}/cancelar`)
      .send({ motivo: 'Factura repetida' })
      .expect(200);
  });

  afterAll(() => app.close());

  it('sin sesión → 401; solo quien administra el catálogo (el administrador) → 403 a los demás', async () => {
    await request(http).get('/api/etiquetas/bodega').expect(401);
    for (const ruta of [
      '/api/etiquetas/bodega',
      '/api/etiquetas/compras',
      '/api/etiquetas/piezas?texto=etq',
    ]) {
      await conSesion('get', ruta, vera.acceso).expect(403).expect({
        codigo: 'PERMISO_DENEGADO',
        mensaje: 'Permiso denegado: se requiere PRODUCTOS_GESTIONAR',
      });
    }
    await pdf(
      { formato: 'ROLLO', piezas: [{ variante_id: pieza.rojo, copias: 1 }] },
      vera.acceso,
    ).expect(403);
  });

  it('GET /api/etiquetas/piezas busca por código, nombre o código de fábrica (sin perforaciones)', async () => {
    const porCodigo = await comoJefa('get', '/api/etiquetas/piezas?texto=etq-00001').expect(200);
    expect(porCodigo.body.piezas).toEqual([
      {
        variante_id: pieza.rojo,
        codigo: 'ETQ-00001',
        producto: 'Llavero ETQ',
        variante: 'Rojo',
        categoria: 'Llaveros ETQ',
        nombre: 'Llavero ETQ · Rojo',
        cantidad: 8, // lo que hay en la bodega
      },
    ]);
    const porNombre = await comoJefa('get', '/api/etiquetas/piezas?texto=llavero%20etq').expect(
      200,
    );
    expect((porNombre.body.piezas as PiezaEtiqueta[]).map((p) => p.codigo).sort()).toEqual([
      '7509999000017',
      'ETQ-00001',
      'ETQ-00002',
    ]);
    const deFabrica = await comoJefa('get', '/api/etiquetas/piezas?texto=7509999000017').expect(
      200,
    );
    expect(deFabrica.body.piezas).toMatchObject([{ codigo: '7509999000017', cantidad: 0 }]);
    const perforacion = await comoJefa('get', '/api/etiquetas/piezas?texto=SRV-LOB').expect(200);
    expect(perforacion.body.piezas).toEqual([]);
    const vacia = await comoJefa('get', '/api/etiquetas/piezas?texto=').expect(400);
    expect(vacia.body.errores).toEqual([
      { campo: 'texto', mensaje: 'Escriba o escanee lo que busca (texto)' },
    ]);
  });

  it('GET /api/etiquetas/bodega: lo que hay en la bodega, con sus existencias como copias', async () => {
    const { body } = await comoJefa('get', '/api/etiquetas/bodega').expect(200);
    // por categoría, producto y variante; la verde no tiene existencias
    expect(propias(body.piezas).map((p) => [p.codigo, p.nombre, p.cantidad])).toEqual([
      ['ETQ-00002', 'Llavero ETQ · Azul', 5],
      ['ETQ-00001', 'Llavero ETQ · Rojo', 8],
    ]);
    expect((body.piezas as PiezaEtiqueta[]).every((p) => (p.cantidad ?? 0) > 0)).toBe(true);
  });

  it('GET /api/etiquetas/compras y /compras/:id: lo que entró con la compra (lo recibido)', async () => {
    const { body } = await comoJefa('get', '/api/etiquetas/compras').expect(200);
    const compras = body.compras as CompraParaEtiquetas[];
    expect(compras.find((c) => c.id === ids.compra)).toEqual({
      id: ids.compra,
      proveedor: 'Proveedor ETQ',
      factura_numero: 'ETQ-001',
      fecha_factura: hoyEnManagua(),
      estado: 'CONFIRMADA',
      piezas: 13,
    });
    expect(compras.map((c) => c.id)).not.toContain(ids.cancelada);

    const detalle = await comoJefa('get', `/api/etiquetas/compras/${ids.compra}`).expect(200);
    expect(detalle.body.compra.factura_numero).toBe('ETQ-001');
    expect(
      (detalle.body.piezas as PiezaEtiqueta[]).map((p) => [p.codigo, p.nombre, p.cantidad]),
    ).toEqual([
      ['ETQ-00002', 'Llavero ETQ · Azul', 5],
      ['ETQ-00001', 'Llavero ETQ · Rojo', 8], // de 10 facturados llegaron 8
    ]);
    for (const id of [ids.cancelada, 999999]) {
      await comoJefa('get', `/api/etiquetas/compras/${id}`)
        .expect(404)
        .expect({ codigo: 'NO_ENCONTRADO', mensaje: `La compra ${id} no existe` });
    }
  });

  it('con el catálogo pero sin las compras ni la cantidad de la bodega: solo lo que le toca', async () => {
    const { permisos } = await bd.db
      .selectFrom('v_roles_admin')
      .select('permisos')
      .where('codigo', '=', 'VENDEDOR')
      .$castTo<{ permisos: string[] }>()
      .executeTakeFirstOrThrow();
    const ponerPermisos = (lista: string[]) =>
      comoJefa('put', '/api/roles/VENDEDOR/permisos').send({ permisos: lista }).expect(200);
    await ponerPermisos([...permisos, 'PRODUCTOS_GESTIONAR']);
    try {
      // de la bodega solo sabe si hay (parámetro BODEGA_VISIBILIDAD en SI_NO)
      const { body } = await conSesion('get', '/api/etiquetas/bodega', vera.acceso).expect(200);
      expect(propias(body.piezas).map((p) => [p.codigo, p.cantidad])).toEqual([
        ['ETQ-00002', null],
        ['ETQ-00001', null],
      ]);
      await conSesion('get', '/api/etiquetas/compras', vera.acceso).expect(403).expect({
        codigo: 'PERMISO_DENEGADO',
        mensaje: 'Permiso denegado: se requiere INVENTARIO_ENTRADA',
      });
      await conSesion('get', `/api/etiquetas/compras/${ids.compra}`, vera.acceso).expect(403);
    } finally {
      await ponerPermisos(permisos); // las otras pruebas esperan los permisos del seed
    }
  });

  it('POST /api/etiquetas/pdf ROLLO: una por página, del tamaño elegido, cada pieza con sus copias', async () => {
    const respuesta = await pdf({
      formato: 'ROLLO',
      piezas: [
        { variante_id: pieza.rojo, copias: 2 },
        { variante_id: pieza.verde, copias: 1 },
      ],
      rollo: { ancho: 50, alto: 30 },
    }).expect(200);
    expect(respuesta.headers['content-type']).toBe('application/pdf');
    expect(respuesta.headers['content-disposition']).toBe('inline; filename="etiquetas.pdf"');
    const paginas = leerPaginas(respuesta.body as Buffer);
    expect(paginas.map((p) => [Math.round(p.ancho), Math.round(p.alto)])).toEqual([
      [50, 30],
      [50, 30],
      [50, 30],
    ]);
    expect(paginas.map((p) => p.textos[0].texto)).toEqual([
      'ETQ-00001',
      'ETQ-00001',
      '7509999000017', // el de fábrica se queda como está: su etiqueta lleva ese mismo código
    ]);
    expect(paginas[0].textos.slice(1).map((t) => t.texto)).toEqual(['Llavero ETQ · Rojo']);
    // sin precio
    expect(paginas.flatMap((p) => p.textos.map((t) => t.texto)).join(' ')).not.toMatch(/C\$|150/);
  });

  it('POST /api/etiquetas/pdf HOJA: carta con la cuadrícula (por defecto, 30 por hoja)', async () => {
    const respuesta = await pdf({
      formato: 'HOJA',
      piezas: [
        { variante_id: pieza.azul, copias: 5 },
        { variante_id: pieza.rojo, copias: 8 },
      ],
      hoja: { saltar: 20 },
    }).expect(200);
    const paginas = leerPaginas(respuesta.body as Buffer);
    expect(paginas.map((p) => [p.ancho.toFixed(1), p.alto.toFixed(1)])).toEqual([
      ['215.9', '279.4'],
      ['215.9', '279.4'],
    ]);
    const codigos = paginas.map((p) =>
      p.textos.filter((t) => t.fuente === 'Helvetica-Bold').map((t) => t.texto),
    );
    // con 20 ya usadas quedan 10 en la primera hoja: las otras 3 van en la segunda
    expect(codigos[0]).toEqual([...Array(5).fill('ETQ-00002'), ...Array(5).fill('ETQ-00001')]);
    expect(codigos[1]).toEqual(Array(3).fill('ETQ-00001'));
  });

  it('POST /api/etiquetas/pdf: datos que no sirven → 400; piezas que no existen o perforaciones → error', async () => {
    const sinPiezas = await pdf({ formato: 'HOJA', piezas: [] }).expect(400);
    expect(sinPiezas.body.toString()).toContain('Elija al menos una pieza');

    const mal = await conSesion('post', '/api/etiquetas/pdf', jefa.acceso)
      .send({
        formato: 'CARTA',
        piezas: [
          { variante_id: pieza.rojo, copias: 0 },
          { variante_id: pieza.rojo, copias: 2 },
        ],
        hoja: { columnas: 4, ancho: 60, saltar: 40 },
        rollo: { ancho: 5 },
      })
      .expect(400);
    expect(mal.body.errores).toEqual(
      expect.arrayContaining([
        { campo: 'formato', mensaje: 'El formato es HOJA (carta) o ROLLO (una por página)' },
        { campo: 'piezas.0.copias', mensaje: 'Copias: un número entero de 1 a 500' },
        {
          campo: 'hoja.columnas',
          mensaje: 'Las columnas no caben a lo ancho de la hoja carta: ocupan 254.4 mm de 215.9',
        },
        { campo: 'hoja.saltar', mensaje: 'La hoja tiene 40 etiquetas: no se pueden saltar 40' },
        { campo: 'rollo.ancho', mensaje: 'Ancho de la etiqueta: de 15 a 110 mm' },
      ]),
    );

    const repetida = await conSesion('post', '/api/etiquetas/pdf', jefa.acceso)
      .send({
        formato: 'ROLLO',
        piezas: [
          { variante_id: pieza.rojo, copias: 1 },
          { variante_id: pieza.rojo, copias: 2 },
        ],
      })
      .expect(400);
    expect(repetida.body.errores).toEqual([
      {
        campo: 'piezas',
        mensaje: 'Una pieza aparece dos veces: ponga todas sus copias en una sola',
      },
    ]);

    await conSesion('post', '/api/etiquetas/pdf', jefa.acceso)
      .send({ formato: 'ROLLO', piezas: [{ variante_id: 999999, copias: 1 }] })
      .expect(404)
      .expect({ codigo: 'NO_ENCONTRADO', mensaje: 'La pieza 999999 no existe' });
    const perforacion = await conSesion('post', '/api/etiquetas/pdf', jefa.acceso)
      .send({ formato: 'ROLLO', piezas: [{ variante_id: ids.servicio, copias: 1 }] })
      .expect(422);
    expect(perforacion.body).toMatchObject({
      codigo: 'REGLA_NEGOCIO',
      mensaje: expect.stringMatching(/es una perforación: las perforaciones no llevan etiqueta$/),
    });
  });
});
