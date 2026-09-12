// FIN-083 — escolha de tema em Configurações.
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeSettings } from './ThemeSettings';

describe('ThemeSettings (FIN-083)', () => {
  it('três opções de rádio com rótulo e descrição associados, marcando a preferência atual', () => {
    render(<ThemeSettings preference="light" onChange={vi.fn()} />);
    const light = screen.getByRole('radio', { name: 'Claro' });
    expect(light).toBeChecked();
    expect(light).toHaveAccessibleDescription('Fundo claro, melhor em ambientes iluminados.');
    expect(screen.getByRole('radio', { name: 'Escuro' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Igual ao sistema' })).not.toBeChecked();
    expect(screen.getByRole('group', { name: 'Tema' })).toBeInTheDocument();
  });

  it('escolher uma opção avisa o App', () => {
    const onChange = vi.fn();
    render(<ThemeSettings preference="dark" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Igual ao sistema'));
    expect(onChange).toHaveBeenCalledWith('system');
  });
});
