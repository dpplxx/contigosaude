import { useState } from "react";
import {
  Calendar,
  Check,
  Loader2,
  MapPin,
  MessageCircle,
  Send,
} from "lucide-react";
import {
  Card,
  ErroInline,
  Field,
  StatusBadge,
  TextInput,
  inputBase,
} from "./ui";
import { enviarMensagem } from "../lib/api";
import { formatDataHora, mensagemDeErro } from "../lib/utils";
import { cepCompleto, consultarCep, formatarCep } from "../lib/geo";

/**
 * Campo de CEP que preenche cidade, bairro e coordenadas sozinho.
 *
 * Se a consulta falhar, não trava nada: os campos de cidade e bairro ficam
 * editáveis e a pessoa digita na mão. O pedido é salvo do mesmo jeito, só sem
 * a distância exata.
 */
export function CepInput({ valor, onChange, onResolvido, ajuda, label }) {
  const [status, setStatus] = useState("vazio");
  const [erro, setErro] = useState("");

  const consultar = async (bruto) => {
    if (!cepCompleto(bruto)) return;
    setStatus("buscando");
    setErro("");
    try {
      const endereco = await consultarCep(bruto);
      onResolvido?.(endereco);
      setStatus(endereco.lat !== null ? "ok" : "semCoordenada");
    } catch (e) {
      setStatus("erro");
      setErro(
        /não encontrado/i.test(e?.message || "")
          ? "CEP não encontrado. Confira o número ou preencha cidade e bairro abaixo."
          : "Não conseguimos consultar o CEP agora. Preencha cidade e bairro abaixo."
      );
    }
  };

  const aoDigitar = (e) => {
    const formatado = formatarCep(e.target.value);
    onChange(formatado);
    if (status !== "vazio") setStatus("vazio");
    if (cepCompleto(formatado)) consultar(formatado);
  };

  return (
    <Field label={label || "CEP do endereço do atendimento"}>
      <div className="relative">
        <TextInput
          value={valor}
          onChange={aoDigitar}
          onBlur={() => consultar(valor)}
          placeholder="00000-000"
          inputMode="numeric"
          autoComplete="postal-code"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2">
          {status === "buscando" && (
            <Loader2 size={16} className="animate-spin" style={{ color: "#7A8580" }} />
          )}
          {(status === "ok" || status === "semCoordenada") && (
            <Check size={16} style={{ color: "#5E7F5A" }} />
          )}
        </span>
      </div>
      {status === "ok" && (
        <p className="text-xs mt-1.5 flex items-center gap-1" style={{ color: "#8FAE8B" }}>
          <MapPin size={12} /> Endereço localizado.{" "}
          {ajuda || "Usamos isso só para calcular a distância — o endereço exato não aparece para ninguém além da equipe."}
        </p>
      )}
      {status === "semCoordenada" && (
        <p className="text-xs mt-1.5" style={{ color: "var(--muted2)" }}>
          Endereço preenchido, mas não conseguimos a localização exata. O match vai usar cidade e
          bairro.
        </p>
      )}
      {status === "erro" && (
        <p className="text-xs mt-1.5" style={{ color: "#D98C6E" }}>
          {erro}
        </p>
      )}
    </Field>
  );
}

export function AgendamentoInfo({ agendamento, otherPartyLabel, otherPartyName }) {
  return (
    <div className="flex flex-wrap items-center gap-2 mt-2">
      <StatusBadge status={agendamento.status} />
      <span className="text-sm flex items-center gap-1" style={{ color: "var(--muted1)" }}>
        <Calendar size={13} /> {formatDataHora(agendamento.data, agendamento.horario)}
      </span>
      <span className="text-sm" style={{ color: "var(--muted1)" }}>
        · {otherPartyLabel}: {otherPartyName}
      </span>
    </div>
  );
}

export function ChatThread({
  agendamentoId,
  remetente,
  remetenteNome,
  mensagens,
  onSent,
}) {
  const [texto, setTexto] = useState("");
  const [sending, setSending] = useState(false);
  const [erro, setErro] = useState("");

  const thread = [...(mensagens || [])].sort(
    (a, b) => new Date(a.criado_em) - new Date(b.criado_em)
  );

  const send = async () => {
    const t = texto.trim();
    if (!t) return;
    setSending(true);
    setErro("");
    try {
      await enviarMensagem({
        agendamentoId,
        remetente,
        remetenteNome,
        texto: t,
      });
      setTexto("");
      await onSent?.();
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível enviar a mensagem."));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
      <p
        className="text-xs uppercase tracking-wide mb-2 flex items-center gap-1.5"
        style={{ color: "var(--muted1)" }}
      >
        <MessageCircle size={13} /> Conversa
      </p>
      <div className="space-y-2 mb-2 pr-1" style={{ maxHeight: 180, overflowY: "auto" }}>
        {thread.length === 0 && (
          <p className="text-sm" style={{ color: "var(--muted3)" }}>
            Nenhuma mensagem ainda. Diga oi!
          </p>
        )}
        {thread.map((m) => {
          const minha = m.remetente === remetente;
          return (
            <div key={m.id} className={`flex ${minha ? "justify-end" : "justify-start"}`}>
              <div
                className="max-w-[80%] rounded-xl px-3 py-1.5 text-sm"
                style={
                  minha
                    ? { background: "#C6693D", color: "#14231F" }
                    : {
                        background: "var(--card-inner)",
                        color: "var(--text)",
                        border: "1px solid var(--border)",
                      }
                }
              >
                {!minha && <p className="text-xs opacity-70 mb-0.5">{m.remetente_nome}</p>}
                {m.texto}
              </div>
            </div>
          );
        })}
      </div>
      <ErroInline>{erro}</ErroInline>
      <div className="flex gap-2">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Escreva uma mensagem..."
          className={`${inputBase} ficha-input flex-1`}
        />
        <button
          onClick={send}
          disabled={sending || !texto.trim()}
          className="shrink-0 flex items-center justify-center rounded-lg px-3.5 disabled:opacity-50"
          style={{ background: "#C6693D", color: "#14231F" }}
          aria-label="Enviar mensagem"
        >
          {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
}
