import { useState } from "react";
import { Lock, LogIn } from "lucide-react";
import { Card, ErroInline, Field, PrimaryButton, TextInput } from "./ui";
import { entrar } from "../lib/api";
import { mensagemDeErro } from "../lib/utils";

export function Login({ onEntrou }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErro("");
    try {
      const sessao = await entrar(email, senha);
      onEntrou?.(sessao);
    } catch (e) {
      setErro(
        /Invalid login credentials/i.test(e?.message || "")
          ? "Email ou senha incorretos."
          : mensagemDeErro(e, "Não foi possível entrar.")
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-2 mb-1">
        <Lock size={18} style={{ color: "#E3A873" }} />
        <h2 className="text-lg font-medium">Área restrita</h2>
      </div>
      <p className="text-sm mb-5" style={{ color: "var(--muted1)" }}>
        O Painel e as Métricas mostram nome, telefone e observações clínicas dos pacientes. Entre
        com a sua conta para continuar.
      </p>
      <form onSubmit={submit}>
        <Field label="Email">
          <TextInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@email.com"
            autoComplete="username"
            required
          />
        </Field>
        <Field label="Senha">
          <TextInput
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <ErroInline>{erro}</ErroInline>
        <PrimaryButton type="submit" loading={loading}>
          <LogIn size={16} /> Entrar
        </PrimaryButton>
      </form>
    </Card>
  );
}
