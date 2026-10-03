import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync, readdirSync } from 'node:fs';
import request from 'supertest';
import type { App } from 'supertest/types';
import { BaseDatosService } from '../src/base-datos/base-datos.service';
import type { CategoriaCatalogo } from '../src/categorias/categorias.service';
import type { GamaCatalogo } from '../src/gamas/gamas.service';
import type { PerforacionCatalogo } from '../src/perforaciones/perforaciones.service';
import type {
  CambioPrecio,
  ExistenciaUbicacion,
  ProductoCatalogo,
  VarianteEncontrada,
} from '../src/productos/productos.service';
import type { PromocionAdmin, PromocionDisponible } from '../src/promociones/promociones.service';
import { crearApp, crearUsuarioDePrueba, registrarTablet, tokenDeAcceso } from './utilidades';

// Recorrido completo de B4 (catálogo) contra la base de pruebas. Las pruebas van en orden y
// comparten estado. Usan actores propios (una administradora y una vendedora) y crean sus propias
// categorías, gamas, productos, perforación y promoción: de los datos demo solo leen.

type Metodo = 'get' | 'post' | 'put' | 'delete';

describe('Catálogo', () => {
  let app: NestExpressApplication;
  let http: App;
  let bd: BaseDatosService;
  const ids = { jefa: 0, lam: 0, clasica: 0, lujo: 0, titanio: 0 };
  /** Variantes de los datos demo, por SKU. */
  const demo = { aro: 0, piedra: 0, labret6: 0, labret8: 0, neilmed: 0 };
  const jefa = { acceso: '' };
  const vera = { acceso: '' };
  // Lo que van creando las pruebas
  const propio = {
    categoria: 0,
    gama: 0,
    reloj: 0,
    relojPlateado: 0,
    relojDorado: 0,
    perforacion: 0,
    promocion: 0,
  };

  function conSesion(metodo: Metodo, ruta: string, acceso: string) {
    return request(http)[metodo](ruta).set('Authorization', `Bearer ${acceso}`);
  }

  /** Atajo: la administradora de estas pruebas. */
  function comoJefa(metodo: Metodo, ruta: string) {
    return conSesion(metodo, ruta, jefa.acceso);
  }

  async function listarProductos(
    consulta: string,
  ): Promise<{ productos: ProductoCatalogo[]; total: number }> {
    return (await comoJefa('get', `/api/productos${consulta}`).expect(200)).body;
  }

  async function perforacion(id: number): Promise<PerforacionCatalogo> {
    return (await comoJefa('get', `/api/perforaciones/${id}`).expect(200)).body.perforacion;
  }

  function precioPaquete(perforacionId: number, piezas: number[]) {
    return comoJefa('get', `/api/perforaciones/${perforacionId}/precio-paquete?piezas=${piezas}`);
  }

  beforeAll(async () => {
    app = await crearApp();
    http = app.getHttpServer();
    bd = app.get(BaseDatosService);

    const lam = await bd.db
      .selectFrom('sucursal')
      .select('id')
      .where('codigo', '=', 'LAM')
      .executeTakeFirstOrThrow();
    ids.lam = lam.id;
    const gamas = await bd.db.selectFrom('gama').select(['id', 'nombre']).execute();
    const gama = (nombre: string) => gamas.find((g) => g.nombre === nombre)?.id ?? 0;
    ids.clasica = gama('Acero clásica');
    ids.lujo = gama('Acero de lujo');
    ids.titanio = gama('Titanio');
    const variantes = await bd.db.selectFrom('variante').select(['id', 'sku']).execute();
    const variante = (sku: string) => variantes.find((v) => v.sku === sku)?.id ?? 0;
    demo.aro = variante('ACE-ARO-16-8');
    demo.piedra = variante('ACE-LAB-PDR');
    demo.labret6 = variante('TIT-LAB-16-6');
    demo.labret8 = variante('TIT-LAB-16-8');
    demo.neilmed = variante('NEI-AFT-177');

    ids.jefa = await crearUsuarioDePrueba(app, {
      nombre: 'Jefa del catálogo',
      username: 'jefa.catalogo',
      password: 'Catalogo#2026',
      rol: 'ADMIN',
    });
    jefa.acceso = await tokenDeAcceso(app, 'jefa.catalogo', 'Catalogo#2026');
    await crearUsuarioDePrueba(app, {
      nombre: 'Vera Vendedora',
      username: 'vera.catalogo',
      password: 'Vendedora#2026',
      rol: 'VENDEDOR',
      sucursales: [ids.lam],
    });
    const tablet = await registrarTablet(app, jefa.acceso, 'Tablet del catálogo', ids.lam);
    vera.acceso = await tokenDeAcceso(app, 'vera.catalogo', 'Vendedora#2026', tablet);
  });

  afterAll(() => app.close());

  it('sin sesión → 401 en las rutas del catálogo', async () => {
    for (const ruta of ['categorias', 'gamas', 'productos', 'perforaciones', 'promociones']) {
      await request(http).get(`/api/${ruta}`).expect(401);
    }
  });

  describe('categorías', () => {
    it('GET /api/categorias: todas, con cuántos productos tiene cada una', async () => {
      const { body } = await comoJefa('get', '/api/categorias').expect(200);
      const categorias = body.categorias as CategoriaCatalogo[];
      const nombres = categorias.map((c) => c.nombre);
      expect(nombres).toEqual([...nombres].sort((a, b) => a.localeCompare(b, 'es')));
      expect(categorias.find((c) => c.nombre === 'Piercing titanio')).toMatchObject({
        descripcion: 'Joyería de titanio ASTM F-136',
        activa: true,
        productos: 1,
      });
      expect(categorias.find((c) => c.nombre === 'Perfumería')?.productos).toBe(0);
    });

    it('POST /api/categorias crea la categoría', async () => {
      const { body } = await comoJefa('post', '/api/categorias')
        .send({ nombre: ' Relojes B4 ', descripcion: '  ' })
        .expect(201);
      expect(body.categoria).toEqual({
        id: expect.any(Number),
        nombre: 'Relojes B4',
        descripcion: null,
        activa: true,
        productos: 0,
      });
      propio.categoria = body.categoria.id;
    });

    it('nombre repetido → 409; datos inválidos → 400', async () => {
      const repetida = await comoJefa('post', '/api/categorias')
        .send({ nombre: 'Relojes B4' })
        .expect(409);
      expect(repetida.body).toMatchObject({
        codigo: 'DUPLICADO',
        restriccion: 'categoria_nombre_key',
      });
      const invalida = await comoJefa('post', '/api/categorias').send({ nombre: 'R' }).expect(400);
      expect(invalida.body.errores).toEqual([
        { campo: 'nombre', mensaje: 'El nombre de la categoría debe tener al menos 2 caracteres' },
      ]);
    });

    it('PUT /api/categorias/:id la edita y /activa la desactiva o reactiva', async () => {
      const editada = await comoJefa('put', `/api/categorias/${propio.categoria}`)
        .send({ nombre: 'Relojes y pulseras B4', descripcion: 'Relojes de pulsera' })
        .expect(200);
      expect(editada.body.categoria).toMatchObject({
        id: propio.categoria,
        nombre: 'Relojes y pulseras B4',
        descripcion: 'Relojes de pulsera',
      });
      const inactiva = await comoJefa('put', `/api/categorias/${propio.categoria}/activa`)
        .send({ activa: false })
        .expect(200);
      expect(inactiva.body.categoria.activa).toBe(false);
    });

    it('reglas de la base: "Perforaciones" es del sistema; la categoría debe existir', async () => {
      const { body } = await comoJefa('get', '/api/categorias').expect(200);
      const perforaciones = (body.categorias as CategoriaCatalogo[]).find(
        (c) => c.nombre === 'Perforaciones',
      );
      await comoJefa('put', `/api/categorias/${perforaciones?.id}`)
        .send({ nombre: 'Piercings' })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: 'La categoría "Perforaciones" es del sistema: no se puede renombrar',
        });
      await comoJefa('put', `/api/categorias/${perforaciones?.id}/activa`)
        .send({ activa: false })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: 'La categoría "Perforaciones" es del sistema: no se puede desactivar',
        });
      await comoJefa('put', '/api/categorias/999999')
        .send({ nombre: 'Nada' })
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: 'La categoría 999999 no existe' });
    });
  });

  describe('gamas', () => {
    it('GET /api/gamas: en su orden, con el modo de precio y cuántas piezas tiene cada una', async () => {
      const { body } = await comoJefa('get', '/api/gamas').expect(200);
      expect((body.gamas as GamaCatalogo[]).slice(0, 3)).toEqual([
        {
          id: ids.clasica,
          nombre: 'Acero clásica',
          modo_precio: 'TABLA',
          orden: 1,
          activa: true,
          piezas: 1,
        },
        {
          id: ids.lujo,
          nombre: 'Acero de lujo',
          modo_precio: 'TABLA',
          orden: 2,
          activa: true,
          piezas: 1,
        },
        {
          id: ids.titanio,
          nombre: 'Titanio',
          modo_precio: 'PIEZA',
          orden: 3,
          activa: true,
          piezas: 2,
        },
      ]);
    });

    it('POST /api/gamas crea la gama; sin uso todavía, puede cambiar de modo de precio', async () => {
      const creada = await comoJefa('post', '/api/gamas')
        .send({ nombre: ' Oro B4 ', modo_precio: 'pieza', orden: 9 })
        .expect(201);
      expect(creada.body.gama).toEqual({
        id: expect.any(Number),
        nombre: 'Oro B4',
        modo_precio: 'PIEZA',
        orden: 9,
        activa: true,
        piezas: 0,
      });
      propio.gama = creada.body.gama.id;

      const editada = await comoJefa('put', `/api/gamas/${propio.gama}`)
        .send({ nombre: 'Oro 14k B4', modo_precio: 'TABLA', orden: 9 })
        .expect(200);
      expect(editada.body.gama).toMatchObject({ nombre: 'Oro 14k B4', modo_precio: 'TABLA' });
    });

    it('una gama en uso no cambia de modo de precio (regla de la base)', async () => {
      await comoJefa('put', `/api/gamas/${ids.titanio}`)
        .send({ nombre: 'Titanio', modo_precio: 'TABLA', orden: 3 })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje:
            'La gama "Titanio" ya tiene piezas o precios: no se puede cambiar su modo de precio',
        });
    });

    it('nombre repetido → 409; modo inválido → 400; gama inexistente → error de la base', async () => {
      await comoJefa('post', '/api/gamas')
        .send({ nombre: 'Titanio', modo_precio: 'PIEZA' })
        .expect(409);
      const invalida = await comoJefa('post', '/api/gamas')
        .send({ nombre: 'Rara B4', modo_precio: 'otro' })
        .expect(400);
      expect(invalida.body.errores).toEqual([
        { campo: 'modo_precio', mensaje: 'El modo de precio debe ser TABLA o PIEZA' },
      ]);
      await comoJefa('put', '/api/gamas/999999/activa')
        .send({ activa: false })
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: 'La gama 999999 no existe' });
    });

    it('PUT /api/gamas/:id/activa la desactiva y la reactiva', async () => {
      const inactiva = await comoJefa('put', `/api/gamas/${propio.gama}/activa`)
        .send({ activa: false })
        .expect(200);
      expect(inactiva.body.gama.activa).toBe(false);
      const activa = await comoJefa('put', `/api/gamas/${propio.gama}/activa`)
        .send({ activa: true })
        .expect(200);
      expect(activa.body.gama.activa).toBe(true);
    });
  });

  describe('productos y variantes', () => {
    const reloj = {
      nombre: ' Reloj clásico B4 ',
      descripcion: 'Correa de cuero',
      variantes: [
        { sku: 'rel-b4-01', nombre: 'Plateado', precio_venta: 900 },
        {
          sku: 'REL-B4-02',
          nombre: 'Dorado',
          precio_venta: '1100.50',
          costo: 400,
          codigo_barras: '7509990000444',
          atributos: { color: 'dorado', correa_mm: 18 },
          foto_url: 'https://ejemplo.com/reloj-dorado.jpg',
        },
      ],
    };

    it('una categoría inactiva no admite productos nuevos (regla de la base)', async () => {
      await comoJefa('post', '/api/productos')
        .send({ ...reloj, categoria_id: propio.categoria })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: 'La categoría "Relojes y pulseras B4" está inactiva',
        });
      await comoJefa('put', `/api/categorias/${propio.categoria}/activa`)
        .send({ activa: true })
        .expect(200);
    });

    it('POST /api/productos crea el producto con sus variantes', async () => {
      const { body } = await comoJefa('post', '/api/productos')
        .send({ ...reloj, categoria_id: propio.categoria })
        .expect(201);
      const producto = body.producto as ProductoCatalogo;
      expect(producto).toEqual({
        id: expect.any(Number),
        nombre: 'Reloj clásico B4',
        descripcion: 'Correa de cuero',
        tipo: 'PRODUCTO',
        categoria: { id: propio.categoria, nombre: 'Relojes y pulseras B4' },
        activo: true,
        variantes: [
          {
            id: expect.any(Number),
            sku: 'REL-B4-02',
            codigo_barras: '7509990000444',
            nombre: 'Dorado',
            atributos: { color: 'dorado', correa_mm: 18 },
            precio_venta: '1100.50',
            costo: '400.00',
            gama: null,
            foto_url: 'https://ejemplo.com/reloj-dorado.jpg',
            activo: true,
          },
          {
            id: expect.any(Number),
            sku: 'REL-B4-01',
            codigo_barras: null,
            nombre: 'Plateado',
            atributos: {},
            precio_venta: '900.00',
            costo: '0.00',
            gama: null,
            foto_url: null,
            activo: true,
          },
        ],
      });
      propio.reloj = producto.id;
      [propio.relojDorado, propio.relojPlateado] = producto.variantes.map((v) => v.id);

      const auditoria = await bd.db
        .selectFrom('auditoria')
        .select(['accion', 'usuario_id'])
        .where('tabla', '=', 'producto')
        .where('registro_id', '=', String(propio.reloj))
        .executeTakeFirstOrThrow();
      expect(auditoria).toEqual({ accion: 'INSERT', usuario_id: ids.jefa });
    });

    it('si una variante falla, no se crea nada (ni el producto)', async () => {
      const { body } = await comoJefa('post', '/api/productos')
        .send({
          categoria_id: propio.categoria,
          nombre: 'Reloj fallido B4',
          variantes: [
            { sku: 'REL-B4-90', precio_venta: 100 },
            { sku: 'REL-B4-01', precio_venta: 100 }, // SKU que ya existe
          ],
        })
        .expect(409);
      expect(body).toMatchObject({ codigo: 'DUPLICADO', restriccion: 'variante_sku_key' });
      expect((await listarProductos('?buscar=fallido&estado=todos')).total).toBe(0);
      expect((await listarProductos('?buscar=REL-B4-90&estado=todos')).total).toBe(0);
    });

    it('datos inválidos → 400 con el error de cada campo; categoría inexistente → error de la base', async () => {
      const { body } = await comoJefa('post', '/api/productos')
        .send({
          nombre: 'R',
          variantes: [{ sku: 'REL 99', precio_venta: 10.999, foto_url: 'javascript:alert(1)' }],
        })
        .expect(400);
      expect(body.errores.map((e: { campo: string }) => e.campo)).toEqual([
        'categoria_id',
        'nombre',
        'variantes.0.sku',
        'variantes.0.precio_venta',
        'variantes.0.foto_url',
      ]);
      await comoJefa('post', '/api/productos')
        .send({ categoria_id: 999_999, nombre: 'Sin categoría B4' })
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: 'La categoría 999999 no existe' });
    });

    it('GET /api/productos busca por nombre, SKU o código de barras', async () => {
      for (const texto of ['clásico b4', 'rel-b4-01', '7509990000444', 'dorado']) {
        const { productos, total } = await listarProductos(
          `?buscar=${encodeURIComponent(texto)}&categoria_id=${propio.categoria}`,
        );
        expect(total).toBe(1);
        expect(productos[0].id).toBe(propio.reloj);
        expect(productos[0].variantes).toHaveLength(2); // siempre el producto completo
      }
      // los comodines se buscan como texto: no traen todo el catálogo
      expect((await listarProductos('?buscar=%25')).total).toBe(0);
      expect((await listarProductos('?buscar=_')).total).toBe(0);
    });

    it('GET /api/productos filtra por categoría, tipo y estado, y pagina', async () => {
      for (const nombre of ['Reloj deportivo B4', 'Reloj de bolsillo B4']) {
        await comoJefa('post', '/api/productos')
          .send({ categoria_id: propio.categoria, nombre })
          .expect(201);
      }
      const filtro = `?categoria_id=${propio.categoria}`;
      const todos = await listarProductos(filtro);
      expect(todos.total).toBe(3);
      expect(todos.productos.map((p) => p.nombre)).toEqual([
        'Reloj clásico B4',
        'Reloj de bolsillo B4',
        'Reloj deportivo B4',
      ]);
      const pagina1 = await listarProductos(`${filtro}&limite=2`);
      expect(pagina1.total).toBe(3);
      expect(pagina1.productos.map((p) => p.nombre)).toEqual([
        'Reloj clásico B4',
        'Reloj de bolsillo B4',
      ]);
      const pagina2 = await listarProductos(`${filtro}&limite=2&desplazamiento=2`);
      expect(pagina2.productos.map((p) => p.nombre)).toEqual(['Reloj deportivo B4']);

      const deportivo = todos.productos[2];
      await comoJefa('put', `/api/productos/${deportivo.id}/activo`)
        .send({ activo: false })
        .expect(200);
      expect((await listarProductos(filtro)).total).toBe(2); // por defecto, solo los activos
      const inactivos = await listarProductos(`${filtro}&estado=inactivos`);
      expect(inactivos.productos.map((p) => p.nombre)).toEqual(['Reloj deportivo B4']);
      expect((await listarProductos(`${filtro}&estado=todos`)).total).toBe(3);

      // las perforaciones también están en el catálogo: el servicio tiene precio, el paquete no
      const servicios = await listarProductos('?tipo=servicio&buscar=Hélix');
      expect(servicios.productos.map((p) => [p.nombre, p.variantes[0].precio_venta])).toEqual([
        ['Perforación Hélix', '350.00'],
      ]);
      const paquetes = await listarProductos('?tipo=PAQUETE&buscar=Hélix');
      expect(paquetes.productos.map((p) => [p.nombre, p.variantes[0].precio_venta])).toEqual([
        ['Perforación Hélix con pieza', null],
      ]);

      const invalido = await comoJefa('get', '/api/productos?tipo=combo&limite=0').expect(400);
      expect(invalido.body.errores.map((e: { campo: string }) => e.campo)).toEqual([
        'tipo',
        'limite',
      ]);
    });

    it('la vendedora consulta el catálogo, pero no ve costos ni puede cambiarlo', async () => {
      const { body } = await conSesion('get', `/api/productos/${propio.reloj}`, vera.acceso).expect(
        200,
      );
      const variantes = (body.producto as ProductoCatalogo).variantes;
      expect(variantes.map((v) => v.precio_venta)).toEqual(['1100.50', '900.00']);
      expect(variantes.map((v) => v.costo)).toEqual([null, null]);
      const lista = await conSesion('get', '/api/productos?buscar=labret', vera.acceso).expect(200);
      expect(
        (lista.body.productos as ProductoCatalogo[]).flatMap((p) =>
          p.variantes.map((v) => v.costo),
        ),
      ).toEqual([null, null, null]);

      const rutas: [Metodo, string, string][] = [
        ['post', '/api/productos', 'PRODUCTOS_GESTIONAR'],
        ['put', `/api/productos/${propio.reloj}`, 'PRODUCTOS_GESTIONAR'],
        ['put', `/api/productos/${propio.reloj}/activo`, 'PRODUCTOS_GESTIONAR'],
        ['post', `/api/productos/${propio.reloj}/variantes`, 'PRODUCTOS_GESTIONAR'],
        ['put', `/api/variantes/${propio.relojDorado}`, 'PRODUCTOS_GESTIONAR'],
        ['put', `/api/variantes/${propio.relojDorado}/precio`, 'PRECIOS_EDITAR'],
        ['put', `/api/variantes/${propio.relojDorado}/activo`, 'PRODUCTOS_GESTIONAR'],
        ['post', '/api/categorias', 'PRODUCTOS_GESTIONAR'],
        ['put', `/api/categorias/${propio.categoria}/activa`, 'PRODUCTOS_GESTIONAR'],
        ['post', '/api/gamas', 'PRODUCTOS_GESTIONAR'],
        ['put', `/api/gamas/${propio.gama}`, 'PRODUCTOS_GESTIONAR'],
      ];
      for (const [metodo, ruta, permiso] of rutas) {
        await conSesion(metodo, ruta, vera.acceso)
          .expect(403)
          .expect({
            codigo: 'PERMISO_DENEGADO',
            mensaje: `Permiso denegado: se requiere ${permiso}`,
          });
      }
    });

    it('GET /api/productos/:id → 404 si no existe', async () => {
      await comoJefa('get', '/api/productos/999999').expect(404).expect({
        codigo: 'NO_ENCONTRADO',
        mensaje: 'El producto 999999 no existe',
      });
    });

    it('PUT /api/productos/:id cambia nombre, descripción y categoría', async () => {
      const { body } = await comoJefa('put', `/api/productos/${propio.reloj}`)
        .send({ categoria_id: propio.categoria, nombre: 'Reloj clásico dama B4' })
        .expect(200);
      expect(body.producto).toMatchObject({
        id: propio.reloj,
        nombre: 'Reloj clásico dama B4',
        descripcion: null,
      });
      expect(body.producto.variantes).toHaveLength(2);
    });

    it('las perforaciones no se editan como productos (regla de la base)', async () => {
      const { productos } = await listarProductos('?tipo=SERVICIO&buscar=Lóbulo');
      const servicio = productos[0];
      const mensaje =
        'Las perforaciones (servicios y paquetes) se editan desde la pantalla de perforaciones';
      await comoJefa('put', `/api/productos/${servicio.id}`)
        .send({ categoria_id: propio.categoria, nombre: 'Otra cosa' })
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje });
      await comoJefa('post', `/api/productos/${servicio.id}/variantes`)
        .send({ sku: 'SRV-B4', precio_venta: 100 })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: 'Las variantes de una perforación las crea el sistema: no se agregan a mano',
        });
    });

    it('POST /api/productos/:id/variantes agrega una variante', async () => {
      const { body } = await comoJefa('post', `/api/productos/${propio.reloj}/variantes`)
        .send({ sku: 'REL-B4-03', precio_venta: 1250 })
        .expect(201);
      const nueva = (body.producto as ProductoCatalogo).variantes.find(
        (v) => v.sku === 'REL-B4-03',
      );
      expect(nueva).toMatchObject({ nombre: 'Única', precio_venta: '1250.00', costo: '0.00' });
      expect(body.producto.variantes).toHaveLength(3);
      await comoJefa('post', '/api/productos/999999/variantes')
        .send({ sku: 'REL-B4-04', precio_venta: 1 })
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: 'El producto 999999 no existe' });
    });

    it('PUT /api/variantes/:id edita la variante sin tocar su precio', async () => {
      const { body } = await comoJefa('put', `/api/variantes/${propio.relojPlateado}`)
        .send({
          sku: 'rel-b4-01p',
          nombre: 'Plateado mate',
          codigo_barras: '7509990000555',
          gama_id: ids.titanio,
          atributos: { color: 'plateado' },
        })
        .expect(200);
      expect(
        (body.producto as ProductoCatalogo).variantes.find((v) => v.id === propio.relojPlateado),
      ).toEqual({
        id: propio.relojPlateado,
        sku: 'REL-B4-01P',
        codigo_barras: '7509990000555',
        nombre: 'Plateado mate',
        atributos: { color: 'plateado' },
        precio_venta: '900.00',
        costo: '0.00',
        gama: { id: ids.titanio, nombre: 'Titanio' },
        foto_url: null,
        activo: true,
      });

      const sinGama = await comoJefa('put', `/api/variantes/${propio.relojPlateado}`)
        .send({ sku: 'REL-B4-01P', atributos: {} })
        .expect(400);
      expect(sinGama.body.errores).toEqual([
        {
          campo: 'gama_id',
          mensaje: 'La gama se indica con su id (o null si la pieza no tiene gama)',
        },
      ]);
      await comoJefa('put', '/api/variantes/999999')
        .send({ sku: 'X', gama_id: null, atributos: {} })
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: 'La variante 999999 no existe' });
    });

    it('PUT /api/variantes/:id/precio cambia precio o costo y deja historial', async () => {
      const ruta = `/api/variantes/${propio.relojPlateado}/precio`;
      const conPrecio = await comoJefa('put', ruta).send({ precio_venta: 950.5 }).expect(200);
      const variante = (producto: ProductoCatalogo) =>
        producto.variantes.find((v) => v.id === propio.relojPlateado);
      expect(variante(conPrecio.body.producto)).toMatchObject({
        precio_venta: '950.50',
        costo: '0.00',
      });
      const conCosto = await comoJefa('put', ruta).send({ costo: '380' }).expect(200);
      expect(variante(conCosto.body.producto)).toMatchObject({
        precio_venta: '950.50',
        costo: '380.00',
      });

      const historial = await bd.db
        .selectFrom('historial_precio')
        .select(['precio_anterior', 'precio_nuevo', 'costo_anterior', 'costo_nuevo', 'usuario_id'])
        .where('variante_id', '=', propio.relojPlateado)
        .orderBy('id')
        .execute();
      expect(historial).toEqual([
        {
          precio_anterior: '900.00',
          precio_nuevo: '950.50',
          costo_anterior: '0.00',
          costo_nuevo: '0.00',
          usuario_id: ids.jefa,
        },
        {
          precio_anterior: '950.50',
          precio_nuevo: '950.50',
          costo_anterior: '0.00',
          costo_nuevo: '380.00',
          usuario_id: ids.jefa,
        },
      ]);

      const vacio = await comoJefa('put', ruta).send({}).expect(400);
      expect(vacio.body.mensaje).toBe('Envíe precio_venta, costo o ambos');
      await comoJefa('put', ruta).send({ precio_venta: 10.999 }).expect(400);
    });

    it('el paquete no lleva precio propio y un servicio no lleva costo (reglas de la base)', async () => {
      const helix = (
        await comoJefa('get', '/api/perforaciones').expect(200)
      ).body.perforaciones.find(
        (p: PerforacionCatalogo) => p.codigo === 'HLX',
      ) as PerforacionCatalogo;
      await comoJefa('put', `/api/variantes/${helix.paquete_variante_id}/precio`)
        .send({ precio_venta: 500 })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje:
            'El precio de un paquete se calcula con la pieza: use la tabla de precios de perforación',
        });
      await comoJefa('put', `/api/variantes/${helix.servicio_variante_id}/precio`)
        .send({ costo: 50 })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: 'Solo las piezas y artículos con stock llevan costo',
        });
    });

    it('PUT /api/variantes/:id/activo: sin existencias se desactiva; con existencias, no', async () => {
      const { body } = await comoJefa('put', `/api/variantes/${propio.relojDorado}/activo`)
        .send({ activo: false })
        .expect(200);
      expect(
        (body.producto as ProductoCatalogo).variantes.find((v) => v.id === propio.relojDorado)
          ?.activo,
      ).toBe(false);
      await comoJefa('put', `/api/variantes/${propio.relojDorado}/activo`)
        .send({ activo: true })
        .expect(200);

      // el labret de titanio de los datos demo tiene existencias en bodega y sucursales
      const conStock = await comoJefa('put', `/api/variantes/${demo.labret6}/activo`)
        .send({ activo: false })
        .expect(422);
      expect(conStock.body.mensaje).toMatch(
        /^"Labret rosca interna — Titanio F-136 · 16G · 6 mm" todavía tiene \d+ unidad\(es\) en existencia o en tránsito: no se puede desactivar$/,
      );
      const labret = (await listarProductos('?buscar=TIT-LAB-16-6')).productos[0];
      const producto = await comoJefa('put', `/api/productos/${labret.id}/activo`)
        .send({ activo: false })
        .expect(422);
      expect(producto.body.mensaje).toMatch(/^El producto "Labret rosca interna" todavía tiene/);
      expect((await listarProductos('?buscar=TIT-LAB-16-6')).productos[0].activo).toBe(true);
    });
  });

  describe('perforaciones y precio de paquetes', () => {
    it('GET /api/perforaciones: cada una con su tabla por gama, precios especiales y piezas permitidas', async () => {
      const { body } = await comoJefa('get', '/api/perforaciones').expect(200);
      const perforaciones = body.perforaciones as PerforacionCatalogo[];
      const porCodigo = (codigo: string) => perforaciones.find((p) => p.codigo === codigo);
      const tabla = (p: PerforacionCatalogo | undefined) =>
        p?.precios_gama.map((t) => [t.gama.nombre, t.precio]);

      const helix = porCodigo('HLX');
      expect(helix).toMatchObject({
        nombre: 'Hélix',
        piezas_por_paquete: 1,
        activa: true,
        precio_servicio: '350.00',
        piezas_permitidas: [],
      });
      // la gama creada arriba (modo TABLA) aparece sin precio todavía
      expect(tabla(helix)).toEqual([
        ['Acero clásica', '450.00'],
        ['Acero de lujo', '550.00'],
        ['Oro 14k B4', null],
      ]);
      expect(helix?.precios_especiales).toEqual([
        {
          id: expect.any(Number),
          variante: {
            id: demo.labret8,
            sku: 'TIT-LAB-16-8',
            nombre: 'Labret rosca interna — Titanio F-136 · 16G · 8 mm',
          },
          gama: null,
          precio: '900.00',
          motivo: 'Promoción de lanzamiento',
        },
      ]);

      expect(porCodigo('LOBP')?.piezas_por_paquete).toBe(2);
      expect(porCodigo('LOB')?.piezas_permitidas).toEqual([
        {
          id: expect.any(Number),
          gama: { id: ids.clasica, nombre: 'Acero clásica' },
          categoria: null,
          variante: null,
        },
        {
          id: expect.any(Number),
          gama: { id: ids.titanio, nombre: 'Titanio' },
          categoria: null,
          variante: null,
        },
      ]);
      expect(tabla(porCodigo('TRG'))).toEqual([
        ['Acero clásica', null],
        ['Acero de lujo', null],
        ['Oro 14k B4', null],
      ]);
    });

    it('GET /api/perforaciones/:id/precio-paquete aplica las tres reglas de precio', async () => {
      const { body } = await comoJefa('get', '/api/perforaciones').expect(200);
      const perforaciones = body.perforaciones as PerforacionCatalogo[];
      const helix = perforaciones.find((p) => p.codigo === 'HLX')?.id ?? 0;
      const lobulo = perforaciones.find((p) => p.codigo === 'LOB')?.id ?? 0;
      const par = perforaciones.find((p) => p.codigo === 'LOBP')?.id ?? 0;

      await precioPaquete(helix, [demo.aro]).expect(200).expect({
        precio: '450.00',
        regla: 'TABLA_GAMA',
        detalle: 'Tabla: Hélix × Acero clásica',
      });
      await precioPaquete(helix, [demo.labret6]).expect(200).expect({
        precio: '1000.00',
        regla: 'SERVICIO_MAS_PIEZA',
        detalle: 'Servicio C$ 350.00 + pieza(s) C$ 650.00',
      });
      await precioPaquete(helix, [demo.labret8]).expect(200).expect({
        precio: '900.00',
        regla: 'ESPECIAL',
        detalle: 'Precio especial para esta pieza',
      });
      const dos = await precioPaquete(par, [demo.aro, demo.aro]).expect(200);
      expect(dos.body).toMatchObject({ precio: '600.00', regla: 'TABLA_GAMA' });

      // reglas de la base, con su mensaje
      await precioPaquete(lobulo, [demo.piedra]).expect(422).expect({
        codigo: 'REGLA_NEGOCIO',
        mensaje:
          '"Labret con piedra — Acero · 16G · piedra" no está permitida para la perforación Lóbulo',
      });
      await precioPaquete(par, [demo.aro]).expect(422).expect({
        codigo: 'REGLA_NEGOCIO',
        mensaje: 'El paquete Lóbulos (par) lleva 2 pieza(s); se recibieron 1',
      });
      await precioPaquete(helix, [demo.neilmed]).expect(422);
      await precioPaquete(999_999, [demo.aro]).expect(422).expect({
        codigo: 'REGLA_NEGOCIO',
        mensaje: 'La perforación 999999 no existe o está inactiva',
      });
      const sinPiezas = await comoJefa('get', `/api/perforaciones/${helix}/precio-paquete`).expect(
        400,
      );
      expect(sinPiezas.body.errores).toEqual([
        {
          campo: 'piezas',
          mensaje: 'Indique las piezas del paquete: ?piezas=12,15 (ids de variante)',
        },
      ]);
    });

    it('POST /api/perforaciones la crea con sus dos entradas del catálogo', async () => {
      const { body } = await comoJefa('post', '/api/perforaciones')
        .send({ codigo: 'nar', nombre: ' Nariz B4 ', precio_servicio: 250 })
        .expect(201);
      const creada = body.perforacion as PerforacionCatalogo;
      expect(creada).toMatchObject({
        codigo: 'NAR',
        nombre: 'Nariz B4',
        piezas_por_paquete: 1,
        activa: true,
        precio_servicio: '250.00',
        precios_especiales: [],
        piezas_permitidas: [],
      });
      expect(creada.precios_gama.every((t) => t.precio === null)).toBe(true);
      propio.perforacion = creada.id;

      const enCatalogo = await listarProductos('?buscar=Nariz%20B4');
      expect(
        enCatalogo.productos.map((p) => [p.nombre, p.tipo, p.variantes[0].sku, p.categoria.nombre]),
      ).toEqual([
        ['Perforación Nariz B4', 'SERVICIO', 'SRV-NAR', 'Perforaciones'],
        ['Perforación Nariz B4 con pieza', 'PAQUETE', 'PAQ-NAR', 'Perforaciones'],
      ]);
    });

    it('código repetido → 409; datos inválidos → 400', async () => {
      const repetida = await comoJefa('post', '/api/perforaciones')
        .send({ codigo: 'NAR', nombre: 'Otra nariz B4', precio_servicio: 250 })
        .expect(409);
      expect(repetida.body.codigo).toBe('DUPLICADO');
      const invalida = await comoJefa('post', '/api/perforaciones')
        .send({ codigo: 'N4', nombre: 'Nariz', precio_servicio: 250, piezas_por_paquete: 5 })
        .expect(400);
      expect(invalida.body.errores.map((e: { campo: string }) => e.campo)).toEqual([
        'codigo',
        'piezas_por_paquete',
      ]);
    });

    it('PUT /api/perforaciones/:id la renombra (también en el catálogo) y cambia sus piezas', async () => {
      const { body } = await comoJefa('put', `/api/perforaciones/${propio.perforacion}`)
        .send({ nombre: 'Nostril B4', piezas_por_paquete: 2 })
        .expect(200);
      expect(body.perforacion).toMatchObject({
        codigo: 'NAR',
        nombre: 'Nostril B4',
        piezas_por_paquete: 2,
      });
      expect(
        (await listarProductos('?buscar=Nostril%20B4')).productos.map((p) => p.nombre),
      ).toEqual(['Perforación Nostril B4', 'Perforación Nostril B4 con pieza']);
      await comoJefa('put', `/api/perforaciones/${propio.perforacion}`)
        .send({ nombre: 'Nostril B4', piezas_por_paquete: 1 })
        .expect(200);
    });

    it('PUT /api/perforaciones/:id/precio-servicio cambia el precio de solo servicio', async () => {
      const { body } = await comoJefa(
        'put',
        `/api/perforaciones/${propio.perforacion}/precio-servicio`,
      )
        .send({ precio: 280 })
        .expect(200);
      expect(body.perforacion.precio_servicio).toBe('280.00');
      await precioPaquete(propio.perforacion, [demo.labret6]).expect(200).expect({
        precio: '930.00',
        regla: 'SERVICIO_MAS_PIEZA',
        detalle: 'Servicio C$ 280.00 + pieza(s) C$ 650.00',
      });
    });

    it('PUT /api/perforaciones/:id/precios-gama fija y quita precios de la tabla', async () => {
      const ruta = `/api/perforaciones/${propio.perforacion}/precios-gama`;
      // sin precio en la tabla, la base no deja vender el paquete con esa gama
      await precioPaquete(propio.perforacion, [demo.aro]).expect(422).expect({
        codigo: 'REGLA_NEGOCIO',
        mensaje:
          'Falta el precio de "Nostril B4" con gama "Acero clásica" en la tabla de precios de perforación',
      });

      const { body } = await comoJefa('put', ruta)
        .send({ gama_id: ids.clasica, precio: 320 })
        .expect(200);
      expect(
        (body.perforacion as PerforacionCatalogo).precios_gama.map((t) => [
          t.gama.nombre,
          t.precio,
        ]),
      ).toEqual([
        ['Acero clásica', '320.00'],
        ['Acero de lujo', null],
        ['Oro 14k B4', null],
      ]);
      await precioPaquete(propio.perforacion, [demo.aro]).expect(200).expect({
        precio: '320.00',
        regla: 'TABLA_GAMA',
        detalle: 'Tabla: Nostril B4 × Acero clásica',
      });

      const quitado = await comoJefa('put', ruta)
        .send({ gama_id: ids.clasica, precio: null })
        .expect(200);
      expect((quitado.body.perforacion as PerforacionCatalogo).precios_gama[0].precio).toBeNull();
      await comoJefa('put', ruta).send({ gama_id: ids.clasica, precio: '320.00' }).expect(200);

      await comoJefa('put', ruta).send({ gama_id: ids.titanio, precio: 999 }).expect(422).expect({
        codigo: 'REGLA_NEGOCIO',
        mensaje:
          'La gama Titanio tiene precio por pieza; no lleva precio en la tabla de perforaciones',
      });
      const cero = await comoJefa('put', ruta)
        .send({ gama_id: ids.clasica, precio: 0 })
        .expect(400);
      expect(cero.body.errores[0].campo).toBe('precio');
    });

    it('PUT /api/perforaciones/:id/precios-especiales: la excepción gana a las demás reglas', async () => {
      const ruta = `/api/perforaciones/${propio.perforacion}/precios-especiales`;
      const { body } = await comoJefa('put', ruta)
        .send({ variante_id: demo.labret6, precio: 800, motivo: ' Lanzamiento ' })
        .expect(200);
      expect((body.perforacion as PerforacionCatalogo).precios_especiales).toEqual([
        {
          id: expect.any(Number),
          variante: {
            id: demo.labret6,
            sku: 'TIT-LAB-16-6',
            nombre: 'Labret rosca interna — Titanio F-136 · 16G · 6 mm',
          },
          gama: null,
          precio: '800.00',
          motivo: 'Lanzamiento',
        },
      ]);
      const especial = await precioPaquete(propio.perforacion, [demo.labret6]).expect(200);
      expect(especial.body).toMatchObject({ precio: '800.00', regla: 'ESPECIAL' });

      const porGama = await comoJefa('put', ruta)
        .send({ gama_id: ids.clasica, precio: 300 })
        .expect(200);
      expect(porGama.body.perforacion.precios_especiales).toHaveLength(2);
      const conGama = await precioPaquete(propio.perforacion, [demo.aro]).expect(200);
      expect(conGama.body).toEqual({
        precio: '300.00',
        regla: 'ESPECIAL',
        detalle: 'Precio especial para gama Acero clásica',
      });

      // null los quita
      await comoJefa('put', ruta).send({ gama_id: ids.clasica, precio: null }).expect(200);
      const sinEspeciales = await comoJefa('put', ruta)
        .send({ variante_id: demo.labret6, precio: null })
        .expect(200);
      expect(sinEspeciales.body.perforacion.precios_especiales).toEqual([]);

      const ambos = await comoJefa('put', ruta)
        .send({ variante_id: demo.labret6, gama_id: ids.clasica, precio: 500 })
        .expect(400);
      expect(ambos.body.mensaje).toBe(
        'Indique una pieza (variante_id) o una gama (gama_id), no las dos',
      );
    });

    it('PUT /api/perforaciones/:id/piezas-permitidas limita qué piezas admite el paquete', async () => {
      const ruta = `/api/perforaciones/${propio.perforacion}/piezas-permitidas`;
      const { body } = await comoJefa('put', ruta)
        .send({ gama_id: ids.titanio, permitir: true })
        .expect(200);
      expect((body.perforacion as PerforacionCatalogo).piezas_permitidas).toEqual([
        {
          id: expect.any(Number),
          gama: { id: ids.titanio, nombre: 'Titanio' },
          categoria: null,
          variante: null,
        },
      ]);
      await precioPaquete(propio.perforacion, [demo.aro]).expect(422).expect({
        codigo: 'REGLA_NEGOCIO',
        mensaje:
          '"Aro segmento — Acero · 16G · 8 mm" no está permitida para la perforación Nostril B4',
      });
      await precioPaquete(propio.perforacion, [demo.labret6]).expect(200);

      // repetir la regla no la duplica; con permitir = false se quita
      const repetida = await comoJefa('put', ruta)
        .send({ gama_id: ids.titanio, permitir: true })
        .expect(200);
      expect(repetida.body.perforacion.piezas_permitidas).toHaveLength(1);
      const sinReglas = await comoJefa('put', ruta)
        .send({ gama_id: ids.titanio, permitir: false })
        .expect(200);
      expect(sinReglas.body.perforacion.piezas_permitidas).toEqual([]);
      await precioPaquete(propio.perforacion, [demo.aro]).expect(200);

      const ninguna = await comoJefa('put', ruta).send({ permitir: true }).expect(400);
      expect(ninguna.body.mensaje).toBe(
        'Indique exactamente una: gama_id, categoria_id o variante_id',
      );
    });

    it('PUT /api/perforaciones/:id/activa: desactivada no se vende ni aparece activa en el catálogo', async () => {
      const inactiva = await comoJefa('put', `/api/perforaciones/${propio.perforacion}/activa`)
        .send({ activa: false })
        .expect(200);
      expect(inactiva.body.perforacion.activa).toBe(false);
      expect((await listarProductos('?buscar=Nostril%20B4')).total).toBe(0);
      expect((await listarProductos('?buscar=Nostril%20B4&estado=inactivos')).total).toBe(2);
      await precioPaquete(propio.perforacion, [demo.labret6])
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: `La perforación ${propio.perforacion} no existe o está inactiva`,
        });

      await comoJefa('put', `/api/perforaciones/${propio.perforacion}/activa`)
        .send({ activa: true })
        .expect(200);
      expect((await perforacion(propio.perforacion)).activa).toBe(true);
      expect((await listarProductos('?buscar=Nostril%20B4')).total).toBe(2);
    });

    it('perforación inexistente → 404', async () => {
      const noExiste = { codigo: 'NO_ENCONTRADO', mensaje: 'La perforación 999999 no existe' };
      await comoJefa('get', '/api/perforaciones/999999').expect(404).expect(noExiste);
      await comoJefa('put', '/api/perforaciones/999999/precios-gama')
        .send({ gama_id: ids.clasica, precio: 100 })
        .expect(404)
        .expect(noExiste);
      await comoJefa('put', '/api/perforaciones/999999/precio-servicio')
        .send({ precio: 100 })
        .expect(404)
        .expect(noExiste);
      await comoJefa('put', '/api/perforaciones/999999/piezas-permitidas')
        .send({ gama_id: ids.clasica, permitir: true })
        .expect(404)
        .expect(noExiste);
    });

    it('la vendedora consulta perforaciones y precios de paquete, pero no los cambia', async () => {
      await conSesion('get', '/api/perforaciones', vera.acceso).expect(200);
      await conSesion(
        'get',
        `/api/perforaciones/${propio.perforacion}/precio-paquete?piezas=${demo.labret6}`,
        vera.acceso,
      ).expect(200);
      const base = `/api/perforaciones/${propio.perforacion}`;
      const rutas: [Metodo, string, string][] = [
        ['post', '/api/perforaciones', 'PRODUCTOS_GESTIONAR'],
        ['put', base, 'PRODUCTOS_GESTIONAR'],
        ['put', `${base}/activa`, 'PRODUCTOS_GESTIONAR'],
        ['put', `${base}/precio-servicio`, 'PRECIOS_EDITAR'],
        ['put', `${base}/precios-gama`, 'PRECIOS_EDITAR'],
        ['put', `${base}/precios-especiales`, 'PRECIOS_EDITAR'],
        ['put', `${base}/piezas-permitidas`, 'PRODUCTOS_GESTIONAR'],
      ];
      for (const [metodo, ruta, permiso] of rutas) {
        await conSesion(metodo, ruta, vera.acceso)
          .expect(403)
          .expect({
            codigo: 'PERMISO_DENEGADO',
            mensaje: `Permiso denegado: se requiere ${permiso}`,
          });
      }
    });
  });

  describe('fotos de las variantes', () => {
    // Un PNG válido de 1 × 1 y un JPG mínimo (lo que se revisa es la firma del contenido)
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
    const FORMATO = /^\/api\/fotos\/[A-Za-z0-9_-]{24}\.(png|jpg|webp)$/;
    const fotos = { primera: '', segunda: '' };

    function archivosGuardados(): string[] {
      const carpeta = process.env.DIR_FOTOS ?? '';
      return existsSync(carpeta) ? readdirSync(carpeta) : [];
    }

    function fotoDelDorado(producto: ProductoCatalogo): string | null | undefined {
      return producto.variantes.find((v) => v.id === propio.relojDorado)?.foto_url;
    }

    it('POST /api/variantes/:id/foto sube la imagen y la deja como foto de la variante', async () => {
      const antes = archivosGuardados().length;
      const { body } = await comoJefa('post', `/api/variantes/${propio.relojDorado}/foto`)
        .attach('foto', PNG, 'reloj.png')
        .expect(200);
      fotos.primera = fotoDelDorado(body.producto) ?? '';
      expect(fotos.primera).toMatch(FORMATO);
      expect(fotos.primera.endsWith('.png')).toBe(true);
      expect(archivosGuardados()).toHaveLength(antes + 1);
    });

    it('GET /api/fotos/:archivo la sirve sin sesión (la usa una <img>), con caché larga', async () => {
      const respuesta = await request(http).get(fotos.primera).expect(200);
      expect(respuesta.headers['content-type']).toBe('image/png');
      expect(respuesta.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(respuesta.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.compare(respuesta.body as Buffer, PNG)).toBe(0);
    });

    it('al subir otra foto, la anterior se borra del servidor', async () => {
      const antes = archivosGuardados().length;
      const { body } = await comoJefa('post', `/api/variantes/${propio.relojDorado}/foto`)
        .attach('foto', JPG, 'cualquier-nombre.png') // el formato sale del contenido, no del nombre
        .expect(200);
      fotos.segunda = fotoDelDorado(body.producto) ?? '';
      expect(fotos.segunda.endsWith('.jpg')).toBe(true);
      expect(archivosGuardados()).toHaveLength(antes); // una entra, la otra sale
      await request(http).get(fotos.primera).expect(404);
      const nueva = await request(http).get(fotos.segunda).expect(200);
      expect(nueva.headers['content-type']).toBe('image/jpeg');
    });

    it('solo imágenes JPG, PNG o WebP de hasta 5 MB, en el campo "foto"', async () => {
      const ruta = `/api/variantes/${propio.relojDorado}/foto`;
      const antes = archivosGuardados().length;
      await comoJefa('post', ruta)
        .attach('foto', Buffer.from('<html><script>alert(1)</script></html>'), 'foto.png')
        .expect(400)
        .expect({
          codigo: 'FOTO_INVALIDA',
          mensaje: 'La foto debe ser una imagen JPG, PNG o WebP',
        });
      await comoJefa('post', ruta)
        .expect(400)
        .expect({ codigo: 'FOTO_INVALIDA', mensaje: 'Adjunte la imagen en el campo "foto"' });
      await comoJefa('post', ruta).attach('archivo', PNG, 'reloj.png').expect(400).expect({
        codigo: 'SOLICITUD_INVALIDA',
        mensaje: 'Adjunte un solo archivo, en el campo que indica la ruta',
      });
      await comoJefa('post', ruta)
        .attach('foto', Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]), 'enorme.png')
        .expect(413)
        .expect({ codigo: 'SOLICITUD_MUY_GRANDE', mensaje: 'El archivo es demasiado grande' });
      // nada de eso cambió la foto ni dejó archivos
      expect(archivosGuardados()).toHaveLength(antes);
      const { body } = await comoJefa('get', `/api/productos/${propio.reloj}`).expect(200);
      expect(fotoDelDorado(body.producto)).toBe(fotos.segunda);
    });

    it('si la variante no existe, el archivo subido no queda suelto en el servidor', async () => {
      const antes = archivosGuardados().length;
      await comoJefa('post', '/api/variantes/999999/foto')
        .attach('foto', PNG, 'reloj.png')
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: 'La variante 999999 no existe' });
      expect(archivosGuardados()).toHaveLength(antes);
    });

    it('al editar la variante se conserva su foto subida', async () => {
      const { body } = await comoJefa('put', `/api/variantes/${propio.relojDorado}`)
        .send({
          sku: 'REL-B4-02',
          nombre: 'Dorado',
          codigo_barras: '7509990000444',
          gama_id: null,
          atributos: { color: 'dorado' },
          foto_url: fotos.segunda,
        })
        .expect(200);
      expect(fotoDelDorado(body.producto)).toBe(fotos.segunda);
      // una dirección local que no es de una foto subida no pasa
      await comoJefa('put', `/api/variantes/${propio.relojDorado}`)
        .send({ sku: 'REL-B4-02', gama_id: null, atributos: {}, foto_url: '/api/fotos/../.env' })
        .expect(400);
    });

    it('POST /api/fotos sube una imagen suelta (p. ej. la de una merma)', async () => {
      const { body } = await conSesion('post', '/api/fotos', vera.acceso)
        .attach('foto', PNG, 'merma.png')
        .expect(201);
      expect(body.foto_url).toMatch(FORMATO);
      await request(http).get(body.foto_url).expect(200);
      await request(http).post('/api/fotos').attach('foto', PNG, 'sin-sesion.png').expect(401);
    });

    it('una vendedora no cambia la foto de una variante', async () => {
      await conSesion('post', `/api/variantes/${propio.relojDorado}/foto`, vera.acceso)
        .attach('foto', PNG, 'reloj.png')
        .expect(403)
        .expect({
          codigo: 'PERMISO_DENEGADO',
          mensaje: 'Permiso denegado: se requiere PRODUCTOS_GESTIONAR',
        });
      await conSesion('delete', `/api/variantes/${propio.relojDorado}/foto`, vera.acceso).expect(
        403,
      );
    });

    it('DELETE /api/variantes/:id/foto la quita y borra el archivo', async () => {
      const antes = archivosGuardados().length;
      const { body } = await comoJefa('delete', `/api/variantes/${propio.relojDorado}/foto`).expect(
        200,
      );
      expect(fotoDelDorado(body.producto)).toBeNull();
      expect(archivosGuardados()).toHaveLength(antes - 1);
      await request(http).get(fotos.segunda).expect(404).expect({
        codigo: 'NO_ENCONTRADO',
        mensaje: 'La foto no existe',
      });
    });

    it('un nombre que no es de una foto → 404, sin salir de la carpeta de fotos', async () => {
      for (const nombre of [
        '..%2F..%2Fpackage.json',
        '.env',
        'foto.png',
        'x'.repeat(24) + '.svg',
      ]) {
        const respuesta = await request(http).get(`/api/fotos/${nombre}`).expect(404);
        expect(respuesta.body.codigo).toBe('NO_ENCONTRADO');
      }
    });
  });

  describe('historial de precios', () => {
    it('GET /api/variantes/:id/historial-precios: cada cambio con quién lo hizo', async () => {
      const { body } = await comoJefa(
        'get',
        `/api/variantes/${propio.relojPlateado}/historial-precios`,
      ).expect(200);
      expect(body.historial).toEqual([
        {
          id: expect.any(Number),
          fecha: expect.any(String),
          precio_anterior: '950.50',
          precio_nuevo: '950.50',
          costo_anterior: '0.00',
          costo_nuevo: '380.00',
          usuario: { id: ids.jefa, nombre_completo: 'Jefa del catálogo' },
        },
        {
          id: expect.any(Number),
          fecha: expect.any(String),
          precio_anterior: '900.00',
          precio_nuevo: '950.50',
          costo_anterior: '0.00',
          costo_nuevo: '0.00',
          usuario: { id: ids.jefa, nombre_completo: 'Jefa del catálogo' },
        },
      ]);
    });

    it('la vendedora ve los cambios de precio, pero no los costos', async () => {
      const { body } = await conSesion(
        'get',
        `/api/variantes/${propio.relojPlateado}/historial-precios`,
        vera.acceso,
      ).expect(200);
      expect(
        (body.historial as CambioPrecio[]).map((h) => [
          h.precio_anterior,
          h.precio_nuevo,
          h.costo_anterior,
          h.costo_nuevo,
        ]),
      ).toEqual([
        ['950.50', '950.50', null, null],
        ['900.00', '950.50', null, null],
      ]);
    });

    it('variante inexistente → 404', async () => {
      await comoJefa('get', '/api/variantes/999999/historial-precios').expect(404).expect({
        codigo: 'NO_ENCONTRADO',
        mensaje: 'La variante 999999 no existe',
      });
    });
  });

  describe('búsqueda para la venta y existencias', () => {
    const otras = { lbr: 0, bod: 0, vera: 0 };

    async function buscar(acceso: string, consulta: string): Promise<VarianteEncontrada[]> {
      return (await conSesion('get', `/api/variantes/buscar${consulta}`, acceso).expect(200)).body
        .variantes;
    }

    beforeAll(async () => {
      const sucursales = await bd.db.selectFrom('sucursal').select(['id', 'codigo']).execute();
      otras.lbr = sucursales.find((s) => s.codigo === 'LBR')?.id ?? 0;
      otras.bod = sucursales.find((s) => s.codigo === 'BOD')?.id ?? 0;
      const fila = await bd.db
        .selectFrom('usuario')
        .select('id')
        .where('username', '=', 'vera.catalogo')
        .executeTakeFirstOrThrow();
      otras.vera = fila.id;
    });

    it('GET /api/variantes/buscar: por nombre, con precio y stock de la sucursal del equipo', async () => {
      // Vera entró desde una tablet de Las Américas: no hace falta indicar la sucursal
      const encontradas = await buscar(vera.acceso, '?texto=labret');
      expect(encontradas.map((v) => [v.sku, v.stock])).toEqual([
        ['ACE-LAB-PDR', 10],
        ['TIT-LAB-16-6', 20],
        ['TIT-LAB-16-8', 15],
      ]);
      expect(encontradas[1]).toEqual({
        id: demo.labret6,
        sku: 'TIT-LAB-16-6',
        codigo_barras: '7501000000011',
        producto: 'Labret rosca interna',
        variante: 'Titanio F-136 · 16G · 6 mm',
        categoria: 'Piercing titanio',
        tipo: 'PRODUCTO',
        precio: '650.00',
        stock: 20,
        gama: 'Titanio',
        foto_url: null,
      });
    });

    it('por código de barras o SKU exactos, y las perforaciones con su precio', async () => {
      expect((await buscar(vera.acceso, '?texto=7501000000011')).map((v) => v.sku)).toEqual([
        'TIT-LAB-16-6',
      ]);
      expect((await buscar(vera.acceso, '?texto=tit-lab-16-8')).map((v) => v.sku)).toEqual([
        'TIT-LAB-16-8',
      ]);
      const helix = await buscar(vera.acceso, `?texto=${encodeURIComponent('Hélix')}`);
      expect(helix.map((v) => [v.sku, v.tipo, v.precio, v.stock])).toEqual([
        ['SRV-HLX', 'SERVICIO', '350.00', null],
        ['PAQ-HLX', 'PAQUETE', null, null], // el precio del paquete se calcula con la pieza
      ]);
      expect(await buscar(vera.acceso, '?texto=labret&limite=1')).toHaveLength(1);
    });

    it('sin equipo registrado hay que indicar la sucursal', async () => {
      await comoJefa('get', '/api/variantes/buscar?texto=labret').expect(400).expect({
        codigo: 'DATOS_INVALIDOS',
        mensaje: 'Indique la sucursal (sucursal_id): esta sesión no es de un equipo registrado',
      });
      const enBrisas = await buscar(jefa.acceso, `?texto=TIT-LAB-16-6&sucursal_id=${otras.lbr}`);
      expect(enBrisas.map((v) => v.stock)).toEqual([10]);
      const sinTexto = await comoJefa(
        'get',
        `/api/variantes/buscar?sucursal_id=${otras.lbr}`,
      ).expect(400);
      expect(sinTexto.body.errores).toEqual([
        { campo: 'texto', mensaje: 'Escriba o escanee lo que busca (texto)' },
      ]);
    });

    it('una vendedora no busca con el stock de una ubicación que no es la suya', async () => {
      await conSesion(
        'get',
        `/api/variantes/buscar?texto=labret&sucursal_id=${otras.bod}`,
        vera.acceso,
      )
        .expect(403)
        .expect({
          codigo: 'PERMISO_DENEGADO',
          mensaje: `El usuario ${otras.vera} no está asignado a la sucursal ${otras.bod}`,
        });
    });

    it('GET /api/variantes/:id/existencias: cuánto hay en cada ubicación', async () => {
      const { body } = await comoJefa('get', `/api/variantes/${demo.labret6}/existencias`).expect(
        200,
      );
      const existencias = body.existencias as ExistenciaUbicacion[];
      expect(existencias.filter((e) => e.sucursal_id !== otras.bod).slice(0, 2)).toEqual([
        {
          sucursal_id: ids.lam,
          sucursal: 'Multicentro Las Américas',
          tipo: 'SUCURSAL',
          cantidad: 20,
          disponible: true,
        },
        {
          sucursal_id: otras.lbr,
          sucursal: 'Multicentro Las Brisas',
          tipo: 'SUCURSAL',
          cantidad: 10,
          disponible: true,
        },
      ]);
      expect(existencias.find((e) => e.sucursal_id === otras.bod)).toMatchObject({
        tipo: 'BODEGA',
        cantidad: 10,
        disponible: true,
      });
    });

    it('de la bodega, la vendedora solo sabe si hay o no (parámetro BODEGA_VISIBILIDAD)', async () => {
      const { body } = await conSesion(
        'get',
        `/api/variantes/${demo.labret6}/existencias`,
        vera.acceso,
      ).expect(200);
      const existencias = body.existencias as ExistenciaUbicacion[];
      expect(existencias.find((e) => e.sucursal_id === otras.bod)).toMatchObject({
        cantidad: null,
        disponible: true,
      });
      expect(existencias.find((e) => e.sucursal_id === otras.lbr)?.cantidad).toBe(10);
      await comoJefa('get', '/api/variantes/999999/existencias').expect(404);
    });
  });

  describe('promociones', () => {
    async function disponibles(consulta = ''): Promise<PromocionDisponible[]> {
      const respuesta = await conSesion(
        'get',
        `/api/promociones/disponibles${consulta}`,
        vera.acceso,
      ).expect(200);
      return respuesta.body.promociones;
    }

    it('GET /api/promociones: todas, con su estado de hoy', async () => {
      const { body } = await comoJefa('get', '/api/promociones').expect(200);
      const promociones = body.promociones as PromocionAdmin[];
      expect(promociones.find((p) => p.nombre === 'Promo 10 %')).toMatchObject({
        descripcion: null,
        tipo: 'PORCENTAJE',
        valor: '10.00',
        compra_minima: '0.00',
        vigente_desde: null,
        vigente_hasta: null,
        activa: true,
        estado: 'VIGENTE',
        ventas: 0,
      });
      expect(promociones.find((p) => p.nombre === 'Aniversario C$100')).toMatchObject({
        tipo: 'MONTO',
        compra_minima: '1000.00',
        vigente_desde: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        activa: true,
        estado: 'PROGRAMADA',
      });
      expect(promociones.find((p) => p.nombre === 'Black Friday 20 %')).toMatchObject({
        activa: false,
        estado: 'INACTIVA',
      });
    });

    it('POST /api/promociones la crea inactiva', async () => {
      const { body } = await comoJefa('post', '/api/promociones')
        .send({
          nombre: ' Liquidación B4 ',
          tipo: 'porcentaje',
          valor: 15,
          compra_minima: 500,
          vigente_desde: '2020-01-01',
          vigente_hasta: '2099-12-31',
          descripcion: 'Fin de temporada',
        })
        .expect(201);
      expect(body.promocion).toMatchObject({
        nombre: 'Liquidación B4',
        descripcion: 'Fin de temporada',
        tipo: 'PORCENTAJE',
        valor: '15.00',
        compra_minima: '500.00',
        vigente_desde: '2020-01-01',
        vigente_hasta: '2099-12-31',
        activa: false,
        estado: 'INACTIVA',
        ventas: 0,
      });
      propio.promocion = body.promocion.id;
      expect((await disponibles()).map((p) => p.id)).not.toContain(propio.promocion);
    });

    it('datos inválidos → 400; nombre repetido → 409', async () => {
      const base = { nombre: 'Rara B4', tipo: 'PORCENTAJE', valor: 10 };
      const porcentaje = await comoJefa('post', '/api/promociones')
        .send({ ...base, valor: 150 })
        .expect(400);
      expect(porcentaje.body.errores).toEqual([
        { campo: 'valor', mensaje: 'Un porcentaje no puede pasar de 100' },
      ]);
      const fechas = await comoJefa('post', '/api/promociones')
        .send({ ...base, vigente_desde: '2026-12-10', vigente_hasta: '2026-12-01' })
        .expect(400);
      expect(fechas.body.errores).toEqual([
        { campo: 'vigente_hasta', mensaje: 'La fecha final no puede ser anterior a la inicial' },
      ]);
      await comoJefa('post', '/api/promociones')
        .send({ ...base, vigente_desde: '2026-13-40' })
        .expect(400);
      const repetida = await comoJefa('post', '/api/promociones')
        .send({ ...base, nombre: 'Liquidación B4' })
        .expect(409);
      expect(repetida.body).toMatchObject({
        codigo: 'DUPLICADO',
        restriccion: 'promocion_nombre_key',
      });
    });

    it('PUT /api/promociones/:id la edita y /activa la pone a disposición del POS', async () => {
      const editada = await comoJefa('put', `/api/promociones/${propio.promocion}`)
        .send({ nombre: 'Liquidación B4', tipo: 'MONTO', valor: '120.50', compra_minima: 500 })
        .expect(200);
      expect(editada.body.promocion).toMatchObject({
        tipo: 'MONTO',
        valor: '120.50',
        descripcion: null,
        vigente_desde: null,
        vigente_hasta: null,
        estado: 'INACTIVA',
      });
      const activa = await comoJefa('put', `/api/promociones/${propio.promocion}/activa`)
        .send({ activa: true })
        .expect(200);
      expect(activa.body.promocion).toMatchObject({ activa: true, estado: 'VIGENTE' });
    });

    it('GET /api/promociones/disponibles: las que el POS puede aplicar hoy y cuánto rebajan', async () => {
      const sinSubtotal = await disponibles();
      expect(sinSubtotal.find((p) => p.id === propio.promocion)).toEqual({
        id: propio.promocion,
        nombre: 'Liquidación B4',
        tipo: 'MONTO',
        valor: '120.50',
        compra_minima: '500.00',
        aplica: true,
        descuento: null,
      });
      const nombres = sinSubtotal.map((p) => p.nombre);
      expect(nombres).toContain('Promo 10 %');
      expect(nombres).not.toContain('Aniversario C$100'); // todavía no empieza
      expect(nombres).not.toContain('Black Friday 20 %'); // inactiva

      const con400 = await disponibles('?subtotal=400');
      expect(con400.find((p) => p.id === propio.promocion)).toMatchObject({
        aplica: false, // no llega a la compra mínima
        descuento: '120.50',
      });
      expect(con400.find((p) => p.nombre === 'Promo 10 %')).toMatchObject({
        aplica: true,
        descuento: '40.00',
      });
      const con1000 = await disponibles('?subtotal=1000.50');
      expect(con1000.find((p) => p.id === propio.promocion)?.aplica).toBe(true);
      expect(con1000.find((p) => p.nombre === 'Promo 10 %')?.descuento).toBe('100.05');

      const invalido = await conSesion(
        'get',
        '/api/promociones/disponibles?subtotal=mil',
        vera.acceso,
      ).expect(400);
      expect(invalido.body.errores).toEqual([
        { campo: 'subtotal', mensaje: 'subtotal debe ser un monto de 0 en adelante' },
      ]);
    });

    it('al desactivarla deja de ofrecerse', async () => {
      await comoJefa('put', `/api/promociones/${propio.promocion}/activa`)
        .send({ activa: false })
        .expect(200);
      expect((await disponibles()).map((p) => p.id)).not.toContain(propio.promocion);
    });

    it('promoción inexistente → error de la base', async () => {
      await comoJefa('put', '/api/promociones/999999')
        .send({ nombre: 'Nada B4', tipo: 'MONTO', valor: 10 })
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: 'La promoción 999999 no existe' });
      await comoJefa('put', '/api/promociones/999999/activa')
        .send({ activa: true })
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: 'La promoción 999999 no existe' });
    });

    it('la vendedora aplica promociones, pero no las administra', async () => {
      const rutas: [Metodo, string][] = [
        ['get', '/api/promociones'],
        ['post', '/api/promociones'],
        ['put', `/api/promociones/${propio.promocion}`],
        ['put', `/api/promociones/${propio.promocion}/activa`],
      ];
      for (const [metodo, ruta] of rutas) {
        await conSesion(metodo, ruta, vera.acceso).expect(403).expect({
          codigo: 'PERMISO_DENEGADO',
          mensaje: 'Permiso denegado: se requiere PROMOCIONES_GESTIONAR',
        });
      }
    });
  });
});
