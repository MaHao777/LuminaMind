/// <reference types="vite/client" />

interface Window {
  luminaDesktop?: {
    chooseVaultDirectory: () => Promise<string | null>;
    getApiBaseUrl?: () => string | null;
    setTitlebarTheme?: (theme: "default" | "dark" | "warm") => Promise<void>;
  };
}
