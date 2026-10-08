import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { alCambiarSesion, api, ponerToken, renovarSesion } from '../api/cliente';
import type { DatosSesion, PantallaPin, RespuestaSesion } from '../api/tipos';
import { useInactividad } from './inactividad';

/**
 * La sesión de quien usa la app.
 * - `cargando`: al abrir, se intenta recuperar la sesión con la cookie.
 * - `fuera`: no hay sesión. `pantalla` dice si este navegador es un equipo registrado y abierto
 *   (entonces se entra con PIN) o no (usuario y contraseña).
 * - `dentro`: hay sesión; `sesion` trae el usuario, sus permisos, el equipo y el tipo de acceso.
 */
export type EstadoSesion =
  | { fase: 'cargando' }
  | { fase: 'fuera'; pantalla: PantallaPin }
  | { fase: 'dentro'; sesion: DatosSesion };

export interface ControlSesion {
  estado: EstadoSesion;
  entrar: (username: string, password: string) => Promise<void>;
  entrarConPin: (usuarioId: number, pin: string) => Promise<void>;
  cambiarPassword: (actual: string, nueva: string) => Promise<void>;
  /** Cierra esta sesión; en un equipo abierto queda la pantalla de PIN para la siguiente persona. */
  bloquear: () => Promise<void>;
  /** Fin del día: el equipo deja de aceptar PIN y se cierran todas sus sesiones. */
  cerrarEquipo: () => Promise<void>;
  /** Vuelve a leer la sesión (después de crear el PIN o de registrar el equipo). */
  refrescar: () => Promise<void>;
}

const SIN_EQUIPO: PantallaPin = { equipo: null, abierto: false, usuarios: [] };

const Contexto = createContext<ControlSesion | null>(null);

function datosDe(respuesta: RespuestaSesion): DatosSesion {
  const { usuario, equipo, acceso, pantalla_bloqueo_minutos } = respuesta;
  return { usuario, equipo, acceso, pantalla_bloqueo_minutos };
}

async function pantallaDeBloqueo(): Promise<PantallaPin> {
  try {
    return await api<PantallaPin>('GET', '/auth/pin/usuarios', { publica: true });
  } catch {
    return SIN_EQUIPO; // sin conexión: se muestra el inicio de sesión normal
  }
}

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const consultas = useQueryClient();
  const [estado, setEstado] = useState<EstadoSesion>({ fase: 'cargando' });

  const abrir = useCallback((respuesta: RespuestaSesion) => {
    ponerToken(respuesta.access_token);
    setEstado({ fase: 'dentro', sesion: datosDe(respuesta) });
  }, []);

  const quedarFuera = useCallback(async () => {
    ponerToken(null);
    consultas.clear(); // lo que vio una persona no se le muestra a la siguiente
    setEstado({ fase: 'fuera', pantalla: await pantallaDeBloqueo() });
  }, [consultas]);

  useEffect(() => {
    alCambiarSesion({ renovada: abrir, terminada: () => void quedarFuera() });
    let vigente = true;
    void (async () => {
      const sesion = await renovarSesion().catch(() => null);
      if (!vigente) return;
      if (sesion) abrir(sesion);
      else await quedarFuera();
    })();
    return () => {
      vigente = false;
    };
  }, [abrir, quedarFuera]);

  const control = useMemo<ControlSesion>(() => {
    const cerrar = async (ruta: string) => {
      try {
        await api<void>('POST', ruta, { publica: ruta === '/auth/logout' });
      } finally {
        await quedarFuera();
      }
    };
    return {
      estado,
      entrar: async (username, password) => {
        abrir(
          await api<RespuestaSesion>('POST', '/auth/login', {
            cuerpo: { username, password },
            publica: true,
          }),
        );
      },
      entrarConPin: async (usuarioId, pin) => {
        abrir(
          await api<RespuestaSesion>('POST', '/auth/pin', {
            cuerpo: { usuario_id: usuarioId, pin },
            publica: true,
          }),
        );
      },
      cambiarPassword: async (actual, nueva) => {
        abrir(
          await api<RespuestaSesion>('POST', '/auth/cambiar-password', {
            cuerpo: { password_actual: actual, password_nueva: nueva },
          }),
        );
      },
      bloquear: () => cerrar('/auth/logout'),
      cerrarEquipo: () => cerrar('/equipos/actual/cerrar'),
      refrescar: async () => {
        const sesion = await api<DatosSesion>('GET', '/auth/yo');
        setEstado({ fase: 'dentro', sesion });
      },
    };
  }, [estado, abrir, quedarFuera]);

  // En un equipo registrado la pantalla se bloquea sola tras un rato sin uso
  const minutos =
    estado.fase === 'dentro' && estado.sesion.equipo
      ? estado.sesion.pantalla_bloqueo_minutos
      : null;
  useInactividad(minutos, () => void control.bloquear());

  return <Contexto.Provider value={control}>{children}</Contexto.Provider>;
}

export function useSesion(): ControlSesion {
  const control = useContext(Contexto);
  if (!control) throw new Error('useSesion() fuera de <ProveedorSesion>');
  return control;
}

/** La sesión abierta, para las pantallas que solo existen con alguien dentro. */
export function useSesionActiva(): DatosSesion {
  const { estado } = useSesion();
  if (estado.fase !== 'dentro') throw new Error('Esta pantalla necesita una sesión abierta');
  return estado.sesion;
}

/** ¿Tiene (en esta sesión) alguno de estos permisos? Sin permisos que pedir, sí. */
export function tienePermiso(sesion: DatosSesion, permisos: readonly string[]): boolean {
  return permisos.length === 0 || permisos.some((p) => sesion.usuario.permisos.includes(p));
}
