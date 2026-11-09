import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Banner, toast } from "@/components/ui/shared";
import { apiPatch } from "@/lib/api";
import type { Club, FeedSignup } from "@/lib/types";

const OPTIONS: FeedSignup[] = ["off", "internal", "public"];

/** "Beitritt über Feeds" (admins): who may become a member by opening a feed. Saves on change. */
export function FeedSignupSection({ club }: { club: Club }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const value = club.feedSignup ?? "internal";

  async function choose(next: FeedSignup) {
    if (next === value || saving) return;
    setSaving(true);
    setFailed(false);
    try {
      await apiPatch(`/api/clubs/${club.id}`, { feedSignup: next });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["club", club.id] }),
        qc.invalidateQueries({ queryKey: ["clubs"] }),
      ]);
      toast.success(t("club.feedSignup.saved"));
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="ap-panel" aria-labelledby="cl-fs-h">
      <div className="ap-panel-head">
        <div>
          <h2 className="t-h2" id="cl-fs-h">
            {t("club.feedSignup.title")}
          </h2>
          <p>{t("club.feedSignup.text")}</p>
        </div>
      </div>
      {failed && <Banner tone="danger">{t("club.feedSignup.failed")}</Banner>}
      <fieldset className="ap-fieldset" disabled={saving}>
        <legend className="ap-sr">{t("club.feedSignup.title")}</legend>
        <div className="ap-stack ap-stack--sm">
          {OPTIONS.map((o) => (
            <label key={o} className="ap-optionrow" style={{ alignItems: "flex-start" }}>
              <input
                type="radio"
                name="cl-feed-signup"
                value={o}
                checked={value === o}
                onChange={() => void choose(o)}
              />
              <span className="ap-stack ap-stack--sm">
                <b className="t-h3">{t(`club.feedSignup.${o}.label`)}</b>
                <span className="t-sm">{t(`club.feedSignup.${o}.text`)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  );
}
