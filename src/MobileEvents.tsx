import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  getMobileEventPage,
  type EntityPage,
  type MobileEvent,
  type MobileEventView
} from "./api/client";

const PAGE_SIZE = 50;

interface MobileEventPage extends EntityPage<MobileEvent> {
  nextOffset: number | null;
}

interface MobileEventsProps {
  token: string;
  userId: string;
  workspaceId: string;
  view: MobileEventView;
}

function readText(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function formatEventDate(value: unknown, includeTime = false): string {
  const text = readText(value);
  if (!text) return "Data não informada";
  const dateOnly = (includeTime ? /^(\d{4})-(\d{2})-(\d{2})$/ :
    /^(\d{4})-(\d{2})-(\d{2})/).exec(text);
  const date = dateOnly
    ? new Date(Date.UTC(
      Number(dateOnly[1]),
      Number(dateOnly[2]) - 1,
      Number(dateOnly[3])
    ))
    : new Date(text);
  if (!Number.isFinite(date.getTime())) return "Data inválida";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: dateOnly ? "UTC" : undefined
  }).format(date);
}

function formatEventAmount(event: MobileEvent): string {
  if (event.AMOUNT === null || event.AMOUNT === undefined ||
    readText(event.AMOUNT) === "") return "Valor não identificado";
  const amount = Number(event.AMOUNT);
  if (!Number.isFinite(amount)) return "Valor inválido";
  const currency = readText(event.CURRENCY).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return `${new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount)} · moeda não informada`;
  }
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency
    }).format(amount);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return `${new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount)} ${currency}`;
  }
}

function statusLabel(value: unknown): string {
  const status = readText(value).toUpperCase();
  const labels: Record<string, string> = {
    PENDENTE_REVISAO: "Pendente de revisão",
    UNVERIFIED: "Não verificado",
    PENDING_DATA: "Dados pendentes",
    NEEDS_FORMAL_REVIEW: "Revisão necessária",
    ERRO: "Erro",
    PROCESSING: "Em processamento",
    INSERIDO_AVULSO: "Inserido",
    PARCELAMENTO: "Parcelamento",
    CONCILIADO: "Conciliado",
    CONCILIADO_ATUALIZADO: "Conciliação atualizada",
    CANCELADA: "Cancelamento conciliado",
    DUPLICADO: "Duplicado",
    IGNORADO_NAO_TRANSACIONAL: "Ignorado · sem transação",
    IGNORADO_TRANSFERENCIA_PROPRIA: "Ignorado · transferência própria",
    IGNORADO_PIX_SEM_CONTRAPARTE: "Ignorado · Pix sem contraparte"
  };
  return labels[status] || status.replace(/_/g, " ") || "Status não informado";
}

function statusTone(value: unknown): string {
  const status = readText(value).toUpperCase();
  if ([
    "PENDENTE_REVISAO", "UNVERIFIED", "PENDING_DATA",
    "NEEDS_FORMAL_REVIEW", "PROCESSING"
  ].includes(status)) return "warning";
  if (status === "ERRO") return "error";
  if ([
    "INSERIDO_AVULSO", "PARCELAMENTO", "CONCILIADO",
    "CONCILIADO_ATUALIZADO", "CANCELADA"
  ].includes(status)) return "success";
  return "muted";
}

function recordKindLabel(event: MobileEvent): string {
  if (event.KIND === "TRANSACTION") return "Lançamento";
  if (event.KIND === "INSTALLMENT_PLAN") return "Parcelamento";
  return "Entrada mobile";
}

function prettyPayload(value: unknown): string {
  const text = readText(value);
  if (!text) return "Não há conteúdo detalhado salvo para este evento.";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return text;
  }
}

function searchText(event: MobileEvent): string {
  return [
    event.ENTRY_TYPE,
    event.TRANSACTION_DATE,
    event.RECEIVED_AT,
    event.DESCRIPTION,
    event.AMOUNT,
    event.CURRENCY,
    event.ACCOUNT_NAME,
    event.CARD_LAST_FOUR,
    event.MERCHANT,
    event.CATEGORY_LABEL,
    event.NOTES,
    event.PROCESSING_STATUS,
    event.PAYLOAD_JSON
  ].map(readText).join(" ").toLocaleLowerCase("pt-BR");
}

export default function MobileEvents({
  token,
  userId,
  workspaceId,
  view
}: MobileEventsProps) {
  const [search, setSearch] = useState("");
  const isReview = view === "review";
  const eventsQuery = useInfiniteQuery({
    queryKey: [
      "finance-data",
      "mobile-events",
      view,
      userId,
      workspaceId
    ],
    queryFn: async ({ pageParam }): Promise<MobileEventPage> => {
      const page = await getMobileEventPage(
        token, workspaceId, view, PAGE_SIZE, pageParam
      );
      return {
        ...page,
        nextOffset: page.items.length > 0 &&
          pageParam + page.items.length < page.total
          ? pageParam + page.items.length
          : null
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    enabled: Boolean(token && workspaceId),
    retry: false,
    staleTime: 30_000
  });
  const events = eventsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const total = eventsQuery.data?.pages[0]?.total ?? 0;
  const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
  const filteredEvents = events.filter((event) =>
    !normalizedSearch || searchText(event).includes(normalizedSearch)
  );
  const title = isReview ? "Revisar pendências" : "Histórico mobile";

  return (
    <section className="transactions-content mobile-events-content">
      <div className="transactions-heading">
        <div>
          <p className="eyebrow">
            {isReview ? "REVISÃO DE LANÇAMENTOS" : "AUTOMAÇÕES"}
          </p>
          <h1>{title}</h1>
          <p className="transactions-subtitle">
            {isReview
              ? "Entradas incompletas e lançamentos que aguardam conferência."
              : "Registro de tentativas recebidas pelos atalhos e notificações."}
          </p>
        </div>
        <button
          className="refresh-button"
          type="button"
          onClick={() => void eventsQuery.refetch()}
          disabled={eventsQuery.isFetching}
        >
          <span
            className={eventsQuery.isFetching
              ? "refresh-icon spinning"
              : "refresh-icon"}
            aria-hidden="true"
          >
            ↻
          </span>
          Atualizar
        </button>
      </div>

      <div className="mobile-events-toolbar">
        <label className="transaction-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            placeholder={`Buscar ${isReview ? "pendências" : "eventos"}`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={`Buscar ${isReview ? "pendências carregadas" : "eventos carregados"}`}
          />
        </label>
        <span className="mobile-events-total">
          {eventsQuery.data
            ? isReview
              ? `${total} ${total === 1 ? "pendente" : "pendentes"}`
              : `${total} ${total === 1 ? "evento" : "eventos"}`
            : "Carregando..."}
        </span>
      </div>

      {eventsQuery.isError && eventsQuery.data && (
        <p className="cache-data-warning" role="status">
          Não foi possível atualizar a lista. Exibindo os últimos registros
          salvos neste dispositivo.
        </p>
      )}

      {eventsQuery.isPending ? (
        <div className="transactions-list-card transactions-state">
          <span className="loading-spinner" aria-hidden="true" />
          <p>{isReview ? "Carregando pendências..." : "Carregando histórico..."}</p>
        </div>
      ) : eventsQuery.isError && !eventsQuery.data ? (
        <div className="transactions-list-card transactions-state error-state" role="alert">
          <span className="state-icon error" aria-hidden="true">!</span>
          <h3>Não foi possível carregar {isReview ? "as pendências" : "o histórico"}</h3>
          <p>
            {eventsQuery.error instanceof Error
              ? eventsQuery.error.message
              : "Verifique sua conexão e tente novamente."}
          </p>
          <button
            className="primary-button retry-button"
            type="button"
            onClick={() => void eventsQuery.refetch()}
          >
            Tentar novamente
          </button>
        </div>
      ) : total === 0 ? (
        <div className="transactions-list-card transactions-state empty-state">
          <span className="empty-icon" aria-hidden="true">{isReview ? "✓" : "◷"}</span>
          <h3>{isReview ? "Nenhuma pendência" : "Nenhum evento registrado"}</h3>
          <p>
            {isReview
              ? "Entradas incompletas e lançamentos não verificados aparecerão aqui."
              : "As tentativas de ingestão mobile aparecerão neste histórico."}
          </p>
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="transactions-list-card transactions-state empty-state">
          <h3>Nenhum resultado encontrado</h3>
          <p>Altere a busca ou carregue mais registros para continuar.</p>
        </div>
      ) : isReview ? (
        <div className="mobile-event-list">
          {filteredEvents.map((event) => (
            <article
              className="transactions-list-card mobile-event-card"
              key={`${event.KIND || "EXTERNAL_EVENT"}:${event.ID}`}
            >
              <div className="mobile-event-card-heading">
                <div>
                  <p className="mobile-event-date">
                    {event.KIND === "INSTALLMENT_PLAN" ? "Compra" : "Transação"}:{" "}
                    {formatEventDate(event.TRANSACTION_DATE)}
                    <span aria-hidden="true"> · </span>
                    Recebida: {formatEventDate(event.RECEIVED_AT, true)}
                  </p>
                  <h2>{readText(event.DESCRIPTION) || "Lançamento sem descrição"}</h2>
                  {readText(event.MERCHANT) && (
                    <p className="mobile-event-merchant">
                      {readText(event.MERCHANT)}
                    </p>
                  )}
                </div>
                <span className={`mobile-event-status ${statusTone(event.PROCESSING_STATUS)}`}>
                  {statusLabel(event.PROCESSING_STATUS)}
                </span>
              </div>

              <div className="mobile-event-fields">
                <div>
                  <span>Tipo</span>
                  <strong>{recordKindLabel(event)}</strong>
                </div>
                <div>
                  <span>Valor</span>
                  <strong>{formatEventAmount(event)}</strong>
                </div>
                <div>
                  <span>Origem</span>
                  <strong>{readText(event.ENTRY_TYPE) || "Não informada"}</strong>
                </div>
                <div>
                  <span>Conta</span>
                  <strong>
                    {readText(event.ACCOUNT_NAME) ||
                      readText(event.ACCOUNT_ID) ||
                      "Não conciliada"}
                  </strong>
                </div>
                <div>
                  <span>Cartão</span>
                  <strong>
                    {readText(event.CARD_LAST_FOUR)
                      ? `Final ${readText(event.CARD_LAST_FOUR)}`
                      : "Não informado"}
                  </strong>
                </div>
                <div>
                  <span>Categoria</span>
                  <strong>{readText(event.CATEGORY_LABEL) || "Não identificada"}</strong>
                </div>
                <div>
                  <span>Identificador</span>
                  <strong>{readText(event.EXTERNAL_ID) || "Não informado"}</strong>
                </div>
              </div>

              {readText(event.NOTES) && (
                <p className="mobile-event-note">
                  <strong>
                    {event.KIND === "EXTERNAL_EVENT" ? "Motivo:" : "Observação:"}
                  </strong>{" "}
                  {readText(event.NOTES)}
                </p>
              )}

              {readText(event.PAYLOAD_JSON) && (
                <details className="mobile-event-details">
                  <summary>Ver dados recebidos</summary>
                  <pre>{prettyPayload(event.PAYLOAD_JSON)}</pre>
                </details>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="transactions-list-card mobile-events-log-card">
          <div className="records-table-wrap">
            <table className="records-table mobile-events-table">
              <thead>
                <tr>
                  <th scope="col">Recebido</th>
                  <th scope="col">Origem</th>
                  <th scope="col">Descrição</th>
                  <th scope="col">Valor</th>
                  <th scope="col">Status</th>
                  <th scope="col">Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((event) => (
                  <tr key={event.ID}>
                    <td>{formatEventDate(event.RECEIVED_AT, true)}</td>
                    <td>{readText(event.ENTRY_TYPE) || "—"}</td>
                    <td>
                      {readText(event.DESCRIPTION) ||
                        readText(event.MERCHANT) ||
                        "Sem descrição"}
                    </td>
                    <td>{formatEventAmount(event)}</td>
                    <td>
                      <span className={`mobile-event-status ${statusTone(event.PROCESSING_STATUS)}`}>
                        {statusLabel(event.PROCESSING_STATUS)}
                      </span>
                    </td>
                    <td>
                      {readText(event.NOTES) || "—"}
                      {readText(event.PAYLOAD_JSON) && (
                        <details className="mobile-event-details">
                          <summary>Ver dados recebidos</summary>
                          <pre>{prettyPayload(event.PAYLOAD_JSON)}</pre>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {eventsQuery.hasNextPage && (
        <div className="load-more-row">
          <button
            className="secondary-button"
            type="button"
            onClick={() => void eventsQuery.fetchNextPage()}
            disabled={eventsQuery.isFetchingNextPage}
          >
            {eventsQuery.isFetchingNextPage
              ? "Carregando..."
              : "Carregar eventos anteriores"}
          </button>
        </div>
      )}
      <p className="list-footnote">
        A busca considera apenas os {events.length} registros carregados.{" "}
        {isReview
          ? "Esta tela é somente para consulta. A revisão e edição ainda não estão disponíveis."
          : "O histórico é somente para consulta."}
      </p>
    </section>
  );
}
