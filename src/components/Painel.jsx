import { useEffect, useState } from "react";
import {
  ArrowUpDown,
  Download,
  Flag,
  GraduationCap,
  MapPin,
  MousePointerClick,
  Phone,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Sparkles,
  Star,
  Upload,
  Users,
} from "lucide-react";
import {
  Card,
  ErroInline,
  Field,
  InnerRow,
  SelectInput,
  StarRow,
  StatusBadge,
  Tag,
  TabButton,
  TextArea,
  TextInput,
  Vazio,
  NovoBadge,
  inputBase,
} from "./ui";
import {
  agendar,
  atualizarStatusPedido,
  avaliarPeloPainel,
  avaliacoesModeracao,
  moderarAvaliacao,
  registrarClique,
  restaurarBackup,
  verificarCrefito,
} from "../lib/api";
import {
  ESPECIALIDADES_FISIO,
  calcularMatches,
  formatDataHora,
  formatarMoeda,
  isNovo,
  linkBuscaCrefito,
  mensagemDeErro,
  pluralAvaliacoes,
  tempoRelativo,
  waLink,
} from "../lib/utils";
import { formatarDistancia } from "../lib/geo";

function AgendarForm({ pedido, fisios, onCreated }) {
  const [open, setOpen] = useState(false);
  const [fisioId, setFisioId] = useState("");
  const [data, setData] = useState("");
  const [horario, setHorario] = useState("");
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");

  const submit = async () => {
    if (!fisioId || !data || !horario) return;
    setSaving(true);
    setErro("");
    try {
      await agendar({ pedidoId: pedido.id, fisioId, data, horario });
      setOpen(false);
      setFisioId("");
      setData("");
      setHorario("");
      await onCreated?.();
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível criar o agendamento."));
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
        Agendar atendimento
      </button>
    );
  }

  return (
    <div className="mt-3 pt-3 space-y-2" style={{ borderTop: "1px solid var(--border)" }}>
      <SelectInput value={fisioId} onChange={(e) => setFisioId(e.target.value)}>
        <option value="">Escolha o fisioterapeuta</option>
        {fisios.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nome} — {p.cidade}
          </option>
        ))}
      </SelectInput>
      <div className="flex gap-2">
        <input
          type="date"
          value={data}
          onChange={(e) => setData(e.target.value)}
          className={`${inputBase} ficha-input`}
        />
        <input
          type="time"
          value={horario}
          onChange={(e) => setHorario(e.target.value)}
          className={`${inputBase} ficha-input`}
        />
      </div>
      <ErroInline>{erro}</ErroInline>
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={saving || !fisioId || !data || !horario}
          className="text-sm px-3 py-1.5 rounded-full disabled:opacity-50"
          style={{ background: "#009E86", color: "#FFFFFF" }}
        >
          {saving ? "Salvando..." : "Confirmar agendamento"}
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

function RatingWidget({ fisioId, onSubmitted }) {
  const [nota, setNota] = useState(0);
  const [comentario, setComentario] = useState("");
  const [nomeAvaliador, setNomeAvaliador] = useState("");
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");
  const [open, setOpen] = useState(false);

  const submit = async () => {
    if (nota === 0) return;
    setSaving(true);
    setErro("");
    try {
      await avaliarPeloPainel({ fisioId, nota, comentario, nomeAvaliador });
      setNota(0);
      setComentario("");
      setNomeAvaliador("");
      setOpen(false);
      await onSubmitted?.();
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível salvar a avaliação."));
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
        Registrar avaliação
      </button>
    );
  }

  return (
    <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
      <div className="flex gap-1 mb-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setNota(n)} aria-label={`${n} estrelas`}>
            <Star size={20} fill={n <= nota ? "#16C4A8" : "none"} style={{ color: "#16C4A8" }} />
          </button>
        ))}
      </div>
      <TextInput
        value={nomeAvaliador}
        onChange={(e) => setNomeAvaliador(e.target.value)}
        placeholder="Nome de quem avaliou (opcional)"
        className="mb-2 text-sm"
      />
      <TextArea
        value={comentario}
        onChange={(e) => setComentario(e.target.value)}
        rows={2}
        placeholder="Comentário (opcional)"
        className="mb-2 text-sm"
      />
      <ErroInline>{erro}</ErroInline>
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={nota === 0 || saving}
          className="text-sm px-3 py-1.5 rounded-full disabled:opacity-50"
          style={{ background: "#009E86", color: "#FFFFFF" }}
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

const CREFITO_STATUS_INFO = {
  pendente: { label: "Pendente de verificação", color: "var(--muted1)", Icon: ShieldQuestion },
  verificado: { label: "Verificado", color: "#2FAE72", Icon: ShieldCheck },
  rejeitado: { label: "Rejeitado", color: "#C24A3E", Icon: ShieldAlert },
};

function VerificacaoCrefito({ fisio, onDone }) {
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");

  if (!fisio.crefito) return null;

  const info = CREFITO_STATUS_INFO[fisio.crefito_status] || CREFITO_STATUS_INFO.pendente;
  const Icon = info.Icon;

  const marcar = async (status) => {
    setSaving(true);
    setErro("");
    try {
      await verificarCrefito({ fisioId: fisio.id, status });
      await onDone?.();
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível atualizar o status do CREFITO."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
      <p className="text-xs flex items-center gap-1.5" style={{ color: info.color }}>
        <Icon size={13} /> CREFITO {fisio.crefito}
        {fisio.crefito_uf ? `/${fisio.crefito_uf}` : ""} · {info.label}
      </p>
      <ErroInline>{erro}</ErroInline>
      <div className="flex flex-wrap gap-3 mt-1">
        <a
          href={linkBuscaCrefito(fisio.crefito, fisio.crefito_uf)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs underline"
          style={{ color: "var(--muted1)" }}
        >
          Pesquisar CREFITO
        </a>
        {fisio.crefito_status !== "verificado" && (
          <button
            onClick={() => marcar("verificado")}
            disabled={saving}
            className="text-xs underline disabled:opacity-50"
            style={{ color: "#2FAE72" }}
          >
            Marcar como verificado
          </button>
        )}
        {fisio.crefito_status !== "rejeitado" && (
          <button
            onClick={() => marcar("rejeitado")}
            disabled={saving}
            className="text-xs underline disabled:opacity-50"
            style={{ color: "#C24A3E" }}
          >
            Marcar como rejeitado
          </button>
        )}
        {fisio.crefito_status !== "pendente" && (
          <button
            onClick={() => marcar("pendente")}
            disabled={saving}
            className="text-xs underline disabled:opacity-50"
            style={{ color: "var(--muted1)" }}
          >
            Voltar pra pendente
          </button>
        )}
      </div>
    </div>
  );
}

const MOTIVO_LABEL = {
  falsa: "Avaliação falsa",
  concorrencia: "Concorrência desleal",
  autopromocao: "Autopromoção",
  ofensiva: "Conteúdo ofensivo",
  publicidade: "Publicidade disfarçada",
  outro: "Outro motivo",
};

function ModeracaoAvaliacoes() {
  const [itens, setItens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [processando, setProcessando] = useState(null);

  const carregar = async () => {
    setLoading(true);
    setErro("");
    try {
      const data = await avaliacoesModeracao();
      setItens(data);
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível carregar as denúncias."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const decidir = async (avaliacaoId, acao) => {
    setProcessando(avaliacaoId);
    try {
      await moderarAvaliacao({ avaliacaoId, acao });
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível aplicar a moderação."));
    } finally {
      setProcessando(null);
    }
  };

  if (loading) return null;
  if (!erro && itens.length === 0) return null;

  return (
    <section>
      <h3
        className="text-sm uppercase tracking-wide mb-3 flex items-center gap-1.5"
        style={{ color: "#C24A3E" }}
      >
        <Flag size={14} /> Avaliações denunciadas ({itens.length})
      </h3>
      <ErroInline>{erro}</ErroInline>
      <div className="space-y-3">
        {itens.map((a) => (
          <Card key={a.id}>
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <p className="font-medium">{a.fisio_nome}</p>
              <span className="text-xs" style={{ color: "var(--muted3)" }}>
                {tempoRelativo(a.criado_em)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <StarRow value={a.nota} size={13} />
              <span className="text-xs" style={{ color: "var(--muted1)" }}>
                {a.nome_avaliador || "Anônimo"}
              </span>
            </div>
            {a.comentario && (
              <p className="text-sm mt-1.5" style={{ color: "var(--muted2)" }}>
                "{a.comentario}"
              </p>
            )}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {a.denuncias.map((d) => (
                <span
                  key={d.id}
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: "#C24A3E22", color: "#C24A3E" }}
                  title={d.detalhes || ""}
                >
                  {MOTIVO_LABEL[d.motivo] || d.motivo}
                </span>
              ))}
            </div>
            <div className="flex gap-3 mt-3">
              <button
                onClick={() => decidir(a.id, "manter")}
                disabled={processando === a.id}
                className="text-xs underline disabled:opacity-50"
                style={{ color: "#2FAE72" }}
              >
                Manter avaliação
              </button>
              <button
                onClick={() => decidir(a.id, "remover")}
                disabled={processando === a.id}
                className="text-xs underline disabled:opacity-50"
                style={{ color: "#C24A3E" }}
              >
                Remover avaliação
              </button>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

function RequestCard({ r, fisios, agendamentos, area, onRefresh, onArchive }) {
  const [mostrarMatches, setMostrarMatches] = useState(false);
  const agendamento = agendamentos.find((a) => a.pedido_id === r.id);
  const fisio = agendamento ? fisios.find((p) => p.id === agendamento.fisio_id) : null;
  const matches = calcularMatches(fisios, r);

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <p className="font-medium">{r.nome}</p>
            {isNovo(r.criado_em) && <NovoBadge />}
            <span className="text-xs" style={{ color: "var(--muted3)" }}>
              {tempoRelativo(r.criado_em)}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 mt-1.5">
            <Tag>{r.especialidade}</Tag>
            <Tag>{r.urgencia}</Tag>
          </div>
          <p className="text-sm mt-2 flex items-center gap-1" style={{ color: "var(--muted1)" }}>
            <MapPin size={13} /> {r.bairro}, {r.cidade}
          </p>
          {r.observacoes && (
            <p className="text-sm mt-1" style={{ color: "var(--muted2)" }}>
              {r.observacoes}
            </p>
          )}

          {agendamento && fisio ? (
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <StatusBadge status={agendamento.status} />
              <span className="text-sm" style={{ color: "var(--muted1)" }}>
                {formatDataHora(agendamento.data, agendamento.horario)} · Fisio: {fisio.nome}
              </span>
            </div>
          ) : (
            <>
              {area === "ativos" && (
                <AgendarForm pedido={r} fisios={fisios} onCreated={onRefresh} />
              )}
              <button
                onClick={() => setMostrarMatches((v) => !v)}
                className="text-xs mt-2 underline flex items-center gap-1"
                style={{ color: "#16C4A8" }}
              >
                <Sparkles size={12} />
                {mostrarMatches ? "Ocultar" : "Ver"} fisios compatíveis ({matches.length})
              </button>
              {mostrarMatches && (
                <div className="mt-2 space-y-2 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
                  {matches.length === 0 && (
                    <Vazio>Nenhum fisio com essa especialidade nessa região ainda.</Vazio>
                  )}
                  {matches.map((m) => (
                    <InnerRow key={m.id}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{m.nome}</p>
                        <p className="text-xs" style={{ color: "var(--muted2)" }}>
                          {m.cidade}
                          {m._distancia != null && (
                            <span style={{ color: "#2FAE72" }}>
                              {" "}
                              · {formatarDistancia(m._distancia)} do paciente
                            </span>
                          )}
                        </p>
                        {m.valor_sessao != null && (
                          <p className="text-xs font-medium" style={{ color: "#2FAE72" }}>
                            {formatarMoeda(m.valor_sessao)} / sessão
                          </p>
                        )}
                      </div>
                      <a
                        href={waLink(
                          m.whatsapp,
                          `Olá ${m.nome}! Tenho um paciente (${r.nome}) precisando de atendimento domiciliar na área ${r.especialidade}, urgência: ${r.urgencia}. Você atende ${r.bairro}, ${r.cidade}?`
                        )}
                        onClick={() => registrarClique(m.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full"
                        style={{ background: "#2FAE7233", color: "#2FAE72", border: "1px solid #2FAE7255" }}
                      >
                        <Phone size={12} /> WhatsApp
                      </a>
                    </InnerRow>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="mt-2">
            {area === "ativos" ? (
              <button
                onClick={() => {
                  if (window.confirm(`Marcar o pedido de ${r.nome} como atendido/arquivado?`)) {
                    onArchive(r.id, "arquivado");
                  }
                }}
                className="text-xs underline"
                style={{ color: "#2FAE72" }}
              >
                Já entrei em contato / Atendido
              </button>
            ) : (
              <button
                onClick={() => {
                  if (window.confirm(`Reabrir o pedido de ${r.nome}?`)) {
                    onArchive(r.id, "ativo");
                  }
                }}
                className="text-xs underline"
                style={{ color: "var(--muted1)" }}
              >
                Reabrir pedido
              </button>
            )}
          </div>
        </div>
        <a
          href={waLink(
            r.whatsapp,
            `Olá ${r.nome}, vi seu pedido de atendimento domiciliar no Contigo Saúde!`
          )}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 flex items-center gap-1 text-sm px-3 py-1.5 rounded-full"
          style={{ background: "#2FAE7233", color: "#2FAE72", border: "1px solid #2FAE7255" }}
        >
          <Phone size={14} /> WhatsApp
        </a>
      </div>
    </Card>
  );
}

export function Painel({ dados, loading, erro, onRefresh }) {
  const { fisios, pedidos, agendamentos, avaliacoes, mensagens } = dados;
  const [area, setArea] = useState("ativos");
  const [filtroRegiao, setFiltroRegiao] = useState("");
  const [filtroEspecialidade, setFiltroEspecialidade] = useState("");
  const [importErro, setImportErro] = useState("");
  const [ordem, setOrdem] = useState("recentes");
  const termo = filtroRegiao.trim().toLowerCase();

  const ordenar = (lista) =>
    [...lista].sort((a, b) => {
      const ta = new Date(a.criado_em).getTime();
      const tb = new Date(b.criado_em).getTime();
      return ordem === "recentes" ? tb - ta : ta - tb;
    });

  const ativos = pedidos.filter((r) => r.status !== "arquivado");
  const arquivados = pedidos.filter((r) => r.status === "arquivado");
  const base = area === "ativos" ? ativos : arquivados;

  const pedidosFiltrados = ordenar(
    base.filter((r) => {
      const bateRegiao =
        !termo ||
        r.cidade?.toLowerCase().includes(termo) ||
        r.bairro?.toLowerCase().includes(termo);
      const bateEsp = !filtroEspecialidade || r.especialidade === filtroEspecialidade;
      return bateRegiao && bateEsp;
    })
  );

  const fisiosFiltrados = ordenar(
    fisios.filter((p) => {
      const bateRegiao =
        !termo ||
        p.cidade?.toLowerCase().includes(termo) ||
        p.bairros?.some((b) => b.toLowerCase().includes(termo));
      const bateEsp = !filtroEspecialidade || p.especialidades?.includes(filtroEspecialidade);
      return bateRegiao && bateEsp;
    })
  );

  const marcarPedido = async (id, status) => {
    try {
      await atualizarStatusPedido(id, status);
      await onRefresh?.();
    } catch (e) {
      setImportErro(mensagemDeErro(e, "Não foi possível atualizar o pedido."));
    }
  };

  const exportarBackup = () => {
    const backup = {
      exportadoEm: new Date().toISOString(),
      fisios,
      pedidos,
      agendamentos,
      avaliacoes,
      mensagens,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contigo-saude-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const importarBackup = async (file) => {
    setImportErro("");
    try {
      const dadosArquivo = JSON.parse(await file.text());
      await restaurarBackup(dadosArquivo);
      await onRefresh?.();
    } catch (e) {
      setImportErro(
        mensagemDeErro(e, "Não foi possível restaurar esse arquivo. Confira se é um backup válido.")
      );
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <p className="text-sm" style={{ color: "var(--muted1)" }}>
          Este painel mostra tudo que chegou pelos formulários. Agende um atendimento pra abrir o
          chat entre paciente e fisioterapeuta.
        </p>
      </Card>

      <ModeracaoAvaliacoes />

      <div className="flex flex-wrap gap-2">
        <button
          onClick={exportarBackup}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border"
          style={{ borderColor: "var(--border-soft)", color: "var(--muted4)" }}
        >
          <Download size={14} /> Baixar backup
        </button>
        <label
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border cursor-pointer"
          style={{ borderColor: "var(--border-soft)", color: "var(--muted4)" }}
        >
          <Upload size={14} /> Restaurar backup
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importarBackup(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      <ErroInline>{importErro || erro}</ErroInline>

      <div className="flex gap-2">
        <TabButton active={area === "ativos"} onClick={() => setArea("ativos")}>
          Pedidos ativos ({ativos.length})
        </TabButton>
        <TabButton active={area === "arquivados"} onClick={() => setArea("arquivados")}>
          Arquivados ({arquivados.length})
        </TabButton>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Filtrar por especialidade">
          <SelectInput
            value={filtroEspecialidade}
            onChange={(e) => setFiltroEspecialidade(e.target.value)}
          >
            <option value="">Todas as especialidades</option>
            {ESPECIALIDADES_FISIO.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Filtrar por cidade ou bairro">
          <TextInput
            value={filtroRegiao}
            onChange={(e) => setFiltroRegiao(e.target.value)}
            placeholder="Ex: Tatuapé"
          />
        </Field>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 text-sm" style={{ color: "var(--muted1)" }}>
          <Users size={16} /> {fisiosFiltrados.length} fisios · {pedidosFiltrados.length} pedidos
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOrdem((o) => (o === "recentes" ? "antigos" : "recentes"))}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border"
            style={{ borderColor: "var(--border-soft)", color: "var(--muted4)" }}
          >
            <ArrowUpDown size={14} />
            Ordenar: {ordem === "recentes" ? "mais recentes" : "mais antigos"}
          </button>
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border"
            style={{ borderColor: "var(--border-soft)", color: "var(--muted4)" }}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Atualizar
          </button>
        </div>
      </div>

      <section>
        <h3 className="text-sm uppercase tracking-wide mb-3" style={{ color: "var(--muted1)" }}>
          {area === "ativos" ? "Pedidos de pacientes" : "Pedidos arquivados"}
        </h3>
        {pedidosFiltrados.length === 0 && !loading && <Vazio>Nenhum pedido encontrado.</Vazio>}
        <div className="space-y-3">
          {pedidosFiltrados.map((r) => (
            <RequestCard
              key={r.id}
              r={r}
              fisios={fisios}
              agendamentos={agendamentos}
              area={area}
              onRefresh={onRefresh}
              onArchive={marcarPedido}
            />
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm uppercase tracking-wide mb-3" style={{ color: "var(--muted1)" }}>
          Fisioterapeutas cadastrados
        </h3>
        {fisiosFiltrados.length === 0 && !loading && <Vazio>Nenhum fisioterapeuta encontrado.</Vazio>}
        <div className="space-y-3">
          {fisiosFiltrados.map((p) => {
            const notas = avaliacoes.filter(
              (a) => a.fisio_id === p.id && a.status !== "removida"
            );
            const media =
              notas.length > 0 ? notas.reduce((s, a) => s + a.nota, 0) / notas.length : 0;
            return (
              <Card key={p.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <p className="font-medium">{p.nome}</p>
                      {isNovo(p.criado_em) && <NovoBadge />}
                      <span className="text-xs" style={{ color: "var(--muted3)" }}>
                        {tempoRelativo(p.criado_em)}
                      </span>
                    </div>
                    {notas.length > 0 && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <StarRow value={media} />
                        <span className="text-xs" style={{ color: "var(--muted2)" }}>
                          {media.toFixed(1)} ({pluralAvaliacoes(notas.length)})
                        </span>
                      </div>
                    )}
                    {p.contador_cliques > 0 && (
                      <p
                        className="text-xs mt-1 flex items-center gap-1"
                        style={{ color: "var(--muted2)" }}
                      >
                        <MousePointerClick size={12} /> {p.contador_cliques} clique
                        {p.contador_cliques > 1 ? "s" : ""} no WhatsApp
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      {p.especialidades?.map((e) => (
                        <Tag key={e}>{e}</Tag>
                      ))}
                    </div>
                    <p
                      className="text-sm mt-2 flex items-center gap-1.5 flex-wrap"
                      style={{ color: "var(--muted1)" }}
                    >
                      <MapPin size={13} className="shrink-0" /> {p.cidade}
                      {p.uf && `/${p.uf}`}
                      <Tag>
                        {p.lat != null ? `atende até ${p.raio_km} km` : "sem CEP — match por bairro"}
                      </Tag>
                      {p.bairros?.map((b) => (
                        <Tag key={b}>{b}</Tag>
                      ))}
                    </p>
                    {p.formacao && (
                      <p
                        className="text-sm mt-1 flex items-center gap-1"
                        style={{ color: "var(--muted1)" }}
                      >
                        <GraduationCap size={13} /> {p.formacao}
                      </p>
                    )}
                    {p.resumo && (
                      <p className="text-sm mt-1.5" style={{ color: "var(--muted2)" }}>
                        {p.resumo}
                      </p>
                    )}
                    {p.disponibilidade && (
                      <p className="text-sm mt-1" style={{ color: "var(--muted2)" }}>
                        {p.disponibilidade}
                      </p>
                    )}
                    {p.valor_sessao != null && (
                      <p className="text-sm mt-1 font-medium" style={{ color: "#2FAE72" }}>
                        {formatarMoeda(p.valor_sessao)} / sessão
                      </p>
                    )}
                    <VerificacaoCrefito fisio={p} onDone={onRefresh} />
                    <RatingWidget fisioId={p.id} onSubmitted={onRefresh} />
                  </div>
                  <a
                    href={waLink(p.whatsapp, `Olá ${p.nome}, obrigado por se cadastrar no Contigo Saúde!`)}
                    onClick={() => registrarClique(p.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 flex items-center gap-1 text-sm px-3 py-1.5 rounded-full"
                    style={{ background: "#2FAE7233", color: "#2FAE72", border: "1px solid #2FAE7255" }}
                  >
                    <Phone size={14} /> WhatsApp
                  </a>
                </div>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
