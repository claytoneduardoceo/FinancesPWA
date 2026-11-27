import { useState, type ReactNode } from "react";
import type { FinanceRecord } from "./api/client";

export interface RecordListColumn<T extends FinanceRecord> {
  key: string;
  label: string;
  render: (record: T) => ReactNode;
}

interface RecordListProps<T extends FinanceRecord> {
  eyebrow: string;
  title: string;
  subtitle: string;
  items: T[];
  columns: RecordListColumn<T>[];
  total: number;
  loadedCount: number;
  isPending: boolean;
  isFetching: boolean;
  error: unknown;
  lookupError: unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  searchText: (record: T) => string;
  emptyTitle: string;
  emptyMessage: string;
  onRefresh: () => void;
  onLoadMore: () => void;
}

export default function RecordList<T extends FinanceRecord>({
  eyebrow,
  title,
  subtitle,
  items,
  columns,
  total,
  loadedCount,
  isPending,
  isFetching,
  error,
  lookupError,
  hasNextPage,
  isFetchingNextPage,
  searchText,
  emptyTitle,
  emptyMessage,
  onRefresh,
  onLoadMore
}: RecordListProps<T>) {
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
  const filteredItems = items.filter((item) =>
    !normalizedSearch ||
    searchText(item).toLocaleLowerCase("pt-BR").includes(normalizedSearch)
  );
  const hasLoadedItems = loadedCount > 0;

  return (
    <section className="transactions-content records-content">
      <div className="transactions-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="transactions-subtitle">{subtitle}</p>
        </div>
        <button
          className="refresh-button"
          type="button"
          onClick={onRefresh}
          disabled={isFetching}
        >
          <span
            className={isFetching ? "refresh-icon spinning" : "refresh-icon"}
            aria-hidden="true"
          >
            ↻
          </span>
          Atualizar
        </button>
      </div>

      <div className="transactions-toolbar">
        <label className="transaction-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            placeholder={`Buscar ${title.toLocaleLowerCase("pt-BR")}`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={`Buscar ${title.toLocaleLowerCase("pt-BR")} carregados`}
          />
        </label>
      </div>

      {lookupError instanceof Error && (
        <p className="lookup-warning" role="alert">
          Não foi possível carregar todos os nomes relacionados:{" "}
          {lookupError.message}
        </p>
      )}

      <div className="transactions-list-card">
        <div className="list-card-heading">
          <div>
            <h2>{title}</h2>
            <p>
              {isPending
                ? "Carregando registros"
                : `${loadedCount} de ${total} registros carregados`}
            </p>
          </div>
          <span className="list-count-badge">
            {filteredItems.length} exibidos
          </span>
        </div>

        {error instanceof Error && loadedCount > 0 && (
          <p className="cache-data-warning" role="status">
            Não foi possível atualizar a lista. Exibindo os últimos registros
            salvos neste dispositivo.
          </p>
        )}

        {isPending ? (
          <div className="transactions-state">
            <span className="loading-spinner" aria-hidden="true" />
            <p>Carregando registros...</p>
          </div>
        ) : error instanceof Error && loadedCount === 0 ? (
          <div className="transactions-state error-state" role="alert">
            <span className="state-icon error" aria-hidden="true">!</span>
            <h3>Não foi possível carregar {title.toLocaleLowerCase("pt-BR")}</h3>
            <p>{error.message}</p>
            <button
              className="primary-button retry-button"
              type="button"
              onClick={onRefresh}
            >
              Tentar novamente
            </button>
          </div>
        ) : total === 0 ? (
          <div className="transactions-state empty-state">
            <h3>{emptyTitle}</h3>
            <p>{emptyMessage}</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="transactions-state empty-state">
            <h3>
              {normalizedSearch
                ? "Nenhum resultado encontrado"
                : emptyTitle}
            </h3>
            <p>
              {normalizedSearch
                ? "Altere a busca ou carregue mais registros para pesquisar itens anteriores."
                : hasNextPage
                  ? `Nenhum registro correspondente entre os ${loadedCount} carregados. Carregue mais para verificar os anteriores.`
                  : emptyMessage}
            </p>
          </div>
        ) : (
          <div className="records-table-wrap">
            <table className="records-table">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column.key} scope="col">{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr key={item.ID}>
                    {columns.map((column) => (
                      <td key={column.key}>{column.render(item)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hasNextPage && (
          <div className="load-more-row">
            <button
              className="secondary-button"
              type="button"
              onClick={onLoadMore}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? "Carregando..." : "Carregar registros anteriores"}
            </button>
          </div>
        )}
      </div>
      <p className="list-footnote">
        {hasNextPage
          ? `A busca considera os ${loadedCount} registros carregados. Carregue mais para consultar os anteriores.`
          : hasLoadedItems
            ? "A busca considera todos os registros carregados deste workspace."
            : "Esta tela é somente para consulta."}
      </p>
    </section>
  );
}
