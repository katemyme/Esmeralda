import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInactividad } from './inactividad';

function Reloj({ minutos, alVencer }: { minutos: number | null; alVencer: () => void }) {
  useInactividad(minutos, alVencer);
  return null;
}

const MINUTO = 60_000;

describe('bloqueo por inactividad', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('vence cuando pasan los minutos sin que nadie toque la pantalla, y una sola vez', () => {
    const alVencer = vi.fn();
    render(<Reloj minutos={3} alVencer={alVencer} />);
    vi.advanceTimersByTime(3 * MINUTO - 6_000);
    expect(alVencer).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(alVencer).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10 * MINUTO);
    expect(alVencer).toHaveBeenCalledTimes(1);
  });

  it('cada toque o tecla vuelve a empezar la cuenta', () => {
    const alVencer = vi.fn();
    render(<Reloj minutos={3} alVencer={alVencer} />);
    vi.advanceTimersByTime(2 * MINUTO);
    window.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(2 * MINUTO);
    window.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(2 * MINUTO);
    expect(alVencer).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MINUTO + 5_000);
    expect(alVencer).toHaveBeenCalledTimes(1);
  });

  it('al volver a la app (una tablet que se durmió) revisa enseguida cuánto pasó', () => {
    const alVencer = vi.fn();
    render(<Reloj minutos={3} alVencer={alVencer} />);
    // la tablet dormida no corre relojes: solo avanza la hora
    vi.setSystemTime(Date.now() + 20 * MINUTO);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(alVencer).toHaveBeenCalledTimes(1);
  });

  it('sin minutos (el celular, o sin sesión) no hay bloqueo', () => {
    const alVencer = vi.fn();
    render(<Reloj minutos={null} alVencer={alVencer} />);
    vi.advanceTimersByTime(60 * MINUTO);
    expect(alVencer).not.toHaveBeenCalled();
  });

  it('al salir de la sesión deja de contar', () => {
    const alVencer = vi.fn();
    const { rerender } = render(<Reloj minutos={3} alVencer={alVencer} />);
    rerender(<Reloj minutos={null} alVencer={alVencer} />);
    vi.advanceTimersByTime(10 * MINUTO);
    expect(alVencer).not.toHaveBeenCalled();
  });
});
