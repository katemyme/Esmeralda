import { sql, type Kysely } from 'kysely';
import { DatabaseError } from 'pg';
import { traducirError } from '../comun/errores';
import { cargarConfiguracion, type Configuracion } from '../configuracion/configuracion';
import { BaseDatosService } from './base-datos.service';
import type { DB } from './tipos-bd';

// Pruebas de integración contra la base de pruebas (test/preparar-bd.mjs la recrea en cada corrida)

async function usuarioActual(ejecutor: Kysely<DB>): Promise<number | null> {
  const { rows } = await sql<{ id: number | null }>`select fn_usuario_actual() as id`.execute(
    ejecutor,
  );
  return rows[0].id;
}

describe('BaseDatosService', () => {
  let config: Configuracion;
  let bd: BaseDatosService;
  let adminId: number;
  let anaId: number;

  async function idUsuario(username: string): Promise<number> {
    const fila = await bd.db
      .selectFrom('usuario')
      .select('id')
      .where('username', '=', username)
      .executeTakeFirstOrThrow();
    return fila.id;
  }

  async function telefonoLam(): Promise<string | null> {
    const fila = await bd.db
      .selectFrom('sucursal')
      .select('telefono')
      .where('codigo', '=', 'LAM')
      .executeTakeFirstOrThrow();
    return fila.telefono;
  }

  beforeAll(async () => {
    config = cargarConfiguracion();
    bd = new BaseDatosService(config);
    adminId = await idUsuario('admin');
    anaId = await idUsuario('ana.martinez');
  });

  afterAll(() => bd.onApplicationShutdown());

  it('usa la base de pruebas, nunca la de desarrollo', () => {
    expect(new URL(config.baseDatos.url).pathname).toMatch(/_test$/);
  });

  it('se conecta a PostgreSQL', async () => {
    expect(await bd.verificarConexion()).toBe(true);
  });

  describe('transaccion() y app.usuario_id', () => {
    it('fija el usuario dentro de la transacción', async () => {
      expect(await bd.transaccion(adminId, (trx) => usuarioActual(trx))).toBe(adminId);
    });

    it('sin usuario (p. ej. login) fn_usuario_actual() es NULL', async () => {
      expect(await bd.transaccion(null, (trx) => usuarioActual(trx))).toBeNull();
    });

    it('el usuario no pasa a la siguiente operación que reutiliza la misma conexión', async () => {
      const unaConexion = new BaseDatosService({
        ...config,
        baseDatos: { ...config.baseDatos, maxConexiones: 1 },
      });
      try {
        await unaConexion.transaccion(adminId, (trx) => usuarioActual(trx));
        expect(await usuarioActual(unaConexion.db)).toBeNull();
        expect(await unaConexion.transaccion(null, (trx) => usuarioActual(trx))).toBeNull();
        expect(await unaConexion.transaccion(anaId, (trx) => usuarioActual(trx))).toBe(anaId);
      } finally {
        await unaConexion.onApplicationShutdown();
      }
    });

    it('transacciones simultáneas no mezclan usuarios', async () => {
      const trabajo = async (trx: Kysely<DB>) => {
        await sql`select pg_sleep(0.05)`.execute(trx);
        return usuarioActual(trx);
      };
      const resultados = await Promise.all([
        bd.transaccion(adminId, trabajo),
        bd.transaccion(anaId, trabajo),
        bd.transaccion(null, trabajo),
      ]);
      expect(resultados).toEqual([adminId, anaId, null]);
    });

    it('la auditoría registra al usuario de la transacción', async () => {
      const telefono = `2${String(Date.now()).slice(-7)}`;
      const { id } = await bd.transaccion(adminId, (trx) =>
        trx
          .updateTable('sucursal')
          .set({ telefono })
          .where('codigo', '=', 'LAM')
          .returning('id')
          .executeTakeFirstOrThrow(),
      );

      const registro = await bd.db
        .selectFrom('auditoria')
        .selectAll()
        .where('tabla', '=', 'sucursal')
        .where('registro_id', '=', String(id))
        .orderBy('id', 'desc')
        .executeTakeFirstOrThrow();
      expect(registro).toMatchObject({ accion: 'UPDATE', usuario_id: adminId });
      expect(registro.despues).toMatchObject({ telefono });
    });

    it('si el trabajo falla, se revierte todo y el error se propaga', async () => {
      const antes = await telefonoLam();
      await expect(
        bd.transaccion(adminId, async (trx) => {
          await trx
            .updateTable('sucursal')
            .set({ telefono: '9999-9999' })
            .where('codigo', '=', 'LAM')
            .execute();
          throw new Error('falla a propósito');
        }),
      ).rejects.toThrow('falla a propósito');
      expect(await telefonoLam()).toBe(antes);
    });

    it('rechaza un usuarioId inválido sin tocar la base', async () => {
      for (const invalido of [0, -1, 1.5, Number.NaN]) {
        await expect(bd.transaccion(invalido, async () => 'no debe ejecutarse')).rejects.toThrow(
          'usuarioId inválido',
        );
      }
    });
  });

  describe('errores de las reglas en la base', () => {
    it('permiso denegado llega como 42501 y se traduce a 403', async () => {
      const error = await bd
        .transaccion(anaId, (trx) =>
          sql`select fn_exigir_permiso(${anaId}, 'USUARIOS_GESTIONAR')`.execute(trx),
        )
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DatabaseError);
      expect(traducirError(error)).toEqual({
        estado: 403,
        cuerpo: {
          codigo: 'PERMISO_DENEGADO',
          mensaje: 'Permiso denegado: se requiere USUARIOS_GESTIONAR',
        },
      });
    });

    it('regla de un trigger llega como P0001 y se traduce a 422', async () => {
      const error = await bd
        .transaccion(adminId, (trx) =>
          trx.deleteFrom('usuario').where('username', '=', 'carlos.ruiz').execute(),
        )
        .catch((e: unknown) => e);
      expect(traducirError(error)).toEqual({
        estado: 422,
        cuerpo: {
          codigo: 'REGLA_NEGOCIO',
          mensaje: 'Los usuarios no se eliminan: desactívelos (activo = false)',
        },
      });
    });

    it('CHECK de una tabla se traduce a 422 con el nombre de la restricción', async () => {
      const error = await bd
        .transaccion(adminId, (trx) =>
          trx.updateTable('stock_sucursal').set({ cantidad: -1 }).execute(),
        )
        .catch((e: unknown) => e);
      expect(traducirError(error)).toEqual({
        estado: 422,
        cuerpo: expect.objectContaining({
          codigo: 'REGLA_NEGOCIO',
          restriccion: 'stock_sucursal_cantidad_check',
        }),
      });
    });
  });

  it('convierte tipos: bigint → number, date → texto, numeric → texto exacto', async () => {
    const { rows } = await sql<{ n: number; d: string; m: string; t: Date }>`
      select 9007199254740991::bigint as n, date '2026-10-01' as d, 950.50::numeric(12,2) as m,
             timestamptz '2026-10-01 08:00-06' as t`.execute(bd.db);
    expect(rows[0]).toEqual({
      n: 9007199254740991,
      d: '2026-10-01',
      m: '950.50',
      t: new Date('2026-10-01T14:00:00Z'),
    });
  });
});
