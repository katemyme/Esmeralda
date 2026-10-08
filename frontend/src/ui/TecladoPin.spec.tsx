import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TecladoPin } from './TecladoPin';

function Prueba({ alCompletar }: { alCompletar: (pin: string) => void }) {
  const [valor, setValor] = useState('');
  return (
    <TecladoPin nombre="PIN de Ana" valor={valor} alCambiar={setValor} alCompletar={alCompletar} />
  );
}

describe('TecladoPin', () => {
  it('al cuarto dígito avisa con el PIN completo; nunca muestra los números', async () => {
    const alCompletar = vi.fn();
    const usuario = userEvent.setup();
    render(<Prueba alCompletar={alCompletar} />);
    for (const digito of ['2', '5', '8']) {
      await usuario.click(screen.getByRole('button', { name: digito }));
    }
    expect(alCompletar).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveAccessibleName('PIN de Ana: 3 de 4 dígitos');
    await usuario.click(screen.getByRole('button', { name: '0' }));
    expect(alCompletar).toHaveBeenCalledExactlyOnceWith('2580');
    expect(screen.queryByText('2580')).not.toBeInTheDocument();
    // con los cuatro puestos no entra un quinto
    await usuario.click(screen.getByRole('button', { name: '1' }));
    expect(alCompletar).toHaveBeenCalledTimes(1);
  });

  it('borrar quita el último dígito', async () => {
    const alCompletar = vi.fn();
    const usuario = userEvent.setup();
    render(<Prueba alCompletar={alCompletar} />);
    expect(screen.getByRole('button', { name: 'Borrar' })).toBeDisabled();
    await usuario.click(screen.getByRole('button', { name: '7' }));
    await usuario.click(screen.getByRole('button', { name: '7' }));
    await usuario.click(screen.getByRole('button', { name: 'Borrar' }));
    expect(screen.getByRole('status')).toHaveAccessibleName('PIN de Ana: 1 de 4 dígitos');
  });
});
