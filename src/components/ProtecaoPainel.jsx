import { useState } from "react";
import { Lock } from "lucide-react";
import { Card, PrimaryButton, TextInput } from "./ui";

export function ProtecaoPainel({ onDesbloqueado }) {
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [tentativas, setTentativas] = useState(0);

  const SENHA_PAINEL = import.meta.env.VITE_PAINEL_PASSWORD;
  const MAX_TENTATIVAS = 5;

  const handleSubmit = (e) => {
    e.preventDefault();
    setErro("");

    if (tentativas >= MAX_TENTATIVAS) {
      setErro("Muitas tentativas. Tente novamente em alguns minutos.");
      return;
    }

    if (senha === SENHA_PAINEL) {
      sessionStorage.setItem("painel_desbloqueado", "true");
      onDesbloqueado?.();
    } else {
      setTentativas((t) => t + 1);
      setErro(
        `Senha incorreta. Tentativas restantes: ${MAX_TENTATIVAS - tentativas - 1}`
      );
      setSenha("");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <div className="flex items-center justify-center mb-4">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center"
            style={{ background: "rgba(227, 168, 115, 0.15)" }}
          >
            <Lock size={24} style={{ color: "#E3A873" }} />
          </div>
        </div>

        <h2 className="text-lg font-medium text-center mb-2">Área Restrita</h2>
        <p
          className="text-sm text-center mb-6"
          style={{ color: "var(--muted1)" }}
        >
          Digite a senha para acessar o painel de gestão.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-medium" style={{ color: "var(--muted)" }}>
              Senha
            </label>
            <TextInput
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="••••••••"
              disabled={tentativas >= MAX_TENTATIVAS}
            />
          </div>

          {erro && (
            <div style={{ color: "#D98C6E", fontSize: "0.875rem" }}>
              {erro}
            </div>
          )}

          <PrimaryButton
            type="submit"
            disabled={tentativas >= MAX_TENTATIVAS || !senha}
            className="w-full"
          >
            Desbloquear
          </PrimaryButton>
        </form>

        <p
          className="text-xs text-center mt-4"
          style={{ color: "var(--muted2)" }}
        >
          🔒 Esta área contém dados sensíveis de pacientes. Acesso protegido por LGPD.
        </p>
      </Card>
    </div>
  );
}
