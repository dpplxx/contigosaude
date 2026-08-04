import { useEffect, useState } from "react";
import { CheckCircle2, MapPin, Stethoscope } from "lucide-react";
import { Card, ErroInline, StarInput, StatusBadge, TextArea, Vazio } from "./ui";
import { avaliar, meusPedidos } from "../lib/api";
import { dataMaisDias, diasDesdeData, formatDataHora, mensagemDeErro } from "../lib/utils";
import { trackEvent, Events } from "../lib/analytics";

export function AvaliarAtendimento({ agendamento, onAvaliado, comBorda = true }) {
  const [nota, setNota] = useState(0);
  const [comentario, setComentario] = useState("");
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");
  const [enviado, setEnviado] = useState(false);

  const enviar = async () => {
    if (nota === 0) return;
    setSaving(true);
    setErro("");
    try {
      await avaliar({ fisioId: agendamento.fisio.id, nota, comentario });
      trackEvent(Events.REVIEW_SUBMITTED, { fisio_id: agendamento.fisio.id, nota });
      setEnviado(true);
      onAvaliado?.();
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível enviar sua avaliação."));
    } finally {
      setSaving(false);
    }
  };

  if (enviado) {
    return (
      <p className="text-sm flex items-center gap-1.5 mt-3" style={{ color: "#1F7A50" }}>
        <CheckCircle2 size={15} /> Avaliação enviada — obrigado!
      </p>
    );
  }

  return (
    <div
      className={comBorda ? "mt-3 pt-3" : ""}
      style={comBorda ? { borderTop: "1px solid var(--border)" } : undefined}
    >
      <p className="text-sm mb-2" style={{ color: "var(--muted1)" }}>
        Como foi o atendimento com {agendamento.fisio.nome}?
      </p>
      <StarInput value={nota} onChange={setNota} />
      <TextArea
        value={comentario}
        onChange={(e) => setComentario(e.target.value)}
        rows={2}
        placeholder="Conte como foi (opcional)"
        className="mt-2 mb-2 text-sm"
      />
      <ErroInline>{erro}</ErroInline>
      <button
        onClick={enviar}
        disabled={nota === 0 || saving}
        className="text-sm px-4 py-1.5 rounded-full disabled:opacity-50"
        style={{ background: "#009E86", color: "#FFFFFF" }}
      >
        {saving ? "Enviando..." : "Enviar avaliação"}
      </button>
    </div>
  );
}

function CartaPedido({ pedido, onAvaliado }) {
  const ag = pedido.agendamento;
  return (
    <Card>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            {pedido.especialidade}
          </p>
          <p className="text-xs flex items-center gap-1 mt-0.5" style={{ color: "var(--muted3)" }}>
            <MapPin size={12} />
            {pedido.bairro ? `${pedido.bairro}, ` : ""}
            {pedido.cidade}
          </p>
        </div>
        {ag ? (
          <StatusBadge status={ag.status} />
        ) : (
          <span className="text-xs shrink-0" style={{ color: "var(--muted3)" }}>
            {pedido.status === "ativo" ? "Buscando profissional" : "Arquivado"}
          </span>
        )}
      </div>

      {!ag && <Vazio>Ainda estamos buscando um profissional pra esse pedido.</Vazio>}

      {ag && (
        <>
          <p className="text-sm flex items-center gap-1.5 mt-2" style={{ color: "var(--muted1)" }}>
            <Stethoscope size={14} /> {ag.fisio.nome} — {formatDataHora(ag.data, ag.horario)}
          </p>

          {ag.status === "concluido" && !ag.avaliado && diasDesdeData(ag.data) >= 7 && (
            <AvaliarAtendimento agendamento={ag} onAvaliado={onAvaliado} />
          )}
          {ag.status === "concluido" && !ag.avaliado && diasDesdeData(ag.data) < 7 && (
            <p className="text-xs mt-3" style={{ color: "var(--muted3)" }}>
              Você poderá avaliar esse atendimento a partir de {dataMaisDias(ag.data, 7)}.
            </p>
          )}
          {ag.status === "concluido" && ag.avaliado && (
            <p className="text-sm flex items-center gap-1.5 mt-3" style={{ color: "#1F7A50" }}>
              <CheckCircle2 size={15} /> Você já avaliou este atendimento.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

export function MeusAtendimentos() {
  const [pedidos, setPedidos] = useState(null);
  const [erro, setErro] = useState("");

  const carregar = async () => {
    try {
      setErro("");
      setPedidos(await meusPedidos());
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível carregar seus atendimentos."));
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  if (erro) {
    return (
      <Card>
        <ErroInline>{erro}</ErroInline>
      </Card>
    );
  }

  if (pedidos === null) {
    return (
      <Card>
        <Vazio>Carregando seus atendimentos...</Vazio>
      </Card>
    );
  }

  if (pedidos.length === 0) {
    return (
      <Card>
        <Vazio>Você ainda não fez nenhum pedido de atendimento.</Vazio>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {pedidos.map((p) => (
        <CartaPedido key={p.id} pedido={p} onAvaliado={carregar} />
      ))}
    </div>
  );
}
