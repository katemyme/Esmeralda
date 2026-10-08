import { AlertDialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { Boton } from './basicos';

interface Props {
  abierta: boolean;
  alCerrar: () => void;
  titulo: string;
  children: ReactNode;
  textoConfirmar: string;
  alConfirmar: () => void;
  ocupado?: boolean;
  peligro?: boolean;
}

/** Pregunta antes de hacer algo que no tiene vuelta atrás. En el celular sale pegada abajo. */
export function Confirmacion({
  abierta,
  alCerrar,
  titulo,
  children,
  textoConfirmar,
  alConfirmar,
  ocupado = false,
  peligro = false,
}: Props) {
  return (
    <AlertDialog.Root open={abierta} onOpenChange={(abrir) => !abrir && alCerrar()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-texto/45" />
        <AlertDialog.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-superficie p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-xl sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[28rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl">
          <AlertDialog.Title className="text-lg font-semibold text-texto">
            {titulo}
          </AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="mt-2 text-texto-secundario">{children}</div>
          </AlertDialog.Description>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Boton variante="secundario" disabled={ocupado}>
                Cancelar
              </Boton>
            </AlertDialog.Cancel>
            <Boton
              variante={peligro ? 'peligro' : 'primario'}
              ocupado={ocupado}
              onClick={alConfirmar}
            >
              {textoConfirmar}
            </Boton>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
