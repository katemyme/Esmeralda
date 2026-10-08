import { Delete } from 'lucide-react';

const LARGO = 4;
const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

interface Props {
  /** Los dígitos escritos hasta ahora (0 a 4). */
  valor: string;
  alCambiar: (valor: string) => void;
  /** Se llama al escribir el cuarto dígito. */
  alCompletar?: (pin: string) => void;
  deshabilitado?: boolean;
  /** Para lectores de pantalla: «PIN de María». */
  nombre: string;
}

/** Teclado numérico grande para el PIN de 4 dígitos. Muestra puntos, nunca los números. */
export function TecladoPin({
  valor,
  alCambiar,
  alCompletar,
  deshabilitado = false,
  nombre,
}: Props) {
  const escribir = (digito: string) => {
    if (deshabilitado || valor.length >= LARGO) return;
    const nuevo = valor + digito;
    alCambiar(nuevo);
    if (nuevo.length === LARGO) alCompletar?.(nuevo);
  };
  const tecla =
    'flex h-16 items-center justify-center rounded-2xl border border-borde bg-superficie text-2xl font-semibold text-texto select-none active:bg-esmeralda-claro disabled:opacity-50';

  return (
    <div className="mx-auto flex w-full max-w-xs flex-col items-center gap-5">
      <output aria-label={`${nombre}: ${valor.length} de ${LARGO} dígitos`} className="flex gap-4">
        {Array.from({ length: LARGO }, (_, i) => (
          <span
            key={i}
            className={`size-4 rounded-full border-2 ${i < valor.length ? 'border-esmeralda bg-esmeralda' : 'border-borde bg-superficie'}`}
          />
        ))}
      </output>
      <div className="grid w-full grid-cols-3 gap-3">
        {TECLAS.map((digito) => (
          <button
            key={digito}
            type="button"
            className={tecla}
            disabled={deshabilitado}
            onClick={() => escribir(digito)}
          >
            {digito}
          </button>
        ))}
        <span />
        <button
          type="button"
          className={tecla}
          disabled={deshabilitado}
          onClick={() => escribir('0')}
        >
          0
        </button>
        <button
          type="button"
          className={tecla}
          disabled={deshabilitado || valor.length === 0}
          aria-label="Borrar"
          onClick={() => alCambiar(valor.slice(0, -1))}
        >
          <Delete className="size-7" aria-hidden />
        </button>
      </div>
    </div>
  );
}
