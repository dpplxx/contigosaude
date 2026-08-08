import { useEffect, useState } from "react";
import { KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { Card, Field, PrimaryButton, TextInput } from "./ui";
import {
  confirmarEnrolamento,
  desafiarLogin,
  desativarFator,
  iniciarEnrolamento,
  listarFatores,
  statusMfa,
} from "../lib/mfa";
import { mensagemDeErro } from "../lib/utils";

// Tela mostrada logo depois da senha, só quando a conta já tem um fator de
// MFA verificado — sem isso o login para em aal1 e as funções que exigem
// aal2 (painel do admin, painel do fisio) recusam com "sem permissão".
export function MfaChallenge({ onVerificado, onCancelar }) {
  const [fatores, setFatores] = useState([]);
  const [codigo, setCodigo] = useState("");
  const [loading, setLoading] = useState(true);
  const [verificando, setVerificando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let ativo = true;
    listarFatores()
      .then((lista) => {
        if (ativo) setFatores(lista.filter((f) => f.status === "verified"));
      })
      .catch((e) =>
        setErro(mensagemDeErro(e, "Não foi possível carregar a verificação em duas etapas."))
      )
      .finally(() => {
        if (ativo) setLoading(false);
      });
    return () => {
      ativo = false;
    };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    const fator = fatores[0];
    if (!fator) return;
    setVerificando(true);
    setErro("");
    try {
      await desafiarLogin({ factorId: fator.id, codigo });
      onVerificado?.();
    } catch (e) {
      setErro(mensagemDeErro(e, "Código inválido. Confira o app autenticador e tente de novo."));
    } finally {
      setVerificando(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <p className="text-sm" style={{ color: "var(--muted1)" }}>
          Verificando sua conta...
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center gap-2 mb-1">
        <KeyRound size={18} style={{ color: "#16C4A8" }} />
        <h2 className="text-lg font-medium">Verificação em duas etapas</h2>
      </div>
      <p className="text-sm mb-5" style={{ color: "var(--muted1)" }}>
        Abra seu app autenticador (Google Authenticator, Authy, 1Password etc.) e digite o código
        de 6 dígitos.
      </p>
      <form onSubmit={submit}>
        <Field label="Código">
          <TextInput
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
            placeholder="000000"
            autoFocus
            required
          />
        </Field>
        {erro && (
          <p className="text-xs mb-3" style={{ color: "#C24A3E" }}>
            {erro}
          </p>
        )}
        <PrimaryButton type="submit" loading={verificando} disabled={codigo.length !== 6}>
          Confirmar
        </PrimaryButton>
        {onCancelar && (
          <button
            type="button"
            onClick={onCancelar}
            className="text-sm underline w-full text-center mt-3"
            style={{ color: "var(--muted1)" }}
          >
            Sair e usar outra conta
          </button>
        )}
      </form>
    </Card>
  );
}

// Painel de configuração: liga/desliga a verificação em duas etapas pra
// quem já está com sessão ativa (admin no Painel, fisio no próprio
// cadastro). Mostrado só pra quem faz sentido ativar — ver os pontos de
// uso em Painel.jsx e Fisio.jsx.
export function MfaConfiguracao({ onToast }) {
  const [carregando, setCarregando] = useState(true);
  const [ativo, setAtivo] = useState(false);
  const [fatorAtivo, setFatorAtivo] = useState(null);
  const [enrolando, setEnrolando] = useState(false);
  const [enrolamento, setEnrolamento] = useState(null);
  const [codigo, setCodigo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const carregar = async () => {
    setCarregando(true);
    setErro("");
    try {
      const [status, fatores] = await Promise.all([statusMfa(), listarFatores()]);
      setAtivo(status.ativo);
      setFatorAtivo(fatores.find((f) => f.status === "verified") || null);
    } catch (e) {
      setErro(
        mensagemDeErro(e, "Não foi possível carregar o status da verificação em duas etapas.")
      );
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const iniciar = async () => {
    setErro("");
    setEnrolando(true);
    try {
      const dados = await iniciarEnrolamento();
      setEnrolamento(dados);
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível iniciar a configuração."));
      setEnrolando(false);
    }
  };

  const confirmar = async (e) => {
    e.preventDefault();
    setSalvando(true);
    setErro("");
    try {
      await confirmarEnrolamento({ factorId: enrolamento.id, codigo });
      setEnrolamento(null);
      setEnrolando(false);
      setCodigo("");
      onToast?.("Verificação em duas etapas ativada!");
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e, "Código inválido. Confira o app autenticador e tente de novo."));
    } finally {
      setSalvando(false);
    }
  };

  const desativar = async () => {
    if (!fatorAtivo) return;
    if (!window.confirm("Desativar a verificação em duas etapas desta conta?")) return;
    setSalvando(true);
    setErro("");
    try {
      await desativarFator(fatorAtivo.id);
      onToast?.("Verificação em duas etapas desativada.");
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível desativar agora."));
    } finally {
      setSalvando(false);
    }
  };

  if (carregando) return null;

  return (
    <Card>
      <div className="flex items-center gap-2 mb-1">
        {ativo ? (
          <ShieldCheck size={18} style={{ color: "#2FAE72" }} />
        ) : (
          <ShieldOff size={18} style={{ color: "var(--muted1)" }} />
        )}
        <h2 className="text-lg font-medium">Verificação em duas etapas</h2>
      </div>
      <p className="text-sm mb-4" style={{ color: "var(--muted1)" }}>
        {ativo
          ? "Ativada. Além da senha, o login pede um código do app autenticador."
          : "Adiciona uma segunda etapa no login, além da senha — recomendado porque esta conta acessa dados de pacientes."}
      </p>

      {erro && (
        <p className="text-xs mb-3" style={{ color: "#C24A3E" }}>
          {erro}
        </p>
      )}

      {!enrolando &&
        (ativo ? (
          <button
            onClick={desativar}
            disabled={salvando}
            className="text-sm px-3 py-1.5 rounded-lg border disabled:opacity-60"
            style={{ borderColor: "var(--border)", color: "#C24A3E" }}
          >
            {salvando ? "Desativando..." : "Desativar"}
          </button>
        ) : (
          <PrimaryButton onClick={iniciar} type="button">
            Ativar verificação em duas etapas
          </PrimaryButton>
        ))}

      {enrolamento && (
        <form onSubmit={confirmar} className="mt-4 space-y-4">
          <p className="text-sm" style={{ color: "var(--muted1)" }}>
            Escaneie o código com o app autenticador (Google Authenticator, Authy, 1Password etc.)
            e digite o código de 6 dígitos gerado.
          </p>
          <img
            src={enrolamento.totp.qr_code}
            alt="QR code para configurar o app autenticador"
            className="w-40 h-40"
          />
          <p className="text-xs break-all" style={{ color: "var(--muted1)" }}>
            Não consegue escanear? Digite manualmente: <code>{enrolamento.totp.secret}</code>
          </p>
          <Field label="Código de 6 dígitos">
            <TextInput
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              autoFocus
              required
            />
          </Field>
          <div className="flex gap-2">
            <PrimaryButton type="submit" loading={salvando} disabled={codigo.length !== 6}>
              Confirmar e ativar
            </PrimaryButton>
            <button
              type="button"
              onClick={() => {
                setEnrolamento(null);
                setEnrolando(false);
                setCodigo("");
              }}
              className="text-sm px-3 py-1.5 rounded-lg border"
              style={{ borderColor: "var(--border)", color: "var(--muted1)" }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
