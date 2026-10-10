import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ErrorApi, api, apiArchivo, mensajeDeError } from '../api/cliente';
import type { ColaDeEquipo, TicketEnCola, TicketEnRenglones } from '../api/tipos';
import { useSesion } from '../sesion/sesion';
import { comandosDeTicket, imprimirConDialogo, imprimirPorUsb, modoDeImpresion } from './imprimir';
import { mensajeDeImpresora } from './impresora';

/**
 * La cola de impresión de este equipo: los tickets de las ventas hechas desde un celular, que
 * salen aquí, en el equipo registrado de la sucursal.
 *
 * La atiende el equipo y no una persona: funciona con alguien dentro y también en la pantalla de
 * PIN, mientras el equipo esté abierto. Por eso habla con la API sin sesión (la API reconoce al
 * equipo por su cookie). Imprime cada ticket con un toque o, si el parámetro lo pide, solo.
 *
 * Cuidados para que un ticket no salga dos veces ni como copia:
 * - el ticket se pide una vez y se guarda; reintentar manda el mismo (y la API, además, entrega el
 *   mismo original mientras siga en la cola);
 * - si el papel ya salió y lo que falló fue avisarlo, el reintento solo avisa;
 * - con la app abierta en dos pestañas del mismo equipo, solo una imprime sola.
 */

const CADA_CUANTO_MS = 8_000;
const CANDADO = 'esmeralda-cola-de-impresion';

export type EstadoDeTicket = { fase: 'imprimiendo' } | { fase: 'error'; mensaje: string };

export interface Cola {
  /** Este navegador es un equipo registrado y abierto: tiene una cola que atender. */
  atendida: boolean;
  /** El equipo imprime los tickets sin que nadie los toque. */
  automatica: boolean;
  tickets: TicketEnCola[];
  /** Lo que está pasando con cada ticket (por su id); sin entrada, espera tranquilo. */
  estados: Record<number, EstadoDeTicket>;
  imprimir: (id: number) => Promise<void>;
}

const VACIA: Cola = {
  atendida: false,
  automatica: false,
  tickets: [],
  estados: {},
  imprimir: () => Promise.resolve(),
};

const Contexto = createContext<Cola>(VACIA);

export function useCola(): Cola {
  return useContext(Contexto);
}

/** Solo una pestaña del equipo imprime sola: la primera que consigue el candado del navegador. */
function useEsLaQueImprime(activo: boolean): boolean {
  const disponible = typeof navigator !== 'undefined' && 'locks' in navigator;
  const [conseguido, setConseguido] = useState(false);
  useEffect(() => {
    if (!activo || !disponible) return;
    let soltar = () => {};
    let vigente = true;
    void navigator.locks.request(CANDADO, () => {
      if (!vigente) return undefined;
      setConseguido(true);
      return new Promise<void>((resolver) => {
        soltar = resolver;
      });
    });
    return () => {
      vigente = false;
      setConseguido(false);
      soltar();
    };
  }, [activo, disponible]);
  return activo && (disponible ? conseguido : true);
}

export function ProveedorCola({ children }: { children: ReactNode }) {
  const { estado: sesion } = useSesion();
  const consultas = useQueryClient();
  const equipoAbierto =
    (sesion.fase === 'dentro' && sesion.sesion.equipo !== null) ||
    (sesion.fase === 'fuera' && sesion.pantalla.equipo !== null && sesion.pantalla.abierto);

  const consulta = useQuery({
    queryKey: ['cola-impresion'],
    queryFn: () => api<ColaDeEquipo>('GET', '/cola-impresion', { publica: true }),
    enabled: equipoAbierto,
    refetchInterval: CADA_CUANTO_MS,
  });
  const cola = equipoAbierto ? consulta.data : undefined;

  const [estados, setEstados] = useState<Record<number, EstadoDeTicket>>({});
  /** Lo ya pedido a la API, por ticket: reintentar no lo pide otra vez. */
  const pedidos = useRef(new Map<number, { usb?: Uint8Array; pdf?: Blob }>());
  /** Tickets cuyo papel ya salió: si falta algo, es solo avisarle a la API. */
  const salieron = useRef(new Set<number>());
  const enCurso = useRef(new Set<number>());

  const imprimir = useCallback(
    async (id: number) => {
      if (enCurso.current.has(id)) return;
      enCurso.current.add(id);
      setEstados((e) => ({ ...e, [id]: { fase: 'imprimiendo' } }));
      try {
        if (!salieron.current.has(id)) {
          const pedido = pedidos.current.get(id) ?? {};
          pedidos.current.set(id, pedido);
          if (modoDeImpresion() === 'usb') {
            if (!pedido.usb) {
              const ticket = await api<TicketEnRenglones>(
                'POST',
                `/cola-impresion/${id}/ticket?formato=renglones`,
                { publica: true },
              );
              pedido.usb = comandosDeTicket(ticket.renglones, { gaveta: ticket.abrir_gaveta });
            }
            await imprimirPorUsb(pedido.usb);
          } else {
            pedido.pdf ??= await apiArchivo('POST', `/cola-impresion/${id}/ticket`, {
              publica: true,
            });
            await imprimirConDialogo(pedido.pdf);
          }
          salieron.current.add(id);
        }
        await api<void>('POST', `/cola-impresion/${id}/impreso`, { publica: true });
        pedidos.current.delete(id);
        setEstados(({ [id]: _listo, ...resto }) => resto);
        await consultas.invalidateQueries({ queryKey: ['cola-impresion'] });
      } catch (error) {
        const mensaje =
          error instanceof ErrorApi ? mensajeDeError(error) : mensajeDeImpresora(error);
        setEstados((e) => ({ ...e, [id]: { fase: 'error', mensaje } }));
        // otro equipo lo imprimió, o alguien lo quitó: la lista se pone al día
        if (error instanceof ErrorApi) {
          await consultas.invalidateQueries({ queryKey: ['cola-impresion'] });
        }
      } finally {
        enCurso.current.delete(id);
      }
    },
    [consultas],
  );

  // Sola, de uno en uno y del más antiguo al más nuevo. Un ticket que falló no se reintenta solo:
  // se queda a la vista hasta que alguien revise la impresora y toque «Reintentar».
  const imprimeSola = useEsLaQueImprime(cola?.automatica === true);
  const siguiente =
    imprimeSola && !Object.values(estados).some((e) => e.fase === 'imprimiendo')
      ? cola?.tickets.find((t) => !t.en_curso && !estados[t.id])
      : undefined;
  const idSiguiente = siguiente?.id;
  useEffect(() => {
    if (idSiguiente === undefined) return;
    // fuera del efecto: imprimir cambia el estado de la cola
    const reloj = window.setTimeout(() => void imprimir(idSiguiente), 0);
    return () => window.clearTimeout(reloj);
  }, [idSiguiente, imprimir]);

  const valor = useMemo<Cola>(
    () =>
      cola?.atendida
        ? { atendida: true, automatica: cola.automatica, tickets: cola.tickets, estados, imprimir }
        : VACIA,
    [cola, estados, imprimir],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}
