import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Camera,
  Clock,
  MapPin,
  Phone,
  RefreshCw,
  Sparkles,
  User,
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
import { CepInput, ChatThread } from "./Compartilhados";
import { EthicalCheckbox, PrototypeWarning } from "./Ethics";
import { formatarDistancia } from "../lib/geo";
import {
  cadastrarFisio,
  enviarFotoFisio,
  marcarStatusAgendamento,
  meuPainelFisio,
} from "../lib/api";
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
  fotoUrl: "",
  declaracaoCrefito: false,
  declaracaoEtica: false,
  declaracaoResponsabilidade: false,
};

const RAIOS = [3, 5, 10, 15, 20, 30, 50];

export function PhysioForm({ onToast }) {
  const [form, setForm] = useState(PHYSIO_INITIAL);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [editando, setEditando] = useState(false);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const fileInputRef = useRef(null);

  // Se a conta já tem cadastro, abre o formulário preenchido em vez de em
  // branco — assim dá pra editar o que já existe, não só criar do zero.
  useEffect(() => {
    let ativo = true;
    meuPainelFisio()
      .then((dados) => {
        if (!ativo || !dados.fisio) return;
        const f = dados.fisio;
        setForm({
          nome: f.nome || "",
          whatsapp: f.whatsapp || "",
          especialidades: f.especialidades || [],
          cep: f.cep || "",
          cidade: f.cidade || "",
          bairros: f.bairros || [],
          uf: f.uf || "",
          lat: f.lat ?? null,
          lng: f.lng ?? null,
          raioKm: f.raio_km || 10,
          disponibilidade: f.disponibilidade || "",
          formacao: f.formacao || "",
          resumo: f.resumo || "",
          valorSessao: f.valor_sessao ?? "",
          crefito: f.crefito || "",
          crefinoUf: f.crefito_uf || "",
          fotoUrl: f.foto_url || "",
          declaracaoCrefito: true,
          declaracaoEtica: true,
          declaracaoResponsabilidade: true,
        });
        setEditando(true);
      })
      .catch(() => {
        // Sem cadastro ainda (ou erro ao buscar): segue com o formulário em branco.
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, []);

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

  // O upload acontece na hora que a pessoa escolhe o arquivo, sem precisar
  // clicar em "Salvar alterações" do resto do formulário.
  const escolherFoto = async (e) => {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    if (arquivo.size > 2 * 1024 * 1024) {
      setErro("A imagem precisa ter até 2MB.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setEnviandoFoto(true);
    setErro("");
    try {
      const url = await enviarFotoFisio(arquivo);
      setForm((f) => ({ ...f, fotoUrl: url }));
      onToast?.("Foto atualizada!");
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível enviar a foto."));
    } finally {
      setEnviandoFoto(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
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
      onToast?.(editando ? "Alterações salvas!" : "Cadastro enviado com sucesso!");
      if (!editando) setForm(PHYSIO_INITIAL);
      setEditando(true);
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível salvar seu cadastro agora."));
    } finally {
      setSaving(false);
    }
  };

  if (carregando) {
    return (
      <div className="space-y-4">
        <PrototypeWarning />
        <Card>
          <p className="text-sm" style={{ color: "var(--muted1)" }}>
            Carregando seu cadastro...
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PrototypeWarning />
      <Card>
        <h2 className="text-lg font-medium mb-1">
          {editando ? "Seu cadastro" : "Cadastre-se como fisioterapeuta"}
        </h2>
        <p className="text-sm mb-5" style={{ color: "var(--muted1)" }}>
          {editando
            ? "Altere o que quiser e salve — os pacientes já veem seus dados atualizados."
            : "Receba pedidos de atendimento domiciliar na sua região."}
        </p>

        {editando && (
          <div className="flex items-center gap-4 mb-5">
            <div
              className="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0"
              style={{ background: "var(--card)" }}
            >
              {form.fotoUrl ? (
                <img src={form.fotoUrl} alt="Sua foto" className="w-full h-full object-cover" />
              ) : (
                <User size={28} style={{ color: "var(--muted)" }} />
              )}
            </div>
            <div>
              <label
                className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border cursor-pointer"
                style={{ borderColor: "var(--border-soft)", color: "var(--muted4)" }}
              >
                <Camera size={14} />
                {enviandoFoto ? "Enviando..." : form.fotoUrl ? "Trocar foto" : "Adicionar foto"}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={escolherFoto}
                  disabled={enviandoFoto}
                  className="hidden"
                />
              </label>
              <p className="text-xs mt-1.5" style={{ color: "var(--muted2)" }}>
                Aparece para os pacientes na busca. JPG, PNG ou WEBP, até 2MB.
              </p>
            </div>
          </div>
        )}

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
            Só recebe pedidos dentro dessa distância. Dá pra mudar quando quiser, é só editar e
            salvar de novo.
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
          {editando ? "Salvar alterações" : "Cadastrar"} <ArrowRight size={16} />
        </PrimaryButton>
      </form>
    </Card>
    </div>
  );
}

export function PhysioDashboard({ onNotify }) {
  const [dados, setDados] = useState({ fisio: null });
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");
  const primeiraChecagem = useRef(true);
  const compativeisAnteriores = useRef(new Set());

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro("");
    try {
      setDados(await meuPainelFisio());
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível carregar seus dados."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    if (!dados.fisio) return;
    const intervalo = setInterval(carregar, 20000);
    return () => clearInterval(intervalo);
  }, [dados.fisio, carregar]);

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
      await marcarStatusAgendamento({ agendamentoId, status });
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível atualizar o agendamento."));
    }
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
          Esta conta ainda não tem um cadastro de fisioterapeuta. Preencha a aba "Cadastrar" para
          começar a receber pedidos.
        </p>
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
        <button
          onClick={carregar}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border"
          style={{ borderColor: "var(--border-soft)", color: "var(--muted4)" }}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Atualizar
        </button>
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
              whatsapp={fisio.whatsapp}
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
