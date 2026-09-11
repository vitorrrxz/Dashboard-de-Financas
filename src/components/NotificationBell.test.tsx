// FIN-066 — sino do header com a central de notificações.
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NotificationBell } from './NotificationBell';
import type { AppNotification, NotificationType } from '../types';

const overdue: AppNotification = {
  id: 'n1',
  type: 'debt_overdue',
  title: 'Empréstimo',
  message: 'A parcela 1/4 (R$ 250,00) venceu em 05/09 e ainda não foi paga.',
  read: false,
  createdAt: new Date().toISOString(),
};

function renderBell(props: Partial<Parameters<typeof NotificationBell>[0]> = {}) {
  const handlers = { onSelect: vi.fn(), onMarkAllRead: vi.fn() };
  render(<NotificationBell notifications={[overdue]} unreadCount={1} {...handlers} {...props}/>);
  return handlers;
}

describe('NotificationBell', () => {
  it('anuncia a quantidade de não lidas no nome acessível do sino', () => {
    renderBell();
    expect(screen.getByRole('button', { name: 'Notificações: 1 não lida(s)' })).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('limita o contador visível a "9+"', () => {
    renderBell({ unreadCount: 12 });
    expect(screen.getByText('9+')).toBeInTheDocument();
  });

  it('sem não lidas não mostra contador e desabilita "marcar todas"', () => {
    renderBell({ notifications: [{ ...overdue, read: true }], unreadCount: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Notificações' }));
    expect(screen.getByRole('button', { name: 'Marcar todas como lidas' })).toBeDisabled();
  });

  it('abre a lista, chama onSelect com a notificação clicada e fecha o painel', () => {
    const { onSelect } = renderBell();
    fireEvent.click(screen.getByRole('button', { name: /Notificações/ }));
    fireEvent.click(screen.getByText('Empréstimo'));
    expect(onSelect).toHaveBeenCalledWith(overdue);
    expect(screen.queryByText(overdue.message)).not.toBeInTheDocument();
  });

  it('marca todas como lidas', () => {
    const { onMarkAllRead } = renderBell();
    fireEvent.click(screen.getByRole('button', { name: /Notificações/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }));
    expect(onMarkAllRead).toHaveBeenCalledTimes(1);
  });

  it('mostra o estado vazio', () => {
    renderBell({ notifications: [], unreadCount: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Notificações' }));
    expect(screen.getByText('Nenhuma notificação.')).toBeInTheDocument();
  });

  it('fecha com Esc', () => {
    renderBell();
    fireEvent.click(screen.getByRole('button', { name: /Notificações/ }));
    expect(screen.getByText(overdue.message)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText(overdue.message)).not.toBeInTheDocument();
  });

  it('um tipo desconhecido vindo da API não quebra a renderização', () => {
    const unknown = { ...overdue, id: 'n2', type: 'tipo_novo' as NotificationType, title: 'Aviso novo' };
    renderBell({ notifications: [unknown] });
    fireEvent.click(screen.getByRole('button', { name: /Notificações/ }));
    expect(screen.getByText('Aviso novo')).toBeInTheDocument();
  });
});
