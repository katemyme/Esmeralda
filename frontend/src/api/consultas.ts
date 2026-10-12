import { useQuery } from '@tanstack/react-query';
import { tienePermiso, useSesionActiva } from '../sesion/sesion';
import { api } from './cliente';
import type { DevolucionResumen, ListaAlertas, TipoCambio, TurnoActual } from './tipos';

// Lo que varias pantallas de la base consultan. Se refresca solo cada minuto y al volver a la app.

const CADA_MINUTO = 60_000;

/** ¿Lee las alertas del panel (ALERTAS_VER) o los avisos de su sucursal? */
export function useRutaAlertas(): '/alertas' | '/alertas/sucursal' {
  const sesion = useSesionActiva();
  return tienePermiso(sesion, ['ALERTAS_VER']) ? '/alertas' : '/alertas/sucursal';
}

/** Cuántas alertas pendientes tiene quien usa la app (para la campana). */
export function usePendientes(): number {
  const ruta = useRutaAlertas();
  const { data } = useQuery({
    queryKey: ['alertas', ruta, 'conteo'],
    queryFn: () => api<ListaAlertas>('GET', `${ruta}?limite=1`),
    refetchInterval: CADA_MINUTO,
  });
  return data?.total_pendientes ?? 0;
}

/**
 * El turno abierto de la caja del equipo (sin montos: el arqueo es a ciegas). Solo se pregunta
 * desde un equipo registrado; el celular no tiene caja propia.
 */
export function useTurno(): TurnoActual | null {
  const sesion = useSesionActiva();
  const puede =
    sesion.equipo !== null &&
    tienePermiso(sesion, ['CAJA_ABRIR', 'CAJA_CERRAR', 'VENTAS_REGISTRAR']);
  const { data } = useQuery({
    queryKey: ['turno'],
    queryFn: () => api<{ turno: TurnoActual | null }>('GET', '/caja/turno'),
    enabled: puede,
    refetchInterval: CADA_MINUTO,
  });
  return data?.turno ?? null;
}

/**
 * Cuántas devoluciones esperan la aprobación de quien las aprueba (el administrador); null para
 * los demás, que no aprueban. Es un conteo: los montos están en cada solicitud.
 */
export function usePorAprobar(): number | null {
  const sesion = useSesionActiva();
  const aprueba = tienePermiso(sesion, ['DEVOLUCIONES_APROBAR']);
  const { data } = useQuery({
    queryKey: ['devoluciones', 'por-aprobar'],
    queryFn: () =>
      api<{ devoluciones: DevolucionResumen[] }>('GET', '/devoluciones?estado=PENDIENTE&limite=50'),
    enabled: aprueba,
    refetchInterval: CADA_MINUTO,
  });
  return aprueba ? (data?.devoluciones.length ?? 0) : null;
}

const tipoCambioVigente = {
  queryKey: ['tipo-cambio'],
  queryFn: () => api<{ tipo_cambio: TipoCambio | null }>('GET', '/tipo-cambio'),
  refetchInterval: 5 * CADA_MINUTO,
};

export function useTipoCambio(): TipoCambio | null {
  const { data } = useQuery(tipoCambioVigente);
  return data?.tipo_cambio ?? null;
}

/** Ya se sabe que hoy todavía no se registra el tipo de cambio (mientras se pregunta, no). */
export function useFaltaTipoCambioDeHoy(): boolean {
  const { data } = useQuery(tipoCambioVigente);
  return data !== undefined && !data.tipo_cambio?.es_de_hoy;
}
