import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import {
  indexedDbPersister,
  PERSISTED_CACHE_MAX_AGE
} from "./api/queryPersister";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      gcTime: PERSISTED_CACHE_MAX_AGE
    }
  }
});

registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: indexedDbPersister,
        maxAge: PERSISTED_CACHE_MAX_AGE,
        buster: "sheet-finances-query-cache-v1",
        dehydrateOptions: {
          shouldDehydrateQuery: (query) =>
            (
              query.queryKey[0] === "finance-data" ||
              query.queryKey[0] === "finance-session"
            ) &&
            query.state.data !== undefined &&
            Date.now() - query.state.dataUpdatedAt <= PERSISTED_CACHE_MAX_AGE
        }
      }}
    >
      <App />
    </PersistQueryClientProvider>
  </StrictMode>
);
