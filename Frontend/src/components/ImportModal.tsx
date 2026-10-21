import { useCallback, useState } from 'react';
import { Upload, X, FileText, CheckCircle, AlertCircle, Loader, CreditCard, Banknote, Smartphone, LayoutList } from 'lucide-react';
import { parseFile } from '../utils/parsers';
import type { Transaction } from '../utils/parsers';
import type { PaymentType, Account } from '../types';
import { formatDateBR } from '../utils/dates';
import { BASE_CURRENCY, currencyOf, formatMoney } from '../utils/currency';

interface ImportModalProps {
  onClose: () => void;
  onImport: (transactions: Transaction[], paymentType: PaymentType) => void;
  accounts: Account[];
}

type UploadState = 'idle' | 'dragging' | 'loading' | 'success' | 'error';

const PAYMENT_TYPES: { value: PaymentType; label: string; description: string; icon: React.ReactNode }[] = [
  {
    value: 'debit',
    label: 'Débito',
    description: 'Extrato de conta corrente/poupança',
    icon: <Banknote size={16} />,
  },
  {
    value: 'credit',
    label: 'Crédito',
    description: 'Fatura de cartão de crédito',
    icon: <CreditCard size={16} />,
  },
  {
    value: 'pix',
    label: 'PIX',
    description: 'Transferências e cobranças via PIX',
    icon: <Smartphone size={16} />,
  },
  {
    value: 'pix_installment',
    label: 'PIX Parcelado',
    description: 'PIX parcelado — entra nas dívidas automaticamente',
    icon: <LayoutList size={16} />,
  },
];

export function ImportModal({ onClose, onImport, accounts }: ImportModalProps) {
  const [state, setState] = useState<UploadState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [preview, setPreview] = useState<Transaction[]>([]);
  const [fileName, setFileName] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState<string>(accounts[0]?.id || '');
  const [paymentType, setPaymentType] = useState<PaymentType>('debit');

  const processFile = async (file: File) => {
    setState('loading');
    setFileName(file.name);
    try {
      const txs = await parseFile(file);
      if (txs.length === 0) {
        setErrorMsg('Nenhuma transação encontrada. Verifique o formato do arquivo.');
        setState('error');
        return;
      }
      setPreview(txs);
      setState('success');
    } catch {
      setErrorMsg('Erro ao processar o arquivo. Tente um OFX ou CSV válido.');
      setState('error');
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setState('idle');
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleConfirm = () => {
    const txsWithAccount = preview.map(tx => ({ ...tx, accountId: selectedAccountId }));
    onImport(txsWithAccount, paymentType);
    onClose();
  };

  const income  = preview.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const expense = preview.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

  // FIN-076: o extrato é importado na moeda da conta de destino — a prévia mostra os valores
  // nela, e não sempre em real.
  const selectedAccount = accounts.find(a => a.id === selectedAccountId);
  const currency = selectedAccount ? currencyOf(selectedAccount) : BASE_CURRENCY;

  const selectedPayment = PAYMENT_TYPES.find(p => p.value === paymentType)!;
  const isDebtType      = paymentType === 'credit' || paymentType === 'pix_installment';
  // Dívidas são registradas em real: numa conta em outra moeda a dívida automática não é criada
  // (o valor seria gravado como real) — ver `handleImport` em App.tsx.
  const willCreateDebt  = isDebtType && currency === BASE_CURRENCY;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl panel rounded-2xl p-8 relative"
        onClick={e => e.stopPropagation()}
        style={{ border: '1px solid var(--fg-10)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-medium text-white">Importar extrato</h2>
            <p className="text-sm text-textMuted mt-1">Suporte a OFX (Itaú, Bradesco, BB, Santander) e CSV (Nubank, Inter)</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-textMuted hover:text-white">
            <X size={20} />
          </button>
        </div>

        {/* Payment Type Selector — always visible */}
        <div className="mb-5">
          <p className="text-sm text-textMuted mb-2">Tipo de pagamento</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PAYMENT_TYPES.map(p => (
              <button
                key={p.value}
                onClick={() => setPaymentType(p.value)}
                type="button"
                aria-pressed={paymentType === p.value}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-colors ${
                  paymentType === p.value ? 'border-[var(--color-textMuted)] text-white bg-white/[0.04]' : 'border-[var(--line)] text-textMuted hover:text-white hover:border-[var(--color-textMuted)]'
                }`}
              >
                <span aria-hidden="true">{p.icon}</span>
                <span className="text-sm font-medium">{p.label}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-textMuted mt-2 text-center">
            {selectedPayment.description}
            {willCreateDebt && (
              <span className="ml-1.5 font-medium text-white">
                · Gera uma dívida automática
              </span>
            )}
            {isDebtType && !willCreateDebt && (
              <span className="ml-1.5 font-medium text-amber-300">
                · Conta em {currency}: sem dívida automática
              </span>
            )}
          </p>
        </div>

        {(state === 'idle' || state === 'dragging') && (
          <div
            onDragOver={e => { e.preventDefault(); setState('dragging'); }}
            onDragLeave={() => setState('idle')}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center cursor-pointer transition-all duration-200 ${
              state === 'dragging'
                ? 'border-primary bg-primary/10'
                : 'border-[var(--line)] hover:border-[var(--color-textMuted)] hover:bg-white/[0.02]'
            }`}
            onClick={() => document.getElementById('file-input')?.click()}
          >
            <input id="file-input" type="file" accept=".ofx,.qfx,.csv" className="hidden" onChange={handleFileInput} />
            <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-3 transition-colors ${
              state === 'dragging' ? 'bg-primary/20' : 'bg-white/5'
            }`}>
              <Upload size={26} className={state === 'dragging' ? 'text-primary' : 'text-textMuted'} />
            </div>
            <p className="text-white font-semibold text-center mb-1">
              {state === 'dragging' ? 'Solte o arquivo aqui!' : 'Arraste seu extrato ou clique para buscar'}
            </p>
            <p className="text-textMuted text-sm text-center">Formatos aceitos: .OFX, .QFX, .CSV</p>
            <div className="flex gap-2 mt-4 flex-wrap justify-center">
              {['Nubank (.csv)', 'Itaú (.ofx)', 'Bradesco (.ofx)', 'BB (.ofx)', 'Inter (.csv)'].map(b => (
                <span key={b} className="text-xs px-3 py-1 bg-white/5 border border-[var(--line)] rounded-full text-textMuted">{b}</span>
              ))}
            </div>
          </div>
        )}

        {state === 'loading' && (
          <div className="flex flex-col items-center justify-center py-14">
            <Loader size={40} className="text-primary animate-spin mb-4" />
            <p className="text-white font-medium">Processando <span className="text-primary">{fileName}</span>...</p>
          </div>
        )}

        {state === 'error' && (
          <div className="flex flex-col items-center justify-center py-10">
            <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
              <AlertCircle size={28} className="text-red-400" />
            </div>
            <p className="text-white font-semibold mb-2">Falha ao importar</p>
            <p className="text-textMuted text-sm text-center mb-6">{errorMsg}</p>
            <button onClick={() => setState('idle')} className="px-6 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white text-sm transition-colors">
              Tentar novamente
            </button>
          </div>
        )}

        {state === 'success' && (
          <div>
            {/* Success summary */}
            <div className="flex items-center justify-between mb-4 p-4 bg-accent/10 border border-accent/20 rounded-xl">
              <div className="flex items-center gap-3">
                <CheckCircle size={20} className="text-accent shrink-0" />
                <div>
                  <p className="text-white text-sm font-semibold">{preview.length} transações encontradas</p>
                  <p className="text-textMuted text-xs mt-0.5">
                    Receitas: <span className="text-accent">+{formatMoney(income, currency)}</span>
                    {' · '}
                    Despesas: <span className="text-red-400">-{formatMoney(expense, currency)}</span>
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-1 items-end">
                <label htmlFor="import-account" className="text-xs text-textMuted font-bold pr-2">Importar para:</label>
                <select
                  id="import-account"
                  value={selectedAccountId}
                  onChange={e => setSelectedAccountId(e.target.value)}
                  className="input-field !w-auto"
                >
                  {accounts.map(acc => (
                    <option key={acc.id} value={acc.id}>{acc.bank} - {acc.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Auto-debt notice */}
            {willCreateDebt && (
              <div
                className="mb-4 p-3 rounded-xl flex items-center gap-2.5 text-sm text-white border border-[var(--control)]"
              >
                <span className="text-textMuted" aria-hidden="true">{selectedPayment.icon}</span>
                <span>
                  Uma dívida de <strong>{formatMoney(expense, currency)}</strong> será criada automaticamente
                  na aba <strong>Dívidas</strong> como "{selectedPayment.label}".
                </span>
              </div>
            )}
            {isDebtType && !willCreateDebt && (
              <div className="mb-4 p-3 rounded-xl flex items-center gap-2.5 text-xs font-medium text-amber-300"
                style={{ border: '1px solid color-mix(in srgb, var(--color-amber-500) 40%, transparent)' }}>
                <AlertCircle size={14} className="shrink-0" aria-hidden="true" />
                <span>
                  A conta de destino está em {currency}. Dívidas são registradas em real, então nenhuma dívida
                  automática será criada — cadastre-a na aba <strong>Dívidas</strong>, se quiser.
                </span>
              </div>
            )}

            {/* Preview table */}
            <div className="max-h-52 overflow-y-auto rounded-xl border border-white/5">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-xs text-textMuted">
                    <th className="px-4 py-3 font-medium">Descrição</th>
                    <th className="px-4 py-3 font-medium">Categoria</th>
                    <th className="px-4 py-3 font-medium">Data</th>
                    <th className="px-4 py-3 font-medium text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 50).map(tx => (
                    <tr key={tx.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                      <td className="px-4 py-2.5 text-sm text-white max-w-[180px] truncate">{tx.name}</td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs px-2 py-1 bg-white/5 border border-[var(--line)] rounded-full text-textMuted">{tx.category}</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-textMuted">{formatDateBR(tx.date)}</td>
                      <td className={`px-4 py-2.5 text-sm font-semibold text-right ${tx.amount > 0 ? 'text-accent' : 'text-white'}`}>
                        {tx.amount > 0 ? '+' : ''}{formatMoney(tx.amount, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.length > 50 && (
                <p className="text-center text-xs text-textMuted py-3">... e mais {preview.length - 50} transações</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 mt-4">
              <button onClick={() => { setState('idle'); setPreview([]); }} className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 border border-[var(--line)] rounded-xl text-sm text-textMuted transition-colors">
                Cancelar
              </button>
              <button
                onClick={handleConfirm}
                className="flex-1 py-2.5 rounded-xl text-sm text-on-accent font-medium bg-primary hover:opacity-90 transition-opacity"
              >
                <div className="flex items-center justify-center gap-2">
                  <FileText size={16} />
                  Importar {preview.length} transações como {selectedPayment.label}
                </div>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
