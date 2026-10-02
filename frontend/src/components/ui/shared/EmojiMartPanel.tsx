// Lazily loaded by EmojiPicker: wraps emoji-mart with bundled data/i18n (no CDN fetch at runtime).
import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";
import deI18n from "@emoji-mart/data/i18n/de.json";
import enI18n from "@emoji-mart/data/i18n/en.json";

interface Props {
  language: string;
  theme: "light" | "dark";
  onSelect: (native: string) => void;
}

export default function EmojiMartPanel({ language, theme, onSelect }: Props) {
  return (
    <Picker
      data={data}
      i18n={language.startsWith("de") ? deI18n : enI18n}
      theme={theme}
      onEmojiSelect={(e: { native: string }) => onSelect(e.native)}
      previewPosition="none"
      skinTonePosition="none"
      navPosition="bottom"
      perLine={8}
      maxFrequentRows={1}
    />
  );
}
