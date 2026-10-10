import { useEffect, useState } from 'react';

/** Espera a que la persona deje de escribir antes de buscar. */
export function useRetrasado(valor: string, ms = 300): string {
  const [retrasado, setRetrasado] = useState(valor);
  useEffect(() => {
    const reloj = window.setTimeout(() => setRetrasado(valor), ms);
    return () => window.clearTimeout(reloj);
  }, [valor, ms]);
  return retrasado;
}
