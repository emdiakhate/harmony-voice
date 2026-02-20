import { Globe } from "lucide-react";

const LANGUAGES = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "de", label: "Deutsch" },
  { code: "pt", label: "Português" },
  { code: "it", label: "Italiano" },
  { code: "ar", label: "العربية" },
  { code: "zh", label: "中文" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "ru", label: "Русский" },
  { code: "hi", label: "हिन्दी" },
];

interface LanguageSelectorProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  showAuto?: boolean;
}

const LanguageSelector = ({ label, value, onChange, showAuto }: LanguageSelectorProps) => {
  return (
    <div className="flex-1">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
        {label}
      </label>
      <div className="relative">
        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full pl-10 pr-4 py-3 rounded-lg bg-muted border border-border text-foreground text-sm appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
        >
          {showAuto && <option value="auto">🔍 Détection auto</option>}
          {LANGUAGES.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};

export default LanguageSelector;
