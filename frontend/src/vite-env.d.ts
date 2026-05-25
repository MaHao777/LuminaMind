/// <reference types="vite/client" />

interface Window {
  luminaDesktop?: {
    chooseVaultDirectory: () => Promise<string | null>;
  };
}
