export class FinanceApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FinanceApiError";
    this.code = code;
  }
}

export interface Membership {
  workspaceId: string;
  role: string;
  status: string;
  deletedAt?: string | null;
}

export interface LoginData {
  token: string;
  tokenType: string;
  userId: string;
  memberships: Membership[];
}

export interface MeData {
  user: {
    ID: string;
    EMAIL: string;
    STATUS: string;
  };
  memberships: Membership[];
}

export interface Workspace {
  id: string;
  name: string;
}

export interface DashboardAccountBalance {
  id: string;
  name: string;
  currentBalance: number;
  projectedBalance: number;
}

export interface DashboardBalance {
  currency: string;
  currentBalance: number | null;
  projectedBalance: number | null;
  projectedIncome: number;
  projectedExpenses: number;
  balanceComplete: boolean;
  missingAccountCount: number;
  balanceSource: "ACCOUNT_ANCHORS" | "WORKSPACE_ANCHOR" | "UNAVAILABLE";
  accounts: DashboardAccountBalance[];
}

export interface DashboardTimelinePoint {
  date: string;
  currency: string;
  income: number;
  expenses: number;
  balance: number | null;
}

export interface DashboardCommitment {
  id: string;
  date: string;
  description: string;
  amount: number | null;
  currency: string;
  direction: "INCOME" | "EXPENSE" | "UNKNOWN";
  accountId: string;
  accountName: string;
  source: "TRANSACTION" | "RECURRENCE" | "DEBT" | "INVOICE";
  estimated: boolean;
  affectsBalance: boolean;
  status: string;
}

export interface DashboardData {
  asOfDate: string;
  throughDate: string;
  horizonDays: number;
  balances: DashboardBalance[];
  timeline: DashboardTimelinePoint[];
  commitments: DashboardCommitment[];
  warnings: string[];
}

export interface FinanceRecord {
  ID: string;
  [field: string]: unknown;
}

export interface EntityPage<T> {
  items: T[];
  total: number;
}

export const financeApiUrl = (
  import.meta.env.VITE_FINANCE_API_URL ?? ""
).trim();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function makeEndpoint(parameters: Record<string, string>): string {
  if (!financeApiUrl) {
    throw new FinanceApiError(
      "API_URL_MISSING",
      "Configure VITE_FINANCE_API_URL no arquivo .env.local."
    );
  }

  let endpoint: URL;
  try {
    endpoint = new URL(financeApiUrl);
  } catch (error) {
    throw new FinanceApiError(
      "API_URL_INVALID",
      "VITE_FINANCE_API_URL precisa ser uma URL válida.",
      { cause: error }
    );
  }

  endpoint.searchParams.set("api", "v1");
  Object.entries(parameters).forEach(([key, value]) => {
    endpoint.searchParams.set(key, value);
  });
  return endpoint.toString();
}

interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

async function requestResponse<T>(
  endpoint: string,
  init?: RequestInit
): Promise<ApiResponse<T>> {
  let response: Response;
  try {
    response = await fetch(endpoint, init);
  } catch (error) {
    throw new FinanceApiError(
      "NETWORK_OR_CORS",
      "Não foi possível acessar a API. Verifique a URL e o gateway/CORS.",
      { cause: error }
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new FinanceApiError(
      "INVALID_RESPONSE",
      "A resposta da API não contém JSON válido.",
      { cause: error }
    );
  }

  if (!isRecord(payload)) {
    throw new FinanceApiError(
      "INVALID_RESPONSE",
      "A API retornou um formato de resposta inesperado."
    );
  }

  if (payload.ok === false && isRecord(payload.error)) {
    const apiError = payload.error;
    throw new FinanceApiError(
      typeof apiError.code === "string" ? apiError.code : "API_ERROR",
      typeof apiError.message === "string"
        ? apiError.message
        : "A API retornou um erro."
    );
  }

  if (!response.ok) {
    throw new FinanceApiError(
      "HTTP_ERROR",
      `A API respondeu com HTTP ${response.status}.`
    );
  }

  if (payload.ok !== true || !("data" in payload)) {
    throw new FinanceApiError(
      "INVALID_RESPONSE",
      "A resposta da API não segue o formato esperado."
    );
  }

  return {
    data: payload.data as T,
    meta: isRecord(payload.meta) ? payload.meta : undefined
  };
}

async function request<T>(
  endpoint: string,
  init?: RequestInit
): Promise<T> {
  return (await requestResponse<T>(endpoint, init)).data;
}

export function login(email: string, password: string): Promise<LoginData> {
  return request<LoginData>(makeEndpoint({}), {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8"
    },
    body: JSON.stringify({
      action: "auth.login",
      email,
      password
    })
  });
}

export function getMe(token: string): Promise<MeData> {
  return request<MeData>(
    makeEndpoint({ resource: "me", access_token: token }),
    { method: "GET", cache: "no-store" }
  );
}

export function getWorkspaces(token: string): Promise<Workspace[]> {
  return request<Workspace[]>(
    makeEndpoint({ resource: "workspaces", access_token: token }),
    { method: "GET", cache: "no-store" }
  );
}

export function getDashboard(
  token: string,
  workspaceId: string,
  horizonDays = 30
): Promise<DashboardData> {
  return request<DashboardData>(
    makeEndpoint({
      resource: "dashboard",
      access_token: token,
      workspaceId,
      horizonDays: String(horizonDays)
    }),
    { method: "GET", cache: "no-store" }
  );
}

export async function getEntityPage<T extends FinanceRecord>(
  resource: string,
  token: string,
  workspaceId: string,
  limit: number,
  offset: number
): Promise<EntityPage<T>> {
  const response = await requestResponse<T[]>(
    makeEndpoint({
      resource,
      access_token: token,
      workspaceId,
      limit: String(limit),
      offset: String(offset)
    }),
    { method: "GET", cache: "no-store" }
  );
  const total = response.meta?.total;
  return {
    items: response.data,
    total: typeof total === "number" ? total : response.data.length
  };
}

export function logout(token: string): Promise<{ status: string }> {
  return request<{ status: string }>(makeEndpoint({}), {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8"
    },
    body: JSON.stringify({
      action: "auth.logout",
      token
    })
  });
}
