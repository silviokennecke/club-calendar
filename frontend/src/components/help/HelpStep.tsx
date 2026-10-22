import { useState, type ReactNode } from "react";

interface HelpStepProps {
  src: string;
  alt: string;
  children: ReactNode;
}

/** One numbered step (the `<ol>` numbers it); the screenshot is optional and vanishes when missing. */
export function HelpStep({ src, alt, children }: HelpStepProps) {
  const [failed, setFailed] = useState(false);
  return (
    <li className="mb-6">
      <p className="m-0">{children}</p>
      {!failed && (
        <figure className="m-0 mt-3">
          <img
            src={src}
            alt={alt}
            loading="lazy"
            width={1170}
            height={820}
            style={{ aspectRatio: "1170 / 820" }}
            className="border-border h-auto w-full max-w-[420px] rounded-lg border"
            onError={() => setFailed(true)}
          />
        </figure>
      )}
    </li>
  );
}
