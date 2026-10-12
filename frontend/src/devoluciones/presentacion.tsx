import { CircleCheck } from 'lucide-react';
import type { DevolucionResumen } from '../api/tipos';
import { Etiqueta } from '../ui/basicos';

// Cómo se nombran y de qué color van las devoluciones en todas sus pantallas. Regla del tema: lo
// pendiente en ámbar, el rojo solo para lo rechazado, y lo aprobado con su check.

type Tono = 'neutro' | 'aviso' | 'error' | 'exito';

const ESTADOS: Record<string, { nombre: string; tono: Tono }> = {
  PENDIENTE: { nombre: 'Esperando aprobación', tono: 'aviso' },
  APROBADA: { nombre: 'Aprobada', tono: 'exito' },
  RECHAZADA: { nombre: 'Rechazada', tono: 'error' },
  EJECUTADA: { nombre: 'Ejecutada', tono: 'neutro' },
  CANCELADA: { nombre: 'Cancelada', tono: 'neutro' },
};

export function nombreDeTipo(tipo: string): string {
  return tipo === 'CAMBIO' ? 'Cambio' : 'Devolución';
}

export function EtiquetaDeEstado({ devolucion }: { devolucion: DevolucionResumen }) {
  const estado = ESTADOS[devolucion.estado] ?? { nombre: devolucion.estado, tono: 'neutro' };
  return (
    <Etiqueta tono={estado.tono}>
      {estado.tono === 'exito' && <CircleCheck className="mr-1 size-3.5" aria-hidden />}
      {estado.nombre}
    </Etiqueta>
  );
}

export const enlaceVolver =
  'flex min-h-toque items-center gap-2 self-start rounded-xl px-2 font-semibold text-esmeralda hover:bg-esmeralda-claro';
