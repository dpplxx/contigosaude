import { useState } from "react";
import { CheckCircle2, Loader2, Star, AlertCircle } from "lucide-react";
import { formatarTelefone, STATUS_LABEL } from "../lib/utils";

export const inputBase =
  "w-full rounded-lg px-3.5 py-2.5 text-[15px] outline-none transition-colors border";

export function Field({ label, children }) {
  return (
    <label className="block mb-4">
      <span className="block text-sm mb-1.5 tracking-wide" style={{ color: "var(--muted1)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

export function TextInput(props) {
  return <input {...props} className={`${inputBase} ficha-input`} />;
}

export function SelectInput({ children, ...props }) {
  return (
    <select {...props} className={`${inputBase} ficha-input`}>
      {children}
    </select>
  );
}

export function TextArea({ className = "", ...props }) {
  return (
    <textarea {...props} className={`${inputBase} resize-none ficha-input ${className}`} />
  );
}

export function PhoneInput({ value, onChange, ...props }) {
  const handleChange = (e) => {
    onChange({ target: { value: formatarTelefone(e.target.value) } });
  };
  return (
    <TextInput
      value={value}
      onChange={handleChange}
      inputMode="tel"
      placeholder="(11) 91234-5678"
      {...props}
    />
  );
}

export function TagInput({ value, onChange, placeholder }) {
  const [draft, setDraft] = useState("");

  const addTag = () => {
    const t = draft.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft("");
  };

  const removeTag = (t) => onChange(value.filter((x) => x !== t));

  return (
    <div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {value.map((t) => (
            <span
              key={t}
              className="flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-full"
              style={{ background: "#009E8622", color: "#007F6C", border: "1px solid #009E8655" }}
            >
              {t}
              <button
                type="button"
                onClick={() => removeTag(t)}
                aria-label={`Remover ${t}`}
                className="leading-none"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addTag();
          }
        }}
        onBlur={addTag}
        placeholder={placeholder}
        className={`${inputBase} ficha-input`}
      />
    </div>
  );
}

export function PrimaryButton({ children, loading, ...props }) {
  return (
    <button
      {...props}
      disabled={loading || props.disabled}
      className="w-full flex items-center justify-center gap-2 rounded-full py-3 font-semibold text-[15px] transition-transform active:scale-[0.99] disabled:opacity-60"
      style={{ background: "#009E86", color: "#FFFFFF" }}
    >
      {loading ? <Loader2 size={18} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

export function Card({ children }) {
  return (
    <div
      className="rounded-2xl p-5 sm:p-6 border"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
    >
      {children}
    </div>
  );
}

export function InnerRow({ children }) {
  return (
    <div
      className="flex items-center justify-between gap-2 rounded-lg px-3 py-2"
      style={{ background: "var(--card-inner)", border: "1px solid var(--border)" }}
    >
      {children}
    </div>
  );
}

export function Tag({ children }) {
  return (
    <span
      className="inline-block text-xs px-2 py-0.5 rounded-full border"
      style={{ borderColor: "var(--border-soft)", color: "var(--muted4)" }}
    >
      {children}
    </span>
  );
}

export function NovoBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full"
      style={{ background: "#16C4A8", color: "#003B32" }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#003B32" }} />
      Novo
    </span>
  );
}

export function StatusBadge({ status }) {
  const colors = {
    agendado: { bg: "#16C4A833", fg: "#0F7A67", bd: "#16C4A855" },
    concluido: { bg: "#2FAE7233", fg: "#1F7A50", bd: "#2FAE7255" },
    cancelado: { bg: "#E2685C22", fg: "#C24A3E", bd: "#E2685C55" },
  };
  const c = colors[status] || colors.agendado;
  return (
    <span
      className="inline-block text-xs px-2 py-0.5 rounded-full border"
      style={{ background: c.bg, color: c.fg, borderColor: c.bd }}
    >
      {STATUS_LABEL[status] || status}
    </span>
  );
}

export function StarRow({ value, size = 14 }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          fill={n <= Math.round(value) ? "#16C4A8" : "none"}
          style={{ color: "#16C4A8" }}
        />
      ))}
    </div>
  );
}

export function StarInput({ value, onChange, size = 26 }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-label={`${n} estrela${n > 1 ? "s" : ""}`}
          className="p-0.5"
        >
          <Star size={size} fill={n <= value ? "#16C4A8" : "none"} style={{ color: "#16C4A8" }} />
        </button>
      ))}
    </div>
  );
}

export function ErroInline({ children }) {
  if (!children) return null;
  return (
    <p className="text-sm mb-3 flex items-start gap-1.5" style={{ color: "#C24A3E" }}>
      <AlertCircle size={15} className="shrink-0 mt-0.5" />
      <span>{children}</span>
    </p>
  );
}

export function Vazio({ children }) {
  return (
    <p className="text-sm" style={{ color: "var(--muted3)" }}>
      {children}
    </p>
  );
}

export function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-semibold transition-colors"
      style={
        active
          ? { background: "#009E86", color: "#FFFFFF" }
          : { background: "transparent", color: "var(--muted1)", border: "1px solid var(--border)" }
      }
    >
      {children}
    </button>
  );
}

export function RoleButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-semibold transition-colors"
      style={
        active
          ? { background: "#009E86", color: "#FFFFFF" }
          : { background: "var(--card)", color: "var(--muted1)", border: "1px solid var(--border)" }
      }
    >
      {children}
    </button>
  );
}

export function ToastContainer({ toasts }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 items-end">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast-item flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg"
          style={
            t.tipo === "erro"
              ? { background: "#E2685C", color: "#FFFFFF" }
              : { background: "#009E86", color: "#FFFFFF" }
          }
        >
          {t.tipo === "erro" ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
          {t.msg}
        </div>
      ))}
    </div>
  );
}
