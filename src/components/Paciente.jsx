import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Heart,
  MapPin,
  Phone,
  RefreshCw,
  Star,
} from "lucide-react";
import {
  Card,
  ErroInline,
  Field,
  InnerRow,
  PhoneInput,
  PrimaryButton,
  SelectInput,
  Tag,
  TextArea,
  TextInput,
} from "./ui";
import { AgendamentoInfo, CepInput, ChatThread, PhoneGate } from "./Compartilhados";
import { EthicalCheckbox, PrototypeWarning } from "./Ethics";
import { BuscaFisios } from "./BuscaFisios";
import { formatarDistancia } from "../lib/geo";
import { avaliar, criarPedido, meusPedidos, registrarClique } from "../lib/api";
import {
  ESPECIALIDADES_PACIENTE,
  URGENCIAS,
  mensagemDeErro,
  waLink,
} from "../lib/utils";
import { POLITICA_PRIVACIDADE, TERMOS_DE_USO } from "../lib/termos";

const FAVORITOS_KEY = "fisio-em-casa:favoritos";

function lerFavoritos() {
  try {
    const bruto = localStorage.getItem(FAVORITOS_KEY);
    return bruto ? JSON.parse(bruto) : [];
  } catch {
    return [];
  }
}

function gravarFavoritos(lista) {
  try {
    localStorage.setItem(FAVORITOS_KEY, JSON.stringify(lista));
  } catch {
    // Navegador em modo privado pode bloquear; favoritar é opcional.
  }
}

const REQUEST_INITIAL = {
  nome: "",
  whatsapp: "",
  especialidade: ESPECIALIDADES_PACIENTE[0],
  cep: "",
  cidade: "",
  bairro: "",
  uf: "",
  lat: null,
  lng: null,
  urgencia: URGENCIAS[0],
  observacoes: "",
  concordaTermos: false,
  concordaCompartilhamento: false,
};

function PedidoEnviado({ fisiosProximos, onNovoPedido }) {
  return (
    <Card>
      <div className="flex items-center gap-2 mb-2">
        <CheckCircle2 size={20} style={{ color: "#8FAE8B" }} />
        <h2 className="text-lg font-medium">Pedido enviado!</h2>
      </div>
      {fisiosProximos > 0 ? (
        <p className="text-sm" style={{ color: "var(--muted1)" }}>
          {fisiosProximos === 1
            ? "1 fisioterapeuta atende a sua região."
            : `${fisiosProximos} fisioterapeutas atendem a sua região.`}{" "}
          A equipe vai entrar em contato pelo WhatsApp para confirmar o horário.
        </p>
      ) : (
        <p className="text-sm" style={{ color: "var(--muted1)" }}>
          Ainda não temos um profissional cadastrado na sua região, mas seu pedido ficou registrado.
          Assim que alguém atender a sua área, a equipe entra em contato.
        </p>
      )}
      <p className="text-sm mt-3" style={{ color: "var(--muted2)" }}>
        Você pode acompanhar o andamento na aba "Acompanhar meu pedido", usando o mesmo WhatsApp.
      </p>
      <button
        onClick={onNovoPedido}
        className="text-sm underline mt-4"
        style={{ color: "#E3A873" }}
      >
        Fazer outro pedido
      </button>
    </Card>
  );
}

export function RequestForm({ onToast }) {
  return (
    <div className="space-y-4">
      <PrototypeWarning />
      <BuscaFisios />
    </div>
  );
}

function AvaliarFisio({ fisio, whatsapp, onDone }) {
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
      await avaliar({ fisioId: fisio.id, nota, comentario, whatsapp });
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
  const [whatsapp, setWhatsapp] = useState("");
  const [entered, setEntered] = useState(false);
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");
  const [favoritos, setFavoritos] = useState(lerFavoritos);
  const primeiraChecagem = useRef(true);
  const agendadosAnteriores = useRef(new Set());

  const carregar = useCallback(async () => {
    if (!whatsapp) return;
    setLoading(true);
    setErro("");
    try {
      const lista = await meusPedidos(whatsapp);
      setPedidos(lista);
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível carregar seus pedidos."));
    } finally {
      setLoading(false);
    }
  }, [whatsapp]);

  useEffect(() => {
    if (entered) carregar();
  }, [entered, carregar]);

  // Avisa quando um pedido que estava só aguardando ganha um agendamento.
  useEffect(() => {
    if (!entered) return;
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
  }, [pedidos, entered, onNotify]);

  // Sem push de verdade, a aba aberta reconsulta de tempos em tempos.
  useEffect(() => {
    if (!entered) return;
    const intervalo = setInterval(carregar, 20000);
    return () => clearInterval(intervalo);
  }, [entered, carregar]);

  const toggleFavorito = (fisio) => {
    const jaTem = favoritos.some((f) => f.id === fisio.id);
    const atual = jaTem
      ? favoritos.filter((f) => f.id !== fisio.id)
      : [
          ...favoritos,
          {
            id: fisio.id,
            nome: fisio.nome,
            whatsapp: fisio.whatsapp,
            cidade: fisio.cidade,
            especialidades: fisio.especialidades,
          },
        ];
    setFavoritos(atual);
    gravarFavoritos(atual);
  };

  if (!entered) {
    return (
      <div className="space-y-4">
        {favoritos.length > 0 && (
          <Card>
            <p className="text-sm font-medium mb-3 flex items-center gap-1.5">
              <Heart size={14} fill="#D9756E" style={{ color: "#D9756E" }} /> Seus
              fisioterapeutas favoritos
            </p>
            <div className="space-y-2">
              {favoritos.map((p) => (
                <InnerRow key={p.id}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{p.nome}</p>
                    <p className="text-xs" style={{ color: "var(--muted2)" }}>
                      {p.cidade} · {p.especialidades?.join(", ")}
                    </p>
                  </div>
                  <a
                    href={waLink(p.whatsapp, `Olá ${p.nome}, preciso de atendimento domiciliar!`)}
                    onClick={() => registrarClique(p.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg"
                    style={{ background: "#8FAE8B33", color: "#8FAE8B", border: "1px solid #8FAE8B55" }}
                  >
                    <Phone size={12} /> WhatsApp
                  </a>
                </InnerRow>
              ))}
            </div>
          </Card>
        )}
        <PhoneGate
          titulo="Acompanhar meu pedido"
          descricao="Digite o WhatsApp que você usou no pedido para ver o andamento."
          whatsapp={whatsapp}
          setWhatsapp={setWhatsapp}
          onSubmit={() => setEntered(true)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm" style={{ color: "var(--muted1)" }}>
          {pedidos.length === 1 ? "1 pedido encontrado" : `${pedidos.length} pedidos encontrados`}
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={carregar}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border"
            style={{ borderColor: "var(--border-soft)", color: "var(--muted4)" }}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Atualizar
          </button>
          <button
            onClick={() => {
              setEntered(false);
              setPedidos([]);
              primeiraChecagem.current = true;
            }}
            className="text-sm underline"
            style={{ color: "var(--muted1)" }}
          >
            Trocar número
          </button>
        </div>
      </div>

      <ErroInline>{erro}</ErroInline>

      {!loading && pedidos.length === 0 && !erro && (
        <Card>
          <p className="text-sm" style={{ color: "var(--muted1)" }}>
            Não encontramos nenhum pedido com esse WhatsApp. Confira se digitou certo ou envie um
            pedido na aba "Pedir atendimento".
          </p>
        </Card>
      )}

      {pedidos.map((r) => {
        const agendamento = r.agendamento;
        const fisio = agendamento?.fisio;
        const favoritado = fisio ? favoritos.some((f) => f.id === fisio.id) : false;
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
                  <button
                    onClick={() => toggleFavorito(fisio)}
                    className="text-xs flex items-center gap-1"
                    style={{ color: favoritado ? "#D9756E" : "var(--muted1)" }}
                  >
                    <Heart size={13} fill={favoritado ? "#D9756E" : "none"} />
                    {favoritado ? "Favoritado" : "Favoritar este profissional"}
                  </button>
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
                  <AvaliarFisio fisio={fisio} whatsapp={whatsapp} onDone={carregar} />
                )}
                <ChatThread
                  agendamentoId={agendamento.id}
                  whatsapp={whatsapp}
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
