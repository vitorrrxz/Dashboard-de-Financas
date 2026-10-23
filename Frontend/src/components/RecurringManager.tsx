import { useMemo, useState } from 'react';
import { X, Plus, Trash2, Edit2, Pause, Play, CheckCircle2, RotateCcw } from 'lucide-react';
import { formatBRL } from '../utils/money';
import type { Account, Debt, RecurrenceFrequency, RecurringTransaction, Transaction } from '../types';
import { CATEGORIES, EXPENSE_CATEGORIES, OWN_TRANSFER_CATEGORIES, categoryDot } from '../utils/categories';
import { isDebtPaid, todayISO } from '../utils/debts';
import { billDueDate, formatDateBR, nextDueOnOrAfter } from '../utils/dates';
import { bankGroupOf, groupByBank, primaryAccountOf } from '../utils/accountGroups';
import { debtorCharges, pendingPixPayment } from '../utils/recurring';
import {
  detectSubscriptions, monthlySubscriptionCost, readDismissedSubscriptions, dismissSubscription,
  type DetectedSubscription,
} from '../utils/subscriptions';
import { FormField } from './shared/FormField';

type RecurringFormData = Omit<RecurringTransaction, 'id' | 'createdAt'>;

const maxDate = (a: string, b: string) => (a > b ? a : b);

/** Rótulos em português das frequências suportadas (ver `RecurrenceFrequency` em utils/dates.ts). */
const FREQUENCY_LABELS: Record<RecurrenceFrequency, string> = {
  weekly: 'Semanal',
  monthly: 'Mensal',
  yearly: 'Anual',
};

const EMPTY_RECURRING: RecurringFormData = {
  name: '', category: '', amount: 0,
  frequency: 'monthly', nextOccurrence: '', active: true,
};

interface RecurringManagerProps {
  recurring: RecurringTransaction[];
  accounts: Account[];
  /** Dívidas que um devedor pode pagar (vínculo `debtId`, só na aba Devedores); as compras do cartão saem de `transactions`. */
  debts: Debt[];
  onAdd: (recurring: RecurringFormData) => Promise<void>;
  onUpdate: (id: string, recurring: Partial<RecurringFormData>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** Devedores: confirma que o PIX recebido (`transactionId`) é o pagamento dele. */
  onConfirmPayment?: (id: string, transactionId: string) => Promise<void>;
  /** Categorias vindas das transações reais, além das curadas — mesmo motivo de BudgetManager. */
  transactionCategories: string[];
  /** Histórico completo, para a detecção de assinaturas (FIN-111) — não só o mês em exibição em Transações. */
  transactions: Transaction[];
  /** Despesas Recorrentes só lista e cria despesas; Devedores, só receitas. */
  kind: 'expense' | 'income';
}

/**
 * Abas "Despesas Recorrentes" e "Devedores" (FIN-056) — cadastro das transações que se repetem,
 * uma aba por tipo (o sinal de `amount`). Não lança nada por conta própria: quem gera as `Transaction` reais é o
 * endpoint `/api/recurring-transactions/process`, disparado no carregamento do app (FIN-055).
 */
export function RecurringManager({ recurring: allRecurring, accounts, debts, onAdd, onUpdate, onDelete, onConfirmPayment, transactionCategories, transactions, kind }: RecurringManagerProps) {
  const isExpense = kind === 'expense';
  const recurring = useMemo(
    () => allRecurring.filter(r => (r.amount < 0) === isExpense),
    [allRecurring, isExpense]
  );
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RecurringFormData>(EMPTY_RECURRING);
  // Cobrança do cartão escolhida no formulário; numa edição, a já gravada aparece pelo nome (`chargeName`).
  const [chargeKey, setChargeKey] = useState('');
  // O vínculo é com o banco: conta corrente e cartão do mesmo banco aparecem uma vez só, e grava a
  // conta que representa o banco (`primaryAccountOf`).
  const bankGroups = useMemo(() => groupByBank(accounts), [accounts]);

  // FIN-111 — sugestões de assinatura, descartadas só neste navegador (ver utils/subscriptions.ts).
  // Assinatura é despesa: em Devedores não há sugestões.
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissedSubscriptions());
  const suggestions = useMemo(
    () => isExpense ? detectSubscriptions(transactions, allRecurring, dismissed) : [],
    [isExpense, transactions, allRecurring, dismissed]
  );
  const suggestionsMonthlyTotal = useMemo(
    () => suggestions.reduce((sum, s) => sum + monthlySubscriptionCost(s), 0),
    [suggestions]
  );

  /** Cria a recorrência a partir da sugestão — some da lista assim que `recurring` for atualizado pelo pai. */
  const handleCreateFromSuggestion = async (sub: DetectedSubscription) => {
    try {
      await onAdd({
        name: sub.name, category: sub.category, amount: sub.amount,
        frequency: sub.frequency, nextOccurrence: sub.nextOccurrence, active: true,
      });
    } catch (err) {
      console.error(err);
    }
  };

  /** Ignora a sugestão — persiste no navegador (FIN-077: sem sincronização entre dispositivos). */
  const handleDismissSuggestion = (key: string) => {
    dismissSubscription(key);
    setDismissed(prev => new Set(prev).add(key));
  };

  // O valor é digitado sempre positivo; o sinal vem da aba (mesma convenção de
  // `Transaction.amount`: negativo = despesa). Despesa não usa "Receita" nem as transferências;
  // receita parte de "Receita", mas aceita as demais.
  const categories = isExpense
    ? Array.from(new Set([...EXPENSE_CATEGORIES, ...transactionCategories.filter(c => c !== 'Receita' && !OWN_TRANSFER_CATEGORIES.includes(c))]))
    : Array.from(new Set([...CATEGORIES, ...transactionCategories]));

  /** Abre o modal em modo "criar", com a próxima ocorrência sugerida para hoje. */
  const openAdd = () => {
    setEditingId(null);
    setForm({ ...EMPTY_RECURRING, category: isExpense ? EXPENSE_CATEGORIES[0] : 'Receita', nextOccurrence: todayISO() });
    setChargeKey('');
    setShowForm(true);
  };

  /** Abre o modal em modo "editar", pré-preenchido com os dados da recorrência. */
  const openEdit = (rec: RecurringTransaction) => {
    setEditingId(rec.id);
    setForm({
      name: rec.name,
      category: rec.category,
      amount: Math.abs(rec.amount),
      frequency: rec.frequency,
      nextOccurrence: rec.nextOccurrence,
      active: rec.active,
      accountId: rec.accountId,
      debtId: rec.debtId ?? null,
      remainingPayments: rec.remainingPayments ?? null,
      chargeName: rec.chargeName ?? null,
    });
    setChargeKey('');
    setShowForm(true);
  };

  // Dívidas que dá para vincular: as em aberto, mais a já vinculada (mesmo quitada, para não sumir do select).
  const linkableDebts = debts.filter(d => !isDebtPaid(d) || d.id === form.debtId);
  // Cobranças do cartão que não são dívida cadastrada (alguém usou o seu cartão).
  const charges = useMemo(() => isExpense ? [] : debtorCharges(transactions, accounts, todayISO()), [isExpense, transactions, accounts]);
  // As opções do "O que ele paga" separadas por banco: as dívidas e depois as compras do cartão de cada um,
  // em ordem alfabética.
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
  const linkOptions = (() => {
    const groups = [...bankGroups.map(g => ({ key: g.key, label: g.bank })), { key: '', label: 'Sem banco' }]
      .map(g => ({ ...g, options: [] as { value: string; label: string }[] }));
    const groupOf = (accountId?: string) => groups.find(g => g.key === (bankGroupOf(bankGroups, accountId)?.key ?? ''))!;
    for (const d of [...linkableDebts].sort(byName)) {
      groupOf(d.accountId).options.push({ value: `debt:${d.id}`, label: `Dívida · ${d.name} · ${formatBRL(d.monthlyPayment)}/mês` });
    }
    for (const c of [...charges].sort(byName)) {
      groupOf(c.accountId).options.push({ value: c.key, label: `Cartão · ${c.name} · ${formatDateBR(c.date)} · ${formatBRL(c.amount)}` });
    }
    return groups.filter(g => g.options.length > 0);
  })();
  const linkValue = form.debtId ? `debt:${form.debtId}` : chargeKey || (form.chargeName ? 'saved' : '');
  /**
   * Vincula o devedor ao que ele paga: uma dívida cadastrada (a receita para quando ela é quitada) ou
   * uma cobrança do cartão (para depois dos pagamentos dela). Sem valor digitado, sugere a parcela.
   * A conta passa a ser a do banco da dívida ou do cartão (a sem banco mantém a escolhida), e a próxima
   * ocorrência, o vencimento: o da dívida, ou o da fatura do cartão em que cai a primeira parcela — e,
   * se essa fatura já venceu, o próximo vencimento do cartão.
   */
  const linkTo = (value: string) => {
    if (value === 'saved') return;
    const debt = value.startsWith('debt:') ? debts.find(d => `debt:${d.id}` === value) : undefined;
    const charge = charges.find(c => c.key === value);
    setChargeKey(charge ? charge.key : '');
    const bank = bankGroupOf(bankGroups, debt?.accountId ?? charge?.accountId);
    const accountId = (current?: string) => bank ? primaryAccountOf(bank).id : current;
    if (debt) {
      setForm(f => ({
        ...f, debtId: debt.id, chargeName: null, remainingPayments: null, amount: f.amount || debt.monthlyPayment,
        accountId: accountId(f.accountId), nextOccurrence: debt.nextDueDate,
      }));
    } else if (charge) {
      const card = accounts.find(a => a.id === charge.accountId);
      const due = card?.dueDay
        ? nextDueOnOrAfter(maxDate(billDueDate(charge.firstDate, card.dueDay, card.closingDay), todayISO()), card.dueDay)
        : undefined;
      setForm(f => ({
        ...f, debtId: null, chargeName: charge.name, remainingPayments: charge.payments, amount: f.amount || charge.amount,
        accountId: accountId(f.accountId), nextOccurrence: due ?? f.nextOccurrence,
      }));
    } else {
      setForm(f => ({ ...f, debtId: null, chargeName: null }));
    }
  };

  /** Envia o formulário, aplicando o sinal do valor conforme a aba. */
  const handleSave = async () => {
    if (!form.name.trim() || form.amount <= 0 || !form.nextOccurrence) return;
    const bank = bankGroupOf(bankGroups, form.accountId);
    const payload: RecurringFormData = {
      ...form,
      // Recorrência antiga ligada ao cartão passa para a conta do banco ao ser salva.
      accountId: bank ? primaryAccountOf(bank).id : form.accountId,
      amount: isExpense ? -Math.abs(form.amount) : Math.abs(form.amount),
      // Devedor de dívida cadastrada para quando ela é quitada, não por contagem.
      ...(form.debtId ? { chargeName: null, remainingPayments: null } : {}),
    };
    try {
      if (editingId) {
        await onUpdate(editingId, payload);
      } else {
        await onAdd(payload);
      }
      setShowForm(false);
    } catch (err) {
      console.error(err);
    }
  };

  /** Pausa/retoma uma recorrência sem apagá-la — pausada não gera novos lançamentos. */
  const handleToggleActive = async (rec: RecurringTransaction) => {
    try {
      await onUpdate(rec.id, { active: !rec.active });
    } catch (err) {
      console.error(err);
    }
  };

  /** Finaliza o devedor (ele não te deve mais): sai da sobra e da projeção. Dá para reativar depois. */
  const handleFinish = async (rec: RecurringTransaction) => {
    if (!confirm(`Finalizar ${rec.name}? Ele deixa de entrar na sobra do mês e na projeção.`)) return;
    try {
      await onUpdate(rec.id, { active: false });
    } catch (err) {
      console.error(err);
    }
  };

  const [confirming, setConfirming] = useState<string | null>(null);
  /** O PIX recebido é o pagamento do devedor — só com o clique, nada é dado como pago sozinho. */
  const handleConfirmPayment = async (rec: RecurringTransaction, pix: Transaction) => {
    if (!onConfirmPayment) return;
    setConfirming(rec.id);
    try {
      await onConfirmPayment(rec.id, pix.id);
    } catch (err) {
      console.error(err);
    } finally {
      setConfirming(null);
    }
  };

  /** Exclui a recorrência `id`, após confirmação. As transações já lançadas permanecem. */
  const handleDelete = async (id: string) => {
    if (confirm('Remover esta recorrência? As transações já lançadas por ela serão mantidas.')) {
      await onDelete(id);
    }
  };

  const set = (k: keyof RecurringFormData, v: string | number | boolean) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div>
      {suggestions.length > 0 && (
        <div className="panel rounded-xl p-4 mb-4">
          <h3 className="text-sm font-medium text-white mb-1">Assinaturas encontradas nas suas transações</h3>
          <p className="text-xs text-textMuted mb-3">
            Cerca de {formatBRL(suggestionsMonthlyTotal)} por mês. Crie a recorrência para lançá-las sozinhas, ou ignore.
          </p>
          <div className="space-y-2">
            {suggestions.map(sub => (
              <div key={sub.key} className="flex items-center gap-3 rounded-lg p-3" style={{ backgroundColor: 'var(--fg-5)' }}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{sub.name}</p>
                  <p className="text-xs text-textMuted">
                    {FREQUENCY_LABELS[sub.frequency]} · {sub.occurrences}x · {sub.category}
                  </p>
                </div>
                <p className="text-sm font-medium text-white shrink-0">
                  {formatBRL(sub.amount)}
                </p>
                <button type="button" onClick={() => handleCreateFromSuggestion(sub)}
                  className="h-8 text-sm px-3 rounded-md text-white bg-card border border-[var(--control)] hover:border-[var(--color-textMuted)] shrink-0 whitespace-nowrap transition-colors">
                  Criar recorrência
                </button>
                <button onClick={() => handleDismissSuggestion(sub.key)} title="Ignorar sugestão"
                  aria-label={`Ignorar sugestão de assinatura ${sub.name}`}
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors text-textMuted hover:text-white shrink-0">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3 mb-4">
        {recurring.length === 0 && (
          <p className="text-sm text-textMuted">
            {isExpense
              ? 'Nenhuma despesa recorrente ainda. Cadastre aluguel e assinaturas para lançá-los sozinhos na data.'
              : 'Nenhum devedor ainda. Cadastre quem te paga todo mês para lançar a receita sozinha na data.'}
          </p>
        )}

        {recurring.map(rec => {
          const bank = bankGroupOf(bankGroups, rec.accountId);
          const linkedDebt = rec.debtId ? debts.find(d => d.id === rec.debtId) : undefined;
          // Último PIX confirmado como pagamento deste devedor (`recurringId`), e o que parece ser o próximo.
          const lastPix = isExpense ? undefined : transactions
            .filter(t => t.recurringId === rec.id).reduce<Transaction | undefined>((a, t) => (!a || t.date > a.date ? t : a), undefined);
          const pendingPix = isExpense ? undefined : pendingPixPayment(rec, transactions, accounts, allRecurring);
          return (
            <div key={rec.id} className={`panel rounded-xl p-4 flex items-center gap-4 ${rec.active ? '' : 'opacity-60'}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white truncate">{rec.name}</p>
                  <span className="text-xs px-2 py-0.5 rounded-full text-textMuted" style={{ backgroundColor: 'var(--fg-5)' }}>
                    {FREQUENCY_LABELS[rec.frequency]}
                  </span>
                  {!rec.active && (
                    <span className="text-xs px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: 'var(--fg-6)', color: 'var(--color-textMain)' }}>
                      {isExpense ? 'Pausada' : 'Finalizado'}
                    </span>
                  )}
                </div>
                <p className="text-xs text-textMuted flex items-center gap-1.5 flex-wrap">
                  <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={categoryDot(rec.category)} aria-hidden="true"/>{rec.category}
                  {bank ? ` · ${bank.bank}` : ''}
                  {rec.active ? ` · próxima em ${formatDateBR(rec.nextOccurrence)}` : ''}
                </p>
                {linkedDebt && (
                  <p className="text-xs text-textMuted mt-0.5">
                    Paga a dívida <span className="text-white">{linkedDebt.name}</span>{' · '}
                    {isDebtPaid(linkedDebt) ? 'quitada, não entra mais' : `parcela ${linkedDebt.paidInstallments + 1} de ${linkedDebt.totalInstallments}`}
                  </p>
                )}
                {!linkedDebt && (rec.chargeName || rec.remainingPayments != null) && (
                  <p className="text-xs text-textMuted mt-0.5">
                    {rec.chargeName && <>Paga a cobrança <span className="text-white">{rec.chargeName}</span>{rec.remainingPayments != null && ' · '}</>}
                    {rec.remainingPayments === 0 ? 'pagou tudo, não entra mais'
                      : rec.remainingPayments === 1 ? 'falta 1 pagamento'
                      : rec.remainingPayments != null ? `faltam ${rec.remainingPayments} pagamentos` : ''}
                  </p>
                )}
                {lastPix && (
                  <p className="text-xs text-teal-400 mt-0.5">PIX de {formatBRL(lastPix.amount)} recebido em {formatDateBR(lastPix.date)}: pagamento confirmado</p>
                )}
                {pendingPix && (
                  <div className="flex items-center gap-2 flex-wrap mt-2">
                    <span className="text-xs text-textMuted">
                      PIX de {formatBRL(pendingPix.amount)} recebido em {formatDateBR(pendingPix.date)} ({pendingPix.name})
                    </span>
                    <button type="button" onClick={() => handleConfirmPayment(rec, pendingPix)} disabled={confirming === rec.id}
                      className="h-7 text-xs px-3 rounded-md text-on-accent font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
                      style={{ background: 'var(--color-primary)' }}>
                      <CheckCircle2 size={13} /> {confirming === rec.id ? 'Confirmando...' : 'Confirmar pagamento'}
                    </button>
                  </div>
                )}
              </div>

              <div className="text-right shrink-0">
                <p className={`text-base font-medium ${rec.amount >= 0 ? 'text-teal-400' : 'text-red-400'}`}>
                  {rec.amount >= 0 ? '+' : '−'}{formatBRL(rec.amount)}
                </p>
              </div>

              <div className="flex gap-1 shrink-0">
                {isExpense ? (
                  <button onClick={() => handleToggleActive(rec)}
                    title={rec.active ? 'Pausar recorrência' : 'Retomar recorrência'}
                    aria-label={rec.active ? `Pausar ${rec.name}` : `Retomar ${rec.name}`}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors text-textMuted hover:text-white">
                    {rec.active ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                ) : rec.active ? (
                  <button type="button" onClick={() => handleFinish(rec)} title="Finalizar devedor" aria-label={`Finalizar ${rec.name}`}
                    className="h-8 text-xs px-2.5 rounded-lg border border-[var(--control)] text-textMuted hover:text-white hover:border-[var(--color-textMuted)] transition-colors whitespace-nowrap">
                    Finalizar devedor
                  </button>
                ) : (
                  <button type="button" onClick={() => handleToggleActive(rec)} title="Reativar devedor" aria-label={`Reativar ${rec.name}`}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors text-textMuted hover:text-white">
                    <RotateCcw size={14} />
                  </button>
                )}
                <button type="button" onClick={() => openEdit(rec)} aria-label={`Editar ${rec.name}`} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-textMuted hover:text-white">
                  <Edit2 size={14} />
                </button>
                <button type="button" onClick={() => handleDelete(rec.id)} aria-label={`Excluir ${rec.name}`} className="p-2 hover:bg-red-500/10 rounded-lg transition-colors text-textMuted hover:text-red-400">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button onClick={openAdd}
        className="w-full h-12 rounded-xl border border-dashed border-[var(--control)] text-sm text-textMuted hover:text-white hover:border-[var(--color-textMuted)] flex items-center justify-center gap-2 transition-colors">
        <Plus size={15} /> {isExpense ? 'Adicionar despesa recorrente' : 'Adicionar devedor'}
      </button>

      {showForm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-md panel rounded-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-base font-medium text-white">{isExpense
                ? (editingId ? 'Editar Despesa Recorrente' : 'Nova Despesa Recorrente')
                : (editingId ? 'Editar Devedor' : 'Novo Devedor')}</h3>
              <button onClick={() => setShowForm(false)} className="p-2 hover:bg-white/10 rounded-lg text-textMuted hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <FormField label="Nome" htmlFor="recurring-name">
                <input id="recurring-name" value={form.name} onChange={e => set('name', e.target.value)}
                  placeholder={isExpense ? 'Ex: Aluguel' : 'Ex: João (empréstimo)'} className="input-field" />
              </FormField>

              <FormField label="Valor (R$)" htmlFor="recurring-amount">
                <input id="recurring-amount" type="number" step="0.01" min="0.01" value={form.amount || ''}
                  onChange={e => set('amount', parseFloat(e.target.value) || 0)}
                  placeholder="350.00" className="input-field" />
              </FormField>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Categoria" htmlFor="recurring-category">
                  <select id="recurring-category" value={form.category} onChange={e => set('category', e.target.value)} className="input-field">
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </FormField>
                <FormField label="Frequência" htmlFor="recurring-frequency">
                  <select id="recurring-frequency" value={form.frequency}
                    onChange={e => set('frequency', e.target.value as RecurrenceFrequency)} className="input-field">
                    {(Object.entries(FREQUENCY_LABELS) as [RecurrenceFrequency, string][]).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </FormField>
              </div>

              <FormField label="Próxima Ocorrência" htmlFor="recurring-next">
                <input id="recurring-next" type="date" value={form.nextOccurrence}
                  onChange={e => set('nextOccurrence', e.target.value)} className="input-field" />
              </FormField>

              <FormField label="Vincular à Conta" htmlFor="recurring-account">
                <select id="recurring-account" value={bankGroupOf(bankGroups, form.accountId)?.key ?? ''}
                  onChange={e => {
                    const bank = bankGroups.find(g => g.key === e.target.value);
                    set('accountId', bank ? primaryAccountOf(bank).id : '');
                  }} className="input-field">
                  <option value="">Sem conta específica</option>
                  {bankGroups.map(group => (
                    <option key={group.key} value={group.key}>{group.bank}</option>
                  ))}
                </select>
              </FormField>

              {!isExpense && (
                <FormField label="O que ele paga" htmlFor="recurring-debt">
                  <select id="recurring-debt" value={linkValue} onChange={e => linkTo(e.target.value)} className="input-field">
                    <option value="">Nada vinculado</option>
                    {linkValue === 'saved' && <option value="saved">{form.chargeName}</option>}
                    {linkOptions.map(group => (
                      <optgroup key={group.key || 'none'} label={group.label}>
                        {group.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  <p className="text-xs text-textMuted mt-1.5">{form.debtId
                    ? 'A receita para de entrar quando a dívida for quitada.'
                    : 'Ex.: alguém usou o seu cartão. Escolha a compra e ele te paga a parcela até acabar.'}</p>
                </FormField>
              )}

              {!isExpense && !form.debtId && (
                <FormField label="Quantas vezes ele paga" htmlFor="recurring-payments">
                  <input id="recurring-payments" type="number" step="1" min="0" value={form.remainingPayments ?? ''}
                    onChange={e => {
                      const n = parseInt(e.target.value, 10);
                      setForm(f => ({ ...f, remainingPayments: Number.isFinite(n) && n >= 0 ? n : null }));
                    }}
                    placeholder="Sem fim" className="input-field" />
                  <p className="text-xs text-textMuted mt-1.5">Contando a próxima ocorrência. Vazio = todo mês, sem fim.</p>
                </FormField>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-xl text-sm text-textMuted border border-[var(--line)] hover:bg-white/5 transition-colors">Cancelar</button>
              <button onClick={handleSave} className="flex-1 py-2.5 rounded-xl text-sm text-on-accent font-semibold transition-colors"
                style={{ background: 'var(--color-primary)' }}>
                {editingId ? 'Salvar' : 'Adicionar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
