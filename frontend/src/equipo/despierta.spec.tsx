import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMantenerDespierta } from './despierta';

function Prueba({ activo }: { activo: boolean }) {
  const { estado } = useMantenerDespierta(activo);
  return <p>{estado}</p>;
}

/** Un Wake Lock de mentira: guarda lo pedido y deja soltarlo como lo haría el navegador. */
function instalarWakeLock(falla = false) {
  const pedidos: EventTarget[] = [];
  const request = vi.fn(async () => {
    if (falla) throw new DOMException('NotAllowedError');
    const centinela = Object.assign(new EventTarget(), {
      released: false,
      release: vi.fn(async () => {}),
    });
    pedidos.push(centinela);
    return centinela;
  });
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
  return { request, pedidos };
}

describe('pantalla siempre encendida (Wake Lock)', () => {
  afterEach(() => {
    delete (navigator as { wakeLock?: unknown }).wakeLock;
  });

  it('con el equipo abierto pide al navegador que no apague la pantalla', async () => {
    const { request } = instalarWakeLock();
    render(<Prueba activo />);
    expect(await screen.findByText('activo')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('screen');
  });

  it('si el navegador la suelta (ahorro de batería) queda como perdida, para avisar', async () => {
    const { pedidos } = instalarWakeLock();
    render(<Prueba activo />);
    await screen.findByText('activo');
    act(() => {
      pedidos[0].dispatchEvent(new Event('release'));
    });
    expect(await screen.findByText('perdido')).toBeInTheDocument();
  });

  it('si el navegador no la da, también', async () => {
    instalarWakeLock(true);
    render(<Prueba activo />);
    expect(await screen.findByText('perdido')).toBeInTheDocument();
  });

  it('sin Wake Lock en el navegador lo dice; y fuera de un equipo abierto ni lo pide', () => {
    const { rerender } = render(<Prueba activo />);
    expect(screen.getByText('no-disponible')).toBeInTheDocument();
    const { request } = instalarWakeLock();
    rerender(<Prueba activo={false} />);
    expect(screen.getByText('inactivo')).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });
});
