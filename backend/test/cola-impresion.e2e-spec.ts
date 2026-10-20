import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { BaseDatosService } from '../src/base-datos/base-datos.service';
import type { ColaDeEquipo } from '../src/cola-impresion/cola-impresion.service';
import type { ProductoCatalogo } from '../src/productos/productos.service';
import type { VentaDetalle } from '../src/ventas/ventas.service';
import {
  comoBytes,
  crearApp,
  crearUsuarioDePrueba,
  registrarTablet,
  tokenDeAcceso,
} from './utilidades';

// La cola de impresión: el ticket de una venta hecha desde un celular sale en el equipo registrado
// de su sucursal. Dos sucursales propias, cada una con su tablet: Zoe (vendedora) y Yara
// (encargada) trabajan en la A; Ximena (vendedora), en la B.

type Metodo = 'get' | 'post' | 'put';
const CLAVE = 'Cola#2026';

describe('Cola de impresión', () => {
  let app: NestExpressApplication;
  let http: App;
  let bd: BaseDatosService;
  const ids = { jefa: 0, zoe: 0, yara: 0, ximena: 0, a: 0, b: 0, cadena: 0 };
  /** El token que identifica a cada equipo (su cookie). */
  const tablet = { a: '', b: '' };
  const jefa = { acceso: '' };
  /** `acceso`: desde su celular (sin equipo). `enTablet`: en la tablet de su sucursal. */
  const zoe = { acceso: '', enTablet: '' };
  const yara = { acceso: '', enTablet: '' };
  const ximena = { acceso: '', enTablet: '' };
  /** Los tickets que van entrando a la cola, por el papel que hacen en las pruebas. */
  const cola = { primero: 0, sinPapel: 0, ajeno: 0, gaveta: 0, alCierre: 0 };
  const venta = { primero: 0, enTablet: 0, alCierre: 0 };
  let turnoB = 0;

  function con(metodo: Metodo, ruta: string, acceso: string) {
    return request(http)[metodo](ruta).set('Authorization', `Bearer ${acceso}`);
  }

  /** Como lo pide el equipo: sin sesión, solo con su cookie. */
  function equipo(metodo: Metodo, ruta: string, token: string | null = tablet.a) {
    const solicitud = request(http)[metodo](ruta);
    return token ? solicitud.set('Cookie', `esmeralda_equipo=${token}`) : solicitud;
  }

  async function verCola(token: string | null = tablet.a): Promise<ColaDeEquipo> {
    return (await equipo('get', '/api/cola-impresion', token).expect(200)).body;
  }

  async function vender(acceso: string, pagos: unknown[] = [{ metodo: 'EFECTIVO', monto: 600 }]) {
    const { body } = await con('post', '/api/ventas', acceso)
      .send({
        clave_idempotencia: randomUUID(),
        items: [{ variante_id: ids.cadena, cantidad: 1 }],
        pagos,
      })
      .expect(201);
    return body.venta as VentaDetalle;
  }

  async function verVenta(id: number, acceso = jefa.acceso): Promise<VentaDetalle> {
    return (await con('get', `/api/ventas/${id}`, acceso).expect(200)).body.venta;
  }

  async function parametro(clave: string, valor: string): Promise<void> {
    await con('put', `/api/parametros/${clave}`, jefa.acceso).send({ valor }).expect(200);
  }

  async function impresiones(ventaId: number): Promise<number> {
    const { total } = await bd.db
      .selectFrom('ticket_impresion')
      .select((eb) => eb.fn.countAll<number>().as('total'))
      .where('venta_id', '=', ventaId)
      .executeTakeFirstOrThrow();
    return Number(total);
  }

  beforeAll(async () => {
    app = await crearApp();
    http = app.getHttpServer();
    bd = app.get(BaseDatosService);
    ids.jefa = await crearUsuarioDePrueba(app, {
      nombre: 'Jefa de la cola',
      username: 'jefa.cola',
      password: CLAVE,
      rol: 'ADMIN',
    });
    jefa.acceso = await tokenDeAcceso(app, 'jefa.cola', CLAVE);

    for (const [codigo, clave] of [
      ['CQA', 'a'],
      ['CQB', 'b'],
    ] as const) {
      const sucursal = await con('post', '/api/sucursales', jefa.acceso)
        .send({ codigo, nombre: `Sucursal Cola ${codigo} e2e`, direccion: `Plaza ${codigo}` })
        .expect(201);
      ids[clave] = sucursal.body.sucursal.id as number;
      await con('post', `/api/sucursales/${ids[clave]}/cajas`, jefa.acceso)
        .send({ nombre: 'Caja 1' })
        .expect(201);
      tablet[clave] = await registrarTablet(app, jefa.acceso, `Tablet ${codigo}`, ids[clave]);
    }

    const actores: [string, 'zoe' | 'yara' | 'ximena', string, number][] = [
      ['Zoe Cola', 'zoe', 'VENDEDOR', ids.a],
      ['Yara Cola', 'yara', 'ENCARGADO', ids.a],
      ['Ximena Cola', 'ximena', 'VENDEDOR', ids.b],
    ];
    for (const [nombre, clave, rol, sucursal] of actores) {
      ids[clave] = await crearUsuarioDePrueba(app, {
        nombre,
        username: `${clave}.cola`,
        password: CLAVE,
        rol,
        sucursales: [sucursal],
      });
    }
    zoe.acceso = await tokenDeAcceso(app, 'zoe.cola', CLAVE);
    yara.acceso = await tokenDeAcceso(app, 'yara.cola', CLAVE);
    ximena.acceso = await tokenDeAcceso(app, 'ximena.cola', CLAVE);

    const categoria = await con('post', '/api/categorias', jefa.acceso)
      .send({ nombre: 'Regalos COLA', prefijo: 'RCOL' })
      .expect(201);
    const producto = await con('post', '/api/productos', jefa.acceso)
      .send({
        categoria_id: categoria.body.categoria.id,
        nombre: 'Regalo COLA',
        variantes: [{ sku: 'COLA-CAD', nombre: 'Cadena', precio_venta: 600, costo: 200 }],
      })
      .expect(201);
    ids.cadena = (producto.body.producto as ProductoCatalogo).variantes[0].id;
    for (const sucursal of [ids.a, ids.b]) {
      await con('post', '/api/inventario/movimientos', jefa.acceso)
        .send({
          sucursal_id: sucursal,
          variante_id: ids.cadena,
          tipo: 'AJUSTE_POSITIVO',
          cantidad: 20,
          motivo: 'Existencias para las pruebas de la cola',
        })
        .expect(201);
    }
    const tipoCambio = await con('get', '/api/tipo-cambio', jefa.acceso).expect(200);
    if (!tipoCambio.body.tipo_cambio) {
      await con('put', '/api/tipo-cambio', jefa.acceso)
        .send({ usd_a_nio: 36.62, confirmar: true })
        .expect(200);
    }
  });

  afterAll(async () => {
    await parametro('IMPRESION_AUTOMATICA_COLA', 'NO');
    await parametro('IMPRESION_ABRIR_GAVETA', 'NO');
    // no queda ninguna caja abierta de estas pruebas
    await con('post', `/api/turnos/${turnoB}/cierre-forzado`, jefa.acceso)
      .send({ motivo: 'Cierre de las pruebas de la cola' })
      .expect(200);
    await app.close();
  });

  describe('el equipo que la atiende', () => {
    it('sin equipo registrado, o con el equipo sin abrir, no hay cola que atender', async () => {
      const vacia = { atendida: false, automatica: false, tickets: [] };
      expect(await verCola(null)).toEqual(vacia);
      expect(await verCola('un-token-que-no-existe')).toEqual(vacia);
      expect(await verCola(tablet.a)).toEqual(vacia); // registrada, pero nadie ha entrado hoy
    });

    it('al entrar alguien con su contraseña el equipo queda abierto y atiende su cola', async () => {
      zoe.enTablet = await tokenDeAcceso(app, 'zoe.cola', CLAVE, tablet.a);
      ximena.enTablet = await tokenDeAcceso(app, 'ximena.cola', CLAVE, tablet.b);
      await con('post', '/api/caja/turno/abrir', zoe.enTablet)
        .send({ inicial_nio: 500, inicial_usd: 0 })
        .expect(201);
      const deB = await con('post', '/api/caja/turno/abrir', ximena.enTablet)
        .send({ inicial_nio: 500, inicial_usd: 0 })
        .expect(201);
      turnoB = deB.body.turno.id;
      // sin sesión: basta la cookie del equipo
      expect(await verCola(tablet.a)).toEqual({ atendida: true, automatica: false, tickets: [] });
    });
  });

  describe('qué entra a la cola', () => {
    it('la venta hecha desde el celular; la hecha en el equipo, no', async () => {
      const delCelular = await vender(zoe.acceso);
      const delEquipo = await vender(zoe.enTablet);
      expect(delCelular.cola).toEqual({ id: expect.any(Number), estado: 'PENDIENTE' });
      expect(delEquipo.cola).toBeNull();
      cola.primero = delCelular.cola?.id ?? 0;
      venta.primero = delCelular.id;
      venta.enTablet = delEquipo.id;

      const { tickets } = await verCola();
      expect(tickets).toEqual([
        {
          id: cola.primero,
          venta_id: delCelular.id,
          numero: delCelular.numero,
          fecha: expect.any(String),
          vendedor: 'Zoe Cola',
          en_curso: false,
        },
      ]);
      // sin montos: el ticket trae el suyo, la lista no
      expect(JSON.stringify(tickets)).not.toMatch(/total|monto|600/);
    });

    it('cada equipo atiende solo los tickets de su sucursal', async () => {
      expect((await verCola(tablet.b)).tickets).toEqual([]);
      const ajeno = await equipo('post', `/api/cola-impresion/${cola.primero}/ticket`, tablet.b);
      expect(ajeno.status).toBe(422);
      expect(ajeno.body.mensaje).toMatch(/no está en la cola de impresión de este equipo/);
    });

    it('pedir un ticket sin la cookie de un equipo, o uno que no existe, no sirve', async () => {
      const ruta = `/api/cola-impresion/${cola.primero}/ticket`;
      expect((await equipo('post', ruta, null)).body).toMatchObject({ codigo: 'EQUIPO_REQUERIDO' });
      expect((await equipo('post', ruta, 'otro-token')).status).toBe(403);
      // ni con la sesión de alguien desde su celular: la cola es del equipo
      expect((await con('post', ruta, zoe.acceso)).status).toBe(403);
      await equipo('post', '/api/cola-impresion/999999999/ticket').expect(404);
      await equipo('post', '/api/cola-impresion/999999999/impreso').expect(404);
      await equipo('post', '/api/cola-impresion/abc/ticket').expect(400);
    });
  });

  describe('imprimir desde la cola', () => {
    it('sale el original; reintentar (falló la impresora) devuelve el mismo, no una copia', async () => {
      const ruta = `/api/cola-impresion/${cola.primero}/ticket?formato=renglones`;
      const sinPedirlo = await equipo('post', `/api/cola-impresion/${cola.primero}/impreso`);
      expect(sinPedirlo.status).toBe(422);
      expect(sinPedirlo.body.mensaje).toMatch(/todavía no se ha pedido/);

      const primero = await equipo('post', ruta).expect(200);
      expect(primero.headers['x-ticket-impresion']).toBe('1');
      expect(primero.body).toMatchObject({ impresion: 1, abrir_gaveta: false });
      const textos = (primero.body.renglones as { texto?: string; izquierda?: string }[]).map(
        (r) => r.texto ?? r.izquierda ?? '',
      );
      expect(textos).toEqual(expect.arrayContaining(['TOTAL C$', 'Atendió: Zoe Cola']));
      expect(textos).not.toContain('COPIA');

      const reintento = await equipo('post', ruta).expect(200);
      expect(reintento.body).toEqual(primero.body);
      // también en PDF, para la PC de caja: la misma impresión
      const pdf = await equipo('post', `/api/cola-impresion/${cola.primero}/ticket`)
        .buffer(true)
        .parse(comoBytes)
        .expect(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(pdf.headers['x-ticket-impresion']).toBe('1');
      expect((pdf.body as Buffer).toString('latin1')).toMatch(/\/MediaBox \[0 0 204\.09/);
      expect(await impresiones(venta.primero)).toBe(1);
      // sigue esperando hasta que el equipo avise de que salió
      expect((await verCola()).tickets).toHaveLength(1);
      expect((await verVenta(venta.primero)).cola).toMatchObject({ estado: 'PENDIENTE' });
    });

    it('cuando el equipo avisa de que salió, deja la cola; reimprimirlo después ya es copia', async () => {
      await equipo('post', `/api/cola-impresion/${cola.primero}/impreso`).expect(204);
      await equipo('post', `/api/cola-impresion/${cola.primero}/impreso`).expect(204); // repetido
      expect((await verCola()).tickets).toEqual([]);
      expect((await verVenta(venta.primero, zoe.acceso)).cola).toEqual({
        id: cola.primero,
        estado: 'IMPRESO',
      });

      const otraVez = await equipo('post', `/api/cola-impresion/${cola.primero}/ticket`);
      expect(otraVez.status).toBe(409);
      expect(otraVez.body.mensaje).toMatch(/ya salió de la cola/);
      const copia = await con(
        'post',
        `/api/ventas/${venta.primero}/imprimir?formato=renglones`,
        zoe.enTablet,
      ).expect(200);
      expect(copia.body.impresion).toBe(2);
    });
  });

  describe('«No imprimir»', () => {
    it('quien vendió lo quita desde su celular: no se anota ninguna impresión', async () => {
      const sinPapel = await vender(zoe.acceso);
      cola.sinPapel = sinPapel.cola?.id ?? 0;
      await con('post', `/api/cola-impresion/${cola.sinPapel}/no-imprimir`, zoe.acceso).expect(204);
      expect((await verCola()).tickets).toEqual([]);
      expect((await verVenta(sinPapel.id, zoe.acceso)).cola).toMatchObject({
        estado: 'NO_IMPRESO',
      });
      expect(await impresiones(sinPapel.id)).toBe(0);
      const repetido = await con(
        'post',
        `/api/cola-impresion/${cola.sinPapel}/no-imprimir`,
        zoe.acceso,
      );
      expect(repetido.status).toBe(409);
      // queda quién lo decidió
      const fila = await bd.db
        .selectFrom('ticket_cola')
        .select(['resuelta_por', 'motivo'])
        .where('id', '=', cola.sinPapel)
        .executeTakeFirstOrThrow();
      expect(fila).toEqual({ resuelta_por: ids.zoe, motivo: 'A_MANO' });
    });

    it('el de otra persona: solo desde un equipo de esa sucursal', async () => {
      const ajeno = await vender(zoe.acceso);
      cola.ajeno = ajeno.cola?.id ?? 0;
      const ruta = `/api/cola-impresion/${cola.ajeno}/no-imprimir`;
      // Yara es la encargada, pero desde su celular no es su venta; Ximena es de otra sucursal
      for (const acceso of [yara.acceso, ximena.acceso, ximena.enTablet]) {
        const rechazo = await con('post', ruta, acceso);
        expect(rechazo.status).toBe(403);
        expect(rechazo.body.mensaje).toMatch(/No puede quitar ese ticket/);
      }
      await request(http).post(ruta).expect(401); // sin sesión no: tiene que quedar quién
      await con('post', '/api/cola-impresion/999999999/no-imprimir', zoe.acceso).expect(404);

      yara.enTablet = await tokenDeAcceso(app, 'yara.cola', CLAVE, tablet.a);
      await con('post', ruta, yara.enTablet).expect(204);
      expect((await verVenta(ajeno.id)).cola).toMatchObject({ estado: 'NO_IMPRESO' });
    });
  });

  describe('los parámetros', () => {
    it('IMPRESION_AUTOMATICA_COLA: el equipo sabe que debe imprimir solo', async () => {
      await parametro('IMPRESION_AUTOMATICA_COLA', 'SI');
      expect(await verCola()).toMatchObject({ atendida: true, automatica: true });
      // fuera de un equipo abierto nunca
      expect(await verCola(null)).toMatchObject({ atendida: false, automatica: false });
      await parametro('IMPRESION_AUTOMATICA_COLA', 'NO');
      expect(await verCola()).toMatchObject({ automatica: false });
    });

    it('IMPRESION_ABRIR_GAVETA: el original de una venta en efectivo lleva la orden de abrirla', async () => {
      const enEfectivo = await vender(zoe.acceso);
      const conTarjeta = await vender(zoe.enTablet, [
        { metodo: 'TARJETA', monto: 600, referencia: '778899' },
      ]);
      cola.gaveta = enEfectivo.cola?.id ?? 0;
      const deLaCola = `/api/cola-impresion/${cola.gaveta}/ticket?formato=renglones`;
      const imprimir = (id: number) =>
        con('post', `/api/ventas/${id}/imprimir?formato=renglones`, zoe.enTablet).expect(200);

      expect((await equipo('post', deLaCola).expect(200)).body.abrir_gaveta).toBe(false); // apagada
      await parametro('IMPRESION_ABRIR_GAVETA', 'SI');
      expect((await equipo('post', deLaCola).expect(200)).body).toMatchObject({
        impresion: 1,
        abrir_gaveta: true,
      });
      await equipo('post', `/api/cola-impresion/${cola.gaveta}/impreso`).expect(204);
      // la venta hecha en el equipo: el original sí; la copia y la pagada con tarjeta, no
      expect((await imprimir(venta.enTablet)).body).toMatchObject({
        impresion: 1,
        abrir_gaveta: true,
      });
      expect((await imprimir(venta.enTablet)).body).toMatchObject({
        impresion: 2,
        abrir_gaveta: false,
      });
      expect((await imprimir(conTarjeta.id)).body).toMatchObject({
        impresion: 1,
        abrir_gaveta: false,
      });
      await parametro('IMPRESION_ABRIR_GAVETA', 'NO');
    });
  });

  describe('el ticket digital', () => {
    it('se pide desde el celular, es un PDF y no cuenta como impresión', async () => {
      const antes = await impresiones(venta.primero);
      const digital = await con('get', `/api/ventas/${venta.primero}/ticket-digital`, zoe.acceso)
        .buffer(true)
        .parse(comoBytes)
        .expect(200);
      expect(digital.headers['content-type']).toBe('application/pdf');
      expect(digital.headers['content-disposition']).toMatch(/filename="ticket-CQA-\d{8}\.pdf"/);
      expect(digital.headers['x-ticket-impresion']).toBeUndefined();
      const pdf = (digital.body as Buffer).toString('latin1');
      expect(pdf.startsWith('%PDF-')).toBe(true);
      expect(pdf).toMatch(/\/MediaBox \[0 0 204\.09/);
      expect(await impresiones(venta.primero)).toBe(antes);
    });

    it('solo de una venta que la persona puede ver', async () => {
      // desde el celular, la venta de otra persona no existe
      await con('get', `/api/ventas/${venta.primero}/ticket-digital`, yara.acceso).expect(404);
      await con('get', `/api/ventas/${venta.primero}/ticket-digital`, ximena.acceso).expect(404);
      await con('get', '/api/ventas/999999999/ticket-digital', zoe.acceso).expect(404);
      // en el equipo, la encargada ve las de su sucursal
      await con('get', `/api/ventas/${venta.primero}/ticket-digital`, yara.enTablet).expect(200);
    });
  });

  describe('lo que queda en la cola', () => {
    it('al anular la venta, su ticket deja de esperar', async () => {
      const anulada = await vender(zoe.acceso);
      expect((await verCola()).tickets.map((t) => t.venta_id)).toEqual([anulada.id]);
      await con('post', `/api/ventas/${anulada.id}/anular`, yara.enTablet)
        .send({ motivo: 'La clienta se arrepintió' })
        .expect(200);
      expect((await verCola()).tickets).toEqual([]);
      expect((await verVenta(anulada.id)).cola).toMatchObject({ estado: 'NO_IMPRESO' });
    });

    it('al cerrar el turno, lo que quedaba se marca solo como no impreso', async () => {
      const pendiente = await vender(zoe.acceso);
      cola.alCierre = pendiente.cola?.id ?? 0;
      venta.alCierre = pendiente.id;
      expect((await verCola()).tickets).toHaveLength(1);
      await con('post', `/api/turnos/${pendiente.turno_id}/cierre-forzado`, jefa.acceso)
        .send({ motivo: 'Cierre de las pruebas de la cola' })
        .expect(200);
      expect((await verCola()).tickets).toEqual([]);
      expect((await verVenta(venta.alCierre)).cola).toEqual({
        id: cola.alCierre,
        estado: 'NO_IMPRESO',
      });
      const fila = await bd.db
        .selectFrom('ticket_cola')
        .select(['resuelta_por', 'motivo'])
        .where('id', '=', cola.alCierre)
        .executeTakeFirstOrThrow();
      expect(fila).toEqual({ resuelta_por: null, motivo: 'TURNO_CERRADO' });
    });

    it('con el equipo cerrado al final del día la cola deja de atenderse', async () => {
      await con('post', '/api/equipos/actual/cerrar', yara.enTablet).expect(204);
      expect(await verCola()).toEqual({ atendida: false, automatica: false, tickets: [] });
      const cerrado = await equipo('post', `/api/cola-impresion/${cola.alCierre}/ticket`);
      expect(cerrado.status).toBe(403);
      expect(cerrado.body.mensaje).toMatch(/equipo registrado de la sucursal que esté abierto/);
    });
  });
});
