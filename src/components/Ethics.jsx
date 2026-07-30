import { useState } from "react";
import { X } from "lucide-react";
import { Card } from "./ui";

export function EthicsModal({ isOpen, onClose, title, children }) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={onClose}
    >
      <Card
        className="relative max-w-lg w-full max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-medium" style={{ color: "var(--text)" }}>
            {title}
          </h3>
          <button
            onClick={onClose}
            className="shrink-0 p-1 hover:opacity-70"
            style={{ color: "var(--muted1)" }}
          >
            <X size={20} />
          </button>
        </div>

        <div
          className="text-sm space-y-2 whitespace-pre-wrap mb-4"
          style={{ color: "var(--muted1)", lineHeight: 1.6 }}
        >
          {children}
        </div>

        <button
          onClick={onClose}
          className="w-full rounded-lg py-2 font-medium"
          style={{ background: "#C6693D", color: "#14231F" }}
        >
          Li e entendi
        </button>
      </Card>
    </div>
  );
}

export function EthicalCheckbox({
  id,
  label,
  checked,
  onChange,
  modalContent,
  modalTitle,
}) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <div className="flex items-start gap-3 mb-3">
        <input
          type="checkbox"
          id={id}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1 shrink-0 w-4 h-4 rounded"
          style={{ accentColor: "#C6693D" }}
        />
        <label htmlFor={id} className="text-sm" style={{ color: "var(--muted1)" }}>
          {label}{" "}
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="underline hover:opacity-75 transition-opacity"
            style={{ color: "#E3A873" }}
          >
            (ler documento)
          </button>
        </label>
      </div>

      <EthicsModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={modalTitle}
      >
        {modalContent}
      </EthicsModal>
    </>
  );
}

export function PrototypeWarning() {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div
          className="text-lg shrink-0 mt-0.5"
          style={{ lineHeight: 1 }}
        >
          ⚠️
        </div>
        <div className="text-sm" style={{ color: "var(--muted1)" }}>
          <p className="font-medium mb-1">Este é um protótipo em desenvolvimento</p>
          <p>
            Os dados registrados aqui são públicos para fins de teste. <strong>Não compartilhe dados reais de pacientes</strong> ou informações sensíveis de saúde.
          </p>
          <p className="text-xs mt-2" style={{ color: "var(--muted2)" }}>
            Quando a plataforma entrar em produção, todos os dados serão migrados para um ambiente seguro com autenticação individual e conformidade LGPD.
          </p>
        </div>
      </div>
    </Card>
  );
}
