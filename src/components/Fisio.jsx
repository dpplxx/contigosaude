import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Clock,
  MapPin,
  Phone,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import {
  Card,
  ErroInline,
  Field,
  PhoneInput,
  PrimaryButton,
  SelectInput,
  StarRow,
  Tag,
  TagInput,
  TextArea,
  TextInput,
  Vazio,
} from "./ui";
import { CepInput, ChatThread, PhoneGate } from "./Compartilhados";
import { EthicalCheckbox, PrototypeWarning } from "./Ethics";
import { formatarDistancia } from "../lib/geo";
import { cadastrarFisio, marcarStatusAgendamento, painelFisio } from "../lib/api";
import {
  ESPECIALIDADES_FISIO,
  STATUS_AGENDAMENTO,
  STATUS_LABEL,
  formatDataHora,
  mensagemDeErro,
  pluralAvaliacoes,
  tempoRelativo,
  waLink,
} from "../lib/utils";
import {
  CODIGO_ETICA_CREFITO,
  POLITICA_PRIVACIDADE,
  TERMOS_DE_USO,
  TERMO_RESPONSABILIDADE_PROFISSIONAL,
} from "../lib/termos";

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
  "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
  "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

const PHYSIO_INITIAL = {
  nome: "",
  whatsapp: "",
  especialidades: [],
  cep: "",
  cidade: "",
  bairros: [],
  uf: "",
  lat: null,
  lng: null,
  raioKm: 10,
  disponibilidade: "",
  formacao: "",
  resumo: "",
  valorSessao: "",
  crefito: "",
  crefinoUf: "",
  declaracaoCrefito: false,
  declaracaoEtica: false,
  declaracaoResponsabilidade: false,
};

const RAIOS = [3, 5, 10, 15, 20, 30, 50];

export function PhysioForm({ onToast }) {
  const [form, setForm] = useState(PHYSIO_INITIAL);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setBairros = (arr) => setForm((f) => ({ ...f, bairros: arr }));

  const aplicarEndereco = (endereco) =>
    setForm((f) => ({
      ...f,
      cep: endereco.cep,
      cidade: endereco.cidade || f.cidade,
      uf: endereco.uf || f.uf,
      lat: endereco.lat,
      lng: endereco.lng,
      bairros:
        f.bairros.length === 0 && endereco.bairro ? [endereco.bairro] : f.bairros,
    }));

  const toggleEsp = (esp) => {
    setForm((f) => ({
      ...f,
      especialidades: f.especialidades.includes(esp)
        ? f.especialidades.filter((x) => x !== esp)
        : [...f.especialidades, esp],
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.nome || !form.whatsapp || !form.cidade || !form.formacao) return;
    if (form.especialidades.length === 0) {
      setErro("Escolha ao menos uma especialidade que você atende.");
      return;
    }
    if (!form.crefito || !form.crefinoUf) {
      setErro("Preencha seu CREFITO e a UF do registro.");
      return;
    }
    if (!form.declaracaoCrefito || !form.declaracaoEtica || !form.declaracaoResponsabilidade) {
      setErro("Você precisa aceitar todas as declarações éticas para se cadastrar.");
      return;
    }
    setSaving(true);
    setErro("");
    try {
      await cadastrarFisio(form);
      onToast?.("Cadastro enviado com sucesso!");
      setForm(PHYSIO_INITIAL);
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível salvar seu cadastro agora."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PrototypeWarning />
      <Card>
        <h2 className="text-lg font-medium mb-1">Cadastre-se como fisioterapeuta</h2>
        <p className="text-sm mb-5" style={{ color: "var(--muted1)" }}>
          Receba pedidos de atendimento domiciliar na sua região.
        </p>
        <form onSubmit={submit}>
          <Field label="Seu nome">
            <TextInput value={form.nome} onChange={set("nome")} placeholder="Ex: João Pereira" required />
          </Field>
          <Field label="WhatsApp para contato">
            <PhoneInput value={form.whatsapp} onChange={set("whatsapp")} required />
          </Field>
          <Field label="Número do CREFITO (obrigatório)">
            <TextInput
              value={form.crefito}
              onChange={set("crefito")}
              placeholder="Ex: 123456"
              required
            />
          </Field>
          <Field label="UF do seu registro">
            <SelectInput
              value={form.crefinoUf}
              onChange={(e) => setForm((f) => ({ ...f, crefinoUf: e.target.value }))}
              required
            >
              <option value="">Selecione a UF</option>
              {UFS.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Especialidades que você atende">
          <div className="flex flex-wrap gap-2">
            {ESPECIALIDADES_FISIO.map((esp) => {
              const active = form.especialidades.includes(esp);
              return (
                <button
                  type="button"
                  key={esp}
                  onClick={() => toggleEsp(esp)}
                  className="text-sm px-3 py-1.5 rounded-full border transition-colors"
                  style={
                    active
                      ? { background: "#C6693D", borderColor: "#C6693D", color: "#14231F" }
                      : {
                          background: "transparent",
                          borderColor: "var(--border-soft)",
                          color: "var(--muted4)",
                        }
                  }
                >
                  {esp}
                </button>
              );
            })}
          </div>
        </Field>
        <CepInput
          label="CEP de onde você sai para os atendimentos"
          valor={form.cep}
          onChange={(cep) => setForm((f) => ({ ...f, cep }))}
          onResolvido={aplicarEndereco}
          ajuda="Seu endereço não aparece para ninguém — serve só de ponto de partida para medir a distância."
        />
        <Field label="Cidade">
          <TextInput value={form.cidade} onChange={set("cidade")} placeholder="Ex: São Paulo" required />
        </Field>
        <Field label="Até quanto você aceita se deslocar?">
          <SelectInput
            value={form.raioKm}
            onChange={(e) => setForm((f) => ({ ...f, raioKm: Number(e.target.value) }))}
          >
            {RAIOS.map((r) => (
              <option key={r} value={r}>
                Até {r} km da minha base
              </option>
            ))}
          </SelectInput>
          <p className="text-xs mt-1.5" style={{ color: "var(--muted2)" }}>
            Só recebe pedidos dentro dessa distância. Dá pra mudar depois, cadastrando de novo com
            o mesmo WhatsApp.
          </p>
        </Field>
        <Field label="Regiões que você atende (opcional — digite e aperte Enter)">
          <TagInput value={form.bairros} onChange={setBairros} placeholder="Ex: Tatuapé" />
          <p className="text-xs mt-1.5" style={{ color: "var(--muted2)" }}>
            Serve para o paciente te conhecer. Quem decide o match é a distância acima.
          </p>
        </Field>
        <Field label="Onde você se formou">
          <TextInput
            value={form.formacao}
            onChange={set("formacao")}
            placeholder="Ex: USP, 2018 · Pós em Neurofuncional"
            required
          />
        </Field>
        <Field label="Um breve resumo sobre você (o paciente vai ver isso)">
          <TextArea
            value={form.resumo}
            onChange={set("resumo")}
            rows={3}
            placeholder="Ex: Atuo há 6 anos com reabilitação pós-AVC e mobilidade em idosos..."
          />
        </Field>
        <Field label="Disponibilidade (opcional)">
          <TextInput
            value={form.disponibilidade}
            onChange={set("disponibilidade")}
            placeholder="Ex: manhãs de segunda a sexta"
          />
        </Field>
        <Field label="Valor estimado da sessão (opcional)">
          <TextInput
            value={form.valorSessao}
            onChange={set("valorSessao")}
            placeholder="Ex: 150"
            inputMode="decimal"
          />
        </Field>

        <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
          <p className="text-sm font-medium mb-3" style={{ color: "#E3A873" }}>
            ⚖️ Declarações Éticas e Legais (obrigatórias)
          </p>

          <EthicalCheckbox
            id="crefito_check"
            checked={form.declaracaoCrefito}
            onChange={(val) => setForm((f) => ({ ...f, declaracaoCrefito: val }))}
            label="Declaro que possuo registro ativo no CREFITO e estou quite com as obrigações do Conselho."
            modalTitle="Declaração de Regularidade"
            modalContent={TERMO_RESPONSABILIDADE_PROFISSIONAL}
          />

          <EthicalCheckbox
            id="etica_check"
            checked={form.declaracaoEtica}
            onChange={(val) => setForm((f) => ({ ...f, declaracaoEtica: val }))}
            label="Declaro ter lido e estar ciente do Código de Ética da Fisioterapia (Resolução COFFITO nº 424/2013)."
            modalTitle="Código de Ética"
            modalContent={CODIGO_ETICA_CREFITO}
          />

          <EthicalCheckbox
            id="responsabilidade_check"
            checked={form.declaracaoResponsabilidade}
            onChange={(val) => setForm((f) => ({ ...f, declaracaoResponsabilidade: val }))}
            label="Declaro que assumo total responsabilidade pelos atendimentos, isentando a plataforma de qualquer responsabilidade civil ou criminal."
            modalTitle="Termo de Responsabilidade"
            modalContent={TERMO_RESPONSABILIDADE_PROFISSIONAL}
          />
        </div>

        <ErroInline>{erro}</ErroInline>
        <PrimaryButton type="submit" loading={saving}>
          Cadastrar <ArrowRight size={16} />
        </PrimaryButton>
        <p className="text-xs mt-4" style={{ color: "var(--muted3)" }}>
          Se você já se cadastrou com este mesmo WhatsApp, enviar de novo atualiza seus dados em vez
          de criar um cadastro duplicado.
        </p>
      </form>
    </Card>
    </div>
  );
}

export function PhysioDashboard({ onNotify }) {
  const [whatsapp, setWhatsapp] = useState("");
  const [entered, setEntered] = useState(false);
  const [dados, setDados] = useState({ fisio: null });
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");
  const primeiraChecagem = useRef(true);
  const compativeisAnteriores = useRef(new Set());

  const carregar = useCallback(async () => {
    if (!whatsapp) return;
    setLoading(true);
    setErro("");
    try {
      setDados(await painelFisio(whatsapp));
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível carregar seus dados."));
    } finally {
      setLoading(false);
    }
  }, [whatsapp]);

  useEffect(() => {
    if (entered) carregar();
  }, [entered, carregar]);

  useEffect(() => {
    if (!entered || !dados.fisio) return;
    const intervalo = setInterval(carregar, 20000);
    return () => clearInterval(intervalo);
  }, [entered, dados.fisio, carregar]);

  const compativeis = dados.pedidos_compativeis || [];

  useEffect(() => {
    if (!dados.fisio) return;
    const idsAtuais = new Set(compativeis.map((r) => r.id));
    if (primeiraChecagem.current) {
      primeiraChecagem.current = false;
      compativeisAnteriores.current = idsAtuais;
      return;
    }
    let novos = 0;
    idsAtuais.forEach((id) => {
      if (!compativeisAnteriores.current.has(id)) novos += 1;
    });
    if (novos > 0) {
      onNotify?.(
        "Novo pedido compatível com você!",
        novos === 1
          ? "Há 1 novo pedido na sua região e especialidade."
          : `Há ${novos} novos pedidos na sua região e especialidade.`
      );
    }
    compativeisAnteriores.current = idsAtuais;
  }, [compativeis, dados.fisio, onNotify]);

  const marcarStatus = async (agendamentoId, status) => {
    try {
      await marcarStatusAgendamento({ agendamentoId, status, whatsapp });
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível atualizar o agendamento."));
    }
  };

  if (!entered) {
    return (
      <PhoneGate
        titulo="Meus agendamentos"
        descricao="Digite o WhatsApp que você usou no cadastro pra entrar."
        whatsapp={whatsapp}
        setWhatsapp={setWhatsapp}
        onSubmit={() => setEntered(true)}
      />
    );
  }

  const voltar = () => {
    setEntered(false);
    setDados({ fisio: null });
    primeiraChecagem.current = true;
  };

  if (loading && !dados.fisio) {
    return (
      <Card>
        <p className="text-sm" style={{ color: "var(--muted1)" }}>
          Carregando seus dados...
        </p>
      </Card>
    );
  }

  if (!dados.fisio) {
    return (
      <Card>
        <ErroInline>{erro}</ErroInline>
        <p className="text-sm" style={{ color: "var(--muted1)" }}>
          Não encontramos nenhum cadastro com esse WhatsApp. Confira se digitou certo ou cadastre-se
          na aba "Cadastrar".
        </p>
        <button onClick={voltar} className="text-sm underline mt-3" style={{ color: "#E3A873" }}>
          Tentar outro número
        </button>
      </Card>
    );
  }

  const fisio = dados.fisio;
  const agendamentos = dados.agendamentos || [];
  const avaliacoes = dados.avaliacoes || [];
  const media =
    avaliacoes.length > 0
      ? avaliacoes.reduce((s, a) => s + a.nota, 0) / avaliacoes.length
      : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm" style={{ color: "var(--muted1)" }}>
          Olá, {fisio.nome} ·{" "}
          {agendamentos.length === 1 ? "1 agendamento" : `${agendamentos.length} agendamentos`}
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={carregar}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border"
            style={{ borderColor: "var(--border-soft)", color: "var(--muted4)" }}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Atualizar
          </button>
          <button onClick={voltar} className="text-sm underline" style={{ color: "var(--muted1)" }}>
            Trocar número
          </button>
        </div>
      </div>

      <ErroInline>{erro}</ErroInline>

      {!fisio.tem_coordenadas && (
        <Card>
          <p className="text-sm" style={{ color: "#E3A873" }}>
            Seu cadastro está sem CEP, então o match usa só cidade e bairro. Cadastre-se de novo com
            o mesmo WhatsApp informando o CEP — aí você passa a receber pedidos por distância real,
            dentro do seu raio de {fisio.raio_km} km.
          </p>
        </Card>
      )}

      {compativeis.length > 0 && (
        <Card>
          <p className="text-sm font-medium flex items-center gap-1.5" style={{ color: "#E3A873" }}>
            <Sparkles size={14} />
            {compativeis.length === 1
              ? "1 pedido compatível com você aguardando"
              : `${compativeis.length} pedidos compatíveis com você aguardando`}
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {compativeis.slice(0, 6).map((p) => (
              <Tag key={p.id}>
                {p.bairro}
                {p.distancia_km != null && ` · ${formatarDistancia(p.distancia_km)}`} ·{" "}
                {p.especialidade}
              </Tag>
            ))}
          </div>
          <p className="text-xs mt-2" style={{ color: "var(--muted2)" }}>
            A equipe do Fisio em Casa vai entrar em contato pra confirmar o agendamento.
          </p>
        </Card>
      )}

      {agendamentos.length === 0 && (
        <Card>
          <p className="text-sm" style={{ color: "var(--muted1)" }}>
            Nenhum agendamento ainda. Assim que a equipe do Fisio em Casa marcar um atendimento pra
            você, ele aparece aqui.
          </p>
        </Card>
      )}

      {agendamentos.map((a) => {
        const pedido = a.pedido;
        return (
          <Card key={a.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium">{pedido?.nome || "Paciente"}</p>
                {pedido && (
                  <p className="text-sm flex items-center gap-1 mt-1" style={{ color: "var(--muted1)" }}>
                    <MapPin size={13} /> {pedido.bairro}, {pedido.cidade}
                    {pedido.distancia_km != null && (
                      <span style={{ color: "#8FAE8B" }}>
                        · {formatarDistancia(pedido.distancia_km)} de você
                      </span>
                    )}
                  </p>
                )}
                {pedido?.observacoes && (
                  <p className="text-sm mt-1" style={{ color: "var(--muted2)" }}>
                    {pedido.observacoes}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-3 mt-2">
                  <span className="text-sm flex items-center gap-1" style={{ color: "var(--muted1)" }}>
                    <Clock size={13} /> {formatDataHora(a.data, a.horario)}
                  </span>
                  {pedido?.whatsapp && (
                    <a
                      href={waLink(
                        pedido.whatsapp,
                        `Olá ${pedido.nome}, aqui é ${fisio.nome}, do Fisio em Casa.`
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg"
                      style={{ background: "#8FAE8B33", color: "#8FAE8B", border: "1px solid #8FAE8B55" }}
                    >
                      <Phone size={12} /> WhatsApp
                    </a>
                  )}
                </div>
              </div>
              <SelectInput
                value={a.status}
                onChange={(e) => marcarStatus(a.id, e.target.value)}
                style={{ maxWidth: 140 }}
              >
                {STATUS_AGENDAMENTO.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </SelectInput>
            </div>
            <ChatThread
              agendamentoId={a.id}
              whatsapp={whatsapp}
              remetente="fisio"
              remetenteNome={fisio.nome}
              mensagens={a.mensagens}
              onSent={carregar}
            />
          </Card>
        );
      })}

      <section className="pt-2">
        <h3 className="text-sm uppercase tracking-wide mb-3" style={{ color: "var(--muted1)" }}>
          Minhas avaliações
        </h3>
        <Card>
          {avaliacoes.length === 0 ? (
            <Vazio>Você ainda não recebeu nenhuma avaliação.</Vazio>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3">
                <StarRow value={media} size={16} />
                <span className="text-sm" style={{ color: "var(--muted2)" }}>
                  {media.toFixed(1)} de 5 ({pluralAvaliacoes(avaliacoes.length)})
                </span>
              </div>
              <div className="space-y-3">
                {avaliacoes.map((a) => (
                  <div key={a.id} className="pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                    <div className="flex items-center justify-between gap-2">
                      <StarRow value={a.nota} />
                      <span className="text-xs" style={{ color: "var(--muted3)" }}>
                        {tempoRelativo(a.criado_em)}
                      </span>
                    </div>
                    {a.comentario && (
                      <p className="text-sm mt-1" style={{ color: "var(--muted4)" }}>
                        {a.comentario}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </section>
    </div>
  );
}
