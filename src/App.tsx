import { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard, Wallet, ArrowRightLeft, Upload, Trash2,
  Bell, Search, ArrowUpRight, ArrowDownRight, CreditCard, AlertCircle, TrendingDown, TrendingUp,
  LogOut, Edit2, X, Menu, PiggyBank, Target, Repeat, BarChart3, Download, FileText
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts';
import { ImportModal } from './components/ImportModal';
import { AccountsManager } from './components/AccountsManager';
import { DebtManager } from './components/DebtManager';
import { BudgetManager } from './components/BudgetManager';
import { GoalsManager } from './components/GoalsManager';
import { RecurringManager } from './components/RecurringManager';
import { ReportsView } from './components/ReportsView';
import { InstallmentsPanel } from './components/InstallmentsPanel';
import { MonthNavigator, MonthTotal } from './components/MonthNavigator';
import { AuthForm } from './components/AuthForm';
import { PluggyConnectButton } from './components/PluggyConnectButton';
import { toCents, toReais } from './utils/money';
import { apiFetch } from './services/api';
import { useFinancialStats } from './hooks/useFinancialStats';
import { computeBudgetProgress } from './utils/budget';
import { computeBalanceProjection } from './utils/projection';
import { todayISO } from './utils/debts';
import { formatDateBR, formatMonthLabel } from './utils/dates';
import { downloadCSV, downloadPDFReport, exportDateSuffix, formatCurrencyCSV } from './utils/export';
import { TRANSACTION_REPORT_HEADERS, transactionsPeriod } from './utils/reports';
import {
  ALL_MONTHS, availableMonths, filterByKind, filterByMonthAndSearch, summarizeTransactions,
} from './utils/transactions';
import { isInstallmentTransaction } from './utils/installments';
import { CATEGORY_COLORS } from './utils/categories';
import type { Account, Budget, Debt, DebtCategory, Goal, RecurringTransaction, Transaction, PaymentType } from './types';

type Tab = 'dashboard' | 'transactions' | 'accounts' | 'debts' | 'budgets' | 'goals' | 'recurring' | 'reports';

function fmt(v: number) {
  return `R$ ${Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}

/* --- Conversão centavos (API/banco) ↔ reais (UI) — ver FIN-015 em docs/BACKLOG_DETAIL.md ---
 * A API troca valores monetários em centavos (inteiro). Todo o resto do app (formulários,
 * cálculos de `stats`, exibição) continua trabalhando em reais — a conversão acontece só
 * nesta borda, logo após receber dados da API e logo antes de enviar. */
function accountFromApi(a: Account): Account {
  return {
    ...a,
    balance: toReais(a.balance),
    limit: a.limit != null ? toReais(a.limit) : a.limit,
    pendingBill: a.pendingBill != null ? toReais(a.pendingBill) : a.pendingBill,
  };
}
function accountToApi<T extends Partial<Account>>(a: T): T {
  const out: T = { ...a };
  if (out.balance != null) out.balance = toCents(out.balance);
  if (out.limit != null) out.limit = toCents(out.limit);
  if (out.pendingBill != null) out.pendingBill = toCents(out.pendingBill);
  return out;
}
function txFromApi(t: Transaction): Transaction {
  return { ...t, amount: toReais(t.amount) };
}
function txToApi<T extends Partial<Transaction>>(t: T): T {
  const out: T = { ...t };
  if (out.amount != null) out.amount = toCents(out.amount);
  return out;
}
function debtFromApi(d: Debt): Debt {
  return {
    ...d,
    totalAmount: toReais(d.totalAmount),
    paidAmount: toReais(d.paidAmount),
    monthlyPayment: toReais(d.monthlyPayment),
    subItems: d.subItems?.map(si => ({ ...si, amount: toReais(si.amount) })),
  };
}
function debtToApi<T extends Partial<Debt>>(d: T): T {
  const out: T = { ...d };
  if (out.totalAmount != null) out.totalAmount = toCents(out.totalAmount);
  if (out.paidAmount != null) out.paidAmount = toCents(out.paidAmount);
  if (out.monthlyPayment != null) out.monthlyPayment = toCents(out.monthlyPayment);
  if (out.subItems != null) out.subItems = out.subItems.map(si => ({ ...si, amount: toCents(si.amount) }));
  return out;
}
/** Converte `monthlyLimit` de centavos (API) para reais (UI) — ver conversão no topo deste bloco. */
function budgetFromApi(b: Budget): Budget {
  return { ...b, monthlyLimit: toReais(b.monthlyLimit) };
}
/** Converte `monthlyLimit` de reais (UI) para centavos (API) — ver conversão no topo deste bloco. */
function budgetToApi<T extends Partial<Budget>>(b: T): T {
  const out: T = { ...b };
  if (out.monthlyLimit != null) out.monthlyLimit = toCents(out.monthlyLimit);
  return out;
}

/**
 * Componente raiz do FinFlow — gerencia sessão (login/token), carrega contas, transações,
 * dívidas e orçamentos do usuário autenticado, deriva as estatísticas do Dashboard e
 * renderiza a navegação e as abas (Dashboard, Transações, Contas, Dívidas, Orçamento).
 */
/** Converte os valores da meta de centavos (API) para reais (UI) — ver conversão no topo deste bloco. */
function goalFromApi(g: Goal): Goal {
  return { ...g, targetAmount: toReais(g.targetAmount), currentAmount: toReais(g.currentAmount) };
}
/** Converte os valores da meta de reais (UI) para centavos (API) — ver conversão no topo deste bloco. */
function goalToApi<T extends Partial<Goal>>(g: T): T {
  const out: T = { ...g };
  if (out.targetAmount != null) out.targetAmount = toCents(out.targetAmount);
  if (out.currentAmount != null) out.currentAmount = toCents(out.currentAmount);
  return out;
}
/** Converte `amount` da recorrência de centavos (API) para reais (UI). */
function recurringFromApi(r: RecurringTransaction): RecurringTransaction {
  return { ...r, amount: toReais(r.amount) };
}
/** Converte `amount` da recorrência de reais (UI) para centavos (API). */
function recurringToApi<T extends Partial<RecurringTransaction>>(r: T): T {
  const out: T = { ...r };
  if (out.amount != null) out.amount = toCents(out.amount);
  return out;
}

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('finflow_token'));
  const [user, setUser]   = useState<{ id: string; name: string; email: string } | null>(null);
  const [loading, setLoading] = useState(!!token);

  const [activeTab, setActiveTab]     = useState<Tab>('dashboard');
  const [showImport, setShowImport]   = useState(false);
  const [search, setSearch]           = useState('');
  const [txFilter, setTxFilter]       = useState<'all' | 'income' | 'expense'>('all');
  // Mês de referência da aba Transações (FIN-093). Começa no mês corrente de propósito:
  // sem recorte, os totais somavam também as parcelas de meses futuros já lançadas no cartão.
  const [txMonth, setTxMonth]         = useState<string>(() => todayISO().slice(0, 7));
  const [dashboardAccountId, setDashboardAccountId] = useState<string | null>(null);
  const [chartPeriod, setChartPeriod] = useState<'30d' | 'all'>('30d');
  const [mobileNavOpen, setMobileNavOpen] = useState(false); // FIN-028
  const [showNotifications, setShowNotifications] = useState(false); // FIN-039
  const [exportingPDF, setExportingPDF] = useState(false); // FIN-061
  
  const [transactions, setTxs]        = useState<Transaction[]>([]);
  const [accounts, setAccounts]       = useState<Account[]>([]);
  const [debts, setDebts]             = useState<Debt[]>([]);
  const [budgets, setBudgets]         = useState<Budget[]>([]);
  const [goals, setGoals]             = useState<Goal[]>([]);
  const [recurring, setRecurring]     = useState<RecurringTransaction[]>([]);
  // FIN-023: a carga inicial busca até 2000 transações (comportamento original,
  // preservado). Se bater exatamente nesse limite, pode haver mais — `txHasMore` habilita
  // o botão "Carregar mais", que busca o restante via paginação real da API.
  const [txHasMore, setTxHasMore]     = useState(false);
  const [txLoadingMore, setTxLoadingMore] = useState(false);

  // Wrapper fino sobre o `apiFetch` compartilhado (ver FIN-025/FIN-027 em
  // docs/BACKLOG_DETAIL.md) — mantém a assinatura posicional e o retorno `any` já usados
  // em ~20 call sites deste arquivo (sem tipagem de resposta por endpoint; isso fica para
  // FIN-026, `strict` mode), só injetando o `token` do estado local.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fetchAPI = (endpoint: string, method = 'GET', body?: unknown): Promise<any> =>
    apiFetch(endpoint, { method, body, token });

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    setAccounts([]);
    setTxs([]);
    setDebts([]);
    setBudgets([]);
    setGoals([]);
    setRecurring([]);
    localStorage.removeItem('finflow_token');
  };

  useEffect(() => {
    if (token) {
      setLoading(true);
      // FIN-055: lança as ocorrências vencidas das recorrências ANTES de buscar as
      // transações, para que as geradas já apareçam nesta carga. O erro é tratado aqui
      // (e não no `.catch` do fluxo principal, que faz logout): uma falha ao processar
      // recorrências não deve derrubar a sessão do usuário nem impedir o app de abrir.
      fetchAPI('/api/recurring-transactions/process', 'POST')
        .catch(err => { console.error('Falha ao processar recorrências pendentes:', err); })
        .then(() => Promise.all([
          fetchAPI('/api/auth/me'),
          fetchAPI('/api/accounts'),
          fetchAPI('/api/transactions'),
          fetchAPI('/api/debts'),
          fetchAPI('/api/budgets'),
          fetchAPI('/api/goals'),
          fetchAPI('/api/recurring-transactions'),
        ])).then(([meData, accsData, txsData, debtsData, budgetsData, goalsData, recurringData]) => {
        setUser(meData.user);
        setAccounts((accsData as Account[]).map(accountFromApi));
        setTxs((txsData as Transaction[]).map(txFromApi));
        setTxHasMore((txsData as Transaction[]).length >= 2000);
        setDebts((debtsData as Debt[]).map(debtFromApi));
        setBudgets((budgetsData as Budget[]).map(budgetFromApi));
        setGoals((goalsData as Goal[]).map(goalFromApi));
        setRecurring((recurringData as RecurringTransaction[]).map(recurringFromApi));
      }).catch(err => {
        console.error('Sessão expirada ou erro:', err);
        handleLogout();
      }).finally(() => {
        setLoading(false);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleLogin = (newToken: string, newUser: { id: string; name: string; email: string }) => {
    localStorage.setItem('finflow_token', newToken);
    setToken(newToken);
    setUser(newUser);
  };

  /* --- API Mappers --- */
  const handleImport = async (newTxs: Transaction[], paymentType: PaymentType) => {
    try {
      // Attach paymentType to all transactions (ainda em reais — parsers.ts trabalha em reais)
      const txsWithType = newTxs.map(t => ({ ...t, paymentType }));
      const res = await fetchAPI('/api/transactions', 'POST', { transactions: txsWithType.map(txToApi) });
      if (res.success) {
        if (res.skipped > 0) {
          alert(`${res.count} transação(ões) importada(s). ${res.skipped} ignorada(s) por já existir (duplicata).`);
        }
        const txsData = await fetchAPI('/api/transactions');
        setTxs((txsData as Transaction[]).map(txFromApi));
        setTxHasMore((txsData as Transaction[]).length >= 2000);

        // Auto-create debt for credit or pix_installment payments
        // Só faz sentido se ao menos uma transação nova foi de fato importada — se tudo
        // já existia (res.count === 0), reimportar o mesmo extrato não deve gerar dívida.
        if ((paymentType === 'credit' || paymentType === 'pix_installment') && res.count > 0) {
          // Usa apenas as transações que a API de fato aceitou (res.acceptedIndices,
          // posições no array original) — não todas as `txsWithType`. Numa reimportação
          // parcial (algumas linhas já existiam, outras são novas), incluir as duplicatas
          // descartadas aqui somaria valores já contabilizados em uma dívida anterior,
          // inflando `totalAmount` e duplicando `subItems`.
          const acceptedIndices: number[] = res.acceptedIndices ?? [];
          const acceptedTxs = txsWithType.filter((_, i) => acceptedIndices.includes(i));
          const expenseTxs = acceptedTxs.filter(t => t.amount < 0);
          if (expenseTxs.length > 0) {
            const totalExpense = expenseTxs.reduce((s, t) => s + Math.abs(t.amount), 0);
            const now = new Date();
            const monthName = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
            const label = paymentType === 'credit' ? 'Crédito' : 'PIX Parcelado';
            const category: DebtCategory = paymentType === 'credit' ? 'Cartão de Crédito' : 'Pessoal';
            // Due date: last day of current month
            const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            const nextDueDate = lastDay.toISOString().slice(0, 10);

            // Build account hint from first tx
            const accountId = txsWithType[0]?.accountId;
            const accountName = accounts.find(a => a.id === accountId);
            const debtName = accountName
              ? `Fatura ${accountName.bank} – ${monthName}`
              : `Fatura ${label} – ${monthName}`;

            // Evita dívida duplicada: se já existe uma dívida com o mesmo nome/conta
            // (ex.: reimportação parcial do mesmo extrato), não cria outra (ver FIN-004).
            const alreadyExists = debts.some(d => d.name === debtName && (d.accountId || undefined) === accountId);
            if (alreadyExists) {
              alert(`Já existe uma dívida "${debtName}" para esta conta/mês. Nenhuma dívida nova foi criada — edite a existente se necessário.`);
              return;
            }

            const newDebt = {
              name: debtName,
              description: `Criada automaticamente a partir de ${expenseTxs.length} transação(ões) importadas`,
              category,
              totalAmount: totalExpense,
              paidAmount: 0,
              monthlyPayment: totalExpense,
              totalInstallments: 1,
              paidInstallments: 0,
              nextDueDate,
              interestRate: 0,
              accountId: accountId || undefined,
              subItems: expenseTxs.map(t => ({
                id: String(Math.random()),
                name: t.name,
                amount: Math.abs(t.amount),
                date: t.date,
              }))
            };
            const createdDebt = await fetchAPI('/api/debts', 'POST', debtToApi(newDebt));
            setDebts(prev => [...prev, debtFromApi(createdDebt)]);
          }
        }
      }
    } catch (e: unknown) { alert("Erro ao importar: " + (e instanceof Error ? e.message : String(e))); }
  };



  // CRUD TRANSACTIONS (FIN-022)
  const updateTransaction = async (id: string, tx: Partial<Transaction>) => {
    try {
      await fetchAPI(`/api/transactions/${id}`, 'PUT', txToApi(tx));
      setTxs(prev => prev.map(t => t.id === id ? { ...t, ...tx } : t));
    } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); throw e; }
  };
  const deleteTransaction = async (id: string) => {
    try {
      await fetchAPI(`/api/transactions/${id}`, 'DELETE');
      setTxs(prev => prev.filter(t => t.id !== id));
    } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); throw e; }
  };

  // FIN-023: busca a próxima página de 2000 além do que já está carregado. Só chamado
  // quando `txHasMore` é true (a carga anterior bateu no limite de 2000).
  const loadMoreTransactions = async () => {
    setTxLoadingMore(true);
    try {
      const nextPage = Math.floor(transactions.length / 2000) + 1;
      const res = await fetchAPI(`/api/transactions?page=${nextPage}&pageSize=2000`);
      const more = (res.transactions as Transaction[]).map(txFromApi);
      setTxs(prev => [...prev, ...more]);
      setTxHasMore(transactions.length + more.length < res.total);
    } catch (e: unknown) {
      alert('Erro ao carregar mais transações: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setTxLoadingMore(false);
    }
  };

  // CRUD ACCOUNTS
  const addAccount = async (acc: Omit<Account, 'id' | 'createdAt'>) => {
    try {
      const newAcc = await fetchAPI('/api/accounts', 'POST', accountToApi(acc));
      setAccounts(prev => [...prev, accountFromApi(newAcc)]);
    } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); throw e; }
  };
  const updateAccount = async (id: string, acc: Omit<Account, 'id' | 'createdAt'>) => {
    try {
      await fetchAPI(`/api/accounts/${id}`, 'PUT', accountToApi(acc));
      setAccounts(prev => prev.map(a => a.id === id ? { ...a, ...acc } : a));
    } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); throw e; }
  };
  const deleteAccount = async (id: string) => {
    try {
      await fetchAPI(`/api/accounts/${id}`, 'DELETE');
      setAccounts(prev => prev.filter(a => a.id !== id));
    } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); throw e; }
  };

  // CRUD DEBTS
  const addDebt = async (debt: Omit<Debt, 'id' | 'createdAt'>) => {
    try {
      const newDebt = await fetchAPI('/api/debts', 'POST', debtToApi(debt));
      setDebts(prev => [...prev, debtFromApi(newDebt)]);
    } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); throw e; }
  };
  const deleteDebt = async (id: string) => {
    try {
      await fetchAPI(`/api/debts/${id}`, 'DELETE');
      setDebts(prev => prev.filter(d => d.id !== id));
    } catch (e: unknown) { alert((e instanceof Error ? e.message : String(e))); throw e; }
  };

  const updateDebt = async (id: string, debtData: Partial<Debt>) => {
    try {
      const updated = await fetchAPI(`/api/debts/${id}`, 'PUT', debtToApi(debtData));
      setDebts(prev => prev.map(d => d.id === id ? debtFromApi(updated) : d));
    } catch (e: unknown) { alert((e instanceof Error ? e.message : String(e))); throw e; }
  };

  // CRUD BUDGETS (FIN-045)
  /** Cria um orçamento via `POST /api/budgets` e adiciona o resultado (já em reais) ao estado local. */
  const addBudget = async (budget: Omit<Budget, 'id' | 'createdAt'>) => {
    try {
      const newBudget = await fetchAPI('/api/budgets', 'POST', budgetToApi(budget));
      setBudgets(prev => [...prev, budgetFromApi(newBudget)]);
    } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); throw e; }
  };
  /** Atualiza um orçamento via `PUT /api/budgets/:id` e reflete a mudança (em reais) no estado local. */
  const updateBudget = async (id: string, budget: Omit<Budget, 'id' | 'createdAt'>) => {
    try {
      await fetchAPI(`/api/budgets/${id}`, 'PUT', budgetToApi(budget));
      setBudgets(prev => prev.map(b => b.id === id ? { ...b, ...budget } : b));
    } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); throw e; }
  };
  /** Exclui um orçamento via `DELETE /api/budgets/:id` e remove do estado local. */
  const deleteBudget = async (id: string) => {
    try {
      await fetchAPI(`/api/budgets/${id}`, 'DELETE');
      setBudgets(prev => prev.filter(b => b.id !== id));
    } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); throw e; }
  };

  // CRUD GOALS (FIN-051)
  /** Cria uma meta via `POST /api/goals` e adiciona o resultado (já em reais) ao estado local. */
  const addGoal = async (goal: Omit<Goal, 'id' | 'createdAt'>) => {
    try {
      const newGoal = await fetchAPI('/api/goals', 'POST', goalToApi(goal));
      setGoals(prev => [...prev, goalFromApi(newGoal)]);
    } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); throw e; }
  };
  /** Atualiza uma meta via `PUT /api/goals/:id` e reflete a mudança (em reais) no estado local. */
  const updateGoal = async (id: string, goal: Omit<Goal, 'id' | 'createdAt'>) => {
    try {
      await fetchAPI(`/api/goals/${id}`, 'PUT', goalToApi(goal));
      setGoals(prev => prev.map(g => g.id === id ? { ...g, ...goal } : g));
    } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); throw e; }
  };
  /** Exclui uma meta via `DELETE /api/goals/:id` e remove do estado local. */
  const deleteGoal = async (id: string) => {
    try {
      await fetchAPI(`/api/goals/${id}`, 'DELETE');
      setGoals(prev => prev.filter(g => g.id !== id));
    } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); throw e; }
  };

  // CRUD RECURRING (FIN-056)
  /** Cria uma recorrência via `POST /api/recurring-transactions`. */
  const addRecurring = async (rec: Omit<RecurringTransaction, 'id' | 'createdAt'>) => {
    try {
      const created = await fetchAPI('/api/recurring-transactions', 'POST', recurringToApi(rec));
      setRecurring(prev => [...prev, recurringFromApi(created)]);
    } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); throw e; }
  };
  /**
   * Atualiza uma recorrência — edição completa pelo formulário ou só o `active`, ao
   * pausar/retomar. Não lança ocorrências: mesmo que a edição coloque `nextOccurrence` no
   * passado, o lançamento continua sendo responsabilidade exclusiva do `/process`, que roda
   * no carregamento do app (FIN-055) — um único ponto de geração de transações.
   */
  const updateRecurring = async (id: string, rec: Partial<Omit<RecurringTransaction, 'id' | 'createdAt'>>) => {
    try {
      await fetchAPI(`/api/recurring-transactions/${id}`, 'PUT', recurringToApi(rec));
      setRecurring(prev => prev.map(r => r.id === id ? { ...r, ...rec } : r));
    } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); throw e; }
  };
  /** Exclui uma recorrência; as transações já lançadas por ela permanecem no histórico. */
  const deleteRecurring = async (id: string) => {
    try {
      await fetchAPI(`/api/recurring-transactions/${id}`, 'DELETE');
      setRecurring(prev => prev.filter(r => r.id !== id));
    } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); throw e; }
  };

  // ---------- Derived stats ----------
  // Lógica extraída para src/hooks/useFinancialStats.ts (ver FIN-086 em
  // docs/BACKLOG_DETAIL.md) — separa a regra de negócio da camada de UI e permite
  // testá-la sem renderizar componentes (ver FIN-034).
  const stats = useFinancialStats(transactions, accounts, debts, dashboardAccountId);

  // FIN-044/FIN-046: progresso de orçamento do mês corrente, calculado sobre TODAS as
  // transações (não filtradas por `dashboardAccountId`) — orçamento é por categoria, não
  // por conta, então não faz sentido restringir a uma conta específica.
  const currentMonth = todayISO().slice(0, 7);
  const budgetProgress = useMemo(
    () => computeBudgetProgress(transactions, budgets, currentMonth),
    [transactions, budgets, currentMonth]
  );
  const overBudget = budgetProgress.filter(b => b.isOverLimit); // FIN-047

  // FIN-058: projeção dos próximos 6 meses a partir do saldo real (contas líquidas),
  // somando as recorrências previstas e descontando as parcelas de dívida previstas.
  const projection = useMemo(
    () => computeBalanceProjection(stats.realBalance, recurring, debts, { months: 6 }),
    [stats.realBalance, recurring, debts]
  );

  // Categorias que já aparecem nas transações do usuário, além das curadas em
  // EXPENSE_CATEGORIES — a importação manual aceita categoria livre, então o
  // BudgetManager precisa poder oferecer essas categorias no formulário (achado do
  // CodeRabbit: sem isto, seria impossível orçar uma categoria "customizada").
  const transactionCategories = useMemo(
    () => Array.from(new Set(transactions.map(t => t.category))).filter(c => c !== 'Receita'),
    [transactions]
  );

  // FIN-094: lançamentos parcelados (parcelas de compra no cartão, PIX parcelado) saem da
  // aba Transações e passam a ser exibidos na aba Dívidas — ver `isInstallmentTransaction`.
  const regularTransactions = useMemo(
    () => transactions.filter(t => !isInstallmentTransaction(t)),
    [transactions]
  );

  // FIN-093: meses selecionáveis na aba Transações. O mês corrente entra sempre, mesmo
  // sem lançamentos, para que o seletor abra num valor que existe na lista.
  const txMonths = useMemo(() => availableMonths(regularTransactions, currentMonth), [regularTransactions, currentMonth]);

  // Recorte do mês de referência + busca. Os totais saem daqui, e não de `filtered`, para
  // continuarem mostrando receitas E despesas quando a lista isola apenas um dos dois.
  const monthScoped = useMemo(
    () => filterByMonthAndSearch(regularTransactions, txMonth, search),
    [regularTransactions, txMonth, search]
  );
  const monthTotals = useMemo(() => summarizeTransactions(monthScoped), [monthScoped]);
  const filtered = useMemo(() => filterByKind(monthScoped, txFilter), [monthScoped, txFilter]);

  // FIN-094: quantos parcelados o recorte de mês deixou de fora — a aba mostra um aviso com
  // atalho para Dívidas, para as parcelas não parecerem ter simplesmente sumido.
  const hiddenInstallments = useMemo(
    () => transactions.filter(t =>
      isInstallmentTransaction(t) && (txMonth === ALL_MONTHS || t.date.startsWith(txMonth))
    ).length,
    [transactions, txMonth]
  );

  /** Sufixo dos arquivos exportados: o mês de referência, ou a data de hoje em "Todos os meses". */
  const exportSuffix = () => (txMonth === ALL_MONTHS ? exportDateSuffix() : txMonth);
  /** Mês de referência por extenso, para o cabeçalho do PDF. */
  const referenceLabel = () => (txMonth === ALL_MONTHS ? 'todos os meses' : formatMonthLabel(txMonth));

  /**
   * Linhas do relatório de transações, compartilhadas por CSV e PDF (FIN-060/FIN-061) —
   * a mesma seleção que está na tela, já filtrada por busca e por tipo.
   */
  const buildTransactionRows = () => filtered.map(t => [
    formatDateBR(t.date),
    t.name,
    t.category,
    accounts.find(a => a.id === t.accountId)?.name ?? 'Sem conta',
    PAYMENT_TYPE_META[t.paymentType ?? 'debit']?.label ?? 'Débito',
    formatCurrencyCSV(t.amount),
  ]);

  /** FIN-060: exporta as transações filtradas em CSV. */
  const exportTransactionsCSV = () => {
    if (filtered.length === 0) return;
    downloadCSV(`transacoes_${exportSuffix()}.csv`, TRANSACTION_REPORT_HEADERS, buildTransactionRows());
  };

  /**
   * FIN-061: exporta as mesmas transações em PDF. Assíncrono porque `jspdf` é carregado
   * sob demanda (ver `downloadPDFReport`); o estado de "gerando" evita cliques repetidos
   * enquanto a biblioteca baixa.
   */
  const exportTransactionsPDF = async () => {
    if (filtered.length === 0 || exportingPDF) return;
    setExportingPDF(true);
    try {
      const periodo = transactionsPeriod(filtered);
      const receitas = filtered.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      const despesas = filtered.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
      await downloadPDFReport({
        title: 'FinFlow — Relatório de Transações',
        subtitles: [
          `Mês de referência: ${referenceLabel()}`,
          `Período: ${formatDateBR(periodo.from)} a ${formatDateBR(periodo.to)}  ·  ${filtered.length} transação(ões)`,
          `Receitas: ${fmt(receitas)}  ·  Despesas: ${fmt(despesas)}  ·  Saldo: ${fmt(receitas - despesas)}`,
        ],
        headers: TRANSACTION_REPORT_HEADERS,
        rows: buildTransactionRows(),
        filename: `transacoes_${exportSuffix()}.pdf`,
      });
    } catch (e: unknown) {
      alert('Erro ao gerar o PDF: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExportingPDF(false);
    }
  };

  const hasAccounts = accounts.length > 0;
  const isEmpty     = transactions.length === 0;

  if (!token) return <AuthForm onLogin={handleLogin} />;
  if (loading) return <div className="h-screen w-full flex items-center justify-center bg-[#0a0a0f] text-white">Carregando Banco de Dados...</div>;

  // ---------- Render ----------
  return (
    <div className="flex h-screen overflow-hidden relative" style={{ backgroundColor: 'var(--color-background)' }}>
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 rounded-full blur-[100px] pointer-events-none" style={{ backgroundColor: 'rgba(99,102,241,0.12)' }} />
      <div className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full blur-[120px] pointer-events-none" style={{ backgroundColor: 'rgba(168,85,247,0.07)' }} />

      {/* ── Sidebar (FIN-028: drawer off-canvas em mobile, estática em md+) ── */}
      {mobileNavOpen && (
        <div className="fixed inset-0 bg-black/70 z-40 md:hidden" onClick={() => setMobileNavOpen(false)} />
      )}
      <aside className={`w-64 glass-panel border-r border-white/5 flex-col justify-between z-50
        ${mobileNavOpen ? 'fixed inset-y-0 left-0 flex' : 'hidden'} md:static md:z-10 md:flex`}>
        <div>
          <div className="p-6 flex items-center justify-between text-white">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-lg"
                style={{ background: 'linear-gradient(135deg,var(--color-primary),var(--color-secondary))' }}>F</div>
              <span className="text-xl font-bold">Fin<span style={{ color: 'var(--color-primary)', fontWeight: 300 }}>Flow</span></span>
            </div>
            <button onClick={() => setMobileNavOpen(false)} className="md:hidden p-1.5 rounded-lg text-textMuted hover:text-white hover:bg-white/10 transition-colors">
              <X size={18}/>
            </button>
          </div>

          <nav className="mt-4 px-4 space-y-1">
            <NavItem icon={<LayoutDashboard size={18}/>} label="Dashboard" active={activeTab==='dashboard'} onClick={() => { setActiveTab('dashboard'); setMobileNavOpen(false); }} />

            <div className="space-y-1">
              <NavItem icon={<Wallet size={18}/>} label="Contas" active={activeTab==='accounts'} onClick={() => { setActiveTab('accounts'); setMobileNavOpen(false); }} badge={accounts.length > 0 ? accounts.length : undefined} />

              {accounts.length > 0 && (
                <div className="ml-6 pl-2 border-l border-white/10 space-y-1 mt-1 transition-all">
                  <NavItem icon={<ArrowRightLeft size={16}/>} label="Transações" active={activeTab==='transactions'} onClick={() => { setActiveTab('transactions'); setMobileNavOpen(false); }} isSubItem />
                  <NavItem icon={<TrendingDown size={16}/>} label="Dívidas" active={activeTab==='debts'} onClick={() => { setActiveTab('debts'); setMobileNavOpen(false); }} isSubItem
                    badge={debts.filter(d => d.paidInstallments < d.totalInstallments).length > 0 ? debts.filter(d => d.paidInstallments < d.totalInstallments).length : undefined}
                    badgeColor={stats.overdueDebts.length > 0 ? '#ef4444' : undefined}
                  />
                </div>
              )}
            </div>

            {/* FIN-045 */}
            <NavItem icon={<PiggyBank size={18}/>} label="Orçamento" active={activeTab==='budgets'} onClick={() => { setActiveTab('budgets'); setMobileNavOpen(false); }}
              badge={budgets.length > 0 ? budgets.length : undefined}
              badgeColor={overBudget.length > 0 ? '#ef4444' : undefined}
            />

            {/* FIN-051 */}
            <NavItem icon={<Target size={18}/>} label="Metas" active={activeTab==='goals'} onClick={() => { setActiveTab('goals'); setMobileNavOpen(false); }}
              badge={goals.length > 0 ? goals.length : undefined}
            />

            {/* FIN-056 */}
            <NavItem icon={<Repeat size={18}/>} label="Recorrências" active={activeTab==='recurring'} onClick={() => { setActiveTab('recurring'); setMobileNavOpen(false); }}
              badge={recurring.filter(r => r.active).length > 0 ? recurring.filter(r => r.active).length : undefined}
            />

            {/* FIN-062/FIN-063/FIN-064 */}
            <NavItem icon={<BarChart3 size={18}/>} label="Relatórios" active={activeTab==='reports'} onClick={() => { setActiveTab('reports'); setMobileNavOpen(false); }} />
          </nav>
        </div>

        <div className="p-5 space-y-2">
          <div className="mb-4 flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
              <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white truncate">{user?.name}</p>
                  <p className="text-xs text-textMuted truncate">{user?.email}</p>
              </div>
              <button onClick={handleLogout} className="p-2 ml-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors">
                  <LogOut size={14}/>
              </button>
          </div>

          <button onClick={() => { setActiveTab('accounts'); setMobileNavOpen(false); }}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all shadow-lg"
            style={{ background: 'linear-gradient(135deg,var(--color-primary),var(--color-secondary))', boxShadow: '0 4px 20px rgba(99,102,241,0.25)' }}>
            <Wallet size={15}/> Gerenciar Contas
          </button>
          <button onClick={() => { setShowImport(true); setMobileNavOpen(false); }}
            className="w-full py-3 rounded-xl border border-white/10 text-xs font-medium text-textMuted hover:text-white flex items-center justify-center gap-2 transition-all hover:bg-white/5">
            <Upload size={14}/> Importação Manual
          </button>
          {token && (
            <PluggyConnectButton
              token={token}
              onSyncComplete={async () => {
                const [accsData, txsData] = await Promise.all([
                  fetchAPI('/api/accounts'),
                  fetchAPI('/api/transactions'),
                ]);
                setAccounts((accsData as Account[]).map(accountFromApi));
                setTxs((txsData as Transaction[]).map(txFromApi));
                setTxHasMore((txsData as Transaction[]).length >= 2000);
              }}
            />
          )}
          {transactions.length > 0 && (
            <button onClick={async () => {
                if (confirm('Remover todas as transações?')) {
                    await fetchAPI('/api/transactions/bulk', 'DELETE');
                    setTxs([]);
                    setTxHasMore(false);
                }
            }}
              className="w-full py-2.5 rounded-xl border border-red-500/10 text-red-400 hover:bg-red-500/10 text-xs font-medium flex items-center justify-center gap-2 transition-all">
              <Trash2 size={14}/> Limpar Transações
            </button>
          )}
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 overflow-y-auto z-10 custom-scrollbar">
        <header className="sticky top-0 z-20 backdrop-blur-xl bg-[#0a0a0f]/80 border-b border-white/5 px-4 md:px-8 py-5 flex justify-between items-center gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* FIN-028: botão hambúrguer, único ponto de entrada para a navegação em mobile */}
            <button onClick={() => setMobileNavOpen(true)} className="md:hidden p-2 rounded-full hover:bg-white/5 transition-colors text-white shrink-0">
              <Menu size={22}/>
            </button>
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" size={18} />
              {/* FIN-040: só troca para a aba Transações na transição vazio→preenchido
                  (1ª tecla), não a cada tecla — evita arrancar o usuário de outra aba a
                  cada caractere digitado. */}
              <input type="text" placeholder="Buscar transações, contas..." value={search}
                onChange={e => {
                  const v = e.target.value;
                  if (v && !search) setActiveTab('transactions');
                  setSearch(v);
                }}
                className="w-full bg-white/5 border border-white/10 rounded-full pl-10 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50 transition-colors" />
            </div>
          </div>
          <div className="flex items-center gap-4 relative">
            {/* FIN-039: sino agora abre um dropdown real com as dívidas vencidas, em vez
                de ser puramente decorativo. */}
            <button onClick={() => setShowNotifications(o => !o)} className="relative p-2 rounded-full hover:bg-white/5 transition-colors">
              <Bell size={20} className="text-textMuted" />
              {stats.overdueDebts.length > 0 && <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-[#0a0a0f]"/>}
            </button>
            {showNotifications && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowNotifications(false)} />
                <div className="absolute right-0 top-full mt-2 w-72 max-w-[90vw] glass-card rounded-2xl p-3 z-40 shadow-2xl">
                  <p className="text-xs font-semibold text-textMuted uppercase tracking-wide px-2 py-1.5">Notificações</p>
                  {stats.overdueDebts.length === 0 ? (
                    <p className="text-sm text-textMuted px-2 py-4 text-center">Nenhuma notificação.</p>
                  ) : (
                    <div className="space-y-1 max-h-72 overflow-y-auto">
                      {stats.overdueDebts.map(d => (
                        <div key={d.id} className="px-2 py-2 rounded-lg hover:bg-white/5 flex items-center gap-2">
                          <AlertCircle size={14} className="text-red-400 shrink-0"/>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-white truncate">{d.name}</p>
                            <p className="text-xs text-red-400">Vencida em {formatDateBR(d.nextDueDate)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </header>

        <div className="p-8 max-w-7xl mx-auto pb-24">
          
          {/* ══════════ DASHBOARD TAB ══════════ */}
          {activeTab === 'dashboard' && (
            <>
              <div className="mb-8 flex justify-between items-center">
                <h1 className="text-3xl font-bold text-white tracking-tight">Visão Geral</h1>
                
                {/* ACCOUNT SELECTOR */}
                {accounts.length > 0 && (
                  <select 
                    value={dashboardAccountId || ''}
                    onChange={(e) => setDashboardAccountId(e.target.value || null)}
                    className="bg-white/5 border border-white/10 text-sm text-white py-2 px-4 rounded-xl focus:outline-none focus:border-primary/50"
                  >
                    <option value="" className="bg-[#12121a]">Todas as Contas</option>
                    {accounts.map(a => (
                      <option key={a.id} value={a.id} className="bg-[#12121a]">{a.name} - {a.bank}</option>
                    ))}
                  </select>
                )}
              </div>

              {stats.overdueDebts.length > 0 && (
                <div className="mb-6 p-4 rounded-xl flex items-center gap-3" style={{ backgroundColor:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)' }}>
                  <AlertCircle size={18} className="text-red-400 shrink-0"/>
                  <p className="text-sm text-red-300">
                    Você tem <strong>{stats.overdueDebts.length}</strong> dívida(s) com vencimento vencido:
                    {' '}{stats.overdueDebts.map(d => d.name).join(', ')}
                  </p>
                </div>
              )}

              {/* FIN-047: mesmo padrão de alerta usado para dívidas vencidas, acima. */}
              {overBudget.length > 0 && (
                <div className="mb-6 p-4 rounded-xl flex items-center gap-3" style={{ backgroundColor:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)' }}>
                  <AlertCircle size={18} className="text-red-400 shrink-0"/>
                  <p className="text-sm text-red-300">
                    Você ultrapassou o limite de <strong>{overBudget.length}</strong> orçamento(s) este mês:
                    {' '}{overBudget.map(b => b.category).join(', ')}
                  </p>
                </div>
              )}

              {/* Summary Cards Row 1 — Real Accounts */}
              {/* "Saldo Real" exclui investimentos (ver FIN-018) — quando o usuário tem
                  contas de investimento, mostramos o total delas separadamente ao lado. */}
              <div className={`grid grid-cols-1 md:grid-cols-3 ${accounts.some(a => a.type === 'investment') ? 'lg:grid-cols-4' : ''} gap-5 mb-5`}>
                <SummaryCard title="Saldo Real (Contas)" amount={fmt(stats.realBalance)} isPositive={stats.realBalance >= 0}
                  icon={<Wallet size={22} style={{ color:'var(--color-primary)' }}/>} badge="Saldo atual" />
                {accounts.some(a => a.type === 'investment') && (
                  <SummaryCard title="Investimentos" amount={fmt(stats.investmentBalance)} isPositive={stats.investmentBalance >= 0}
                    icon={<TrendingUp size={22} className="text-teal-400"/>}
                    badge={`${accounts.filter(a=>a.type==='investment').length} conta(s)`} />
                )}
                <SummaryCard title="Fatura Pendente" amount={fmt(stats.pendingBills)} isPositive={false}
                  icon={<CreditCard size={22} className="text-pink-400"/>} badge={`${accounts.filter(a=>a.type==='credit').length} cartão(ões)`} />
                <SummaryCard title="Dívidas Ativas" amount={fmt(stats.activeDebts)} isPositive={false}
                  icon={<TrendingDown size={22} className="text-amber-400"/>}
                  badge={`${debts.filter(d=>d.paidInstallments < d.totalInstallments).length} pendente(s)`} />
              </div>

              {/* Summary Cards Row 2 — Transactions */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
                <SummaryCard title="Total de Receitas" amount={fmt(stats.income)} isPositive={true}
                  icon={<ArrowUpRight size={22} style={{ color:'var(--color-accent)' }}/>} badge={`${stats.income > 0 ? (transactions.filter(t=>t.amount>0).length) : 0} entradas`}
                  onClick={() => { setTxFilter('income'); setActiveTab('transactions'); }} />
                <SummaryCard title="Total de Despesas" amount={fmt(stats.expense)} isPositive={false}
                  icon={<ArrowDownRight size={22} className="text-red-400"/>} badge={`${stats.expense > 0 ? (transactions.filter(t=>t.amount<0).length) : 0} saídas`}
                  onClick={() => { setTxFilter('expense'); setActiveTab('transactions'); }} />
                <SummaryCard title="Este Mês (Gastos)" amount={fmt(stats.monthExpense)} isPositive={false}
                  icon={<ArrowDownRight size={22} className="text-orange-400"/>} badge="Mês corrente" />
              </div>

              {/* FIN-046: indicador de orçamento do mês corrente no Dashboard. */}
              {budgetProgress.length > 0 && (
                <div className="glass-card rounded-2xl p-6 mb-8">
                  <div className="flex justify-between items-center mb-5">
                    <h3 className="text-lg font-semibold text-white">Orçamento do Mês</h3>
                    <button onClick={() => setActiveTab('budgets')} className="text-xs text-textMuted hover:text-white transition-colors">Ver tudo →</button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {budgetProgress.map(b => (
                      <div key={b.id}>
                        <div className="flex justify-between text-xs mb-1.5">
                          <span className="text-white font-medium">{b.category}</span>
                          <span className={b.isOverLimit ? 'text-red-400' : 'text-textMuted'}>{fmt(b.spent)} / {fmt(b.limit)}</span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
                          <div className={`h-full rounded-full transition-all ${b.isOverLimit ? 'bg-red-400' : 'bg-primary'}`}
                            style={{ width: `${Math.min(100, b.percentage)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isEmpty && !hasAccounts && (
                <div className="glass-card rounded-2xl p-16 flex flex-col items-center text-center">
                  <div className="w-20 h-20 rounded-2xl flex items-center justify-center mb-6"
                    style={{ background:'linear-gradient(135deg,rgba(99,102,241,0.2),rgba(168,85,247,0.2))', border:'1px solid rgba(99,102,241,0.2)' }}>
                    <Wallet size={36} style={{ color:'var(--color-primary)' }}/>
                  </div>
                  <h2 className="text-2xl font-bold text-white mb-3">Bem-vindo ao FinFlow!</h2>
                  <p className="text-textMuted max-w-md mb-8">
                    Seu painel financeiro pessoal! 
                    Adicione suas contas na aba <strong>Contas</strong> e importe seus extratos bancários (CSV/OFX) para acompanhar suas finanças.
                  </p>
                  <div className="flex gap-3">
                    <button onClick={() => setActiveTab('accounts')}
                      className="px-6 py-3 rounded-xl text-white font-semibold text-sm shadow-md"
                      style={{ background:'linear-gradient(135deg,var(--color-primary),var(--color-secondary))', boxShadow:'0 4px 24px rgba(99,102,241,0.35)' }}>
                      <span className="flex items-center gap-2"><Wallet size={16}/> Adicionar Conta</span>
                    </button>
                    <button onClick={() => setShowImport(true)}
                      className="px-6 py-3 rounded-xl text-textMuted text-sm font-medium border border-white/10 hover:bg-white/5 hover:text-white transition-colors">
                      <span className="flex items-center gap-2"><Upload size={16}/> Importar Extrato</span>
                    </button>
                  </div>
                </div>
              )}

              {(!isEmpty || hasAccounts) && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                  <div className="lg:col-span-2 glass-card rounded-2xl p-6">
                    <div className="flex justify-between items-center mb-6">
                      <h3 className="text-lg font-semibold text-white">Fluxo Financeiro</h3>
                      <div className="flex bg-white/5 p-1 rounded-xl border border-white/5">
                        <button 
                          onClick={() => setChartPeriod('30d')}
                          className={`px-3 py-1.5 text-[10px] uppercase font-bold rounded-lg transition-all ${chartPeriod === '30d' ? 'bg-primary text-white shadow-lg' : 'text-textMuted hover:text-white'}`}
                        >
                          30 Dias
                        </button>
                        <button 
                          onClick={() => setChartPeriod('all')}
                          className={`px-3 py-1.5 text-[10px] uppercase font-bold rounded-lg transition-all ${chartPeriod === 'all' ? 'bg-primary text-white shadow-lg' : 'text-textMuted hover:text-white'}`}
                        >
                          Histórico
                        </button>
                      </div>
                    </div>
                    <div className="h-60">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartPeriod === '30d' ? stats.dailyEvolution : stats.balanceByMonth}>
                          <defs>
                            <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" vertical={false}/>
                          <XAxis 
                            dataKey="name" 
                            stroke="#6b7280" 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{ fontSize:10 }} 
                            interval={chartPeriod === '30d' ? 4 : 0}
                          />
                          <YAxis stroke="#6b7280" axisLine={false} tickLine={false} tick={{ fontSize:10 }} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`}/>
                          <RechartsTooltip 
                            contentStyle={{ backgroundColor:'#1c1c24', border:'1px solid rgba(255,255,255,0.1)', borderRadius:12 }}
                            formatter={(v) => [fmt(Number(v)), chartPeriod === '30d' ? 'Evolução' : 'Saldo']}
                            labelStyle={{ color:'#9ca3af' }}
                          />
                          <Area type="monotone" dataKey="balance" stroke="#6366f1" strokeWidth={2.5} fill="url(#cg)" animationDuration={1000}/>
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {stats.expenseByCategory.length > 0 && (
                    <div className="glass-card rounded-2xl p-6">
                      <h3 className="text-lg font-semibold text-white mb-6">Por Categoria</h3>
                      <div className="h-60">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={stats.expenseByCategory} layout="vertical" margin={{ left:-10, right:10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" horizontal={false}/>
                            <XAxis type="number" hide/>
                            <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} stroke="#6b7280" tick={{ fontSize:11 }} width={80}/>
                            <RechartsTooltip cursor={{ fill:'rgba(255,255,255,0.03)' }}
                              contentStyle={{ backgroundColor:'#1c1c24', border:'1px solid rgba(255,255,255,0.1)', borderRadius:12 }}
                              formatter={(v) => [fmt(Number(v)),'Gasto']}/>
                            <Bar dataKey="amount" radius={[0,4,4,0]} barSize={14}>
                              {stats.expenseByCategory.map(e => (
                                <Cell key={e.name} fill={CATEGORY_COLORS[e.name] || '#6366f1'}/>
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* FIN-059: projeção de saldo — só aparece quando há algo a projetar
                  (recorrência ativa ou dívida em aberto), senão seria uma linha reta. */}
              {(recurring.some(r => r.active) || debts.length > 0) && (
                <div className="glass-card rounded-2xl p-6 mb-8">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-semibold text-white">Projeção de Saldo</h3>
                    <span className="text-[10px] uppercase tracking-wider font-bold text-textMuted bg-white/5 px-2.5 py-1 rounded-full border border-white/5">
                      Próximos 6 meses
                    </span>
                  </div>
                  <div className="h-60">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={projection}>
                        <defs>
                          <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#14b8a6" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" vertical={false}/>
                        <XAxis dataKey="name" stroke="#6b7280" axisLine={false} tickLine={false} tick={{ fontSize:10 }}/>
                        <YAxis stroke="#6b7280" axisLine={false} tickLine={false} tick={{ fontSize:10 }} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`}/>
                        <RechartsTooltip
                          contentStyle={{ backgroundColor:'#1c1c24', border:'1px solid rgba(255,255,255,0.1)', borderRadius:12 }}
                          formatter={(v) => [fmt(Number(v)), 'Saldo projetado']}
                          labelStyle={{ color:'#9ca3af' }}
                        />
                        <Area type="monotone" dataKey="balance" stroke="#14b8a6" strokeWidth={2.5} fill="url(#pg)" animationDuration={1000}/>
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-xs text-textMuted mt-3">
                    Saldo real de hoje somado às recorrências ativas e descontadas as parcelas de dívidas em aberto.
                  </p>
                </div>
              )}
            </>
          )}

          {/* ══════════ TRANSACTIONS TAB ══════════ */}
          {activeTab === 'transactions' && (
            <>
              <div className="mb-6 flex justify-between items-end">
                <div>
                  <h1 className="text-3xl font-bold text-white mb-1">Transações</h1>
                  <p className="text-textMuted text-sm">{filtered.length} registros</p>
                </div>
                <div className="flex gap-2">
                  {/* FIN-060/FIN-061: exportam exatamente o recorte visível (busca + filtro). */}
                  <button onClick={exportTransactionsCSV} disabled={filtered.length === 0}
                    title={filtered.length === 0 ? 'Nenhuma transação para exportar' : 'Exportar as transações filtradas em CSV'}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-white/10 text-textMuted hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                    <Download size={15}/> CSV
                  </button>
                  <button onClick={exportTransactionsPDF} disabled={filtered.length === 0 || exportingPDF}
                    title={filtered.length === 0 ? 'Nenhuma transação para exportar' : 'Exportar as transações filtradas em PDF'}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-white/10 text-textMuted hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                    <FileText size={15}/> {exportingPDF ? 'Gerando...' : 'PDF'}
                  </button>
                  <button onClick={() => setShowImport(true)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm text-white font-medium transition-colors"
                    style={{ backgroundColor:'var(--color-primary)' }}>
                    <Upload size={15}/> Importar
                  </button>
                </div>
              </div>

              {/* FIN-093: mês de referência + total do recorte. Fica acima dos filtros de
                  tipo porque delimita o conjunto sobre o qual eles atuam. */}
              <div className="glass-card rounded-2xl p-4 mb-5 flex flex-wrap items-end justify-between gap-4">
                <MonthNavigator id="tx-month" value={txMonth} months={txMonths} onChange={setTxMonth} allowAll/>

                <div className="flex flex-wrap items-end gap-6">
                  <MonthTotal label="Receitas" value={monthTotals.income} color="var(--color-accent)"/>
                  <MonthTotal label="Despesas" value={monthTotals.expense} color="#f87171"/>
                  <MonthTotal label="Valor total" value={monthTotals.balance} signed
                    color={monthTotals.balance >= 0 ? '#ffffff' : '#f87171'}/>
                </div>
              </div>

              {/* FIN-094: os parcelados não aparecem nesta aba — em vez de sumir com eles, avisa
                  quantos ficaram de fora e leva direto para a aba onde estão. */}
              {hiddenInstallments > 0 && (
                <p className="text-xs text-textMuted -mt-2 mb-5">
                  {hiddenInstallments} {hiddenInstallments === 1 ? 'lançamento parcelado' : 'lançamentos parcelados'}
                  {txMonth === ALL_MONTHS ? '' : ' deste mês'} {hiddenInstallments === 1 ? 'está' : 'estão'} em{' '}
                  <button type="button" onClick={() => setActiveTab('debts')}
                    className="text-primary font-medium hover:underline">
                    Dívidas e Parcelamentos
                  </button>.
                </p>
              )}
              <div className="flex gap-2 mb-5">
                {([
                  { key: 'all',     label: 'Todas',     color: 'rgba(99,102,241,0.15)',  border: 'rgba(99,102,241,0.4)',  text: '#a5b4fc' },
                  { key: 'income',  label: '↑ Receitas', color: 'rgba(20,184,166,0.12)', border: 'rgba(20,184,166,0.4)', text: '#5eead4' },
                  { key: 'expense', label: '↓ Despesas', color: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.4)',  text: '#fca5a5' },
                ] as const).map(f => (
                  <button key={f.key} onClick={() => setTxFilter(f.key)}
                    className="px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200"
                    style={{
                      backgroundColor: txFilter === f.key ? f.color : 'rgba(255,255,255,0.04)',
                      borderColor: txFilter === f.key ? f.border : 'rgba(255,255,255,0.08)',
                      color: txFilter === f.key ? f.text : '#9ca3af',
                      borderWidth: 1
                    }}>
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="glass-card rounded-2xl p-6">
                {filtered.length === 0 ? (
                  <p className="text-center text-textMuted py-12 text-sm">Nenhuma transação encontrada.</p>
                ) : (
                  <TxTable
                    rows={filtered.slice(0, 200)}
                    accounts={accounts}
                    onUpdate={updateTransaction}
                    onDelete={deleteTransaction}
                  />
                )}
              </div>

              {/* FIN-023: a carga inicial busca no máximo 2000 transações — este botão só
                  aparece quando esse limite foi atingido, permitindo acessar o restante. */}
              {txHasMore && (
                <button onClick={loadMoreTransactions} disabled={txLoadingMore}
                  className="w-full mt-4 py-3 rounded-xl border border-white/10 text-sm text-textMuted hover:text-white hover:bg-white/5 transition-all disabled:opacity-50">
                  {txLoadingMore ? 'Carregando...' : 'Carregar transações mais antigas'}
                </button>
              )}
            </>
          )}

          {/* ══════════ ACCOUNTS TAB ══════════ */}
          {activeTab === 'accounts' && (
            <>
              <div className="mb-6">
                <h1 className="text-3xl font-bold text-white mb-1">Contas e Cartões</h1>
                <p className="text-textMuted text-sm">Seu saldo real e faturas pendentes</p>
              </div>
              <AccountsManager 
                accounts={accounts} 
                onAdd={addAccount}
                onUpdate={updateAccount}
                onDelete={deleteAccount}
              />
            </>
          )}

          {/* ══════════ DEBTS TAB ══════════ */}
          {activeTab === 'debts' && (
            <>
              <div className="mb-6">
                <h1 className="text-3xl font-bold text-white mb-1">Dívidas e Parcelamentos</h1>
                <p className="text-textMuted text-sm">Compras parceladas no cartão, dívidas cadastradas e o que vence em cada mês</p>
              </div>
              {/* FIN-094: mês de referência, vencimentos do mês e compras parceladas no cartão. */}
              <InstallmentsPanel transactions={transactions} debts={debts} accounts={accounts}/>
              <DebtManager
                debts={debts}
                onAdd={addDebt}
                onUpdate={updateDebt}
                onDelete={deleteDebt}
                accounts={accounts}
              />
            </>
          )}

          {/* ══════════ BUDGETS TAB (FIN-045) ══════════ */}
          {activeTab === 'budgets' && (
            <>
              <div className="mb-6">
                <h1 className="text-3xl font-bold text-white mb-1">Orçamento</h1>
                <p className="text-textMuted text-sm">Limite de gasto mensal por categoria</p>
              </div>
              <BudgetManager
                budgetProgress={budgetProgress}
                onAdd={addBudget}
                onUpdate={updateBudget}
                onDelete={deleteBudget}
                existingCategories={budgets.map(b => b.category)}
                transactionCategories={transactionCategories}
              />
            </>
          )}

          {/* ══════════ GOALS TAB (FIN-051) ══════════ */}
          {activeTab === 'goals' && (
            <>
              <div className="mb-6">
                <h1 className="text-3xl font-bold text-white mb-1">Metas</h1>
                <p className="text-textMuted text-sm">Quanto você quer juntar e até quando</p>
              </div>
              <GoalsManager
                goals={goals}
                onAdd={addGoal}
                onUpdate={updateGoal}
                onDelete={deleteGoal}
              />
            </>
          )}

          {/* ══════════ RECURRING TAB (FIN-056) ══════════ */}
          {activeTab === 'recurring' && (
            <>
              <div className="mb-6">
                <h1 className="text-3xl font-bold text-white mb-1">Recorrências</h1>
                <p className="text-textMuted text-sm">Lançamentos que se repetem — salário, aluguel, assinaturas</p>
              </div>
              <RecurringManager
                recurring={recurring}
                accounts={accounts}
                onAdd={addRecurring}
                onUpdate={updateRecurring}
                onDelete={deleteRecurring}
                transactionCategories={transactionCategories}
              />
            </>
          )}

          {/* ══════════ REPORTS TAB (FIN-062/FIN-063/FIN-064) ══════════ */}
          {activeTab === 'reports' && (
            <>
              <div className="mb-6">
                <h1 className="text-3xl font-bold text-white mb-1">Relatórios</h1>
                <p className="text-textMuted text-sm">Patrimônio líquido e comparativos de receitas e despesas</p>
              </div>
              <ReportsView
                transactions={transactions}
                accounts={accounts}
                debts={debts}
              />
            </>
          )}
        </div>
      </main>

      {showImport && <ImportModal accounts={accounts} onClose={() => setShowImport(false)} onImport={(txs, pt) => handleImport(txs, pt)} />}
    </div>
  );
}

/* --- UI Helpers --- */

function SummaryCard({ title, amount, icon, badge, isPositive, onClick }: { title: string; amount: string; icon: React.ReactNode; badge?: string; isPositive: boolean; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={`glass-card rounded-2xl p-6 transition-all ${onClick ? 'cursor-pointer hover:bg-white/5 hover:-translate-y-1' : ''}`}>
      <div className="flex justify-between items-start mb-4">
        <div className="p-2.5 rounded-xl" style={{ backgroundColor:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.05)' }}>
          {icon}
        </div>
        {badge && <span className="text-[10px] uppercase tracking-wider font-bold text-textMuted bg-white/5 px-2.5 py-1 rounded-full border border-white/5">{badge}</span>}
      </div>
      <p className="text-sm font-medium text-textMuted mb-1">{title}</p>
      <h3 className={`text-2xl font-bold tracking-tight ${isPositive ? 'text-white' : 'text-white'}`}>
        {!isPositive && amount !== 'R$ 0,00' ? '-' : ''}{amount}
      </h3>
    </div>
  );
}

const PAYMENT_TYPE_META: Record<string, { label: string; color: string }> = {
  debit:           { label: 'Débito',       color: '#3b82f6' },
  credit:          { label: 'Crédito',      color: '#ec4899' },
  pix:             { label: 'PIX',          color: '#10b981' },
  pix_installment: { label: 'PIX Parc.',    color: '#f59e0b' },
};

// FIN-022: edição/exclusão individual de transação. `rows` continua sendo o recorte já
// filtrado/paginado calculado pelo componente pai — este componente só adiciona a UI de
// ação por linha e o modal de edição.
function TxTable({ rows, accounts, onUpdate, onDelete }: {
  rows: Transaction[];
  accounts: Account[];
  onUpdate: (id: string, tx: Partial<Transaction>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [form, setForm] = useState<Partial<Transaction>>({});
  const [saving, setSaving] = useState(false);

  const openEdit = (t: Transaction) => { setEditing(t); setForm({ ...t }); };

  const handleSave = async () => {
    if (!editing || !form.name?.trim() || !form.date || form.amount === undefined) return;
    setSaving(true);
    try {
      await onUpdate(editing.id, form);
      setEditing(null);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (t: Transaction) => {
    if (confirm(`Excluir a transação "${t.name}"?`)) await onDelete(t.id);
  };

  return (
    <div className="overflow-x-auto min-h-[400px]">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-textMuted">
            <th className="pb-3 font-semibold w-24">Data</th>
            <th className="pb-3 font-semibold">Descrição</th>
            <th className="pb-3 font-semibold">Categoria</th>
            <th className="pb-3 font-semibold">Tipo</th>
            <th className="pb-3 font-semibold text-right">Valor</th>
            <th className="pb-3 font-semibold w-20 text-right">Ações</th>
          </tr>
        </thead>
        <tbody className="text-sm divide-y divide-white/5">
          {rows.map(t => {
            const pt = PAYMENT_TYPE_META[t.paymentType ?? 'debit'] ?? PAYMENT_TYPE_META['debit'];
            return (
              <tr key={t.id} className="group hover:bg-white/[0.02] transition-colors">
                <td className="py-4 text-textMuted">{formatDateBR(t.date)}</td>
                <td className="py-4 font-medium text-white">{t.name}</td>
                <td className="py-4">
                  <span className="px-2.5 py-1 rounded-full text-xs border"
                    style={{
                      backgroundColor: CATEGORY_COLORS[t.category] ? `${CATEGORY_COLORS[t.category]}15` : 'rgba(255,255,255,0.05)',
                      borderColor: CATEGORY_COLORS[t.category] ? `${CATEGORY_COLORS[t.category]}30` : 'rgba(255,255,255,0.1)',
                      color: CATEGORY_COLORS[t.category] || '#9ca3af'
                    }}>
                    {t.category}
                  </span>
                </td>
                <td className="py-4">
                  <span
                    className="px-2.5 py-1 rounded-full text-xs font-semibold border"
                    style={{
                      backgroundColor: `${pt.color}15`,
                      borderColor: `${pt.color}35`,
                      color: pt.color,
                    }}
                  >
                    {pt.label}
                  </span>
                </td>
                <td className={`py-4 text-right font-bold ${t.amount >= 0 ? 'text-teal-400' : 'text-red-400'}`}>
                  {t.amount >= 0 ? '+' : ''}{t.amount.toLocaleString('pt-BR', { minimumFractionDigits:2 })}
                </td>
                <td className="py-4">
                  <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(t)} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-textMuted hover:text-white">
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => handleDelete(t)} className="p-1.5 hover:bg-red-500/10 rounded-lg transition-colors text-textMuted hover:text-red-400">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {editing && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-md glass-card rounded-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-bold text-white">Editar Transação</h3>
              <button onClick={() => setEditing(null)} className="p-2 hover:bg-white/10 rounded-lg text-textMuted hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-textMuted mb-1.5 uppercase tracking-wide">Descrição</label>
                <input value={form.name ?? ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input-field" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-textMuted mb-1.5 uppercase tracking-wide">Data</label>
                  <input type="date" value={form.date ?? ''} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="input-field" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-textMuted mb-1.5 uppercase tracking-wide">Valor (R$)</label>
                  <input type="number" step="0.01" value={form.amount ?? 0} onChange={e => setForm(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-textMuted mb-1.5 uppercase tracking-wide">Categoria</label>
                  <select value={form.category ?? ''} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="input-field">
                    {Object.keys(CATEGORY_COLORS).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-textMuted mb-1.5 uppercase tracking-wide">Tipo</label>
                  <select value={form.paymentType ?? 'debit'} onChange={e => setForm(f => ({ ...f, paymentType: e.target.value as PaymentType }))} className="input-field">
                    {Object.entries(PAYMENT_TYPE_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-textMuted mb-1.5 uppercase tracking-wide">Conta</label>
                <select value={form.accountId ?? ''} onChange={e => setForm(f => ({ ...f, accountId: e.target.value }))} className="input-field">
                  <option value="">Sem conta vinculada</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setEditing(null)} className="flex-1 py-2.5 rounded-xl text-sm text-textMuted border border-white/10 hover:bg-white/5 transition-colors">Cancelar</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm text-white font-semibold transition-colors disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))' }}>
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NavItem({ icon, label, active, badge, badgeColor, onClick, isSubItem }: { icon: React.ReactNode; label: string; active: boolean; badge?: number; badgeColor?: string; onClick: () => void; isSubItem?: boolean }) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all ${
        active ? 'bg-white/10 text-white shadow-sm' : 'text-textMuted hover:bg-white/5 hover:text-white'
      } ${isSubItem ? 'text-sm py-2' : ''}`}>
      <div className="flex items-center gap-3">
        <span className={active ? 'text-primary' : ''}>{icon}</span>
        <span className="font-medium">{label}</span>
      </div>
      {badge !== undefined && (
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: badgeColor || 'rgba(255,255,255,0.1)', color: badgeColor ? '#fff' : 'inherit' }}>
          {badge}
        </span>
      )}
    </button>
  );
}
