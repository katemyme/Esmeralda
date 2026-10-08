import { CircleCheck, CircleX, Info, LoaderCircle, TriangleAlert } from 'lucide-react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
} from 'react';

// Piezas base, pensadas primero para tocar con el dedo: nada mide menos de 48 px de alto.

type Variante = 'primario' | 'secundario' | 'peligro' | 'texto';

const VARIANTES: Record<Variante, string> = {
  primario: 'bg-esmeralda text-white hover:bg-esmeralda-oscuro active:bg-esmeralda-oscuro',
  secundario:
    'border border-borde bg-superficie text-texto hover:bg-esmeralda-claro active:bg-esmeralda-claro',
  peligro: 'bg-error text-white hover:brightness-90 active:brightness-90',
  texto: 'text-esmeralda hover:bg-esmeralda-claro active:bg-esmeralda-claro',
};

interface PropsBoton extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  /** Muestra que la acción está en curso y no deja tocarlo otra vez. */
  ocupado?: boolean;
  ancho?: boolean;
}

export function Boton({
  variante = 'primario',
  ocupado = false,
  ancho = false,
  className = '',
  children,
  disabled,
  type = 'button',
  ...resto
}: PropsBoton) {
  return (
    <button
      type={type}
      disabled={disabled || ocupado}
      className={`inline-flex min-h-toque items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold transition-colors select-none disabled:cursor-not-allowed disabled:opacity-55 ${VARIANTES[variante]} ${ancho ? 'w-full' : ''} ${className}`}
      {...resto}
    >
      {ocupado && <LoaderCircle className="size-5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

interface PropsCampo extends InputHTMLAttributes<HTMLInputElement> {
  etiqueta: string;
  error?: string;
  ayuda?: string;
  ref?: Ref<HTMLInputElement>;
}

export function Campo({ etiqueta, error, ayuda, id, className = '', ref, ...resto }: PropsCampo) {
  const campo = id ?? resto.name;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={campo} className="text-sm font-medium text-texto">
        {etiqueta}
      </label>
      <input
        id={campo}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${campo}-error` : undefined}
        className={`min-h-toque rounded-xl border bg-superficie px-4 text-texto placeholder:text-texto-secundario ${error ? 'border-error' : 'border-borde'} ${className}`}
        {...resto}
      />
      {error ? (
        <p id={`${campo}-error`} className="text-sm text-error">
          {error}
        </p>
      ) : (
        ayuda && <p className="text-sm text-texto-secundario">{ayuda}</p>
      )}
    </div>
  );
}

interface PropsSelector extends SelectHTMLAttributes<HTMLSelectElement> {
  etiqueta: string;
  error?: string;
  ref?: Ref<HTMLSelectElement>;
}

/** Lista para elegir una opción, con su etiqueta arriba y su error abajo. */
export function Selector({ etiqueta, error, id, children, ref, ...resto }: PropsSelector) {
  const campo = id ?? resto.name;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={campo} className="text-sm font-medium text-texto">
        {etiqueta}
      </label>
      <select
        id={campo}
        ref={ref}
        aria-invalid={error ? true : undefined}
        className={`min-h-toque rounded-xl border bg-superficie px-3 text-texto ${error ? 'border-error' : 'border-borde'}`}
        {...resto}
      >
        {children}
      </select>
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}

export function Tarjeta({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-borde bg-superficie p-5 ${className}`}>
      {children}
    </section>
  );
}

type TipoAviso = 'exito' | 'aviso' | 'error' | 'info';

const AVISOS: Record<TipoAviso, { clases: string; icono: typeof Info }> = {
  // El éxito siempre con su check: así no se confunde con el verde de la marca
  exito: { clases: 'border-exito/30 bg-exito-claro text-exito', icono: CircleCheck },
  aviso: { clases: 'border-aviso/30 bg-aviso-claro text-aviso', icono: TriangleAlert },
  error: { clases: 'border-error/30 bg-error-claro text-error', icono: CircleX },
  info: { clases: 'border-info/30 bg-info-claro text-info', icono: Info },
};

export function Aviso({ tipo, children }: { tipo: TipoAviso; children: ReactNode }) {
  const { clases, icono: Icono } = AVISOS[tipo];
  return (
    <div
      role={tipo === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm font-medium ${clases}`}
    >
      <Icono className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="text-texto">{children}</div>
    </div>
  );
}

/** Etiqueta pequeña. `oro` es el acento de la marca: fondo oro claro con texto oro oscuro. */
export function Etiqueta({
  tono = 'neutro',
  children,
}: {
  tono?: 'neutro' | 'oro' | 'aviso' | 'error' | 'info' | 'exito';
  children: ReactNode;
}) {
  const tonos = {
    neutro: 'bg-fondo text-texto-secundario border border-borde',
    oro: 'bg-oro-claro text-oro-texto',
    aviso: 'bg-aviso-claro text-aviso',
    error: 'bg-error-claro text-error',
    info: 'bg-info-claro text-info',
    exito: 'bg-exito-claro text-exito',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${tonos[tono]}`}
    >
      {children}
    </span>
  );
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <output className="flex items-center justify-center gap-3 p-8 text-texto-secundario">
      <LoaderCircle className="size-6 animate-spin" aria-hidden />
      <span>{texto}</span>
    </output>
  );
}

/** El nombre de la marca: «Experience» va en oro claro (sobre la barra oscura) u oro oscuro. */
export function Marca({ sobreOscuro = false }: { sobreOscuro?: boolean }) {
  return (
    <span className="font-semibold tracking-wide">
      Esmeralda{' '}
      <span className={sobreOscuro ? 'text-oro-claro' : 'text-oro-texto'}>Experience</span>
    </span>
  );
}

/** El lugar del logo, que el dueño agrega después. */
export function EspacioLogo({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-lg border border-dashed border-oro-claro/60 ${className}`}
    />
  );
}
