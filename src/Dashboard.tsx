import { useQuery } from "@tanstack/react-query";
import {
  type DashboardBalance,
  type DashboardTimelinePoint,
  getDashboard
} from "./api/client";

interface DashboardProps {
  token: string;
  userId: string;
  workspaceId: string;
  workspaceName: string;
}

function formatMoney(value: number, currency: string): string {
  if (!currency) return "Moeda não informada";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency
    }).format(value);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return `${new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value)} ${currency}`;
  }
}

function formatDate(value: string, options: Intl.DateTimeFormatOptions = {}): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return "Data inválida";
  const date = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  ));
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
    ...options
  }).format(date);
}

function getBalancePath(points: DashboardTimelinePoint[]): string {
  const values = points
    .map((point) => point.balance)
    .filter((value): value is number => value !== null);
  if (values.length < 2) return "";
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || 1;
  const padding = range * 0.12;
  const lower = minimum - padding;
  const upper = maximum + padding;
  let started = false;
  return points.reduce((path, point, index) => {
    if (point.balance === null) return path;
    const x = (index / Math.max(points.length - 1, 1)) * 640;
    const y = 150 - ((point.balance - lower) / (upper - lower)) * 130;
    const command = started ? "L" : "M";
    started = true;
    return `${path}${command}${x.toFixed(1)} ${y.toFixed(1)} `;
  }, "").trim();
}

function balanceLabel(balance: DashboardBalance): string {
  if (balance.currentBalance === null) return "Saldo-base necessário";
  if (!balance.balanceComplete) {
    return `${balance.missingAccountCount} conta(s) sem saldo-base`;
  }
  return balance.balanceSource === "WORKSPACE_ANCHOR"
    ? "Base do workspace"
    : "Saldos por conta";
}

function sourceLabel(source: string): string {
  switch (source) {
    case "TRANSACTION":
      return "Lançamento";
    case "RECURRENCE":
      return "Recorrência";
    case "DEBT":
      return "Dívida";
    case "INVOICE":
      return "Fatura";
    default:
      return "Compromisso";
  }
}

export default function Dashboard({
  token,
  userId,
  workspaceId,
  workspaceName
}: DashboardProps) {
  const dashboardQuery = useQuery({
    queryKey: ["finance-data", "dashboard", userId, workspaceId, 30],
    queryFn: () => getDashboard(token, workspaceId, 30),
    enabled: Boolean(token && workspaceId),
    retry: false,
    staleTime: 30_000
  });
  const data = dashboardQuery.data;

  return (
    <section className="transactions-content dashboard-content" id="dashboard">
      <div className="transactions-heading">
        <div>
          <p className="eyebrow">VISÃO GERAL</p>
          <h1>Dashboard</h1>
          <p className="transactions-subtitle">
            {workspaceName} · projeção de {data?.horizonDays ?? 30} dias
          </p>
        </div>
        <button
          className="refresh-button"
          type="button"
          onClick={() => void dashboardQuery.refetch()}
          disabled={dashboardQuery.isFetching}
        >
          <span
            className={dashboardQuery.isFetching
              ? "refresh-icon spinning"
              : "refresh-icon"}
            aria-hidden="true"
          >
            ↻
          </span>
          Atualizar
        </button>
      </div>

      {dashboardQuery.isPending ? (
        <div className="transactions-list-card transactions-state">
          <span className="loading-spinner" aria-hidden="true" />
          <p>Calculando saldos e compromissos...</p>
        </div>
      ) : dashboardQuery.isError && !data ? (
        <div className="transactions-list-card transactions-state" role="alert">
          <span className="state-icon error" aria-hidden="true">!</span>
          <h3>Não foi possível carregar o dashboard</h3>
          <p>
            {dashboardQuery.error instanceof Error
              ? dashboardQuery.error.message
              : "Verifique sua conexão e tente novamente."}
          </p>
          <button
            className="primary-button retry-button"
            type="button"
            onClick={() => void dashboardQuery.refetch()}
          >
            Tentar novamente
          </button>
        </div>
      ) : data ? (
        <>
          {dashboardQuery.isError && (
            <p className="cache-data-warning" role="status">
              Não foi possível atualizar o dashboard. Exibindo os últimos
              dados salvos neste dispositivo.
            </p>
          )}
          {data.warnings.length > 0 && (
            <div className="dashboard-warnings" role="status">
              {data.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}

          <div className="dashboard-summary-grid">
            {data.balances.map((balance) => (
              <div className="dashboard-summary-group" key={balance.currency}>
                <article className="dashboard-stat-card">
                  <span>Disponível hoje · {balance.currency}</span>
                  <strong className={balance.currentBalance !== null &&
                    balance.currentBalance < 0 ? "negative-value" : ""}>
                    {balance.currentBalance === null
                      ? "—"
                      : formatMoney(balance.currentBalance, balance.currency)}
                  </strong>
                  <small>{balanceLabel(balance)}</small>
                </article>
                <article className="dashboard-stat-card positive">
                  <span>Entradas previstas</span>
                  <strong>
                    {formatMoney(balance.projectedIncome, balance.currency)}
                  </strong>
                  <small>Próximos {data.horizonDays} dias</small>
                </article>
                <article className="dashboard-stat-card negative">
                  <span>Saídas previstas</span>
                  <strong>
                    {formatMoney(-balance.projectedExpenses, balance.currency)}
                  </strong>
                  <small>Inclui compromissos com valor conhecido</small>
                </article>
                <article className="dashboard-stat-card projected">
                  <span>Saldo ao final do período</span>
                  <strong className={balance.projectedBalance !== null &&
                    balance.projectedBalance < 0 ? "negative-value" : ""}>
                    {balance.projectedBalance === null
                      ? "—"
                      : formatMoney(
                        balance.projectedBalance,
                        balance.currency
                      )}
                  </strong>
                  <small>Em {formatDate(data.throughDate)}</small>
                </article>
              </div>
            ))}
            {data.balances.length === 0 && (
              <div className="dashboard-card dashboard-no-balance">
                <h2>Cadastre suas contas</h2>
                <p>O dashboard precisa de contas e saldos-base para calcular a disponibilidade.</p>
              </div>
            )}
          </div>

          {data.balances.some((balance) => balance.accounts.length > 0) && (
            <section className="dashboard-card dashboard-accounts-card">
              <div className="dashboard-card-heading">
                <div>
                  <p className="eyebrow">DISPONIBILIDADE</p>
                  <h2>Saldos por conta</h2>
                </div>
                <span className="list-count-badge">
                  {data.balances.reduce(
                    (total, balance) => total + balance.accounts.length,
                    0
                  )}
                </span>
              </div>
              <div className="dashboard-account-list">
                {data.balances.flatMap((balance) =>
                  balance.accounts.map((account) => (
                    <article
                      className="dashboard-account-item"
                      key={account.id}
                    >
                      <span>{account.name}</span>
                      <small>{balance.currency}</small>
                      <strong className={account.currentBalance < 0
                        ? "negative-value"
                        : ""}>
                        {formatMoney(
                          account.currentBalance,
                          balance.currency
                        )}
                      </strong>
                      <small>
                        Projetado: {formatMoney(
                          account.projectedBalance,
                          balance.currency
                        )}
                      </small>
                    </article>
                  ))
                )}
              </div>
            </section>
          )}

          <div className="dashboard-main-grid">
            <section className="dashboard-card dashboard-timeline">
              <div className="dashboard-card-heading">
                <div>
                  <p className="eyebrow">FLUXO DE CAIXA</p>
                  <h2>Linha do tempo</h2>
                </div>
                <span className="list-count-badge">
                  {data.horizonDays} dias
                </span>
              </div>
              {data.balances.map((balance) => {
                const points = data.timeline.filter(
                  (point) => point.currency === balance.currency
                );
                const path = getBalancePath(points);
                return (
                  <div className="dashboard-timeline-currency" key={balance.currency}>
                    <div className="dashboard-timeline-currency-heading">
                      <strong>{balance.currency}</strong>
                      <span>
                        {balance.currentBalance === null
                          ? "Sem saldo-base"
                          : formatMoney(
                            balance.currentBalance,
                            balance.currency
                          )}
                      </span>
                    </div>
                    {path && (
                      <div className="dashboard-chart" role="img" aria-label={
                        `Saldo projetado em ${balance.currency}`
                      }>
                        <svg viewBox="0 0 640 160" preserveAspectRatio="none">
                          <path className="dashboard-chart-grid" d="M0 45H640 M0 90H640 M0 135H640" />
                          <path className="dashboard-chart-line" d={path} />
                        </svg>
                        <div className="dashboard-chart-labels">
                          <span>{formatDate(data.asOfDate)}</span>
                          <span>{formatDate(data.throughDate)}</span>
                        </div>
                      </div>
                    )}
                    <div className="dashboard-table-wrap">
                      <table className="dashboard-table">
                        <thead>
                          <tr>
                            <th>Data</th>
                            <th>Entradas</th>
                            <th>Saídas</th>
                            <th>Saldo previsto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {points.map((point) => (
                            <tr key={point.date}>
                              <td>{formatDate(point.date, {
                                weekday: "short"
                              })}</td>
                              <td className="income-cell">
                                {point.income
                                  ? formatMoney(point.income, balance.currency)
                                  : "—"}
                              </td>
                              <td className="expense-cell">
                                {point.expenses
                                  ? formatMoney(-point.expenses, balance.currency)
                                  : "—"}
                              </td>
                              <td>
                                {point.balance === null
                                  ? "—"
                                  : formatMoney(point.balance, balance.currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </section>

            <section className="dashboard-card dashboard-commitments">
              <div className="dashboard-card-heading">
                <div>
                  <p className="eyebrow">AGENDA FINANCEIRA</p>
                  <h2>Próximos compromissos</h2>
                </div>
                <span className="list-count-badge">
                  {data.commitments.length}
                </span>
              </div>
              {data.commitments.length === 0 ? (
                <div className="dashboard-empty">
                  <span className="empty-icon" aria-hidden="true">✓</span>
                  <h3>Nenhum compromisso previsto</h3>
                  <p>Não há vencimentos ou lançamentos previstos neste período.</p>
                </div>
              ) : (
                <ul className="commitment-list">
                  {data.commitments.map((item) => (
                    <li className="commitment-item" key={item.id}>
                      <div className="commitment-date">
                        <strong>{formatDate(item.date, { day: "2-digit" })}</strong>
                        <span>{formatDate(item.date, { month: "short" })}</span>
                      </div>
                      <div className="commitment-detail">
                        <strong>{item.description}</strong>
                        <span>
                          {sourceLabel(item.source)}
                          {item.accountName ? ` · ${item.accountName}` : ""}
                          {item.estimated ? " · Previsto" : ""}
                        </span>
                      </div>
                      <div className={`commitment-amount ${item.direction.toLowerCase()}`}>
                        <strong>
                          {item.amount === null
                            ? "Valor indisponível"
                            : formatMoney(
                              item.direction === "EXPENSE"
                                ? -item.amount
                                : item.amount,
                              item.currency
                            )}
                        </strong>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      ) : (
        <div className="transactions-list-card transactions-state">
          <p>Não há dados disponíveis para este workspace.</p>
        </div>
      )}
    </section>
  );
}
