import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Disclosure } from "@/components/ui/shared";
import { ConsentHistoryList, ConsentVersionModal } from "@/components/legal/ConsentHistoryList";
import { LegalLinks } from "@/components/legal/LegalLinks";
import type { ConsentRecord } from "@/lib/legal";

/**
 * "Legal & consents" panel: current documents and the history of accepted versions. A collapsed native
 * `<details>`; the history is requested only once the section was opened.
 */
export function LegalSection() {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);
  const [viewing, setViewing] = useState<ConsentRecord | null>(null);

  return (
    <section className="ap-panel" aria-labelledby="pr-legal">
      <Disclosure
        title={
          <span className="t-h2" id="pr-legal">
            {t("profile.legal.title")}
          </span>
        }
        onToggle={(open) => {
          if (open) setOpened(true);
        }}
      >
        <div className="ap-stack" style={{ marginTop: 12 }}>
          <p>{t("profile.legal.text")}</p>
          <h3 className="t-h3">{t("profile.legal.current")}</h3>
          <LegalLinks />
          <h3 className="t-h3">{t("profile.legal.history")}</h3>
          <ConsentHistoryList enabled={opened} onView={setViewing} />
        </div>
      </Disclosure>
      {viewing && <ConsentVersionModal record={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}
