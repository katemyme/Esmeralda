import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useSesion } from '../sesion/sesion';
import { Aviso, Boton } from '../ui/basicos';

/**
 * Pantalla siempre encendida (Wake Lock) en el equipo del mostrador. Mientras el equipo está
 * abierto —con alguien dentro o en la pantalla de PIN— la app pide al navegador que no apague la
 * pantalla: la cola de tickets y la impresión automática dependen de que la app siga activa.
 * Si el navegador no lo permite o lo suelta, se avisa bien visible.
 */
export type EstadoDespierta =
  /** No hace falta: no es un equipo registrado y abierto. */
  | 'inactivo'
  | 'activo'
  /** El navegador no tiene Wake Lock. */
  | 'no-disponible'
  /** Se pidió y el navegador no lo dio, o lo soltó (batería baja, ahorro de energía). */
  | 'perdido';

const Contexto = createContext<EstadoDespierta>('inactivo');

export function useDespierta(): EstadoDespierta {
  return useContext(Contexto);
}

export function useMantenerDespierta(activo: boolean): {
  estado: EstadoDespierta;
  reintentar: () => void;
} {
  // Lo último que respondió el navegador al pedírselo; lo demás se deduce al dibujar
  const [respuesta, setRespuesta] = useState<'activo' | 'perdido'>('activo');
  const pedir = useRef<() => void>(() => {});
  const disponible = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

  useEffect(() => {
    if (!activo || !disponible) return;
    let vigente = true;
    let centinela: WakeLockSentinel | null = null;
    const solicitar = async () => {
      if (
        !vigente ||
        document.visibilityState !== 'visible' ||
        (centinela && !centinela.released)
      ) {
        return;
      }
      try {
        const nuevo = await navigator.wakeLock.request('screen');
        if (!vigente) {
          void nuevo.release();
          return;
        }
        centinela = nuevo;
        setRespuesta('activo');
        // Al ocultar la app el navegador lo suelta solo: se vuelve a pedir al regresar
        nuevo.addEventListener('release', () => {
          if (vigente && document.visibilityState === 'visible') setRespuesta('perdido');
        });
      } catch {
        if (vigente) setRespuesta('perdido');
      }
    };
    pedir.current = () => void solicitar();
    const alVolver = () => void solicitar();
    void solicitar();
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      vigente = false;
      document.removeEventListener('visibilitychange', alVolver);
      void centinela?.release().catch(() => {});
    };
  }, [activo, disponible]);

  const reintentar = useCallback(() => pedir.current(), []);
  const estado: EstadoDespierta = !activo ? 'inactivo' : disponible ? respuesta : 'no-disponible';
  return { estado, reintentar };
}

/** Mantiene despierta la pantalla del equipo abierto y avisa cuando no puede. */
export function PantallaDespierta({ children }: { children: ReactNode }) {
  const { estado: sesion } = useSesion();
  const equipoAbierto =
    (sesion.fase === 'dentro' && sesion.sesion.equipo !== null) ||
    (sesion.fase === 'fuera' && sesion.pantalla.equipo !== null && sesion.pantalla.abierto);
  const { estado, reintentar } = useMantenerDespierta(equipoAbierto);

  return (
    <Contexto.Provider value={estado}>
      {(estado === 'no-disponible' || estado === 'perdido') && (
        <div className="sticky top-0 z-40 bg-fondo p-2">
          <Aviso tipo="aviso">
            <p className="font-semibold">La pantalla de este equipo puede apagarse</p>
            <p className="font-normal">
              {estado === 'no-disponible'
                ? 'Este navegador no puede mantenerla encendida. Con la pantalla apagada no salen los tickets de la cola: use Chrome y desactive el apagado automático en los ajustes del equipo.'
                : 'El equipo dejó de mantenerla encendida (suele ser el ahorro de batería). Con la pantalla apagada no salen los tickets de la cola.'}
            </p>
            {estado === 'perdido' && (
              <Boton variante="secundario" className="mt-2" onClick={reintentar}>
                Mantener encendida
              </Boton>
            )}
          </Aviso>
        </div>
      )}
      {children}
    </Contexto.Provider>
  );
}
