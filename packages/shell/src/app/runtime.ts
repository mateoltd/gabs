import { useEffect, useState } from "react";
import { QueryClient } from "@tanstack/react-query";
import { SuiteClient, ApiError } from "@suite/client/api";
import { getPlatform } from "@suite/client/browser";

export const platform = getPlatform();
export const client = new SuiteClient(
  window.suiteDesktop
    ? (request) => window.suiteDesktop!.execute(request)
    : undefined,
);
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) =>
        !(error instanceof ApiError && error.status < 500) && count < 1,
      staleTime: 15000,
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});

export function useConnectivity() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    let active = true,
      probing = false;
    const probe = async () => {
      if (!navigator.onLine) {
        if (active) setOnline(false);
        return;
      }
      if (probing) return;
      probing = true;
      try {
        await client.request({ operation: "connection" });
        if (active) setOnline(true);
      } catch {
        if (active) setOnline(false);
      } finally {
        probing = false;
      }
    };
    const up = () => {
        void probe();
      },
      down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    void probe();
    const timer = setInterval(up, 15000);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}
