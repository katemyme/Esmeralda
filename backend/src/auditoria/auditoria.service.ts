import { Injectable } from '@nestjs/common';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { finDelDia, inicioDelDia } from '../comun/fechas';
import type { FiltroAccesos, FiltroCambios } from './esquemas';

interface UsuarioReferido {
  id: number;
  nombre_completo: string;
}

/** Un cambio en los datos maestros (usuarios, productos, precios, parámetros, sucursales...). */
export interface CambioAuditado {
  id: number;
  tabla: string;
  registro_id: string | null;
  /** INSERT, UPDATE o DELETE. */
  accion: string;
  /** La fila antes y después del cambio (nunca incluye contraseñas ni tokens). */
  antes: unknown;
  despues: unknown;
  /** Quién lo hizo (null: el propio sistema, p. ej. un intento de login). */
  usuario: UsuarioReferido | null;
  fecha: Date;
}

/** Un intento de inicio de sesión, haya entrado o no. */
export interface AccesoRegistrado {
  id: number;
  usuario: UsuarioReferido | null;
  username_intentado: string;
  exito: boolean;
  /** Por qué no entró: contraseña incorrecta, cuenta bloqueada, equipo no autorizado... */
  motivo: string | null;
  ip: string | null;
  user_agent: string | null;
  equipo: { id: string; nombre: string } | null;
  fecha: Date;
}

function usuario(id: number | null, nombre: string | null): UsuarioReferido | null {
  return id !== null && nombre !== null ? { id, nombre_completo: nombre } : null;
}

/** Bitácora: la escriben los triggers de la base (fn_auditar) y fn_registrar_login; aquí solo se lee. */
@Injectable()
export class AuditoriaService {
  constructor(private readonly bd: BaseDatosService) {}

  /** Cambios en los datos maestros, del más reciente al más antiguo. */
  async cambios(filtro: FiltroCambios): Promise<CambioAuditado[]> {
    let consulta = this.bd.db
      .selectFrom('auditoria as a')
      .leftJoin('usuario as u', 'u.id', 'a.usuario_id')
      .select([
        'a.id',
        'a.tabla',
        'a.registro_id',
        'a.accion',
        'a.antes',
        'a.despues',
        'a.fecha',
        'u.id as usuario_id',
        'u.nombre_completo as usuario_nombre',
      ])
      .orderBy('a.id', 'desc')
      .limit(filtro.limite);
    if (filtro.tabla) consulta = consulta.where('a.tabla', '=', filtro.tabla);
    if (filtro.registro_id) consulta = consulta.where('a.registro_id', '=', filtro.registro_id);
    if (filtro.usuario_id) consulta = consulta.where('a.usuario_id', '=', filtro.usuario_id);
    if (filtro.accion) consulta = consulta.where('a.accion', '=', filtro.accion);
    if (filtro.desde) consulta = consulta.where('a.fecha', '>=', inicioDelDia(filtro.desde));
    if (filtro.hasta) consulta = consulta.where('a.fecha', '<', finDelDia(filtro.hasta));
    if (filtro.antes_de) consulta = consulta.where('a.id', '<', filtro.antes_de);

    const filas = await consulta.execute();
    return filas.map((f) => ({
      id: f.id,
      tabla: f.tabla,
      registro_id: f.registro_id,
      accion: f.accion,
      antes: f.antes,
      despues: f.despues,
      usuario: usuario(f.usuario_id, f.usuario_nombre),
      fecha: f.fecha,
    }));
  }

  /** Inicios de sesión (exitosos y fallidos), del más reciente al más antiguo. */
  async accesos(filtro: FiltroAccesos): Promise<AccesoRegistrado[]> {
    let consulta = this.bd.db
      .selectFrom('acceso_log as l')
      .leftJoin('usuario as u', 'u.id', 'l.usuario_id')
      .leftJoin('dispositivo as d', 'd.id', 'l.dispositivo_id')
      .select([
        'l.id',
        'l.username_intentado',
        'l.exito',
        'l.motivo',
        'l.ip',
        'l.user_agent',
        'l.fecha',
        'u.id as usuario_id',
        'u.nombre_completo as usuario_nombre',
        'd.id as equipo_id',
        'd.nombre as equipo_nombre',
      ])
      .orderBy('l.id', 'desc')
      .limit(filtro.limite);
    if (filtro.usuario_id) consulta = consulta.where('l.usuario_id', '=', filtro.usuario_id);
    if (filtro.username) consulta = consulta.where('l.username_intentado', '=', filtro.username);
    if (filtro.exito !== undefined) consulta = consulta.where('l.exito', '=', filtro.exito);
    if (filtro.desde) consulta = consulta.where('l.fecha', '>=', inicioDelDia(filtro.desde));
    if (filtro.hasta) consulta = consulta.where('l.fecha', '<', finDelDia(filtro.hasta));
    if (filtro.antes_de) consulta = consulta.where('l.id', '<', filtro.antes_de);

    const filas = await consulta.execute();
    return filas.map((f) => ({
      id: f.id,
      usuario: usuario(f.usuario_id, f.usuario_nombre),
      username_intentado: f.username_intentado,
      exito: f.exito,
      motivo: f.motivo,
      ip: f.ip,
      user_agent: f.user_agent,
      equipo:
        f.equipo_id !== null && f.equipo_nombre !== null
          ? { id: f.equipo_id, nombre: f.equipo_nombre }
          : null,
      fecha: f.fecha,
    }));
  }
}
