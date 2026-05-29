import { useState, useRef } from 'react';
import { X, Plus, Trash2, Edit2, TrendingDown, AlertCircle, CheckCircle, Download, Upload } from 'lucide-react';
import type { Debt, DebtCategory, Account } from '../types';
import { parseDebtsAsGroup } from '../utils/parsers';

const CATEGORY_COLORS: Record<DebtCategory, string> = {
  'Empréstimo':        '#f59e0b',
  'Financiamento':     '#3b82f6',
  'Cartão de Crédito': '#ec4899',
  'Pessoal':           '#a855f7',
  'Outros':            '#6b7280',
};

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

function advanceMonth(dateString: string): string {
  const parts = dateString.split('-');
  if (parts.length !== 3) return dateString;
  let year = parseInt(parts[0]);
  let month = parseInt(parts[1]);
  const day = parseInt(parts[2]);

  month += 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }

  const yearStr = String(year);
  const monthStr = String(month).padStart(2, '0');
  const dayStr = String(day).padStart(2, '0');
  return `${yearStr}-${monthStr}-${dayStr}`;
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

  const totalDebt = debts.reduce((s, d) => s + (d.totalAmount - d.paidAmount), 0);
  const totalMonthly = debts.reduce((s, d) => s + d.monthlyPayment, 0);

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

    const nextPaidInstallments = debt.paidInstallments + 1;
    let nextPaidAmount = debt.paidAmount + debt.monthlyPayment;
    if (nextPaidInstallments >= debt.totalInstallments) {
      nextPaidAmount = debt.totalAmount;
    } else {
      nextPaidAmount = Math.min(nextPaidAmount, debt.totalAmount);
    }

    const nextDueDate = advanceMonth(debt.nextDueDate);

    try {
      await onUpdate(debt.id, {
        paidInstallments: nextPaidInstallments,
        paidAmount: nextPaidAmount,
        nextDueDate,
      });
    } catch (err) {
      alert("Erro ao pagar parcela: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Remover esta dívida?')) await onDelete(id);
  };

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm(f => ({ ...f, [k]: v }));

  const remaining = (d: Debt) => Math.max(0, d.totalAmount - d.paidAmount);
  const progress = (d: Debt) => d.totalInstallments > 0 ? (d.paidInstallments / d.totalInstallments) * 100 : 0;
  const isPaid = (d: Debt) => d.paidInstallments >= d.totalInstallments;
  const isOverdue = (d: Debt) => !isPaid(d) && new Date(d.nextDueDate) < new Date();

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
      d.totalAmount.toFixed(2).replace('.', ','),
      d.paidAmount.toFixed(2).replace('.', ','),
      remaining(d).toFixed(2).replace('.', ','),
      d.monthlyPayment.toFixed(2).replace('.', ','),
      d.paidInstallments,
      d.totalInstallments,
      progress(d).toFixed(1).replace('.', ','),
      (d.interestRate ?? 0).toFixed(2).replace('.', ','),
      new Date(d.nextDueDate + 'T12:00:00').toLocaleDateString('pt-BR'),
      isPaid(d) ? 'Quitada' : isOverdue(d) ? 'Vencida' : 'Em dia',
    ]);
    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dividas_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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

  const handlePayAll = async () => {
    const unpaidDebts = debts.filter(d => !isPaid(d));
    if (unpaidDebts.length === 0) {
      alert("Nenhuma parcela pendente de pagamento.");
      return;
    }

    if (confirm(`Deseja pagar uma parcela de todas as ${unpaidDebts.length} dívidas pendentes?`)) {
      try {
        for (const debt of unpaidDebts) {
          const nextPaidInstallments = debt.paidInstallments + 1;
          let nextPaidAmount = debt.paidAmount + debt.monthlyPayment;
          if (nextPaidInstallments >= debt.totalInstallments) {
            nextPaidAmount = debt.totalAmount;
          } else {
            nextPaidAmount = Math.min(nextPaidAmount, debt.totalAmount);
          }
          const nextDueDate = advanceMonth(debt.nextDueDate);

          await onUpdate(debt.id, {
            paidInstallments: nextPaidInstallments,
            paidAmount: nextPaidAmount,
            nextDueDate,
          });
        }
      } catch (err) {
        alert("Erro ao processar pagamentos: " + (err instanceof Error ? err.message : String(err)));
      }
    }
  };

  const handleDeleteAll = async () => {
    if (debts.length === 0) return;
    if (confirm('TEM CERTEZA? Isso excluirá todas as dívidas permanentemente.')) {
      try {
        for (const d of debts) {
          await onDelete(d.id);
        }
      } catch (err) {
        alert("Erro ao excluir dívidas: " + (err instanceof Error ? err.message : String(err)));
      }
    }
  };

  return (
    <div>
      {/* Summary + Actions button */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-textMuted uppercase tracking-wide font-medium">Resumo</p>
        <div className="flex gap-2">
          <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".csv" className="hidden" />
          <button
            onClick={handleImportClick}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:bg-white/10 border border-white/10 text-white"
          >
            <Upload size={14} />
            Importar CSV
          </button>
          <button
            onClick={exportCSV}
            disabled={debts.length === 0}
            title={debts.length === 0 ? 'Adicione dívidas para exportar' : 'Exportar dívidas como CSV'}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{
              background: debts.length === 0
                ? 'rgba(255,255,255,0.04)'
                : 'linear-gradient(135deg, #f59e0b22, #ec489922)',
              backgroundColor: debts.length === 0 ? undefined : 'rgba(245,158,11,0.1)',
              border: `1px solid ${debts.length === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(245,158,11,0.3)'}`,
              color: debts.length === 0 ? 'var(--color-textMuted)' : '#fbbf24',
              cursor: debts.length === 0 ? 'not-allowed' : 'pointer',
              opacity: debts.length === 0 ? 0.5 : 1,
            }}
          >
            <Download size={14} />
            Exportar CSV
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="glass-card rounded-2xl p-5">
          <p className="text-xs text-textMuted uppercase tracking-wide mb-1">Total em Dívidas</p>
          <p className="text-2xl font-bold text-red-400">
            R$ {totalDebt.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-textMuted mt-1">{debts.filter(d => !isPaid(d)).length} dívida(s) ativas</p>
        </div>
        <div className="glass-card rounded-2xl p-5">
          <p className="text-xs text-textMuted uppercase tracking-wide mb-1">Parcelas Mensais</p>
          <p className="text-2xl font-bold text-amber-400">
            R$ {totalMonthly.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-textMuted mt-1">por mês</p>
        </div>
      </div>

      {/* Debt Cards */}
      <div className="space-y-4 mb-4">
        {debts.length === 0 && (
          <div className="glass-card rounded-xl p-10 flex flex-col items-center text-center">
            <TrendingDown size={32} className="text-textMuted mb-3" />
            <p className="text-white font-medium mb-1">Nenhuma dívida cadastrada</p>
            <p className="text-textMuted text-sm">Adicione empréstimos, financiamentos ou outras dívidas</p>
          </div>
        )}

        {debts.map(debt => {
          const pct = progress(debt);
          const paid = isPaid(debt);
          const overdue = isOverdue(debt);
          const color = CATEGORY_COLORS[debt.category];
          const isExpanded = expandedId === debt.id;
          const isGroup = !!(debt.subItems && debt.subItems.length > 0);

          return (
            <div key={debt.id} className="glass-card rounded-xl overflow-hidden" style={{ borderLeft: `3px solid ${color}` }}>
              <div className="p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-semibold text-white">{debt.name}</h4>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: `${color}20`, color }}>
                        {debt.category}
                      </span>
                      {isGroup && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">Fatura Grupal</span>}
                      {paid && <span className="text-xs px-2 py-0.5 rounded-full bg-accent/20 text-accent flex items-center gap-1"><CheckCircle size={10} /> Quitada</span>}
                      {overdue && <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 flex items-center gap-1"><AlertCircle size={10} /> Vencida</span>}
                    </div>
                    {debt.description && <p className="text-xs text-textMuted mt-0.5">{debt.description}</p>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {!paid && (
                      <button onClick={() => handlePayInstallment(debt)}
                        title={isGroup ? 'Registrar pagamento da fatura' : 'Marcar parcela como paga'}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
                        style={{ backgroundColor: 'rgba(20,184,166,0.1)', color: '#14b8a6', border: '1px solid rgba(20,184,166,0.2)' }}>
                        {isGroup ? '✓ Pagar Fatura' : '+ Pagar parcela'}
                      </button>
                    )}
                    <button onClick={() => openEdit(debt)} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-textMuted hover:text-white">
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => handleDelete(debt.id)} className="p-2 hover:bg-red-500/10 rounded-lg transition-colors text-textMuted hover:text-red-400">
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
                  <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.07)' }}>
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: paid ? '#14b8a6' : color }} />
                  </div>
                </div>

                {/* Financial Info */}
                <div className="grid grid-cols-3 gap-3 text-center mb-1">
                  <div className="rounded-lg p-2.5" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
                    <p className="text-xs text-textMuted mb-0.5">Total</p>
                    <p className="text-sm font-bold text-white">R$ {remaining(debt).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                  </div>
                  <div className="rounded-lg p-2.5" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
                    <p className="text-xs text-textMuted mb-0.5">{isGroup ? 'Subtotal' : 'Parcela'}</p>
                    <p className="text-sm font-bold" style={{ color }}>R$ {debt.monthlyPayment.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                  </div>
                  <div className="rounded-lg p-2.5" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
                    <p className="text-xs text-textMuted mb-0.5">Vencimento</p>
                    <p className={`text-sm font-bold ${overdue ? 'text-red-400' : 'text-white'}`}>
                      {paid ? '—' : new Date(debt.nextDueDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
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
                    <table className="w-full text-left text-[11px]">
                      <thead className="text-textMuted uppercase tracking-wider">
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
                              {item.amount < 0 && <span className="ml-1 text-[10px] opacity-70">(Estorno)</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4 pt-3 border-t border-white/10 flex justify-between items-center">
                    <span className="text-[10px] text-textMuted">Total da fatura importada</span>
                    <span className="text-sm font-bold text-white">R$ {debt.totalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button onClick={openAdd}
        className="w-full py-3 rounded-xl border border-dashed border-white/10 hover:border-red-400/40 text-textMuted hover:text-white text-sm flex items-center justify-center gap-2 transition-all">
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
          <div className="w-full max-w-md glass-card rounded-2xl p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-bold text-white">{editing ? 'Editar Dívida' : 'Nova Dívida'}</h3>
              <button onClick={() => setShowForm(false)} className="p-2 hover:bg-white/10 rounded-lg text-textMuted hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <FormField label="Nome da Dívida">
                <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Ex: Empréstimo Banco do Brasil" className="input-field" />
              </FormField>

              <FormField label="Descrição (opcional)">
                <input value={form.description} onChange={e => set('description', e.target.value)} placeholder="Detalhes adicionais..." className="input-field" />
              </FormField>

              <FormField label="Categoria">
                <select value={form.category} onChange={e => set('category', e.target.value as DebtCategory)} className="input-field">
                  {DEBT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </FormField>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Valor Total (R$)">
                  <input type="number" step="0.01" value={form.totalAmount || ''} onChange={e => set('totalAmount', parseFloat(e.target.value) || 0)} placeholder="10000.00" className="input-field" />
                </FormField>
                <FormField label="Parcela Mensal (R$)">
                  <input type="number" step="0.01" value={form.monthlyPayment || ''} onChange={e => set('monthlyPayment', parseFloat(e.target.value) || 0)} placeholder="500.00" className="input-field" />
                </FormField>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Nº Total de Parcelas">
                  <input type="number" min={1} value={form.totalInstallments || ''} onChange={e => set('totalInstallments', parseInt(e.target.value) || 1)} placeholder="24" className="input-field" />
                </FormField>
                <FormField label="Juros (% ao mês)">
                  <input type="number" step="0.01" value={form.interestRate || ''} onChange={e => set('interestRate', parseFloat(e.target.value) || 0)} placeholder="2.5" className="input-field" />
                </FormField>
              </div>

              <FormField label="Próximo Vencimento">
                <input type="date" value={form.nextDueDate} onChange={e => set('nextDueDate', e.target.value)} className="input-field" />
              </FormField>

              <FormField label="Vincular à Conta">
                <select value={form.accountId || ''} onChange={e => set('accountId', e.target.value)} className="input-field">
                  <option value="">Sem conta específica</option>
                  {accounts.map(acc => (
                    <option key={acc.id} value={acc.id}>{acc.bank} - {acc.name}</option>
                  ))}
                </select>
              </FormField>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-xl text-sm text-textMuted border border-white/10 hover:bg-white/5 transition-colors">Cancelar</button>
              <button onClick={handleSave} className="flex-1 py-2.5 rounded-xl text-sm text-white font-semibold transition-colors"
                style={{ background: 'linear-gradient(135deg, #f59e0b, #ec4899)' }}>
                {editing ? 'Salvar' : 'Adicionar'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Group Naming Modal */}
      {pendingGroup && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4" onClick={() => setPendingGroup(null)}>
          <div className="w-full max-w-sm glass-card rounded-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-white">Importar Fatura</h3>
              <button onClick={() => setPendingGroup(null)} className="p-2 hover:bg-white/10 rounded-lg text-textMuted">
                <X size={18} />
              </button>
            </div>
            
            <p className="text-xs text-textMuted mb-5 leading-relaxed">
              Consolidando <span className="text-white font-bold">{pendingGroup.items.length} itens</span> do arquivo.<br/>
              Total líquido: <span className="text-accent font-bold">R$ {pendingGroup.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            </p>

            <div className="space-y-4">
              <FormField label="Nome do Grupo/Fatura">
                <input
                  autoFocus
                  value={groupName}
                  onChange={e => setGroupName(e.target.value)}
                  placeholder="Ex: Fatura Nubank Outubro"
                  className="input-field"
                  onKeyDown={e => e.key === 'Enter' && finalizeGroupImport()}
                />
              </FormField>

              <FormField label="Categoria">
                <select 
                  value={groupCategory} 
                  onChange={e => setGroupCategory(e.target.value as DebtCategory)} 
                  className="input-field"
                >
                  {DEBT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </FormField>

              <FormField label="Vincular à Conta">
                <select 
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
              <button onClick={() => setPendingGroup(null)} className="flex-1 py-2.5 text-sm text-textMuted hover:bg-white/5 rounded-xl border border-white/10 transition-colors">Cancelar</button>
              <button onClick={finalizeGroupImport} className="flex-1 py-2.5 text-sm text-white font-bold rounded-xl shadow-lg transition-all hover:brightness-110 active:scale-95" style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}>
                Salvar Fatura
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-textMuted mb-1.5 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}
