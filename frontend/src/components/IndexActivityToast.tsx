import { CircleAlert, CircleCheck, LoaderCircle, X } from "lucide-react";
import { useSyncExternalStore } from "react";

import { useI18n } from "../i18n";
import {
  dismissIndexActivity,
  getIndexActivityState,
  subscribeIndexActivity,
} from "../services/indexActivity";

export function IndexActivityToast() {
  const { t } = useI18n();
  const state = useSyncExternalStore(
    subscribeIndexActivity,
    getIndexActivityState,
    getIndexActivityState,
  );

  if (state.status === "idle") return null;

  const isRunning = state.status === "running";
  const isError = state.status === "error";
  const title = isRunning
    ? t("indexActivity.buildingTitle")
    : isError
      ? t("indexActivity.errorTitle")
      : t("indexActivity.successTitle", { chunks: state.indexedChunks });
  const detail = isRunning
    ? t("indexActivity.buildingDetail")
    : isError
      ? state.message
      : t("indexActivity.successDetail");

  return (
    <aside
      className={`index-activity-toast ${state.status}`}
      role={isError ? "alert" : "status"}
      aria-label={title}
      aria-live={isError ? "assertive" : "polite"}
    >
      <span className="index-activity-icon" aria-hidden="true">
        {isRunning ? <LoaderCircle size={21} /> : null}
        {state.status === "success" ? <CircleCheck size={21} /> : null}
        {isError ? <CircleAlert size={21} /> : null}
      </span>
      <span className="index-activity-copy">
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      {!isRunning ? (
        <button
          type="button"
          className="index-activity-dismiss"
          aria-label={t("indexActivity.dismiss")}
          onClick={dismissIndexActivity}
        >
          <X size={16} aria-hidden />
        </button>
      ) : null}
    </aside>
  );
}
