import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "react-hot-toast";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { AuthProvider } from "./hooks/useAuth";
import "./index.css";

// Apply saved theme before first paint to avoid flash.
try {
  const saved = localStorage.getItem("propdesk-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (saved === "dark" || (!saved && prefersDark)) {
    document.documentElement.classList.add("dark");
  }
} catch {
  // ignore
}

// Any change that succeeds — a payment, credit, water reading, move-out,
// manual income, deposit edit — can move the books. Rather than every mutation
// remembering to say so, all of them refresh the money screens: the reports
// and accounting figures and the dashboard. Only screens on display refetch.
const mutationCache = new MutationCache({
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ["reports"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  },
});

const queryClient: QueryClient = new QueryClient({
  mutationCache,
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <App />
            <Toaster
              position="top-right"
              toastOptions={{
                // Pills, in the system's type: what you read is calm, never a block of colour.
                style: {
                  borderRadius: 99,
                  fontSize: 13,
                  fontWeight: 500,
                  padding: "8px 14px",
                  color: "#111113",
                  boxShadow: "0 10px 28px rgba(20,24,35,.14)",
                },
              }}
            />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
