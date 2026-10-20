import { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
import {
  LayoutDashboard, Wallet, Upload,
  Search, TrendingUp, Loader2,
  LogOut, X, Menu, WifiOff, Sun, Moon, PiggyBank, Target, Repeat, BarChart3, Settings
} from 'lucide-react';
import { ImportModal } from './components/ImportModal';
import { NavItem } from './components/NavItem';
import { FinFlowMark } from './components/FinFlowMark';
import { PAYMENT_TYPE_META, type CategoryRuleDraft } from './utils/paymentTypes';
import { NotificationBell } from './components/NotificationBell';
import { AuthForm } from './components/AuthForm';
import { DashboardPage } from './pages/DashboardPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { AccountsPage } from './pages/AccountsPage';
import { DebtsPage } from './pages/DebtsPage';
import { BudgetsPage } from './pages/BudgetsPage';
import { GoalsPage } from './pages/GoalsPage';
import { RecurringPage } from './pages/RecurringPage';
// FIN-117 — carregadas sob demanda: cada uma vira um pedaço próprio no build (Reports/Investments
// trazem o Recharts, Settings traz 2FA/backup/regras de categoria, e o widget da Pluggy só é
// usado por quem conecta um banco). O pacote inicial fica menor; quem nunca abre essas abas nunca
// baixa esse código.
const InvestmentsPage = lazy(() => import('./pages/InvestmentsPage').then(m => ({ default: m.InvestmentsPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then(m => ({ default: m.ReportsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const PluggyConnectButton = lazy(() => import('./components/PluggyConnectButton').then(m => ({ default: m.PluggyConnectButton })));
import { formatBRL as fmt, toCents, toReais } from './utils/money';
import { apiFetch, ApiError } from './services/api';
import { accountIdsOf, inAccounts } from './utils/accountGroups';

import { useFinancialStats } from './hooks/useFinancialStats';
import { useMobileDrawer } from './hooks/useMobileDrawer';
import { useTheme } from './hooks/useTheme';
import { computeBudgetProgress } from './utils/budget';
import { computeBalanceProjection } from './utils/projection';
import { computeInvestmentHoldings } from './utils/investments';
import { linkedGoalAmount } from './utils/goals';
import { todayISO } from './utils/debts';
import { formatDateBR, formatMonthLabel } from './utils/dates';
import { downloadCSV, downloadPDFReport, exportDateSuffix, formatCurrencyCSV } from './utils/export';
import { TRANSACTION_REPORT_HEADERS, transactionsPeriod, computeNetWorth, type NetWorth } from './utils/reports';
import {
  ALL_MONTHS, availableMonths, filterByKind, filterByMonthAndSearch, summarizeTransactions,
} from './utils/transactions';
import { isInstallmentTransaction } from './utils/installments';
import {
  BASE_CURRENCY, accountsInBase, currencyOf, foreignCurrencies,
  investmentsInBase, parseExchangeRates, transactionsInBase,
  type ExchangeRates,
} from './utils/currency';
import type {
  Account, AppNotification, Budget, Debt, DebtCategory, Goal, Investment, InvestmentInput, NetWorthSnapshot,
  NotificationType, RecurringTransaction, Salary, Transaction, PaymentType,
} from './types';

const TABS = ['dashboard', 'transactions', 'accounts', 'debts', 'budgets', 'goals', 'investments', 'recurring', 'reports', 'settings'] as const;
export type Tab = (typeof TABS)[number];

/** A aba vive no endereço (#contas…): voltar, recarregar e abrir em outra aba mantêm a tela. */
const tabFromHash = (): Tab => {
  const hash = window.location.hash.slice(1);
  return (TABS as readonly string[]).includes(hash) ? (hash as Tab) : 'dashboard';
};

// Login desativado temporariamente — ver `local-session` em Backend/server/routes/auth.js.
const AUTH_DISABLED = import.meta.env.VITE_AUTH_DISABLED === 'true';

// FIN-066: aba para onde o clique numa notificação leva, por tipo.
const NOTIFICATION_TAB: Record<NotificationType, Tab> = {
  debt_due: 'debts',
  debt_overdue: 'debts',
  bill_due: 'accounts',
  unusual_spending: 'transactions',
};

/** Resposta de `GET /api/notifications` (FIN-065). */
interface NotificationsResponse {
  notifications: AppNotification[];
  unreadCount: number;
}

/** FIN-117 — estado de carregamento (acessível) de uma aba carregada sob demanda. */
function PageLoadingFallback() {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-24 text-sm text-textMuted">
      <Loader2 size={18} className="animate-spin" aria-hidden="true" />
      Carregando...
    </div>
  );
}

/** FIN-117 — mesmo papel de `PageLoadingFallback`, no tamanho do botão do widget da Pluggy. */
function PluggyButtonLoadingFallback() {
  return (
    <div role="status" className="w-full py-3 flex items-center justify-center gap-2 text-xs text-textMuted">
      <Loader2 size={14} className="animate-spin" aria-hidden="true" />
      Carregando...
    </div>
  );
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
 * Converte os valores da meta de centavos (API) para reais (UI) — ver conversão no topo deste
 * bloco. `accountId`/`investmentId` nulos (FIN-113: meta sem vínculo) viram ausentes, mesma
 * convenção de `investmentFromApi`.
 */
function goalFromApi(g: Goal): Goal {
  return {
    ...g,
    accountId: g.accountId ?? undefined,
    investmentId: g.investmentId ?? undefined,
    targetAmount: toReais(g.targetAmount),
    currentAmount: toReais(g.currentAmount),
  };
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
/** Converte os valores do investimento de centavos (API) para reais (UI); `accountId` nulo vira ausente. */
function investmentFromApi(i: Investment): Investment {
  return {
    ...i,
    accountId: i.accountId ?? undefined,
    amountInvested: toReais(i.amountInvested),
    currentValue: toReais(i.currentValue),
  };
}
/**
 * Converte os valores do investimento de reais (UI) para centavos (API). "Sem conta" vai como
 * `null` explícito, e não como campo ausente: na edição, ausente manteria o vínculo antigo.
 */
function investmentToApi(i: InvestmentInput) {
  return {
    ...i,
    accountId: i.accountId || null,
    amountInvested: toCents(i.amountInvested),
    currentValue: toCents(i.currentValue),
  };
}
/** Converte um retrato do patrimônio (FIN-112) de centavos (API) para reais (UI). */
function netWorthSnapshotFromApi(s: NetWorthSnapshot): NetWorthSnapshot {
  return {
    month: s.month,
    liquid: toReais(s.liquid),
    investments: toReais(s.investments),
    liabilities: toReais(s.liabilities),
    total: toReais(s.total),
  };
}
/** Payload em centavos de `POST /api/net-worth/snapshot`, a partir do patrimônio já calculado em reais. */
function netWorthSnapshotToApi(nw: NetWorth) {
  return {
    liquid: toCents(nw.liquid),
    investments: toCents(nw.investments),
    liabilities: toCents(nw.pendingBills + nw.debts),
    total: toCents(nw.total),
  };
}

/**
 * Componente raiz do FinFlow — gerencia sessão (login/token), carrega contas, transações,
 * dívidas e orçamentos do usuário autenticado, deriva as estatísticas do Dashboard e
 * renderiza a navegação e as abas (Dashboard, Transações, Contas, Dívidas, Orçamento).
 *
 * FIN-116 — o conteúdo de cada aba mora em `src/pages/*.tsx`; este componente fica só com a
 * sessão, a carga/mutação de dados e a navegação (barra lateral, cabeçalho, troca de aba).
 */
export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('finflow_token'));
  const [user, setUser]   = useState<{ id: string; name: string; email: string } | null>(null);
  const [loading, setLoading] = useState(!!token);

  const [activeTab, setActiveTab]     = useState<Tab>(tabFromHash);
  const [showImport, setShowImport]   = useState(false);
  const [search, setSearch]           = useState('');
  const [txFilter, setTxFilter]       = useState<'all' | 'income' | 'expense'>('all');
  // Mês de referência da aba Transações (FIN-093). Começa no mês corrente de propósito:
  // sem recorte, os totais somavam também as parcelas de meses futuros já lançadas no cartão.
  const [txMonth, setTxMonth]         = useState<string>(() => todayISO().slice(0, 7));
  // Filtro por conta das abas Transações e Dívidas (null = todas), compartilhado entre as duas.
  const [listAccountId, setListAccountId] = useState<string | null>(null);
  const [dashboardAccountId, setDashboardAccountId] = useState<string | null>(null);
  const [chartPeriod, setChartPeriod] = useState<'30d' | 'all'>('30d');
  const [mobileNavOpen, setMobileNavOpen] = useState(false); // FIN-028
  // FIN-081: a gaveta do menu em telas pequenas — foco preso nela, Esc, deslize para fechar e
  // `inert` quando fechada. Refs do botão que abre (recebe o foco de volta) e do que fecha.
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const drawer = useMobileDrawer({
    open: mobileNavOpen,
    onClose: () => setMobileNavOpen(false),
    containerRef: drawerRef,
    initialFocusRef: drawerCloseRef,
    returnFocusRef: menuButtonRef,
  });
  useEffect(() => {
    if (window.location.hash.slice(1) !== activeTab) window.location.hash = activeTab;
    window.scrollTo(0, 0);
  }, [activeTab]);
  useEffect(() => {
    // Só hashes de aba trocam a tela — o #main-content do "pular para o conteúdo" não.
    const onHash = () => { if ((TABS as readonly string[]).includes(window.location.hash.slice(1))) setActiveTab(tabFromHash()); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  // FIN-083: tema claro/escuro — aplicado ao documento também na tela de login.
  const theme = useTheme();
  const [notifications, setNotifications] = useState<AppNotification[]>([]); // FIN-066
  const [unreadCount, setUnreadCount] = useState(0);
  const [exportingPDF, setExportingPDF] = useState(false); // FIN-061

  const [transactions, setTxs]        = useState<Transaction[]>([]);
  const [accounts, setAccounts]       = useState<Account[]>([]);
  const [debts, setDebts]             = useState<Debt[]>([]);
  const [budgets, setBudgets]         = useState<Budget[]>([]);
  const [salary, setSalary]           = useState<Salary>({ amount: 0, frequency: 'monthly', payDay: 15, bonus: 0, bonusHalf: 1, bonusMonth: null });
  const [goals, setGoals]             = useState<Goal[]>([]);
  const [recurring, setRecurring]     = useState<RecurringTransaction[]>([]);
  const [investments, setInvestments] = useState<Investment[]>([]); // FIN-072
  const [netWorthHistory, setNetWorthHistory] = useState<NetWorthSnapshot[]>([]); // FIN-112
  // FIN-075: cotações para os totais em real — só buscadas quando há moeda estrangeira em uso.
  const [rates, setRates] = useState<ExchangeRates | null>(null);
  const [ratesFailed, setRatesFailed] = useState(false);
  // FIN-023: a carga inicial busca até 2000 transações (comportamento original,
  // preservado). Se bater exatamente nesse limite, pode haver mais — `txHasMore` habilita
  // o botão "Carregar mais", que busca o restante via paginação real da API.
  const [txHasMore, setTxHasMore]     = useState(false);
  const [txLoadingMore, setTxLoadingMore] = useState(false);
  // FIN-080: incrementado depois de restaurar um backup — refaz a carga de todos os dados.
  const [dataVersion, setDataVersion] = useState(0);
  const [settingsNotice, setSettingsNotice] = useState('');
  // FIN-082: a carga falhou sem ser por sessão inválida (sem conexão, servidor fora do ar).
  const [loadError, setLoadError] = useState('');

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
    setNotifications([]);
    setUnreadCount(0);
    setTxs([]);
    setDebts([]);
    setBudgets([]);
    setSalary({ amount: 0, frequency: 'monthly', payDay: 15, bonus: 0, bonusHalf: 1, bonusMonth: null });
    setGoals([]);
    setRecurring([]);
    setInvestments([]);
    setNetWorthHistory([]);
    setRates(null);
    setRatesFailed(false);
    setSettingsNotice('');
    setLoadError('');
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
          fetchAPI('/api/investments'),
          fetchAPI('/api/net-worth/history'),
          fetchAPI('/api/auth/salary'),
        ])).then(([meData, accsData, txsData, debtsData, budgetsData, goalsData, recurringData, investmentsData, netWorthHistoryData, salaryData]) => {
        setUser(meData.user);
        setAccounts((accsData as Account[]).map(accountFromApi));
        setTxs((txsData as Transaction[]).map(txFromApi));
        setTxHasMore((txsData as Transaction[]).length >= 2000);
        setDebts((debtsData as Debt[]).map(debtFromApi));
        setBudgets((budgetsData as Budget[]).map(budgetFromApi));
        setGoals((goalsData as Goal[]).map(goalFromApi));
        setRecurring((recurringData as RecurringTransaction[]).map(recurringFromApi));
        setInvestments((investmentsData as Investment[]).map(investmentFromApi));
        setNetWorthHistory((netWorthHistoryData as NetWorthSnapshot[]).map(netWorthSnapshotFromApi));
        setSalary({ amount: toReais(salaryData.salaryCents), frequency: salaryData.salaryFrequency, payDay: salaryData.salaryPayDay ?? 15,
          bonus: toReais(salaryData.bonusCents ?? 0), bonusHalf: salaryData.bonusHalf === 2 ? 2 : 1, bonusMonth: salaryData.bonusMonth ?? null });
      }).catch(err => {
        // FIN-082: só um token recusado (401/403) encerra a sessão. Sem conexão — o app instalado
        // aberto offline — ou com o servidor fora do ar, a sessão continua e a tela oferece tentar
        // de novo; antes, qualquer falha aqui deslogava.
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          console.error('Sessão expirada:', err);
          handleLogout();
        } else {
          console.error('Falha ao carregar os dados:', err);
          setLoadError('Não foi possível carregar os seus dados. Verifique a conexão com a internet e tente de novo.');
        }
      }).finally(() => {
        setLoading(false);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, dataVersion]);

  // FIN-066/FIN-067: gera as notificações automáticas e recarrega a central na carga inicial
  // e sempre que os dados que as originam mudam (pagamento de parcela, importação, edição de
  // cartão). A geração é idempotente no servidor, então rodar a cada mudança não duplica
  // nada; `cancelled` descarta a resposta de uma rodada que já foi superada por outra.
  // Uma falha aqui não derruba a sessão — o sino só fica desatualizado.
  useEffect(() => {
    if (!token || loading) return;
    let cancelled = false;
    (async () => {
      try {
        await apiFetch('/api/notifications/generate', { method: 'POST', token });
        const data = await apiFetch<Partial<NotificationsResponse> | null>('/api/notifications', { token });
        if (cancelled) return;
        // Normaliza a resposta: um corpo inesperado não pode quebrar o header inteiro.
        setNotifications(Array.isArray(data?.notifications) ? data.notifications : []);
        setUnreadCount(typeof data?.unreadCount === 'number' ? data.unreadCount : 0);
      } catch (err) {
        console.error('Falha ao atualizar notificações:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [token, loading, debts, accounts, transactions]);

  // FIN-075: moedas estrangeiras em uso — as cotações que o app precisa. Quem só usa real não
  // faz requisição nenhuma ao câmbio. A chave em texto evita buscar de novo quando as listas
  // mudam sem mudar as moedas.
  const foreignKey = useMemo(
    () => foreignCurrencies(accounts, transactions, investments).join(','),
    [accounts, transactions, investments]
  );

  useEffect(() => {
    if (!token || !foreignKey) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<unknown>(`/api/exchange-rates?symbols=${encodeURIComponent(foreignKey)}`, { token });
        if (cancelled) return;
        // Normaliza a resposta: um corpo inesperado vira "sem cotação", nunca uma exceção na tela.
        const parsed = parseExchangeRates(data);
        if (parsed) setRates(parsed);
        setRatesFailed(parsed === null);
      } catch (err) {
        console.error('Falha ao obter cotações:', err);
        // Mantém a última cotação conhecida, se houver; a tela avisa o que ficou sem cotação.
        if (!cancelled) setRatesFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [token, foreignKey]);

  /** FIN-107: depois que o widget da Pluggy sincroniza, recarrega contas e transações. */
  const handlePluggySyncComplete = async () => {
    const [accsData, txsData] = await Promise.all([
      fetchAPI('/api/accounts'),
      fetchAPI('/api/transactions'),
    ]);
    setAccounts((accsData as Account[]).map(accountFromApi));
    setTxs((txsData as Transaction[]).map(txFromApi));
    setTxHasMore((txsData as Transaction[]).length >= 2000);
  };

  /** Remove todas as transações do usuário, com confirmação. */
  const handleClearTransactions = async () => {
    if (!confirm(`Apagar as ${transactions.length} transações? Não dá para desfazer.`)) return;
    await fetchAPI('/api/transactions/bulk', 'DELETE');
    setTxs([]);
    setTxHasMore(false);
  };

  const handleLogin = (newToken: string, newUser: { id: string; name: string; email: string }) => {
    localStorage.setItem('finflow_token', newToken);
    setToken(newToken);
    setUser(newUser);
  };

  // Login desativado temporariamente (VITE_AUTH_DISABLED=true): sem token, abre a sessão local
  // em vez de mostrar a tela de login. Se a rota falhar, a tela de login volta a aparecer.
  const [localSessionFailed, setLocalSessionFailed] = useState(false);
  useEffect(() => {
    if (!AUTH_DISABLED || token || localSessionFailed) return;
    apiFetch<{ token: string; user: { id: string; name: string; email: string } }>('/api/auth/local-session', { method: 'POST' })
      .then(data => handleLogin(data.token, data.user))
      .catch(err => { console.error('Falha ao abrir a sessão local:', err); setLocalSessionFailed(true); });
  }, [token, localSessionFailed]);

  /** FIN-082: nova tentativa depois de uma carga que falhou sem conexão. */
  const retryLoad = () => {
    setLoadError('');
    setDataVersion(v => v + 1);
  };

  /**
   * FIN-080: depois de restaurar um backup, todos os dados mudaram no servidor — refaz a carga
   * completa (a mesma do login) e guarda o resumo para a aba Configurações mostrar. O filtro de
   * conta do Dashboard volta para "todas", porque a conta escolhida pode não existir mais.
   */
  const handleRestored = (summary: string) => {
    setSettingsNotice(summary);
    setDashboardAccountId(null);
    setDataVersion(v => v + 1);
  };

  /** Busca de novo as transações (a primeira página), depois de uma mudança feita no servidor. */
  const reloadTransactions = async () => {
    const txsData = await fetchAPI('/api/transactions');
    setTxs((txsData as Transaction[]).map(txFromApi));
    setTxHasMore((txsData as Transaction[]).length >= 2000);
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
        await reloadTransactions();

        // Auto-create debt for pix_installment payments. Cartão não: as compras já estão nas
        // transações e a fatura no `pendingBill` da conta — a dívida contava tudo de novo no
        // total a pagar do mês da aba Dívidas.
        // Só faz sentido se ao menos uma transação nova foi de fato importada — se tudo
        // já existia (res.count === 0), reimportar o mesmo extrato não deve gerar dívida.
        // FIN-076: dívidas são registradas em real — a fatura de uma conta em outra moeda não
        // vira dívida automática, porque o valor seria gravado como se fosse real.
        const importAccount = accounts.find(a => a.id === txsWithType[0]?.accountId);
        const importCurrency = importAccount ? currencyOf(importAccount) : BASE_CURRENCY;
        const wantsDebt = paymentType === 'pix_installment' && res.count > 0;
        if (wantsDebt && importCurrency !== BASE_CURRENCY) {
          alert(`Transações importadas. A conta está em ${importCurrency} e dívidas são registradas em real, então nenhuma dívida automática foi criada — cadastre-a na aba Dívidas, se quiser.`);
        } else if (wantsDebt) {
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
            const label = 'PIX Parcelado';
            const category: DebtCategory = 'Pessoal';
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
      // FIN-074: trocar a conta troca a moeda — a mesma regra que o servidor acabou de aplicar.
      const currency = tx.accountId !== undefined
        ? currencyOf(accounts.find(a => a.id === tx.accountId) ?? {})
        : undefined;
      setTxs(prev => prev.map(t => t.id === id ? { ...t, ...tx, ...(currency ? { currency } : {}) } : t));
    } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); throw e; }
  };
  const deleteTransaction = async (id: string) => {
    try {
      await fetchAPI(`/api/transactions/${id}`, 'DELETE');
      setTxs(prev => prev.filter(t => t.id !== id));
    } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); throw e; }
  };
  // FIN-106: regra criada ao corrigir a categoria. Aplicada às já gravadas, recarrega as transações.
  const createCategoryRule = async (rule: CategoryRuleDraft) => {
    try {
      const saved = await fetchAPI('/api/category-rules', 'POST', rule);
      if (Number(saved?.updated) > 0) await reloadTransactions();
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
      // FIN-074: o servidor leva as transações da conta para a moeda nova; o estado local também.
      if (acc.currency) {
        setTxs(prev => prev.map(t => (t.accountId === id ? { ...t, currency: acc.currency } : t)));
      }
    } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); throw e; }
  };
  const deleteAccount = async (id: string) => {
    try {
      await fetchAPI(`/api/accounts/${id}`, 'DELETE');
      setAccounts(prev => prev.filter(a => a.id !== id));
      setTxs(prev => prev.filter(t => t.accountId !== id)); // o servidor exclui as transações da conta
      // FIN-072: o banco desfaz o vínculo das posições com a conta excluída (ON DELETE SET
      // NULL); o estado local acompanha, para a carteira não citar uma conta que não existe.
      setInvestments(prev => prev.map(i => (i.accountId === id ? { ...i, accountId: undefined } : i)));
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

  /** Salva o salário manual via `PUT /api/auth/salary` (API em centavos, estado em reais). */
  const saveSalary = async (next: Salary) => {
    try {
      await fetchAPI('/api/auth/salary', 'PUT', { salaryCents: toCents(next.amount), salaryFrequency: next.frequency, salaryPayDay: next.payDay,
        bonusCents: toCents(next.bonus), bonusHalf: next.bonusHalf, bonusMonth: next.bonusMonth });
      setSalary(next);
    } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); throw e; }
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

  // CRUD INVESTMENTS (FIN-072)
  /** Cadastra uma posição via `POST /api/investments` e adiciona o resultado (em reais) ao estado. */
  const addInvestment = async (inv: InvestmentInput) => {
    try {
      const created = await fetchAPI('/api/investments', 'POST', investmentToApi(inv));
      setInvestments(prev => [...prev, investmentFromApi(created)]);
    } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); throw e; }
  };
  /** Atualiza uma posição e usa o registro devolvido pela API, que traz o `updatedAt` novo. */
  const updateInvestment = async (id: string, inv: InvestmentInput) => {
    try {
      const updated = await fetchAPI(`/api/investments/${id}`, 'PUT', investmentToApi(inv));
      setInvestments(prev => prev.map(i => (i.id === id ? investmentFromApi(updated) : i)));
    } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); throw e; }
  };
  /** Exclui uma posição via `DELETE /api/investments/:id` e remove do estado local. */
  const deleteInvestment = async (id: string) => {
    try {
      await fetchAPI(`/api/investments/${id}`, 'DELETE');
      setInvestments(prev => prev.filter(i => i.id !== id));
    } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); throw e; }
  };

  // ---------- Derived stats ----------
  // Lógica extraída para src/hooks/useFinancialStats.ts (ver FIN-086 em
  // docs/BACKLOG_DETAIL.md) — separa a regra de negócio da camada de UI e permite
  // testá-la sem renderizar componentes (ver FIN-034).
  // FIN-075/FIN-076: os totais do app são em real. Contas, transações, posições e recorrências em
  // outra moeda entram neles convertidas pela cotação; sem cotação, ficam de fora — e a tela
  // avisa —, em vez de somar dólar como se fosse real. As listas originais continuam valendo
  // para a exibição item a item, que mostra cada valor na própria moeda.
  const accountsBase = useMemo(() => accountsInBase(accounts, rates), [accounts, rates]);
  const transactionsBase = useMemo(() => transactionsInBase(transactions, rates), [transactions, rates]);
  const investmentsBase = useMemo(() => investmentsInBase(investments, rates), [investments, rates]);

  // FIN-112: guarda um retrato do patrimônio líquido de hoje, para o gráfico de evolução em
  // Relatórios. Roda de novo sempre que ele muda (contas, dívidas, investimentos ou a cotação que
  // os converte para real) — mesmo padrão do efeito de notificações logo acima: idempotente no
  // servidor (upsert no mês corrente), então repetir não duplica nada. Sem contas nem dívidas
  // ainda (conta recém-criada), não há o que registrar.
  useEffect(() => {
    if (!token || loading || (accountsBase.items.length === 0 && debts.length === 0)) return;
    let cancelled = false;
    (async () => {
      try {
        const netWorth = computeNetWorth(accountsBase.items, debts, investmentsBase.items);
        await fetchAPI('/api/net-worth/snapshot', 'POST', netWorthSnapshotToApi(netWorth));
        const history = await fetchAPI('/api/net-worth/history');
        if (!cancelled) setNetWorthHistory((history as NetWorthSnapshot[]).map(netWorthSnapshotFromApi));
      } catch (err) {
        console.error('Falha ao salvar o retrato do patrimônio:', err);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, loading, accountsBase.items, investmentsBase.items, debts]);

  // FIN-113: mantém `currentAmount` das metas ligadas a conta/investimento em dia — o progresso
  // anda sozinho, sem digitar (quem edita manualmente é GoalsManager, para uma meta sem vínculo).
  // `linkedGoalAmount` devolve `null` para meta sem vínculo ou cujo vínculo sumiu (conta/
  // investimento excluído — o `accountId`/`investmentId` já veio nulo da API): nada a fazer, o
  // último valor gravado fica congelado. Um único `setGoals` no fim (não um por meta): `goals` é
  // dependência deste efeito, e um `setGoals` a cada iteração de um `for` reiniciaria o efeito no
  // meio do próprio laço.
  useEffect(() => {
    if (!token || loading) return;
    const pending = goals
      .map(goal => ({ id: goal.id, name: goal.name, amount: linkedGoalAmount(goal, accountsBase.items, investmentsBase.items) }))
      .filter((p): p is { id: string; name: string; amount: number } => p.amount !== null)
      .filter(p => p.amount !== goals.find(g => g.id === p.id)!.currentAmount);
    if (pending.length === 0) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.allSettled(
        pending.map(p => fetchAPI(`/api/goals/${p.id}`, 'PUT', goalToApi({ currentAmount: p.amount })))
      );
      if (cancelled) return;
      const synced = new Map(pending.filter((_, i) => results[i].status === 'fulfilled').map(p => [p.id, p.amount]));
      if (synced.size > 0) setGoals(prev => prev.map(g => (synced.has(g.id) ? { ...g, currentAmount: synced.get(g.id)! } : g)));
      results.forEach((r, i) => {
        if (r.status === 'rejected') console.error(`Falha ao atualizar o progresso da meta "${pending[i].name}":`, r.reason);
      });
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, loading, goals, accountsBase.items, investmentsBase.items]);

  const missingCurrencies = useMemo(
    () => foreignCurrencies(accountsBase.missing, transactionsBase.missing, investmentsBase.missing),
    [accountsBase, transactionsBase, investmentsBase]
  );
  const usedCurrencies = foreignKey ? foreignKey.split(',') : [];
  const conversionIssue = missingCurrencies.length > 0 || rates?.stale === true;

  const stats = useFinancialStats(transactionsBase.items, accountsBase.items, debts, dashboardAccountId, investmentsBase.items);

  // FIN-073: o card de Investimentos aparece com conta de investimento OU posição na carteira;
  // a legenda diz de onde vem o total (posições, contas sem posições, ou os dois).
  const hasInvestments = investments.length > 0 || accounts.some(a => a.type === 'investment');
  const investmentHoldings = useMemo(
    () => computeInvestmentHoldings(accountsBase.items, investmentsBase.items),
    [accountsBase, investmentsBase]
  );

  // FIN-044/FIN-046: progresso de orçamento do mês corrente, calculado sobre TODAS as
  // transações (não filtradas por `dashboardAccountId`) — orçamento é por categoria, não
  // por conta, então não faz sentido restringir a uma conta específica.
  const currentMonth = todayISO().slice(0, 7);
  const budgetProgress = useMemo(
    () => computeBudgetProgress(transactionsBase.items, budgets, currentMonth),
    [transactionsBase, budgets, currentMonth]
  );
  const overBudget = budgetProgress.filter(b => b.isOverLimit); // FIN-047

  // FIN-058: projeção dos próximos 6 meses a partir do saldo real (contas líquidas),
  // somando o salário e descontando as dívidas de cada mês (fatura, parcelas do cartão e dívidas).
  const projection = useMemo(
    () => computeBalanceProjection(stats.realBalance, salary, debts, {
      months: 6, currentBill: stats.monthCardExpense, cardInstallments: stats.cardInstallmentsAhead,
    }),
    [stats.realBalance, stats.monthCardExpense, stats.cardInstallmentsAhead, salary, debts]
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
  // Conta escolhida no filtro, se ainda existir: excluir a conta ou restaurar um backup não
  // deixa o filtro preso numa conta que sumiu (o que esvaziaria as listas).
  // A seleção pode ser um banco inteiro (conta corrente + cartão) — ver accountGroups.
  const listAccountIds = accountIdsOf(listAccountId, accounts);
  const listAccount = listAccountIds ? listAccountId : null;
  const inListAccount = (t: Transaction) => inAccounts(listAccountIds, t.accountId);

  const regularTransactions = useMemo(
    () => transactions.filter(t => !isInstallmentTransaction(t) && inListAccount(t)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transactions, listAccount]
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
  // FIN-076: os totais do mês em real — a lista continua mostrando cada transação na própria moeda.
  const regularTransactionsBase = useMemo(
    () => transactionsBase.items.filter(t => !isInstallmentTransaction(t) && inListAccount(t)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transactionsBase, listAccount]
  );
  const monthScopedBase = useMemo(
    () => filterByMonthAndSearch(regularTransactionsBase, txMonth, search),
    [regularTransactionsBase, txMonth, search]
  );
  const monthTotals = useMemo(() => summarizeTransactions(monthScopedBase), [monthScopedBase]);
  const filtered = useMemo(() => filterByKind(monthScoped, txFilter), [monthScoped, txFilter]);

  // FIN-094: quantos parcelados o recorte de mês deixou de fora — a aba mostra um aviso com
  // atalho para Dívidas, para as parcelas não parecerem ter simplesmente sumido.
  const hiddenInstallments = useMemo(
    () => transactions.filter(t =>
      isInstallmentTransaction(t) && inListAccount(t) && (txMonth === ALL_MONTHS || t.date.startsWith(txMonth))
    ).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transactions, txMonth, listAccount]
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
    currencyOf(t),
    formatCurrencyCSV(t.amount),
  ]);

  /**
   * Nota do PDF quando o recorte tem transações em outra moeda (FIN-076): cada linha sai na moeda
   * da conta, e os totais em real — pela cotação do dia, sem as linhas que ficaram sem cotação.
   */
  const currencyReportNote = (codes: string[]) =>
    `Linhas em ${codes.join(', ')} na moeda da conta; totais em real` +
    (rates ? ` pela cotação de ${formatDateBR(rates.date)}` : '') +
    (codes.some(code => missingCurrencies.includes(code)) ? ' (linhas sem cotação ficaram fora dos totais)' : '') +
    '.';

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
      // FIN-076: totais do relatório em real, a partir do mesmo recorte já convertido.
      const filteredBase = filterByKind(monthScopedBase, txFilter);
      const receitas = filteredBase.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      const despesas = filteredBase.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
      const foreignInReport = foreignCurrencies(filtered);
      await downloadPDFReport({
        title: 'FinFlow — Relatório de Transações',
        subtitles: [
          `Mês de referência: ${referenceLabel()}`,
          `Período: ${formatDateBR(periodo.from)} a ${formatDateBR(periodo.to)}  ·  ${filtered.length} transação(ões)`,
          `Receitas: ${fmt(receitas)}  ·  Despesas: ${fmt(despesas)}  ·  Saldo: ${fmt(receitas - despesas)}`,
          ...(foreignInReport.length > 0 ? [currencyReportNote(foreignInReport)] : []),
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

  /**
   * FIN-066: abre a aba relacionada à notificação e a marca como lida. A marcação é otimista
   * — o sino responde na hora — e é desfeita se a API falhar, para a tela não mentir.
   */
  const openNotification = async (notification: AppNotification) => {
    setActiveTab(NOTIFICATION_TAB[notification.type] ?? 'dashboard');
    if (notification.read) return;
    setNotifications(list => list.map(n => (n.id === notification.id ? { ...n, read: true } : n)));
    setUnreadCount(count => Math.max(0, count - 1));
    try {
      await fetchAPI(`/api/notifications/${notification.id}/read`, 'PUT');
    } catch (err) {
      console.error('Falha ao marcar notificação como lida:', err);
      setNotifications(list => list.map(n => (n.id === notification.id ? { ...n, read: false } : n)));
      setUnreadCount(count => count + 1);
    }
  };

  /** FIN-066: marca todas como lidas, também de forma otimista e reversível. */
  const markAllNotificationsRead = async () => {
    const previous = { notifications, unreadCount };
    setNotifications(list => list.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
    try {
      await fetchAPI('/api/notifications/read-all', 'PUT');
    } catch (err) {
      console.error('Falha ao marcar notificações como lidas:', err);
      setNotifications(previous.notifications);
      setUnreadCount(previous.unreadCount);
    }
  };

  const hasAccounts = accounts.length > 0;
  const isEmpty     = transactions.length === 0;

  // Contadores da navegação: só onde há o que resolver (dívida vencida, orçamento estourado).
  const debtsBadge = stats.overdueDebts.length > 0 ? stats.overdueDebts.length : undefined;
  const budgetsBadge = overBudget.length > 0 ? overBudget.length : undefined;

  const go = (tab: Tab) => { setActiveTab(tab); setMobileNavOpen(false); };

  if (!token) {
    return AUTH_DISABLED && !localSessionFailed
      ? <div className="h-screen w-full flex items-center justify-center bg-background text-textMuted">Entrando…</div>
      : <AuthForm onLogin={handleLogin} />;
  }
  if (loading) return <div role="status" className="h-screen w-full flex items-center justify-center bg-background text-textMuted">Carregando seus dados…</div>;
  if (loadError) return (
    <div className="h-screen w-full flex items-center justify-center p-6 bg-background">
      <div role="alert" className="panel rounded-2xl p-8 max-w-md">
        <WifiOff size={20} className="mb-4 text-textMuted" aria-hidden="true"/>
        <h1 className="text-lg font-medium text-white mb-2">Sem conexão com o servidor</h1>
        <p className="text-sm text-textMuted mb-6">{loadError}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={retryLoad}
            className="h-9 px-4 rounded-md text-sm font-medium bg-primary text-on-accent hover:opacity-90 transition-opacity">
            Tentar de novo
          </button>
          <button type="button" onClick={handleLogout}
            className="h-9 px-4 rounded-md text-sm text-white bg-white/[0.06] hover:bg-white/10 transition-colors">
            Sair
          </button>
        </div>
      </div>
    </div>
  );

  // ---------- Render ----------
  return (
    <div className="flex min-h-screen bg-background">
      {/* FIN-081: primeiro item focável da página — leva direto ao conteúdo, pulando o menu. */}
      <a href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:px-4 focus:py-2 focus:rounded-md focus:bg-primary focus:text-on-accent focus:text-sm focus:font-medium">
        Pular para o conteúdo
      </a>

      {/* ── Barra lateral (FIN-028/FIN-081: gaveta que desliza em mobile, estática em md+) ── */}
      <div aria-hidden="true" onClick={() => setMobileNavOpen(false)}
        className={`fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity duration-200 motion-reduce:transition-none
          ${mobileNavOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} />
      <aside id="app-sidebar" ref={drawerRef} inert={drawer.hidden}
        {...(drawer.modal ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Menu de navegação' } : {})}
        {...drawer.swipeHandlers}
        className={`w-60 shrink-0 bg-background border-r border-white/[0.07] flex flex-col z-50 overflow-y-auto
          fixed inset-y-0 left-0 transition-transform duration-200 ease-out motion-reduce:transition-none
          ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}
          md:sticky md:top-0 md:h-screen md:z-10 md:translate-x-0 md:transition-none`}>
        <div className="h-14 px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <FinFlowMark />
            <div className="min-w-0 leading-tight">
              <p className="text-sm font-medium text-white">FinFlow</p>
              {user?.name && <p className="text-xs text-textMuted truncate">{user.name}</p>}
            </div>
          </div>
          <button ref={drawerCloseRef} type="button" onClick={() => setMobileNavOpen(false)} aria-label="Fechar menu"
            className="md:hidden p-1.5 rounded-md text-textMuted hover:text-white hover:bg-white/[0.06] transition-colors">
            <X size={16}/>
          </button>
        </div>

        <nav aria-label="Principal" className="mt-2 px-2 space-y-0.5">
          <NavItem icon={<LayoutDashboard size={16} strokeWidth={1.75}/>} label="Visão geral" active={activeTab==='dashboard'} onClick={() => go('dashboard')} />
          <NavItem icon={<Wallet size={16} strokeWidth={1.75}/>} label="Contas" active={activeTab==='accounts'} onClick={() => go('accounts')} />
          {accounts.length > 0 && (
            <>
              <NavItem icon={null} label="Transações" active={activeTab==='transactions'} onClick={() => go('transactions')} isSubItem />
              <NavItem icon={null} label="Dívidas" active={activeTab==='debts'} onClick={() => go('debts')} isSubItem badge={debtsBadge} />
            </>
          )}
          {/* FIN-045 */}
          <NavItem icon={<PiggyBank size={16} strokeWidth={1.75}/>} label="Orçamento" active={activeTab==='budgets'} onClick={() => go('budgets')} badge={budgetsBadge} />
          {/* FIN-051 */}
          <NavItem icon={<Target size={16} strokeWidth={1.75}/>} label="Metas" active={activeTab==='goals'} onClick={() => go('goals')} />
          {/* FIN-072 */}
          <NavItem icon={<TrendingUp size={16} strokeWidth={1.75}/>} label="Investimentos" active={activeTab==='investments'} onClick={() => go('investments')} />
          {/* FIN-056 */}
          <NavItem icon={<Repeat size={16} strokeWidth={1.75}/>} label="Recorrências" active={activeTab==='recurring'} onClick={() => go('recurring')} />
          {/* FIN-062/FIN-063/FIN-064 */}
          <NavItem icon={<BarChart3 size={16} strokeWidth={1.75}/>} label="Relatórios" active={activeTab==='reports'} onClick={() => go('reports')} />
        </nav>

        <div className="mt-auto p-3 space-y-3">
          {token && (
            <Suspense fallback={<PluggyButtonLoadingFallback />}>
              <PluggyConnectButton token={token} onSyncComplete={handlePluggySyncComplete} />
            </Suspense>
          )}
          <div className="space-y-0.5">
            <NavItem icon={<Upload size={16} strokeWidth={1.75}/>} label="Importar extrato" active={false} onClick={() => { setShowImport(true); setMobileNavOpen(false); }} />
            {/* FIN-078/FIN-079/FIN-080/FIN-083 */}
            <NavItem icon={<Settings size={16} strokeWidth={1.75}/>} label="Configurações" active={activeTab==='settings'} onClick={() => go('settings')} />
          </div>
          <div className="flex items-center justify-between gap-2 px-2.5 pt-3 border-t border-white/[0.07]">
            <p className="text-xs text-textMuted truncate">{user?.email}</p>
            <button type="button" onClick={handleLogout} aria-label="Sair da conta" title="Sair da conta"
              className="p-1.5 rounded-md text-textMuted hover:text-white hover:bg-white/[0.06] transition-colors">
              <LogOut size={14}/>
            </button>
          </div>
        </div>
      </aside>
      {/* ── Conteúdo ── */}
      <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 focus:outline-none">
        <header className="h-14 px-4 md:px-8 flex justify-between items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {/* FIN-028: botão de menu, único ponto de entrada para a navegação em mobile */}
            <button ref={menuButtonRef} type="button" onClick={() => setMobileNavOpen(true)}
              aria-label="Abrir menu" aria-expanded={mobileNavOpen} aria-controls="app-sidebar"
              className="md:hidden p-2 -ml-2 rounded-md hover:bg-white/[0.06] transition-colors text-white shrink-0">
              <Menu size={20}/>
            </button>
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" size={14} aria-hidden="true" />
              {/* FIN-040: só troca para a aba Transações na transição vazio→preenchido
                  (1ª tecla), não a cada tecla — evita arrancar o usuário de outra aba a
                  cada caractere digitado. */}
              <input type="search" aria-label="Buscar transações" placeholder="Buscar transações" value={search}
                onChange={e => {
                  const v = e.target.value;
                  if (v && !search) setActiveTab('transactions');
                  setSearch(v);
                }}
                className="input-field !pl-8" />
            </div>
          </div>
          <div className="flex items-center gap-1 relative">
            {/* FIN-083: atalho entre claro e escuro — a escolha completa, com "igual ao sistema", fica em Configurações. */}
            <button type="button" onClick={() => theme.setPreference(theme.resolved === 'dark' ? 'light' : 'dark')}
              aria-label={theme.resolved === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
              title={theme.resolved === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
              className="p-2 rounded-md hover:bg-white/[0.06] transition-colors text-textMuted hover:text-white">
              {theme.resolved === 'dark' ? <Sun size={16} aria-hidden="true"/> : <Moon size={16} aria-hidden="true"/>}
            </button>
            {/* FIN-066: central de notificações persistidas no servidor (substitui FIN-039). */}
            <NotificationBell notifications={notifications} unreadCount={unreadCount}
              onSelect={openNotification} onMarkAllRead={markAllNotificationsRead}/>
          </div>
        </header>

        <div className="px-4 md:px-8 pt-2 pb-16 max-w-[1240px]">

          {activeTab === 'dashboard' && (
            <DashboardPage
              accounts={accounts}
              dashboardAccountId={dashboardAccountId}
              onChangeDashboardAccount={setDashboardAccountId}
              stats={stats}
              overBudget={overBudget}
              budgetProgress={budgetProgress}
              usedCurrencies={usedCurrencies}
              rates={rates}
              ratesFailed={ratesFailed}
              conversionIssue={conversionIssue}
              missingCurrencies={missingCurrencies}
              hasInvestments={hasInvestments}
              investmentHoldings={investmentHoldings}
              isEmpty={isEmpty}
              hasAccounts={hasAccounts}
              chartPeriod={chartPeriod}
              onChangeChartPeriod={setChartPeriod}
              projection={projection}
              onNavigate={setActiveTab}
              onFilterTransactions={setTxFilter}
              onShowImport={() => setShowImport(true)}
              salary={salary}
              onSaveSalary={saveSalary}
            />
          )}

          {activeTab === 'transactions' && (
            <TransactionsPage
              filtered={filtered}
              txMonth={txMonth}
              onChangeTxMonth={setTxMonth}
              txMonths={txMonths}
              monthTotals={monthTotals}
              hiddenInstallments={hiddenInstallments}
              onGoToDebts={() => setActiveTab('debts')}
              txFilter={txFilter}
              onChangeTxFilter={setTxFilter}
              accounts={accounts}
              accountId={listAccount}
              onChangeAccount={setListAccountId}
              onUpdateTransaction={updateTransaction}
              onDeleteTransaction={deleteTransaction}
              onCreateRule={createCategoryRule}
              txHasMore={txHasMore}
              txLoadingMore={txLoadingMore}
              onLoadMore={loadMoreTransactions}
              onExportCSV={exportTransactionsCSV}
              onExportPDF={exportTransactionsPDF}
              exportingPDF={exportingPDF}
              onShowImport={() => setShowImport(true)}
            />
          )}

          {activeTab === 'accounts' && (
            <AccountsPage
              accounts={accounts}
              onAdd={addAccount}
              onUpdate={updateAccount}
              onDelete={deleteAccount}
              rates={rates}
            />
          )}

          {activeTab === 'debts' && (
            <DebtsPage
              transactionsBase={transactionsBase.items}
              debts={debts}
              accounts={accounts}
              accountId={listAccount}
              onChangeAccount={setListAccountId}
              onAdd={addDebt}
              onUpdate={updateDebt}
              onDelete={deleteDebt}
            />
          )}

          {activeTab === 'budgets' && (
            <BudgetsPage
              budgetProgress={budgetProgress}
              onAdd={addBudget}
              onUpdate={updateBudget}
              onDelete={deleteBudget}
              existingCategories={budgets.map(b => b.category)}
              transactionCategories={transactionCategories}
            />
          )}

          {activeTab === 'goals' && (
            <GoalsPage
              goals={goals}
              accounts={accountsBase.items}
              investments={investmentsBase.items}
              onAdd={addGoal}
              onUpdate={updateGoal}
              onDelete={deleteGoal}
            />
          )}

          {activeTab === 'investments' && (
            <Suspense fallback={<PageLoadingFallback />}>
              <InvestmentsPage
                investments={investments}
                accounts={accounts}
                onAdd={addInvestment}
                onUpdate={updateInvestment}
                onDelete={deleteInvestment}
                rates={rates}
              />
            </Suspense>
          )}

          {activeTab === 'recurring' && (
            <RecurringPage
              recurring={recurring}
              accounts={accounts}
              onAdd={addRecurring}
              onUpdate={updateRecurring}
              onDelete={deleteRecurring}
              transactionCategories={transactionCategories}
              transactions={transactions}
            />
          )}

          {activeTab === 'reports' && (
            <Suspense fallback={<PageLoadingFallback />}>
              <ReportsPage
                transactions={transactionsBase.items}
                accounts={accountsBase.items}
                debts={debts}
                investments={investmentsBase.items}
                netWorthHistory={netWorthHistory}
              />
            </Suspense>
          )}

          {activeTab === 'settings' && (
            <Suspense fallback={<PageLoadingFallback />}>
              <SettingsPage
                settingsNotice={settingsNotice}
                onDismissNotice={() => setSettingsNotice('')}
                theme={theme}
                token={token}
                onRestored={handleRestored}
                hasTransactions={transactions.length > 0}
                onClearTransactions={handleClearTransactions}
              />
            </Suspense>
          )}
        </div>
      </main>

      {showImport && <ImportModal accounts={accounts} onClose={() => setShowImport(false)} onImport={(txs, pt) => handleImport(txs, pt)} />}
    </div>
  );
}
