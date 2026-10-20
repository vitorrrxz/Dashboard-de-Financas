import { useState, useRef } from 'react';
import { X, Plus, Trash2, Edit2, AlertCircle, CheckCircle, Download, Upload } from 'lucide-react';
import type { Debt, DebtCategory, Account } from '../types';
import { parseDebtsAsGroup } from '../utils/parsers';
import { isDebtOverdue, isDebtPaid, computeNextInstallment } from '../utils/debts';
import { formatDateBR } from '../utils/dates';
import { downloadCSV, exportDateSuffix, formatCurrencyCSV } from '../utils/export';
import { FormField } from './shared/FormField';
import { formatBRL } from '../utils/money';

const DEBT_CATEGORIES: DebtCategory[] = ['Empréstimo', 'Financiamento', 'Cartão de Crédito', 'Pessoal', 'Outros'];

const EMPTY_DEBT: Omit<Debt, 'id' | 'createdAt' | 'paidAmount' | 'paidInstallments'> = {
  name: '',
  description: '',
  category: 'Empréstimo',
  totalAmount: 0,
  monthlyPayment: 0,
  totalInstallments: 1,
  nextDueDate: new Date().toISOString().slice(0, 10),
  interestRate: 0,
  accountId: '',
};

interface DebtManagerProps {
  debts: Debt[];
  onAdd: (debt: Omit<Debt, 'id' | 'createdAt'>) => Promise<void>;
  onUpdate: (id: string, debtData: Partial<Debt>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  accounts: Account[];
}

export function DebtManager({ debts, onAdd, onUpdate, onDelete, accounts }: DebtManagerProps) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Debt | null>(null);
  const [form, setForm] = useState<Omit<Debt, 'id' | 'createdAt' | 'paidAmount' | 'paidInstallments'>>(EMPTY_DEBT);
  const [pendingGroup, setPendingGroup] = useState<{ items: Debt[], total: number } | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupCategory, setGroupCategory] = useState<DebtCategory>('Cartão de Crédito');
  const [selectedAccountId, setSelectedAccountId] = useState<string>(accounts[0]?.id || '');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);


  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_DEBT);
    setShowForm(true);
  };

  const openEdit = (debt: Debt) => {
    setEditing(debt);
    setForm({
      name: debt.name,
      description: debt.description ?? '',
      category: debt.category,
      totalAmount: debt.totalAmount,
      monthlyPayment: debt.monthlyPayment,
      totalInstallments: debt.totalInstallments,
      nextDueDate: debt.nextDueDate,
      interestRate: debt.interestRate,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || form.totalAmount <= 0) return;
    try {
      if (editing) {
        await onUpdate(editing.id, {
          name: form.name,
          description: form.description,
          category: form.category,
          totalAmount: form.totalAmount,
          monthlyPayment: form.monthlyPayment,
          totalInstallments: form.totalInstallments,
          nextDueDate: form.nextDueDate,
          interestRate: form.interestRate,
          accountId: form.accountId || undefined,
        });
      } else {
        await onAdd({
          ...form,
          accountId: form.accountId || undefined,
          paidAmount: 0,
          paidInstallments: 0,
        });
      }
      setShowForm(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handlePayInstallment = async (debt: Debt) => {
    if (isPaid(debt)) return;

    try {
      await onUpdate(debt.id, computeNextInstallment(debt));
    } catch (err) {
      alert("Erro ao pagar parcela: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Remover esta dívida?')) await onDelete(id);
  };

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm(f => {
      const next = { ...f, [k]: v };
      // Total ou nº de parcelas mudou → sugere parcela = total / n (ainda editável à mão).
      if ((k === 'totalAmount' || k === 'totalInstallments') && next.totalAmount > 0 && next.totalInstallments > 0) {
        next.monthlyPayment = Math.round((next.totalAmount / next.totalInstallments) * 100) / 100;
      }
      return next;
    });

  const remaining = (d: Debt) => Math.max(0, d.totalAmount - d.paidAmount);
  const progress = (d: Debt) => d.totalInstallments > 0 ? (d.paidInstallments / d.totalInstallments) * 100 : 0;
  const isPaid = isDebtPaid;
  const isOverdue = isDebtOverdue;

  const exportCSV = () => {
    if (debts.length === 0) return;
    const headers = [
      'Nome', 'Descrição', 'Categoria', 'Valor Total (R$)', 'Valor Pago (R$)',
      'Restante (R$)', 'Parcela Mensal (R$)', 'Parcelas Pagas', 'Total de Parcelas',
      'Progresso (%)', 'Juros (% a.m.)', 'Próximo Vencimento', 'Status',
    ];
    const rows = debts.map(d => [
      d.name,
      d.description ?? '',
      d.category,
      formatCurrencyCSV(d.totalAmount),
      formatCurrencyCSV(d.paidAmount),
      formatCurrencyCSV(remaining(d)),
      formatCurrencyCSV(d.monthlyPayment),
      d.paidInstallments,
      d.totalInstallments,
      progress(d).toFixed(1).replace('.', ','),
      formatCurrencyCSV(d.interestRate ?? 0),
      formatDateBR(d.nextDueDate),
      isPaid(d) ? 'Quitada' : isOverdue(d) ? 'Vencida' : 'Em dia',
    ]);
    downloadCSV(`dividas_${exportDateSuffix()}.csv`, headers, rows);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // In consolidated mode, we use parseDebtsAsGroup
      const result = await parseDebtsAsGroup(file);
      if (result.items.length > 0) {
        setPendingGroup(result);
        setGroupName(file.name.replace('.csv', ''));
      } else {
        alert('Nenhuma transação encontrada no arquivo.');
      }
    } catch (err) {
      console.error(err);
      alert('Erro ao processar o arquivo CSV.');
    }
    e.target.value = '';
  };

  const finalizeGroupImport = async () => {
    if (!pendingGroup || !groupName.trim()) return;

    const newDebtData: Omit<Debt, 'id' | 'createdAt'> = {
      name: groupName,
      category: groupCategory,
      accountId: selectedAccountId || undefined,
      totalAmount: pendingGroup.total,
      paidAmount: 0,
      monthlyPayment: pendingGroup.total,
      totalInstallments: 1,
      paidInstallments: 0,
      nextDueDate: new Date().toISOString().slice(0, 10),
      subItems: pendingGroup.items.map(it => ({
        id: String(Math.random()),
        name: it.name,
        amount: it.totalAmount,
        date: it.nextDueDate
      }))
    };

    try {
      await onAdd(newDebtData);
      setPendingGroup(null);
      setGroupName('');
    } catch (err) {
      alert("Erro ao salvar fatura consolidada: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  // Processa cada dívida independentemente via Promise.allSettled — se uma falhar (ex.
  // rede caiu no meio), as demais não ficam bloqueadas, e o usuário sabe exatamente quais
  // itens precisam ser tentados de novo (ver FIN-017 em docs/BACKLOG_DETAIL.md).
  const handlePayAll = async () => {
    const unpaidDebts = debts.filter(d => !isPaid(d));
    if (unpaidDebts.length === 0) {
      alert("Nenhuma parcela pendente de pagamento.");
      return;
    }

    if (!confirm(`Deseja pagar uma parcela de todas as ${unpaidDebts.length} dívidas pendentes?`)) return;

    const results = await Promise.allSettled(
      unpaidDebts.map(debt => onUpdate(debt.id, computeNextInstallment(debt)))
    );

    const failedNames = results
      .map((r, i) => ({ r, debt: unpaidDebts[i] }))
      .filter(({ r }) => r.status === 'rejected')
      .map(({ debt }) => debt.name);

    if (failedNames.length > 0) {
      alert(`${results.length - failedNames.length} de ${results.length} parcela(s) paga(s) com sucesso.\nFalha em: ${failedNames.join(', ')}. Tente novamente para essas.`);
    }
  };

  const handleDeleteAll = async () => {
    if (debts.length === 0) return;
    // A lista pode estar filtrada por conta (DebtsPage): a confirmação diz quantas saem, não "todas".
    if (!confirm(`TEM CERTEZA? Isso excluirá ${debts.length} dívida(s) da lista permanentemente.`)) return;

    const results = await Promise.allSettled(debts.map(d => onDelete(d.id)));

    const failedNames = results
      .map((r, i) => ({ r, debt: debts[i] }))
      .filter(({ r }) => r.status === 'rejected')
      .map(({ debt }) => debt.name);

    if (failedNames.length > 0) {
      alert(`${results.length - failedNames.length} de ${results.length} dívida(s) excluída(s) com sucesso.\nFalha em: ${failedNames.join(', ')}. Tente novamente para essas.`);
    }
  };

  return (
    <div>
      {/* Actions */}
      <div className="flex items-center justify-end mb-4">
        <div className="flex gap-2">
          <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".csv" className="hidden" />
          <button
            onClick={handleImportClick}
            className="h-9 px-3 flex items-center gap-2 rounded-md text-sm text-white bg-card border border-[var(--control)] hover:border-[var(--color-textMuted)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Upload size={14} />
            Importar CSV
          </button>
          <button
            onClick={exportCSV}
            disabled={debts.length === 0}
            title={debts.length === 0 ? 'Adicione dívidas para exportar' : 'Exportar dívidas como CSV'}
            className="h-9 px-3 flex items-center gap-2 rounded-md text-sm text-white bg-card border border-[var(--control)] hover:border-[var(--color-textMuted)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={14} />
            Exportar CSV
          </button>
        </div>
      </div>

      {/* Debt Cards */}
      <div className="space-y-4 mb-4">
        {debts.length === 0 && (
          <p className="text-sm text-textMuted">Nenhuma dívida cadastrada. Empréstimos, financiamentos e acordos entram aqui; as compras parceladas do cartão aparecem sozinhas.</p>
        )}

        {debts.map(debt => {
          const pct = progress(debt);
          const paid = isPaid(debt);
          const overdue = isOverdue(debt);
          const isExpanded = expandedId === debt.id;
          const isGroup = !!(debt.subItems && debt.subItems.length > 0);

          return (
            <div key={debt.id} className="panel rounded-xl overflow-hidden">
              <div className="p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-medium text-white">{debt.name}</h4>
                      <span className="text-xs text-textMuted">{debt.category}{isGroup ? ' · fatura agrupada' : ''}</span>
                      {paid && <span className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1" style={{ backgroundColor: 'var(--fg-6)' }}><CheckCircle size={11} className="text-teal-400" /> Quitada</span>}
                      {overdue && <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 font-medium flex items-center gap-1"><AlertCircle size={11} /> Vencida</span>}
                    </div>
                    {debt.description && <p className="text-xs text-textMuted mt-0.5">{debt.description}</p>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {!paid && (
                      <button onClick={() => handlePayInstallment(debt)}
                        title={isGroup ? 'Registrar pagamento da fatura' : 'Marcar parcela como paga'}
                        className="h-8 px-3 rounded-md text-sm text-white bg-card border border-[var(--control)] hover:border-[var(--color-textMuted)] transition-colors">
                        {isGroup ? 'Pagar fatura' : 'Pagar parcela'}
                      </button>
                    )}
                    <button type="button" onClick={() => openEdit(debt)} aria-label={`Editar ${debt.name}`} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-textMuted hover:text-white">
                      <Edit2 size={13} />
                    </button>
                    <button type="button" onClick={() => handleDelete(debt.id)} aria-label={`Excluir ${debt.name}`} className="p-2 hover:bg-red-500/10 rounded-lg transition-colors text-textMuted hover:text-red-400">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="mb-3">
                  <div className="flex justify-between text-xs text-textMuted mb-1.5">
                    <span>{debt.paidInstallments}/{debt.totalInstallments} {isGroup ? 'fatura paga' : 'parcelas pagas'}</span>
                    <span>{pct.toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--fg-8)' }}>
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: paid ? 'var(--color-teal-500)' : 'var(--color-accent)' }} />
                  </div>
                </div>

                {/* Financial Info */}
                <div className="grid grid-cols-3 gap-3 mb-1">
                  <div>
                    <p className="text-xs text-textMuted mb-0.5">Total</p>
                    <p className="text-sm font-bold text-white">{formatBRL(remaining(debt))}</p>
                  </div>
                  <div>
                    <p className="text-xs text-textMuted mb-0.5">{isGroup ? 'Subtotal' : 'Parcela'}</p>
                    <p className="text-sm font-bold text-white">{formatBRL(debt.monthlyPayment)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-textMuted mb-0.5">Vencimento</p>
                    <p className={`text-sm font-bold ${overdue ? 'text-red-400' : 'text-white'}`}>
                      {paid ? '—' : formatDateBR(debt.nextDueDate, { day: '2-digit', month: '2-digit' })}
                    </p>
                  </div>
                </div>

                {isGroup && (
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : debt.id)}
                    className="w-full mt-3 py-1.5 text-xs text-textMuted hover:text-white border-t border-white/5 font-medium transition-colors"
                  >
                    {isExpanded ? 'Ocultar Detalhes' : `Ver Detalhes (${debt.subItems?.length} itens)`}
                  </button>
                )}
              </div>

              {/* Expansion Table */}
              {isGroup && isExpanded && (
                <div className="border-t border-white/5 bg-black/20 p-4 animate-in slide-in-from-top-2 duration-300">
                  <div className="max-h-60 overflow-y-auto pr-2">
                    <table className="w-full text-left text-xs">
                      <thead className="text-textMuted">
                        <tr>
                          <th className="pb-2">Local/Descrição</th>
                          <th className="pb-2 text-right">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {debt.subItems?.map((item, idx) => (
                          <tr key={idx} className="border-t border-white/5">
                            <td className="py-2 text-white font-medium max-w-[150px] truncate">{item.name}</td>
                            <td className={`py-2 text-right font-bold ${item.amount < 0 ? 'text-accent' : 'text-white'}`}>
                              R$ {Math.abs(item.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              {item.amount < 0 && <span className="ml-1 text-xs opacity-70">(Estorno)</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4 pt-3 border-t border-[var(--line)] flex justify-between items-center">
                    <span className="text-xs text-textMuted">Total da fatura importada</span>
                    <span className="text-sm font-bold text-white">R$ {debt.totalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button onClick={openAdd}
        className="w-full py-3 rounded-xl border border-dashed border-[var(--line)] hover:border-red-400/40 text-textMuted hover:text-white text-sm flex items-center justify-center gap-2 transition-all">
        <Plus size={16} /> Adicionar Dívida
      </button>

      {debts.length > 0 && (
        <div className="flex gap-4 mt-4 px-2">
          <button onClick={handlePayAll}
            className="text-xs font-semibold text-accent hover:underline flex items-center gap-1.5 transition-all">
            <CheckCircle size={14} /> Pagar todas as parcelas do mês
          </button>
          <button onClick={handleDeleteAll}
            className="text-xs font-semibold text-textMuted hover:text-red-400 flex items-center gap-1.5 transition-all ml-auto">
            <Trash2 size={14} /> Excluir todas as dívidas
          </button>
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-md panel rounded-2xl p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-base font-medium text-white">{editing ? 'Editar Dívida' : 'Nova Dívida'}</h3>
              <button onClick={() => setShowForm(false)} className="p-2 hover:bg-white/10 rounded-lg text-textMuted hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <FormField label="Nome da Dívida" htmlFor="debt-name">
                <input id="debt-name" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Ex: Empréstimo Banco do Brasil" className="input-field" />
              </FormField>

              <FormField label="Descrição (opcional)" htmlFor="debt-description">
                <input id="debt-description" value={form.description} onChange={e => set('description', e.target.value)} placeholder="Detalhes adicionais..." className="input-field" />
              </FormField>

              <FormField label="Categoria" htmlFor="debt-category">
                <select id="debt-category" value={form.category} onChange={e => set('category', e.target.value as DebtCategory)} className="input-field">
                  {DEBT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </FormField>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Valor Total (R$)" htmlFor="debt-total-amount">
                  <input id="debt-total-amount" type="number" step="0.01" value={form.totalAmount || ''} onChange={e => set('totalAmount', parseFloat(e.target.value) || 0)} placeholder="10000.00" className="input-field" />
                </FormField>
                <FormField label="Parcela Mensal (R$)" htmlFor="debt-monthly-payment">
                  <input id="debt-monthly-payment" type="number" step="0.01" value={form.monthlyPayment || ''} onChange={e => set('monthlyPayment', parseFloat(e.target.value) || 0)} placeholder="500.00" className="input-field" />
                </FormField>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Nº Total de Parcelas" htmlFor="debt-total-installments">
                  <input id="debt-total-installments" type="number" min={1} value={form.totalInstallments || ''} onChange={e => set('totalInstallments', parseInt(e.target.value) || 1)} placeholder="24" className="input-field" />
                </FormField>
                <FormField label="Juros (% ao mês)" htmlFor="debt-interest-rate">
                  <input id="debt-interest-rate" type="number" step="0.01" value={form.interestRate || ''} onChange={e => set('interestRate', parseFloat(e.target.value) || 0)} placeholder="2.5" className="input-field" />
                </FormField>
              </div>

              <FormField label="Próximo Vencimento" htmlFor="debt-next-due-date">
                <input id="debt-next-due-date" type="date" value={form.nextDueDate} onChange={e => set('nextDueDate', e.target.value)} className="input-field" />
              </FormField>

              <FormField label="Vincular à Conta" htmlFor="debt-account">
                <select id="debt-account" value={form.accountId || ''} onChange={e => set('accountId', e.target.value)} className="input-field">
                  <option value="">Sem conta específica</option>
                  {accounts.map(acc => (
                    <option key={acc.id} value={acc.id}>{acc.bank} - {acc.name}</option>
                  ))}
                </select>
              </FormField>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-xl text-sm text-textMuted border border-[var(--line)] hover:bg-white/5 transition-colors">Cancelar</button>
              <button onClick={handleSave} className="flex-1 py-2.5 rounded-xl text-sm text-on-accent font-medium bg-primary hover:opacity-90 transition-opacity">
                {editing ? 'Salvar' : 'Adicionar'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Group Naming Modal */}
      {pendingGroup && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4" onClick={() => setPendingGroup(null)}>
          <div className="w-full max-w-sm panel rounded-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-base font-medium text-white">Importar Fatura</h3>
              <button onClick={() => setPendingGroup(null)} className="p-2 hover:bg-white/10 rounded-lg text-textMuted">
                <X size={18} />
              </button>
            </div>
            
            <p className="text-xs text-textMuted mb-5 leading-relaxed">
              Consolidando <span className="text-white font-bold">{pendingGroup.items.length} itens</span> do arquivo.<br/>
              Total líquido: <span className="text-accent font-bold">R$ {pendingGroup.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            </p>

            <div className="space-y-4">
              <FormField label="Nome do Grupo/Fatura" htmlFor="group-name">
                <input
                  id="group-name"
                  autoFocus
                  value={groupName}
                  onChange={e => setGroupName(e.target.value)}
                  placeholder="Ex: Fatura Nubank Outubro"
                  className="input-field"
                  onKeyDown={e => e.key === 'Enter' && finalizeGroupImport()}
                />
              </FormField>

              <FormField label="Categoria" htmlFor="group-category">
                <select
                  id="group-category"
                  value={groupCategory}
                  onChange={e => setGroupCategory(e.target.value as DebtCategory)}
                  className="input-field"
                >
                  {DEBT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </FormField>

              <FormField label="Vincular à Conta" htmlFor="group-account">
                <select
                  id="group-account"
                  value={selectedAccountId}
                  onChange={e => setSelectedAccountId(e.target.value)}
                  className="input-field"
                >
                  {accounts.map(acc => (
                    <option key={acc.id} value={acc.id}>{acc.bank} - {acc.name}</option>
                  ))}
                </select>
              </FormField>
            </div>

            <div className="flex gap-3 mt-8">
              <button onClick={() => setPendingGroup(null)} className="flex-1 py-2.5 text-sm text-textMuted hover:bg-white/5 rounded-xl border border-[var(--line)] transition-colors">Cancelar</button>
              <button onClick={finalizeGroupImport} className="flex-1 py-2.5 text-sm text-on-accent font-medium rounded-xl bg-primary hover:opacity-90 transition-opacity">
                Salvar fatura
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
