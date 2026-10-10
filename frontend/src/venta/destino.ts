import { useQuery } from '@tanstack/react-query';
import { api, mensajeDeError } from '../api/cliente';
import type { CajaAbierta, Sucursal, TurnoActual } from '../api/tipos';
import { useSesionActiva } from '../sesion/sesion';

/**
 * Dónde entra la venta. La pantalla no decide el turno: en un equipo registrado es el de su caja;
 * sin equipo (el celular de la vendedora, o el administrador desde donde esté) es el turno abierto
 * de una de sus sucursales, y solo se elige cuando hay más de una caja abierta.
 */
export type Destino =
  | { estado: 'cargando' }
  | { estado: 'error'; mensaje: string }
  /** No hay una caja abierta donde vender. */
  | { estado: 'sin-turno' }
  /** Hay más de una caja abierta: falta decir en cuál entra la venta. */
  | { estado: 'elegir'; cajas: CajaAbierta[] }
  | {
      estado: 'listo';
      turnoId: number;
      sucursal: Sucursal;
      caja: { id: number; nombre: string };
      /** Lo que se envía como `caja_id`; null en un equipo registrado (la caja sale de él). */
      cajaId: number | null;
      /** Las demás cajas abiertas, para cambiar de una a otra (vacío en un equipo registrado). */
      cajas: CajaAbierta[];
    };

const CADA_MINUTO = 60_000;

export function useDestinoDeVenta(cajaElegida: number | null): Destino {
  const sesion = useSesionActiva();
  const enEquipo = sesion.equipo !== null;

  const turno = useQuery({
    queryKey: ['turno'],
    queryFn: () => api<{ turno: TurnoActual | null }>('GET', '/caja/turno'),
    enabled: enEquipo,
    refetchInterval: CADA_MINUTO,
  });
  const abiertas = useQuery({
    queryKey: ['caja', 'abiertas'],
    queryFn: () => api<{ cajas: CajaAbierta[] }>('GET', '/caja/abiertas'),
    enabled: !enEquipo,
    refetchInterval: CADA_MINUTO,
  });

  if (enEquipo) {
    if (turno.isPending) return { estado: 'cargando' };
    if (turno.isError) return { estado: 'error', mensaje: mensajeDeError(turno.error) };
    const abierto = turno.data.turno;
    if (!abierto) return { estado: 'sin-turno' };
    return {
      estado: 'listo',
      turnoId: abierto.id,
      sucursal: abierto.sucursal,
      caja: abierto.caja,
      cajaId: null,
      cajas: [],
    };
  }

  if (abiertas.isPending) return { estado: 'cargando' };
  if (abiertas.isError) return { estado: 'error', mensaje: mensajeDeError(abiertas.error) };
  const { cajas } = abiertas.data;
  if (cajas.length === 0) return { estado: 'sin-turno' };
  const elegida =
    cajas.length === 1 ? cajas[0] : (cajas.find((c) => c.caja.id === cajaElegida) ?? null);
  if (!elegida) return { estado: 'elegir', cajas };
  return {
    estado: 'listo',
    turnoId: elegida.turno_id,
    sucursal: elegida.sucursal,
    caja: elegida.caja,
    cajaId: elegida.caja.id,
    cajas,
  };
}
