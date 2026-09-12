// FIN-079/FIN-080 — tela de backup: baixar o arquivo e restaurar um backup.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BackupSettings } from './BackupSettings';
import { apiFetch, ApiError } from '../services/api';
import { downloadJSON } from '../utils/export';

vi.mock('../services/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  apiFetch: vi.fn(),
}));
vi.mock('../utils/export', async importOriginal => ({
  ...(await importOriginal<typeof import('../utils/export')>()),
  downloadJSON: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);
const downloadMock = vi.mocked(downloadJSON);

const BACKUP = {
  format: 'finflow-backup',
  version: 1,
  exportedAt: '2026-09-11T15:30:00.000Z',
  user: { name: 'Fulano', email: 'fulano@teste.com' },
  data: {
    accounts: [{ id: 'a1' }, { id: 'a2' }], transactions: [{ id: 't1' }], debts: [], budgets: [], goals: [{ id: 'g1' }],
    recurring: [], investments: [],
  },
};
const RESTORED = { accounts: 2, transactions: 1, debts: 0, budgets: 0, goals: 1, recurring: 0, investments: 0 };

function chooseFile(content: string) {
  fireEvent.change(screen.getByLabelText('Arquivo de backup'), {
    target: { files: [new File([content], 'backup.json', { type: 'application/json' })] },
  });
}

async function fillRestoreForm() {
  chooseFile(JSON.stringify(BACKUP));
  expect(await screen.findByText(/2 contas, 1 transação, 1 meta\.$/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Sua senha'), { target: { value: 'senha123' } });
  fireEvent.click(screen.getByLabelText(/dados atuais serão substituídos/));
}

describe('BackupSettings', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    downloadMock.mockReset();
  });

  it('baixa o backup completo e diz o que foi salvo', async () => {
    apiFetchMock.mockResolvedValueOnce(BACKUP);
    render(<BackupSettings token="tok" onRestored={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Baixar backup/ }));

    expect(await screen.findByRole('status')).toHaveTextContent('Backup baixado: 2 contas, 1 transação, 1 meta.');
    expect(apiFetchMock).toHaveBeenCalledWith('/api/account/export', { token: 'tok' });
    expect(downloadMock).toHaveBeenCalledWith(expect.stringMatching(/^finflow-backup-\d{4}-\d{2}-\d{2}\.json$/), BACKUP);
  });

  it('resposta inesperada na exportação: mostra erro e não baixa nada', async () => {
    apiFetchMock.mockResolvedValueOnce({ erro: 'formato estranho' });
    render(<BackupSettings token="tok" onRestored={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Baixar backup/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Resposta inesperada do servidor.');
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('restaura: mostra o resumo do arquivo e só libera o envio com senha e confirmação', async () => {
    apiFetchMock.mockResolvedValueOnce({ success: true, restored: RESTORED });
    const onRestored = vi.fn();
    render(<BackupSettings token="tok" onRestored={onRestored} />);

    const submit = screen.getByRole('button', { name: /Restaurar backup/ });
    expect(submit).toBeDisabled();
    chooseFile(JSON.stringify(BACKUP));
    expect(await screen.findByText(/^Backup de .*: 2 contas, 1 transação, 1 meta\.$/)).toBeInTheDocument();
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Sua senha'), { target: { value: 'senha123' } });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/dados atuais serão substituídos/));
    expect(submit).toBeEnabled();

    fireEvent.click(submit);
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith('Backup restaurado: 2 contas, 1 transação, 1 meta.'));
    expect(apiFetchMock).toHaveBeenCalledWith('/api/account/import', {
      method: 'POST', token: 'tok', body: { password: 'senha123', backup: BACKUP },
    });
    expect(screen.getByLabelText('Arquivo de backup')).toHaveValue('');
    expect(screen.queryByLabelText('Sua senha')).not.toBeInTheDocument();
  });

  it('arquivo que não é JSON, ou não é backup do FinFlow, é recusado antes de qualquer envio', async () => {
    render(<BackupSettings token="tok" onRestored={vi.fn()} />);

    chooseFile('isto não é json');
    expect(await screen.findByRole('alert')).toHaveTextContent('O arquivo não é um JSON válido.');
    for (const content of [JSON.stringify({ format: 'outro-app' }), JSON.stringify({ ...BACKUP, version: 2 })]) {
      chooseFile(content);
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('não é um backup do FinFlow'));
    }
    expect(screen.queryByLabelText('Sua senha')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Restaurar backup/ })).toBeDisabled();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('trocar um arquivo válido por um inválido desfaz a confirmação e bloqueia o envio', async () => {
    render(<BackupSettings token="tok" onRestored={vi.fn()} />);
    await fillRestoreForm();
    expect(screen.getByRole('button', { name: /Restaurar backup/ })).toBeEnabled();

    chooseFile('{}');
    expect(await screen.findByRole('alert')).toHaveTextContent('não é um backup do FinFlow');
    expect(screen.getByRole('button', { name: /Restaurar backup/ })).toBeDisabled();
  });

  it('erro do servidor na restauração: mostra a mensagem e não avisa o App', async () => {
    apiFetchMock.mockRejectedValueOnce(new ApiError('Senha incorreta.', 400, {}));
    const onRestored = vi.fn();
    render(<BackupSettings token="tok" onRestored={onRestored} />);
    await fillRestoreForm();
    fireEvent.click(screen.getByRole('button', { name: /Restaurar backup/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Senha incorreta.');
    expect(onRestored).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Sua senha')).toHaveValue('senha123');
  });
});
