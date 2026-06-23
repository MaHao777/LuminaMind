import { Sparkles } from "lucide-react";

import { useI18n } from "../i18n";

const menuKeys = [
  "app.menuFile",
  "app.menuEdit",
  "app.menuView",
  "app.menuHelp",
] as const;

export function AppTitlebar() {
  const { t } = useI18n();

  return (
    <header className="app-titlebar" role="banner" aria-label={t("app.titlebar")}>
      <div className="app-titlebar-brand" aria-hidden="true">
        <Sparkles size={16} />
        <span>LuminaMind</span>
      </div>
      <nav className="app-titlebar-menu" aria-label={t("app.titlebarMenu")}>
        {menuKeys.map((key) => (
          <button type="button" key={key}>
            {t(key)}
          </button>
        ))}
      </nav>
    </header>
  );
}
