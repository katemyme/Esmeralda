import type { NestExpressApplication } from '@nestjs/platform-express';
import { sql } from 'kysely';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AlertaAdmin } from '../src/alertas/alertas.service';
import { BaseDatosService } from '../src/base-datos/base-datos.service';
import { CONFIGURACION, type Configuracion } from '../src/configuracion/configuracion';
import type { ProductoCatalogo } from '../src/productos/productos.service';
import { hoyEnManagua, rangoDelPeriodo, sumarDias } from '../src/reportes/periodo';
import type { Reporte } from '../src/reportes/reporte';
import { TareasService } from '../src/tareas/tareas.service';
import { crearApp, crearUsuarioDePrueba, tokenDeAcceso } from './utilidades';

// Tareas programadas (B7) contra la base: la alerta de cajas sin cerrar y la foto mensual del
// inventario. En las pruebas no corren solas (TAREAS_PROGRAMADAS=false): aquí se llama a
// TareasService.ejecutar() con la hora que hace falta. Todo ocurre en una sucursal propia.

const SUCURSAL = 'Sucursal Tareas e2e';

describe('Tareas programadas', () => {
  let app: NestExpressApplication;
  let http: App;
  let bd: BaseDatosService;
  let tareas: TareasService;
  const hoy = hoyEnManagua();
  const ids = { jefa: 0, suc: 0, caja: 0, turno: 0, aro: 0 };
  const jefa = { acceso: '' };

  /** Ese día a esa hora de Managua (UTC−6 todo el año). */
  const aLas = (hora: string) => new Date(`${hoy}T${hora}:00-06:00`);

  function comoJefa(metodo: 'get' | 'post', ruta: string) {
    return request(http)[metodo](ruta).set('Authorization', `Bearer ${jefa.acceso}`);
  }

  async function alertasDeLaCaja(estado = 'pendientes'): Promise<AlertaAdmin[]> {
    const { body } = await comoJefa(
      'get',
      `/api/alertas?tipo=CAJA_SIN_CERRAR&sucursal_id=${ids.suc}&estado=${estado}`,
    ).expect(200);
    return body.alertas as AlertaAdmin[];
  }

  beforeAll(async () => {
    app = await crearApp();
    http = app.getHttpServer();
    bd = app.get(BaseDatosService);
    tareas = app.get(TareasService);
    ids.jefa = await crearUsuarioDePrueba(app, {
      nombre: 'Jefa de tareas',
      username: 'jefa.tar',
      password: 'Tareas#2026',
      rol: 'ADMIN',
    });
    jefa.acceso = await tokenDeAcceso(app, 'jefa.tar', 'Tareas#2026');
    const sucursal = await comoJefa('post', '/api/sucursales')
      .send({ codigo: 'TAR', nombre: SUCURSAL })
      .expect(201);
    ids.suc = sucursal.body.sucursal.id;
    const conCaja = await comoJefa('post', `/api/sucursales/${ids.suc}/cajas`)
      .send({ nombre: 'Caja 1' })
      .expect(201);
    ids.caja = conCaja.body.sucursal.cajas[0].id;
    const categoria = await comoJefa('post', '/api/categorias')
      .send({ nombre: 'Joyas TAR' })
      .expect(201);
    const producto = await comoJefa('post', '/api/productos')
      .send({
        categoria_id: categoria.body.categoria.id,
        nombre: 'Joya TAR',
        variantes: [{ sku: 'TAR-ARO', nombre: 'Aro', precio_venta: 300, costo: 100 }],
      })
      .expect(201);
    ids.aro = (producto.body.producto as ProductoCatalogo).variantes[0].id;
    // El administrador (sin equipo registrado) abre la caja indicándola
    const turno = await comoJefa('post', '/api/caja/turno/abrir')
      .send({ inicial_nio: 500, caja_id: ids.caja })
      .expect(201);
    ids.turno = turno.body.turno.id;
  });

  afterAll(() => app.close());

  it('en las pruebas el servidor no las corre por su cuenta', () => {
    expect(app.get<Configuracion>(CONFIGURACION).tareasProgramadas).toBe(false);
  });

  describe('cajas sin cerrar', () => {
    it('antes de la hora de cierre (21:30) no hay alerta', async () => {
      await tareas.ejecutar(aLas('12:00'));
      await tareas.ejecutar(aLas('21:29'));
      expect(await alertasDeLaCaja()).toEqual([]);
    });

    it('después de esa hora, una alerta por cada caja que sigue abierta, y una sola vez', async () => {
      const resultado = await tareas.ejecutar(aLas('21:45'));
      expect(resultado.cajas_sin_cerrar).toBeGreaterThanOrEqual(1);
      const alertas = await alertasDeLaCaja();
      expect(alertas).toEqual([
        expect.objectContaining({
          tipo: 'CAJA_SIN_CERRAR',
          titulo: expect.stringMatching(new RegExp(`^${SUCURSAL}: la caja sigue abierta`)),
          detalle: { turno_id: ids.turno, caja_id: ids.caja },
          sucursal: { id: ids.suc, codigo: 'TAR', nombre: SUCURSAL },
        }),
      ]);
      // las pasadas siguientes no la repiten
      await tareas.ejecutar(aLas('22:00'));
      await tareas.ejecutar(aLas('23:45'));
      expect(await alertasDeLaCaja()).toHaveLength(1);
    });

    it('al cerrar la caja la alerta queda atendida', async () => {
      await comoJefa('post', `/api/turnos/${ids.turno}/cierre-forzado`)
        .send({ motivo: 'Nadie cerró la caja de la prueba de tareas' })
        .expect(200);
      expect(await alertasDeLaCaja()).toEqual([]);
      expect(await alertasDeLaCaja('atendidas')).toHaveLength(1);
      // y una caja cerrada ya no vuelve a alertar
      await tareas.ejecutar(aLas('23:50'));
      expect(await alertasDeLaCaja()).toEqual([]);
    });
  });

  describe('foto mensual del inventario', () => {
    const mesAnterior = rangoDelPeriodo('mes', sumarDias(rangoDelPeriodo('mes', hoy).desde, -1));
    const mes = mesAnterior.desde.slice(0, 7);

    it('la primera pasada de un mes guarda la foto del mes que acaba de cerrar, una sola vez', async () => {
      // Lo que había en esta sucursal al cambiar de mes: tres aros que entraron hace 40 días
      await sql`delete from inventario_cierre_mensual where mes = ${mesAnterior.desde}::date`.execute(
        bd.db,
      );
      await sql`
        insert into movimiento_inventario
               (sucursal_id, variante_id, tipo, cantidad, stock_resultante, motivo, usuario_id, fecha)
        values (${ids.suc}, ${ids.aro}, 'ENTRADA', 3, 0, 'Entrada de hace 40 días (prueba)',
                ${ids.jefa}, now() - interval '40 days')`.execute(bd.db);
      // y dos más de hoy, que ya no son del mes anterior
      await comoJefa('post', '/api/inventario/movimientos')
        .send({
          sucursal_id: ids.suc,
          variante_id: ids.aro,
          tipo: 'AJUSTE_POSITIVO',
          cantidad: 2,
          motivo: 'Entrada de hoy para la prueba de tareas',
        })
        .expect(201);

      const primera = await tareas.ejecutar(aLas('00:10'));
      expect(primera.foto_inventario).toBeGreaterThanOrEqual(1);
      expect((await tareas.ejecutar(aLas('00:25'))).foto_inventario).toBe(0);

      const { body } = await comoJefa(
        'get',
        `/api/reportes/inventario-valorizado?mes=${mes}&sucursal_id=${ids.suc}`,
      ).expect(200);
      const reporte = body.reporte as Reporte;
      expect(reporte.secciones[0].filas).toEqual([
        { sucursal: SUCURSAL, unidades: 3, valor_costo: '300.00', valor_venta: '900.00' },
      ]);
      const meses = await comoJefa('get', '/api/reportes/inventario-valorizado/meses').expect(200);
      expect(meses.body.meses).toContain(mes);
      // el de hoy ya cuenta los cinco
      const actual = await comoJefa(
        'get',
        `/api/reportes/inventario-valorizado?sucursal_id=${ids.suc}`,
      ).expect(200);
      expect((actual.body.reporte as Reporte).secciones[0].filas[0]).toMatchObject({ unidades: 5 });
    });
  });
});
