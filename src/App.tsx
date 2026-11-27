import {
  useEffect,
  useState,
  useSyncExternalStore,
  type FormEvent
} from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";
import {
  type EntityPage,
  type FinanceRecord,
  FinanceApiError,
  financeApiUrl,
  getEntityPage,
  getMe,
  getWorkspaces,
  login,
  logout,
  type Workspace
} from "./api/client";
import Dashboard from "./Dashboard";
import RecordList, { type RecordListColumn } from "./RecordList";
import {
  getQueryCacheError,
  indexedDbPersister,
  subscribeToQueryCacheError
} from "./api/queryPersister";

const SESSION_TOKEN_KEY = "finance-api-session";
const SESSION_USER_ID_KEY = "finance-api-user-id";
const TRANSACTION_PAGE_SIZE = 50;
const WORKSPACE_NAVIGATION: Array<{
  id: WorkspaceView;
  label: string;
  icon: string;
}> = [
  { id: "dashboard", label: "Dashboard", icon: "▦" },
  { id: "items", label: "Itens", icon: "↗" },
  { id: "income", label: "Rendas", icon: "↙" },
  { id: "expenses", label: "Despesas", icon: "↗" },
  { id: "debts", label: "Dívidas", icon: "◷" },
  { id: "subscriptions", label: "Assinaturas", icon: "◌" },
  { id: "installments", label: "Parcelamentos", icon: "▤" }
];

function readStoredSessionToken(): string | null {
  const persistentToken = window.localStorage.getItem(SESSION_TOKEN_KEY);
  const sessionToken = window.sessionStorage.getItem(SESSION_TOKEN_KEY);
  if (persistentToken) {
    window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
    return persistentToken;
  }
  if (sessionToken) {
    window.localStorage.setItem(SESSION_TOKEN_KEY, sessionToken);
    window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
    return sessionToken;
  }
  return null;
}

function storeSessionToken(token: string): void {
  window.localStorage.setItem(SESSION_TOKEN_KEY, token);
  window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
}

function readStoredUserId(): string | null {
  return window.localStorage.getItem(SESSION_USER_ID_KEY);
}

function storeSessionIdentity(token: string, userId: string): void {
  storeSessionToken(token);
  window.localStorage.setItem(SESSION_USER_ID_KEY, userId);
}

function clearStoredSessionToken(): void {
  window.localStorage.removeItem(SESSION_TOKEN_KEY);
  window.localStorage.removeItem(SESSION_USER_ID_KEY);
  window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
}

interface Transaction extends FinanceRecord {
  ACCOUNT_ID?: string;
  AMOUNT?: number | string;
  CARD_ID?: string;
  CATEGORY_ID?: string;
  CURRENCY?: string;
  DESCRIPTION?: string;
  DIRECTION?: string;
  OCCURRED_AT?: string;
  TRANSACTION_TYPE?: string;
}

interface TransactionPage extends EntityPage<Transaction> {
  nextOffset: number | null;
}

type WorkspaceView =
  | "dashboard"
  | "items"
  | "income"
  | "expenses"
  | "debts"
  | "subscriptions"
  | "installments";

type EntityPageWithOffset<T extends FinanceRecord> = EntityPage<T> & {
  nextOffset: number | null;
};

function readText(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function formatTransactionDate(value: unknown): string {
  const dateValue = readText(value);
  if (!dateValue) return "Data não informada";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateValue);
  const date = match
    ? new Date(Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3])
    ))
    : new Date(dateValue);
  if (!Number.isFinite(date.getTime())) return "Data inválida";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function formatTransactionAmount(
  amountValue: unknown,
  currencyValue: unknown
): string {
  if (
    amountValue === null ||
    amountValue === undefined ||
    readText(amountValue) === ""
  ) {
    return "—";
  }
  const amount = Number(amountValue);
  if (!Number.isFinite(amount)) return "—";
  const currency = readText(currencyValue).toUpperCase();
  const supportedCurrency = /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: supportedCurrency
    }).format(amount);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return `${new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount)} ${supportedCurrency}`;
  }
}

function formatRecordAmount(amountValue: unknown, currency: string): string {
  if (amountValue === null || amountValue === undefined || readText(amountValue) === "") {
    return "—";
  }
  if (!currency) return "Moeda não informada";
  return formatTransactionAmount(amountValue, currency);
}

function formatEnumLabel(value: unknown): string {
  const label = readText(value).toLocaleLowerCase("pt-BR").replace(/_/g, " ");
  return label ? label.charAt(0).toLocaleUpperCase("pt-BR") + label.slice(1) : "";
}

function isAccessDenial(error: unknown): boolean {
  return error instanceof FinanceApiError &&
    [
      "UNAUTHORIZED",
      "FORBIDDEN",
      "WORKSPACE_FORBIDDEN",
      "USER_NOT_FOUND"
    ].includes(error.code);
}

async function fetchEntityPage<T extends FinanceRecord>(
  resource: string,
  token: string,
  workspaceId: string,
  offset: number | null
): Promise<EntityPageWithOffset<T>> {
  if (offset === null) {
    const probe = await getEntityPage<T>(
      resource, token, workspaceId, 1, 0
    );
    if (probe.total === 0) {
      return { items: [], total: 0, nextOffset: null };
    }
    offset = Math.max(0, probe.total - TRANSACTION_PAGE_SIZE);
  }

  const page = await getEntityPage<T>(
    resource,
    token,
    workspaceId,
    TRANSACTION_PAGE_SIZE,
    offset
  );
  return {
    ...page,
    nextOffset: offset > 0
      ? Math.max(0, offset - TRANSACTION_PAGE_SIZE)
      : null
  };
}

function fetchTransactionPage(
  token: string,
  workspaceId: string,
  offset: number | null
): Promise<TransactionPage> {
  return fetchEntityPage<Transaction>(
    "transactions", token, workspaceId, offset
  );
}
interface TransactionsWorkspaceProps {
  token: string;
  userId: string;
  email: string;
  workspaces: Workspace[];
  isOnline: boolean;
  usingCachedSession: boolean;
  cacheError: string | null;
  onLogout: () => void;
  isLoggingOut: boolean;
}

function TransactionsWorkspace({
  token,
  userId,
  email,
  workspaces,
  isOnline,
  usingCachedSession,
  cacheError,
  onLogout,
  isLoggingOut
}: TransactionsWorkspaceProps) {
  const [activeView, setActiveView] = useState<WorkspaceView>("dashboard");
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [directionFilter, setDirectionFilter] = useState("ALL");
  const selectedWorkspace = workspaces.find(
    (workspace) => workspace.id === workspaceId
  ) ?? workspaces[0];
  const isTransactionView = ["items", "income", "expenses"].includes(activeView);
  const recordResource = activeView === "debts"
    ? "debts"
    : activeView === "subscriptions"
      ? "recurrences"
      : activeView === "installments"
        ? "installment_plans"
        : "";
  const isRecordView = Boolean(recordResource);
  const needsAccountLookup = isTransactionView || isRecordView;
  const needsCategoryLookup = isTransactionView ||
    activeView === "subscriptions" ||
    activeView === "installments";
  const needsCardLookup = isTransactionView || activeView === "installments";
  const transactionsQuery = useInfiniteQuery({
    queryKey: ["finance-data", "transactions", userId, selectedWorkspace?.id],
    queryFn: ({ pageParam }) => {
      if (!selectedWorkspace) {
        throw new Error("Nenhum workspace selecionado.");
      }
      return fetchTransactionPage(token, selectedWorkspace.id, pageParam);
    },
    initialPageParam: null as number | null,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    enabled: isTransactionView && Boolean(selectedWorkspace),
    retry: false,
    staleTime: 30_000
  });
  const recordsQuery = useInfiniteQuery({
    queryKey: [
      "finance-data",
      "entity-list",
      recordResource,
      userId,
      selectedWorkspace?.id
    ],
    queryFn: ({ pageParam }) => {
      if (!selectedWorkspace || !recordResource) {
        throw new Error("Nenhuma lista selecionada.");
      }
      return fetchEntityPage<FinanceRecord>(
        recordResource,
        token,
        selectedWorkspace.id,
        pageParam
      );
    },
    initialPageParam: null as number | null,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    enabled: isRecordView && Boolean(selectedWorkspace),
    retry: false,
    staleTime: 60_000
  });
  const accountsQuery = useQuery({
    queryKey: ["finance-data", "accounts", userId, selectedWorkspace?.id],
    queryFn: () => {
      if (!selectedWorkspace) throw new Error("Nenhum workspace selecionado.");
      return getEntityPage<FinanceRecord>(
        "accounts", token, selectedWorkspace.id, 200, 0
      );
    },
    enabled: needsAccountLookup && Boolean(selectedWorkspace),
    retry: false,
    staleTime: 60_000
  });
  const categoriesQuery = useQuery({
    queryKey: ["finance-data", "categories", userId, selectedWorkspace?.id],
    queryFn: () => {
      if (!selectedWorkspace) throw new Error("Nenhum workspace selecionado.");
      return getEntityPage<FinanceRecord>(
        "categories", token, selectedWorkspace.id, 200, 0
      );
    },
    enabled: needsCategoryLookup && Boolean(selectedWorkspace),
    retry: false,
    staleTime: 60_000
  });
  const cardsQuery = useQuery({
    queryKey: ["finance-data", "cards", userId, selectedWorkspace?.id],
    queryFn: () => {
      if (!selectedWorkspace) throw new Error("Nenhum workspace selecionado.");
      return getEntityPage<FinanceRecord>(
        "cards", token, selectedWorkspace.id, 200, 0
      );
    },
    enabled: needsCardLookup && Boolean(selectedWorkspace),
    retry: false,
    staleTime: 60_000
  });

  const accountsById = new Map(
    (accountsQuery.data?.items ?? []).map((account) => [
      account.ID,
      readText(account.NAME) || "Conta"
    ])
  );
  const categoriesById = new Map(
    (categoriesQuery.data?.items ?? []).map((category) => [
      category.ID,
      readText(category.DISPLAY_NAME) ||
        readText(category.NAME) ||
        "Categoria"
    ])
  );
  const cardsById = new Map(
    (cardsQuery.data?.items ?? []).map((card) => [
      card.ID,
      readText(card.ISSUER_NAME) || "Cartão"
    ])
  );
  const transactions = transactionsQuery.data?.pages.flatMap((page) =>
    page.items.slice().reverse()
  ) ?? [];
  const loadedRecords = recordsQuery.data?.pages.flatMap((page) =>
    page.items.slice().reverse()
  ) ?? [];
  const records = activeView === "subscriptions"
    ? loadedRecords.filter((record) =>
      /SUBSCRIPTION|ASSINATURA/.test(readText(record.RULE_TYPE).toUpperCase())
    )
    : loadedRecords;
  const recordsTotal = recordsQuery.data?.pages[0]?.total ?? 0;
  const transactionTotal = transactionsQuery.data?.pages[0]?.total ?? 0;
  const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
  const filteredTransactions = transactions.filter((transaction) => {
    const description = readText(transaction.DESCRIPTION);
    const category = categoriesById.get(readText(transaction.CATEGORY_ID)) ?? "";
    const account = accountsById.get(readText(transaction.ACCOUNT_ID)) ?? "";
    const card = cardsById.get(readText(transaction.CARD_ID)) ?? "";
    const matchesSearch = !normalizedSearch ||
      [description, category, account, card].some((value) =>
        value.toLocaleLowerCase("pt-BR").includes(normalizedSearch)
      );
    const direction = readText(transaction.DIRECTION).toUpperCase();
    const viewDirection = activeView === "income"
      ? "INCOME"
      : activeView === "expenses"
        ? "EXPENSE"
        : directionFilter;
    const matchesDirection = viewDirection === "ALL" ||
      direction === viewDirection;
    return matchesSearch && matchesDirection;
  });
  const total = transactionTotal;
  const lookupError = (needsAccountLookup ? accountsQuery.error : undefined) ??
    (needsCategoryLookup ? categoriesQuery.error : undefined) ??
    (needsCardLookup ? cardsQuery.error : undefined);
  const initials = email.slice(0, 1).toLocaleUpperCase("pt-BR") || "U";
  const transactionViewHeading = activeView === "income"
    ? {
      eyebrow: "ENTRADAS",
      title: "Rendas",
      subtitle: "Consulte os lançamentos classificados como receita."
    }
    : activeView === "expenses"
      ? {
        eyebrow: "SAÍDAS",
        title: "Despesas",
        subtitle: "Consulte os lançamentos classificados como despesa."
      }
      : {
        eyebrow: "MOVIMENTAÇÕES",
        title: "Itens",
        subtitle: "Consulte todos os lançamentos do seu workspace."
      };
  const accountCurrencyById = new Map(
    (accountsQuery.data?.items ?? []).map((account) => [
      readText(account.ID),
      readText(account.CURRENCY).toUpperCase()
    ])
  );
  const cardAccountById = new Map(
    (cardsQuery.data?.items ?? []).map((card) => [
      readText(card.ID),
      readText(card.ACCOUNT_ID)
    ])
  );
  function getRecordCurrency(record: FinanceRecord): string {
    const accountId = readText(record.ACCOUNT_ID) ||
      cardAccountById.get(readText(record.CARD_ID)) ||
      "";
    return accountCurrencyById.get(accountId) || "";
  }
  const recordColumns: RecordListColumn<FinanceRecord>[] =
    activeView === "debts"
      ? [
        {
          key: "description",
          label: "Descrição",
          render: (record) => readText(record.DESCRIPTION) || "Dívida"
        },
        {
          key: "account",
          label: "Conta",
          render: (record) =>
            accountsById.get(readText(record.ACCOUNT_ID)) || "—"
        },
        {
          key: "installment",
          label: "Parcela",
          render: (record) => {
            const currency = accountCurrencyById.get(
              readText(record.ACCOUNT_ID)
            ) || "";
            const amount = formatRecordAmount(
              record.INSTALLMENT_AMOUNT,
              currency
            );
            const count = readText(record.INSTALLMENT_COUNT);
            return count ? `${amount} · ${count}x` : amount;
          }
        },
        {
          key: "period",
          label: "Período",
          render: (record) => {
            const start = readText(record.START_DATE);
            const end = readText(record.END_DATE);
            if (!start && !end) return "—";
            return `${start ? formatTransactionDate(start) : "Início aberto"} – ${
              end ? formatTransactionDate(end) : "Sem fim"
            }`;
          }
        },
        {
          key: "due-day",
          label: "Vencimento",
          render: (record) => {
            const dueDay = readText(record.DUE_DAY);
            return dueDay ? `Dia ${dueDay}` : "—";
          }
        },
        {
          key: "status",
          label: "Situação",
          render: (record) => formatEnumLabel(record.STATUS) || "—"
        }
      ]
      : activeView === "subscriptions"
        ? [
          {
            key: "description",
            label: "Assinatura",
            render: (record) => readText(record.DESCRIPTION) || "Assinatura"
          },
          {
            key: "amount",
            label: "Valor",
            render: (record) => formatRecordAmount(
              record.AMOUNT,
              readText(record.CURRENCY).toUpperCase()
            )
          },
          {
            key: "account",
            label: "Conta",
            render: (record) =>
              accountsById.get(readText(record.ACCOUNT_ID)) || "—"
          },
          {
            key: "category",
            label: "Categoria",
            render: (record) =>
              categoriesById.get(readText(record.CATEGORY_ID)) || "—"
          },
          {
            key: "cycle",
            label: "Recorrência",
            render: (record) => {
              const dueDay = readText(record.DUE_DAY);
              return dueDay ? `Mensal · dia ${dueDay}` : "Mensal";
            }
          },
          {
            key: "start-date",
            label: "Início",
            render: (record) => record.START_DATE
              ? formatTransactionDate(record.START_DATE)
              : "—"
          },
          {
            key: "status",
            label: "Situação",
            render: (record) => formatEnumLabel(record.STATUS) || "—"
          }
        ]
        : [
          {
            key: "description",
            label: "Parcelamento",
            render: (record) => readText(record.DESCRIPTION) || "Parcelamento"
          },
          {
            key: "account",
            label: "Conta / cartão",
            render: (record) => {
              const card = cardsById.get(readText(record.CARD_ID));
              const account = accountsById.get(readText(record.ACCOUNT_ID));
              return card || account || "—";
            }
          },
          {
            key: "category",
            label: "Categoria",
            render: (record) =>
              categoriesById.get(readText(record.CATEGORY_ID)) || "—"
          },
          {
            key: "total",
            label: "Valor total",
            render: (record) => formatRecordAmount(
              record.TOTAL_AMOUNT,
              getRecordCurrency(record)
            )
          },
          {
            key: "installment",
            label: "Parcelas",
            render: (record) => {
              const count = readText(record.INSTALLMENT_COUNT);
              const amount = formatRecordAmount(
                record.INSTALLMENT_AMOUNT,
                getRecordCurrency(record)
              );
              return count ? `${count}x · ${amount}` : amount;
            }
          },
          {
            key: "purchase-date",
            label: "Compra",
            render: (record) => record.PURCHASE_DATE
              ? formatTransactionDate(record.PURCHASE_DATE)
              : readText(record.FIRST_INVOICE_MONTH) || "—"
          },
          {
            key: "status",
            label: "Situação",
            render: (record) => formatEnumLabel(record.STATUS) || "—"
          }
        ];

  return (
    <main className="finance-app">
      <header className="finance-topbar">
        <a className="brand finance-brand" href="/FinancesPWA/" aria-label="SheetFinances">
          <img src="/FinancesPWA/favicon.svg" alt="" width="38" height="38" />
          <span>SheetFinances</span>
        </a>
        <div className="finance-topbar-actions">
          {workspaces.length > 1 ? (
            <label className="workspace-picker">
              <span>Workspace</span>
              <select
                value={selectedWorkspace?.id ?? ""}
                onChange={(event) => setWorkspaceId(event.target.value)}
              >
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name || "Workspace"}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="workspace-name">
              {selectedWorkspace?.name || "Meu workspace"}
            </span>
          )}
          <div className="user-chip" title={email}>
            <span className="user-avatar">{initials}</span>
            <span className="user-email">{email}</span>
          </div>
          <button
            className="logout-link"
            type="button"
            onClick={onLogout}
            disabled={isLoggingOut}
          >
            {isLoggingOut ? "Saindo..." : "Sair"}
          </button>
        </div>
      </header>

      {!isOnline && (
        <p className="cache-status-banner" role="status">
          Você está offline. Os dados salvos neste dispositivo podem ser
          consultados por até 24 horas; dados ainda não carregados precisam de
          conexão.
        </p>
      )}
      {usingCachedSession && isOnline && (
        <p className="cache-status-banner" role="status">
          Não foi possível validar a sessão agora. Exibindo informações salvas
          localmente; elas podem estar desatualizadas.
        </p>
      )}
      {cacheError && (
        <p className="cache-status-banner cache-status-error" role="status">
          {cacheError}. Verifique o espaço disponível no navegador e evite
          limpar os dados do site enquanto estiver offline.
        </p>
      )}

      <div className="finance-body">
        <aside className="finance-sidebar">
          <p className="sidebar-caption">MENU PRINCIPAL</p>
          <nav aria-label="Navegação principal">
            {WORKSPACE_NAVIGATION.map((item) => (
              <a
                key={item.id}
                className={`sidebar-link ${activeView === item.id ? "active" : ""}`}
                href={`#${item.id}`}
                aria-current={activeView === item.id ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  setActiveView(item.id);
                }}
              >
                <span className="sidebar-icon" aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
              </a>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <span className="sidebar-secure-mark" aria-hidden="true">✓</span>
            <span>Seus dados são privados</span>
          </div>
        </aside>

        {activeView === "dashboard" && selectedWorkspace ? (
          <Dashboard
            token={token}
            userId={userId}
            workspaceId={selectedWorkspace.id}
            workspaceName={selectedWorkspace.name || "Meu workspace"}
          />
        ) : isTransactionView ? (
        <section className="transactions-content" id="transactions">
          <div className="transactions-heading">
            <div>
              <p className="eyebrow">{transactionViewHeading.eyebrow}</p>
              <h1>{transactionViewHeading.title}</h1>
              <p className="transactions-subtitle">{transactionViewHeading.subtitle}</p>
            </div>
            <button
              className="refresh-button"
              type="button"
              onClick={() => void transactionsQuery.refetch()}
              disabled={transactionsQuery.isFetching}
            >
              <span className={transactionsQuery.isFetching ? "refresh-icon spinning" : "refresh-icon"} aria-hidden="true">↻</span>
              Atualizar
            </button>
          </div>

          <div className="transactions-toolbar">
            <label className="transaction-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                placeholder="Buscar descrição ou categoria"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Buscar transações carregadas"
              />
            </label>
            {activeView === "items" && (
              <label className="direction-select">
                <span className="visually-hidden">Filtrar por tipo</span>
                <select
                  value={directionFilter}
                  onChange={(event) => setDirectionFilter(event.target.value)}
                >
                  <option value="ALL">Todos os tipos</option>
                  <option value="INCOME">Rendas</option>
                  <option value="EXPENSE">Despesas</option>
                </select>
              </label>
            )}
          </div>

          {lookupError instanceof Error && (
            <p className="lookup-warning" role="alert">
              Não foi possível atualizar os nomes de contas, categorias ou
              cartões. Os nomes salvos podem estar desatualizados:{" "}
              {lookupError.message}
            </p>
          )}

          <div className="transactions-list-card">
            <div className="list-card-heading">
              <div>
                <h2>{transactionViewHeading.title}</h2>
                <p>
                  {transactionsQuery.data
                    ? `${transactions.length} de ${total} carregadas`
                    : "Carregando lançamentos"}
                </p>
              </div>
              <span className="list-count-badge">
                {filteredTransactions.length} exibidas
              </span>
            </div>

            {transactionsQuery.isError && transactionsQuery.data && (
              <p className="cache-data-warning" role="status">
                Não foi possível atualizar os lançamentos. Exibindo os últimos
                dados salvos neste dispositivo.
              </p>
            )}

            {transactionsQuery.isPending ? (
              <div className="transactions-state">
                <span className="loading-spinner" aria-hidden="true" />
                <p>Carregando suas transações...</p>
              </div>
            ) : transactionsQuery.isError && !transactionsQuery.data ? (
              <div className="transactions-state error-state" role="alert">
                <span className="state-icon error" aria-hidden="true">!</span>
                <h3>Não foi possível carregar as transações</h3>
                <p>
                  {transactionsQuery.error instanceof Error
                    ? transactionsQuery.error.message
                    : "Verifique sua conexão e tente novamente."}
                </p>
                <button
                  className="primary-button retry-button"
                  type="button"
                  onClick={() => void transactionsQuery.refetch()}
                >
                  Tentar novamente
                </button>
              </div>
            ) : total === 0 ? (
              <div className="transactions-state empty-state">
                <span className="empty-icon" aria-hidden="true">↗</span>
                <h3>Nenhum lançamento por aqui ainda</h3>
                <p>Quando houver lançamentos neste workspace, eles aparecerão nesta lista.</p>
              </div>
            ) : filteredTransactions.length === 0 ? (
              <div className="transactions-state empty-state">
                <h3>Nenhum resultado encontrado</h3>
                <p>Altere a busca ou o filtro para ver outras transações.</p>
              </div>
            ) : (
              <div className="transaction-table-wrap">
                <table className="transaction-table">
                  <thead>
                    <tr>
                      <th scope="col">Data</th>
                      <th scope="col">Descrição</th>
                      <th scope="col">Conta / cartão</th>
                      <th scope="col">Tipo</th>
                      <th scope="col" className="amount-heading">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTransactions.map((transaction) => {
                      const direction = readText(transaction.DIRECTION).toUpperCase();
                      const category = categoriesById.get(
                        readText(transaction.CATEGORY_ID)
                      );
                      const account = accountsById.get(
                        readText(transaction.ACCOUNT_ID)
                      );
                      const card = cardsById.get(readText(transaction.CARD_ID));
                      const description = readText(transaction.DESCRIPTION) ||
                        "Lançamento sem descrição";
                      return (
                        <tr key={transaction.ID}>
                          <td className="transaction-date">
                            {formatTransactionDate(transaction.OCCURRED_AT)}
                          </td>
                          <td>
                            <span className="transaction-description">{description}</span>
                            <span className="transaction-category">
                              {category || formatEnumLabel(transaction.TRANSACTION_TYPE) || "Sem categoria"}
                            </span>
                          </td>
                          <td className="transaction-account">
                            {card || account || "—"}
                          </td>
                          <td>
                            <span className={`direction-badge ${direction.toLowerCase()}`}>
                              {direction === "INCOME"
                                ? "Receita"
                                : direction === "EXPENSE"
                                  ? "Despesa"
                                  : formatEnumLabel(direction) || "Indefinido"}
                            </span>
                          </td>
                          <td className={`transaction-amount ${direction.toLowerCase()}`}>
                            {formatTransactionAmount(
                              transaction.AMOUNT,
                              transaction.CURRENCY
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {transactionsQuery.hasNextPage && (
              <div className="load-more-row">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void transactionsQuery.fetchNextPage()}
                  disabled={transactionsQuery.isFetchingNextPage}
                >
                  {transactionsQuery.isFetchingNextPage
                    ? "Carregando..."
                    : "Carregar transações anteriores"}
                </button>
              </div>
            )}
          </div>
          <p className="list-footnote">
            A busca e os filtros consideram os lançamentos já carregados.
          </p>
        </section>
        ) : isRecordView ? (
          <RecordList
            eyebrow={activeView === "debts"
              ? "COMPROMISSOS"
              : activeView === "subscriptions"
                ? "RECORRÊNCIAS"
                : "COMPRAS PARCELADAS"}
            title={activeView === "debts"
              ? "Dívidas"
              : activeView === "subscriptions"
                ? "Assinaturas"
                : "Parcelamentos"}
            subtitle={activeView === "debts"
              ? "Acompanhe parcelas, prazos e situação das dívidas cadastradas."
              : activeView === "subscriptions"
                ? "Regras recorrentes identificadas como assinaturas."
                : "Consulte compras parceladas, valores e situação."}
            items={records}
            columns={recordColumns}
            total={recordsTotal}
            loadedCount={loadedRecords.length}
            isPending={recordsQuery.isPending}
            isFetching={recordsQuery.isFetching}
            error={recordsQuery.error}
            lookupError={lookupError}
            hasNextPage={recordsQuery.hasNextPage}
            isFetchingNextPage={recordsQuery.isFetchingNextPage}
            searchText={(record) =>
              Object.values(record).map(readText).join(" ")
            }
            emptyTitle={activeView === "debts"
              ? "Nenhuma dívida cadastrada"
              : activeView === "subscriptions"
                ? "Nenhuma assinatura encontrada"
                : "Nenhum parcelamento cadastrado"}
            emptyMessage={activeView === "debts"
              ? "As dívidas cadastradas neste workspace aparecerão aqui."
              : activeView === "subscriptions"
                ? "As regras em RECURRENCES com tipo SUBSCRIPTION ou ASSINATURA aparecerão aqui."
                : "Os parcelamentos cadastrados neste workspace aparecerão aqui."}
            onRefresh={() => void recordsQuery.refetch()}
            onLoadMore={() => void recordsQuery.fetchNextPage()}
          />
        ) : null}
      </div>
    </main>
  );
}

function App() {
  const [token, setToken] = useState<string | null>(() =>
    readStoredSessionToken()
  );
  const [userId, setUserId] = useState<string | null>(() =>
    readStoredUserId()
  );
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const queryClient = useQueryClient();
  const cacheError = useSyncExternalStore(
    subscribeToQueryCacheError,
    getQueryCacheError,
    () => null
  );

  async function clearApiCache() {
    queryClient.clear();
    await indexedDbPersister.removeClient();
  }

  const meQuery = useQuery({
    queryKey: ["finance-session", "me", userId || "unresolved"],
    queryFn: () => getMe(token!),
    enabled: Boolean(token && financeApiUrl),
    retry: false,
    staleTime: 30_000
  });
  const verifiedUserId = meQuery.data?.user.ID ?? userId ?? "";
  const activeMemberships = meQuery.data?.memberships.filter(
    (membership) => membership.status === "ACTIVE" && !membership.deletedAt
  ) ?? [];
  const workspacesQuery = useQuery({
    queryKey: ["finance-data", "workspaces", verifiedUserId],
    queryFn: () => getWorkspaces(token!),
    enabled: Boolean(token && meQuery.data && activeMemberships.length),
    retry: false,
    staleTime: 60_000
  });

  const loginMutation = useMutation({
    mutationFn: () => login(email.trim(), password),
    onSuccess: (session) => {
      storeSessionIdentity(session.token, session.userId);
      setToken(session.token);
      setUserId(session.userId);
      setPassword("");
      setAuthMessage("");
    }
  });

  const logoutMutation = useMutation({
    mutationFn: () => logout(token!),
    onSuccess: async () => {
      await clearApiCache();
      clearStoredSessionToken();
      setToken(null);
      setUserId(null);
      setAuthMessage("");
    },
    onError: async (error) => {
      await clearApiCache();
      clearStoredSessionToken();
      setToken(null);
      setUserId(null);
      setAuthMessage(
        `A sessão foi removida deste dispositivo, mas a API não confirmou a revogação. ${
          error instanceof Error ? error.message : ""
        }`.trim()
      );
    }
  });

  useEffect(() => {
    const verifiedId = meQuery.data?.user.ID;
    if (token && verifiedId && verifiedId !== userId) {
      if (userId && userId !== verifiedId) {
        void clearApiCache();
      }
      queryClient.setQueryData(
        ["finance-session", "me", verifiedId],
        meQuery.data
      );
      window.localStorage.setItem(SESSION_USER_ID_KEY, verifiedId);
      setUserId(verifiedId);
    }
  }, [meQuery.data, queryClient, token, userId]);

  useEffect(() => {
    if (
      token &&
      (
        isAccessDenial(meQuery.error) ||
        isAccessDenial(workspacesQuery.error)
      )
    ) {
      void clearApiCache();
      clearStoredSessionToken();
      setToken(null);
      setUserId(null);
      setAuthMessage("Sua sessão ou permissão foi revogada. Entre novamente.");
    }
  }, [meQuery.error, queryClient, token, workspacesQuery.error]);

  useEffect(() => {
    const updateOnlineState = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);

  function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthMessage("");
    loginMutation.mutate();
  }

  const accessDenied = isAccessDenial(meQuery.error) ||
    isAccessDenial(workspacesQuery.error);
  const availableWorkspaces = workspacesQuery.data ?? [];
  const usingCachedSession = Boolean(
    meQuery.data &&
    (meQuery.isError || workspacesQuery.isError) &&
    !accessDenied
  );
  if (
    token &&
    meQuery.data &&
    !accessDenied &&
    activeMemberships.length > 0 &&
    availableWorkspaces.length > 0
  ) {
    return (
      <TransactionsWorkspace
        token={token}
        userId={verifiedUserId}
        email={meQuery.data.user.EMAIL}
        workspaces={availableWorkspaces}
        isOnline={isOnline}
        usingCachedSession={usingCachedSession}
        cacheError={cacheError}
        onLogout={() => logoutMutation.mutate()}
        isLoggingOut={logoutMutation.isPending}
      />
    );
  }

  return (
    <main className="page-shell">
      <a className="brand" href="/FinancesPWA/" aria-label="SheetFinances">
        <img src="/FinancesPWA/favicon.svg" alt="" width="40" height="40" />
        <span>SheetFinances</span>
      </a>

      <section className="auth-layout" aria-label="Acesso ao SheetFinances">
        <aside className="visual-panel">
          <div className="visual-copy">
            <p className="eyebrow">FINANÇAS COM MAIS CLAREZA</p>
            <h1>Seu dinheiro, organizado do seu jeito.</h1>
            <p className="visual-description">
              Um espaço simples e seguro para acompanhar sua vida financeira.
            </p>
          </div>

          <div className="visual-art" aria-hidden="true">
            <div className="art-glow" />
            <div className="art-ring ring-back" />
            <div className="art-ring ring-front" />
            <div className="art-card">
              <div className="art-card-heading">
                <span>VISÃO FINANCEIRA</span>
                <span className="art-card-menu">•••</span>
              </div>
              <div className="art-card-rule" />
              <div className="art-chart">
                <span className="chart-bar bar-one" />
                <span className="chart-bar bar-two" />
                <span className="chart-bar bar-three" />
                <span className="chart-bar bar-four" />
                <span className="chart-bar bar-five" />
                <span className="chart-line" />
              </div>
              <div className="art-card-footer">
                <span />
                <span />
                <span />
              </div>
            </div>
            <div className="art-orb orb-one" />
            <div className="art-orb orb-two" />
          </div>

          <p className="visual-footer">PRIVADO · PESSOAL · SEU</p>
        </aside>

        <section className="form-panel" aria-labelledby="login-title">
          {!token ? (
            <>
              <div className="form-heading">
                <div className="secure-mark" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10m-9.5 0h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.7"
                    />
                    <path
                      d="M12.5 14.5v2"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeWidth="1.7"
                    />
                  </svg>
                </div>
                <p className="eyebrow">BEM-VINDO DE VOLTA</p>
                <h2 id="login-title">Acesse sua conta</h2>
                <p className="form-subtitle">
                  Entre com seu e-mail e senha para continuar.
                </p>
              </div>

              <form className="login-form" onSubmit={handleLogin}>
                <label htmlFor="email">E-mail</label>
                <input
                  id="email"
                  type="email"
                  name="email"
                  autoComplete="username"
                  placeholder="voce@exemplo.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />

                <div className="password-label">
                  <label htmlFor="password">Senha</label>
                </div>
                <input
                  id="password"
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  placeholder="Digite sua senha"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />

                {!financeApiUrl && (
                  <p className="form-message error" role="alert">
                    Configure a URL da API em <code>pwa/.env.local</code> para
                    habilitar o login.
                  </p>
                )}
                {loginMutation.isError && (
                  <p className="form-message error" role="alert">
                    {loginMutation.error instanceof Error
                      ? loginMutation.error.message
                      : "Não foi possível entrar. Tente novamente."}
                  </p>
                )}
                {authMessage && (
                  <p className="form-message" role="status">{authMessage}</p>
                )}
                {cacheError && (
                  <p className="form-message error" role="status">
                    {cacheError}
                  </p>
                )}

                <button
                  className="primary-button"
                  type="submit"
                  disabled={!financeApiUrl || loginMutation.isPending}
                >
                  {loginMutation.isPending ? (
                    <>
                      <span className="button-spinner" aria-hidden="true" />
                      Verificando acesso...
                    </>
                  ) : (
                    <>
                      Entrar
                      <span className="button-arrow" aria-hidden="true">→</span>
                    </>
                  )}
                </button>
              </form>

              <p className="form-footnote">
                Sua sessão permanece neste dispositivo até você sair. Evite em
                dispositivos compartilhados.
              </p>
            </>
          ) : meQuery.isPending ? (
            <div className="session-state">
              <span className="loading-spinner" aria-hidden="true" />
              <p className="eyebrow">SUA CONTA</p>
              <h2 id="login-title">Validando sua sessão</h2>
              <p className="form-subtitle">
                Aguarde enquanto confirmamos seu acesso.
              </p>
            </div>
          ) : meQuery.isError ? (
            <div className="session-state">
              <span className="state-icon error" aria-hidden="true">!</span>
              <p className="eyebrow">SUA CONTA</p>
              <h2 id="login-title">Não foi possível validar</h2>
              <p className="form-subtitle">
                {meQuery.error instanceof Error
                  ? meQuery.error.message
                  : "Tente novamente ou saia da sessão."}
              </p>
              <button
                className="primary-button"
                type="button"
                onClick={() => void meQuery.refetch()}
              >
                Tentar novamente
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
              >
                Sair desta sessão
              </button>
            </div>
          ) : activeMemberships.length > 0 && workspacesQuery.isPending ? (
            <div className="session-state">
              <span className="loading-spinner" aria-hidden="true" />
              <p className="eyebrow">SEU WORKSPACE</p>
              <h2 id="login-title">Preparando seu espaço</h2>
              <p className="form-subtitle">Estamos carregando seus dados.</p>
            </div>
          ) : activeMemberships.length > 0 && workspacesQuery.isError ? (
            <div className="session-state">
              <span className="state-icon error" aria-hidden="true">!</span>
              <p className="eyebrow">SEU WORKSPACE</p>
              <h2 id="login-title">Não foi possível carregar</h2>
              <p className="form-subtitle">
                {workspacesQuery.error instanceof Error
                  ? workspacesQuery.error.message
                  : "Tente novamente."}
              </p>
              <button
                className="primary-button"
                type="button"
                onClick={() => void workspacesQuery.refetch()}
              >
                Tentar novamente
              </button>
            </div>
          ) : activeMemberships.length > 0 && workspacesQuery.isSuccess ? (
            <div className="session-state">
              <span className="state-icon error" aria-hidden="true">!</span>
              <p className="eyebrow">SEU WORKSPACE</p>
              <h2 id="login-title">Workspace indisponível</h2>
              <p className="form-subtitle">
                Sua conta tem uma associação ativa, mas não há um workspace
                disponível. Fale com o administrador.
              </p>
              <button
                className="primary-button logout-button"
                type="button"
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
              >
                {logoutMutation.isPending ? "Saindo..." : "Sair da conta"}
              </button>
            </div>
          ) : (
            <div className="session-state">
              <span className="state-icon success" aria-hidden="true">✓</span>
              <p className="eyebrow">SESSÃO ATIVA</p>
              <h2 id="login-title">Que bom ter você de volta.</h2>
              <p className="account-email">{meQuery.data?.user.EMAIL}</p>
              {activeMemberships.length ? (
                <p className="form-subtitle">
                  Acesso ao workspace ·{" "}
                  {activeMemberships.map((membership) => membership.role).join(", ")}
                </p>
              ) : (
                <p className="form-subtitle">
                  Sua conta ainda não tem acesso ativo a um workspace. Fale com
                  o administrador.
                </p>
              )}
              {logoutMutation.isError && (
                <p className="form-message error" role="alert">{authMessage}</p>
              )}
              <button
                className="primary-button logout-button"
                type="button"
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
              >
                {logoutMutation.isPending ? "Saindo..." : "Sair da conta"}
              </button>
            </div>
          )}
        </section>
      </section>

      <footer className="page-footer">
        <span>SheetFinances</span>
        <span>Seus dados financeiros permanecem privados.</span>
      </footer>
    </main>
  );
}

export default App;
