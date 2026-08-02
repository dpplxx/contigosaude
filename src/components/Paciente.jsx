import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, Phone, RefreshCw, Star } from "lucide-react";
import { Card, ErroInline, Tag, TextArea } from "./ui";
import { AgendamentoInfo, ChatThread } from "./Compartilhados";
import { PrototypeWarning } from "./Ethics";
import { BuscaFisios } from "./BuscaFisios";
import { formatarDistancia } from "../lib/geo";
import { avaliar, meusPedidos, registrarClique } from "../lib/api";
import { mensagemDeErro, waLink } from "../lib/utils";

export function RequestForm({ onToast }) {
  return (
    <div className="space-y-4">
      <PrototypeWarning />
      <BuscaFisios />
    </div>
  );
}

function AvaliarFisio({ fisio, onDone }) {
  const [nota, setNota] = useState(0);
  const [comentario, setComentario] = useState("");
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");
  const [open, setOpen] = useState(false);

  const submit = async () => {
    if (nota === 0) return;
    setSaving(true);
    setErro("");
    try {
      await avaliar({ fisioId: fisio.id, nota, comentario });
      setNota(0);
      setComentario("");
      setOpen(false);
      await onDone?.();
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível enviar sua avaliação."));
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs mt-2 underline"
        style={{ color: "var(--muted1)" }}
      >
        Avaliar {fisio.nome}
      </button>
    );
  }

  return (
    <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
      <div className="flex gap-1 mb-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setNota(n)} aria-label={`${n} estrelas`}>
            <Star size={20} fill={n <= nota ? "#E3A873" : "none"} style={{ color: "#E3A873" }} />
          </button>
        ))}
      </div>
      <TextArea
        value={comentario}
        onChange={(e) => setComentario(e.target.value)}
        rows={2}
        placeholder="Comentário (opcional)"
        className="mb-2"
      />
      <ErroInline>{erro}</ErroInline>
      <div className="flex gap-2 mt-2">
        <button
          onClick={submit}
          disabled={nota === 0 || saving}
          className="text-sm px-3 py-1.5 rounded-lg disabled:opacity-50"
          style={{ background: "#C6693D", color: "#14231F" }}
        >
          {saving ? "Enviando..." : "Enviar avaliação"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="text-sm px-3 py-1.5 rounded-lg"
          style={{ color: "var(--muted1)" }}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

export function PatientTracking({ onNotify }) {
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const primeiraChecagem = useRef(true);
  const agendadosAnteriores = useRef(new Set());

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro("");
    try {
      const lista = await meusPedidos();
      setPedidos(lista);
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível carregar seus pedidos."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Avisa quando um pedido que estava só aguardando ganha um agendamento.
  useEffect(() => {
    const idsAtuais = new Set(pedidos.filter((p) => p.agendamento).map((p) => p.id));
    if (primeiraChecagem.current) {
      primeiraChecagem.current = false;
      agendadosAnteriores.current = idsAtuais;
      return;
    }
    idsAtuais.forEach((id) => {
      if (!agendadosAnteriores.current.has(id)) {
        onNotify?.(
          "Seu pedido foi agendado!",
          "Você já pode ver os detalhes e conversar com o fisioterapeuta por aqui."
        );
      }
    });
    agendadosAnteriores.current = idsAtuais;
  }, [pedidos, onNotify]);

  // Sem push de verdade, a aba aberta reconsulta de tempos em tempos.
  useEffect(() => {
    const intervalo = setInterval(carregar, 20000);
    return () => clearInterval(intervalo);
  }, [carregar]);

  if (loading && pedidos.length === 0) {
    return (
      <Card>
        <p className="text-sm" style={{ color: "var(--muted1)" }}>
          Carregando seus pedidos...
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm" style={{ color: "var(--muted1)" }}>
          {pedidos.length === 1 ? "1 pedido encontrado" : `${pedidos.length} pedidos encontrados`}
        </p>
        <button
          onClick={carregar}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border"
          style={{ borderColor: "var(--border-soft)", color: "var(--muted4)" }}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Atualizar
        </button>
      </div>

      <ErroInline>{erro}</ErroInline>

      {!loading && pedidos.length === 0 && !erro && (
        <Card>
          <p className="text-sm" style={{ color: "var(--muted1)" }}>
            Você ainda não fez nenhum pedido. Use a aba "Pedir atendimento" para começar.
          </p>
        </Card>
      )}

      {pedidos.map((r) => {
        const agendamento = r.agendamento;
        const fisio = agendamento?.fisio;
        return (
          <Card key={r.id}>
            <div className="flex flex-wrap gap-2 mb-1">
              <Tag>{r.especialidade}</Tag>
              <Tag>{r.urgencia}</Tag>
            </div>
            <p className="text-sm flex items-center gap-1" style={{ color: "var(--muted1)" }}>
              <MapPin size={13} /> {r.bairro}, {r.cidade}
            </p>
            {!agendamento && (
              <p className="text-sm mt-2" style={{ color: "#E3A873" }}>
                Ainda buscando um fisioterapeuta pra você.
              </p>
            )}
            {agendamento && fisio && (
              <>
                <AgendamentoInfo
                  agendamento={agendamento}
                  otherPartyLabel="Fisioterapeuta"
                  otherPartyName={fisio.nome}
                />
                {fisio.distancia_km != null && (
                  <p
                    className="text-sm mt-1.5 flex items-center gap-1"
                    style={{ color: "#8FAE8B" }}
                  >
                    <MapPin size={13} />
                    {fisio.nome} atende a {formatarDistancia(fisio.distancia_km)} de você
                  </p>
                )}
                {fisio.formacao && (
                  <p className="text-sm mt-1" style={{ color: "var(--muted2)" }}>
                    {fisio.formacao}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-3 mt-2">
                  <a
                    href={waLink(fisio.whatsapp, `Olá ${fisio.nome}, aqui é ${r.nome}.`)}
                    onClick={() => registrarClique(fisio.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg"
                    style={{ background: "#8FAE8B33", color: "#8FAE8B", border: "1px solid #8FAE8B55" }}
                  >
                    <Phone size={12} /> WhatsApp
                  </a>
                </div>
                {agendamento.status === "concluido" && (
                  <AvaliarFisio fisio={fisio} onDone={carregar} />
                )}
                <ChatThread
                  agendamentoId={agendamento.id}
                  remetente="paciente"
                  remetenteNome={r.nome}
                  mensagens={agendamento.mensagens}
                  onSent={carregar}
                />
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
}
