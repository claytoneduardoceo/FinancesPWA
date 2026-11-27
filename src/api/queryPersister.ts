import type {
  PersistedClient,
  Persister
} from "@tanstack/react-query-persist-client";

export const PERSISTED_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;

const DATABASE_NAME = "sheet-finances-pwa";
const DATABASE_VERSION = 1;
const OBJECT_STORE_NAME = "query-cache";
const CLIENT_KEY = "finance-query-client";

let databasePromise: Promise<IDBDatabase> | undefined;
let cacheError: string | null = null;
let writeQueue: Promise<void> = Promise.resolve();
const cacheErrorListeners = new Set<() => void>();

function publishCacheError(error: string | null): void {
  if (cacheError === error) return;
  cacheError = error;
  cacheErrorListeners.forEach((listener) => listener());
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "erro desconhecido";
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error("IndexedDB não está disponível neste navegador.")
    );
  }
  if (databasePromise) return databasePromise;

  const pendingDatabase = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OBJECT_STORE_NAME)) {
        database.createObjectStore(OBJECT_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error || new Error("Não foi possível abrir o cache local.")
    );
    request.onblocked = () => reject(
      new Error("A atualização do cache local está bloqueada por outra aba.")
    );
  });
  const openingDatabase = pendingDatabase.catch((error: unknown) => {
    databasePromise = undefined;
    throw error;
  });
  databasePromise = openingDatabase;
  return openingDatabase;
}

async function readClient(): Promise<PersistedClient | undefined> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(OBJECT_STORE_NAME, "readonly");
    const request = transaction.objectStore(OBJECT_STORE_NAME).get(CLIENT_KEY);
    request.onsuccess = () => resolve(
      request.result as PersistedClient | undefined
    );
    request.onerror = () => reject(
      request.error || new Error("Não foi possível ler o cache local.")
    );
    transaction.onabort = () => reject(
      transaction.error || new Error("A leitura do cache local foi cancelada.")
    );
  });
}

async function writeClient(client: PersistedClient): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(OBJECT_STORE_NAME, "readwrite");
    transaction.objectStore(OBJECT_STORE_NAME).put(client, CLIENT_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error || new Error("Não foi possível salvar o cache local.")
    );
    transaction.onabort = () => reject(
      transaction.error || new Error("A gravação do cache local foi cancelada.")
    );
  });
}

async function deleteClient(): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(OBJECT_STORE_NAME, "readwrite");
    transaction.objectStore(OBJECT_STORE_NAME).delete(CLIENT_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error || new Error("Não foi possível remover o cache local.")
    );
    transaction.onabort = () => reject(
      transaction.error || new Error("A remoção do cache local foi cancelada.")
    );
  });
}

function normalizeClient(client: PersistedClient): PersistedClient {
  const queries = client.clientState.queries
    .filter((query) =>
      query.state.data !== undefined &&
      Date.now() - query.state.dataUpdatedAt <= PERSISTED_CACHE_MAX_AGE
    )
    .map((query) => ({
      ...query,
      state: {
        ...query.state,
        status: "success" as const,
        fetchStatus: "idle" as const,
        error: null,
        errorUpdatedAt: 0,
        failureCount: 0,
        failureReason: null
      }
    }));

  return {
    ...client,
    clientState: {
      ...client.clientState,
      queries,
      mutations: []
    }
  };
}

async function enqueueWrite(
  operation: () => Promise<void>,
  failureMessage: string
): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    try {
      await operation();
      publishCacheError(null);
    } catch (error) {
      publishCacheError(`${failureMessage}: ${errorMessage(error)}`);
    }
  });
  await writeQueue;
}

export const indexedDbPersister: Persister = {
  async persistClient(client) {
    await enqueueWrite(
      () => writeClient(normalizeClient(client)),
      "Não foi possível salvar o cache local"
    );
  },
  async restoreClient() {
    try {
      const client = await readClient();
      publishCacheError(null);
      return client;
    } catch (error) {
      publishCacheError(
        `Não foi possível restaurar o cache local: ${errorMessage(error)}`
      );
      return undefined;
    }
  },
  async removeClient() {
    await enqueueWrite(
      deleteClient,
      "Não foi possível remover o cache local"
    );
  }
};

export function getQueryCacheError(): string | null {
  return cacheError;
}

export function subscribeToQueryCacheError(
  listener: () => void
): () => void {
  cacheErrorListeners.add(listener);
  return () => cacheErrorListeners.delete(listener);
}
