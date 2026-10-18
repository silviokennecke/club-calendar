import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LangSwitch, Logo } from "@/components/ui/shared";
import { usePublicHead } from "./usePublicHead";

interface PublicShellProps {
  /** Document title (without the secret). */
  title?: string;
  /** `feed.indexable`; missing (loading, errors) means noindex. */
  indexable?: boolean;
  /** Name shown in the brand row (the club); defaults to the generic "Öffentlicher Kalender". */
  brand?: string;
  /** Content of the page header below the brand row (title, actions). */
  hero?: ReactNode;
  children: ReactNode;
}

/**
 * Frame of the public pages (design: Public.dc.html): skip link, brand row with language switch
 * (no account needed), page header, `<main>` and footer. No app navigation.
 */
export function PublicShell({ title, indexable, brand, hero, children }: PublicShellProps) {
  const { t } = useTranslation();
  usePublicHead({ title: title ?? t("feed.brand"), indexable });

  return (
    <div className="ap pub">
      <a className="ap-skip cc-btn cc-btn--primary" href="#main">
        {t("shell.skipToContent")}
      </a>
      <header className="pub-head">
        <div className="pub-wrap">
          <div className="pub-topbar">
            <div className="pub-brandrow">
              <Logo variant="mark" size={28} />
              <span>{brand ?? t("feed.brand")}</span>
            </div>
            <div className="pub-tools">
              <LangSwitch />
            </div>
          </div>
          {hero}
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <div className="pub-wrap">{children}</div>
      </main>
      <footer className="pub-wrap">
        <div className="pub-foot">
          <span>{t("feed.footer")}</span>
          <Logo variant="mark" size={24} />
        </div>
      </footer>
    </div>
  );
}
