import { useEffect, useRef } from 'react';

const EVENTOS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

/**
 * Llama a `alVencer` cuando pasan `minutos` sin que nadie toque la pantalla ni el teclado. También
 * revisa al volver a la app (una tablet que se durmió no corre relojes): si ya pasó el tiempo,
 * vence en ese momento. Con `minutos` en null no hace nada.
 */
export function useInactividad(minutos: number | null, alVencer: () => void): void {
  const aviso = useRef(alVencer);
  useEffect(() => {
    aviso.current = alVencer;
  }, [alVencer]);

  useEffect(() => {
    if (!minutos || minutos <= 0) return;
    const limite = minutos * 60_000;
    let ultimoUso = Date.now();
    let vencido = false;
    const tocar = () => {
      ultimoUso = Date.now();
    };
    const revisar = () => {
      if (vencido || Date.now() - ultimoUso < limite) return;
      vencido = true;
      aviso.current();
    };
    const alVolver = () => {
      if (document.visibilityState === 'visible') revisar();
    };
    for (const evento of EVENTOS) window.addEventListener(evento, tocar, { passive: true });
    document.addEventListener('visibilitychange', alVolver);
    const reloj = window.setInterval(revisar, 5_000);
    return () => {
      for (const evento of EVENTOS) window.removeEventListener(evento, tocar);
      document.removeEventListener('visibilitychange', alVolver);
      window.clearInterval(reloj);
    };
  }, [minutos]);
}
