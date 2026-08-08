import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Camera,
  ShieldAlert,
  ShieldCheck,
  User,
} from "lucide-react";
import {
  Card,
  ErroInline,
  Field,
  PhoneInput,
  PrimaryButton,
  SelectInput,
  StatusBadge,
  TagInput,
  TextArea,
  TextInput,
  Vazio,
} from "./ui";
import { CepInput } from "./Compartilhados";
import { EthicalCheckbox, PrototypeWarning } from "./Ethics";
import {
  cadastrarFisio,
  enviarFotoFisio,
  marcarStatusAgendamento,
  meuPainelFisio,
  verificarTurnstile,
} from "../lib/api";
import { trackEvent, Events } from "../lib/analytics";
import {
  ESPECIALIDADES_FISIO,
  crefitoValido,
  formatDataHora,
  mensagemDeErro,
  telefoneCompleto,
} from "../lib/utils";
import { TurnstileWidget, turnstileConfigurado } from "../lib/turnstile";
import { MfaConfiguracao } from "./MFA";
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

function CartaAgendamentoFisio({ agendamento, onAtualizado }) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const p = agendamento.pedido;

  const marcar = async (status) => {
    setSalvando(true);
    setErro("");
    try {
      await marcarStatusAgendamento(agendamento.id, status);
      onAtualizado(agendamento.id, status);
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível atualizar o status."));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="py-3" style={{ borderTop: "1px solid var(--border)" }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
            {p.nome}
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted3)" }}>
            {p.especialidade}
            {p.bairro ? ` · ${p.bairro}` : ""}
            {p.cidade ? `, ${p.cidade}` : ""}
            {p.distancia_km != null ? ` · ${p.distancia_km} km` : ""}
          </p>
        </div>
        <StatusBadge status={agendamento.status} />
      </div>
      <p className="text-xs mt-1.5" style={{ color: "var(--muted1)" }}>
        {formatDataHora(agendamento.data, agendamento.horario)}
      </p>
      <ErroInline>{erro}</ErroInline>
      {agendamento.status === "agendado" && (
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={() => marcar("concluido")}
            disabled={salvando}
            className="text-xs px-3 py-1.5 rounded-full disabled:opacity-50"
            style={{ background: "#009E86", color: "#FFFFFF" }}
          >
            Marcar como concluído
          </button>
          <button
            type="button"
            onClick={() => marcar("cancelado")}
            disabled={salvando}
            className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-50"
            style={{ color: "var(--muted1)" }}
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}

export function PhysioForm({ onToast }) {
  const [form, setForm] = useState(PHYSIO_INITIAL);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [editando, setEditando] = useState(false);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [crefitoStatus, setCrefitoStatus] = useState(null);
  const [agendamentos, setAgendamentos] = useState([]);
  const fileInputRef = useRef(null);

  // Se a conta já tem cadastro, abre o formulário preenchido em vez de em
  // branco — assim dá pra editar o que já existe, não só criar do zero.
  useEffect(() => {
    let ativo = true;
    meuPainelFisio()
      .then((dados) => {
        if (!ativo || !dados.fisio) {
          // Novo cadastro: rastreia que iniciou o signup
          if (ativo) {
            trackEvent(Events.SIGNUP_STARTED);
          }
          return;
        }
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
        setCrefitoStatus(f.crefito_status || null);
        setAgendamentos(dados.agendamentos || []);
        setEditando(true);
      })
      .catch(() => {
        // Sem cadastro ainda (ou erro ao buscar): segue com o formulário em branco.
        trackEvent(Events.SIGNUP_STARTED);
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

  const atualizarStatusAgendamentoLocal = (id, status) => {
    setAgendamentos((lista) => lista.map((a) => (a.id === id ? { ...a, status } : a)));
    onToast?.(
      status === "concluido" ? "Atendimento marcado como concluído!" : "Atendimento cancelado."
    );
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
    if (!form.nome || !form.whatsapp || !form.cidade || !form.formacao) {
      setErro("Preencha nome, WhatsApp, cidade e formação.");
      return;
    }
    if (!telefoneCompleto(form.whatsapp)) {
      setErro("Informe um WhatsApp válido, com DDD.");
      return;
    }
    if (form.especialidades.length === 0) {
      setErro("Escolha ao menos uma especialidade que você atende.");
      return;
    }
    if (!form.crefito || !form.crefinoUf) {
      setErro("Preencha seu CREFITO e a UF do registro.");
      return;
    }
    if (!crefitoValido(form.crefito)) {
      setErro("Número do CREFITO inválido. Use só o número, com ou sem a letra da categoria (ex: 123456 ou 123456-F).");
      return;
    }
    if (!form.declaracaoCrefito || !form.declaracaoEtica || !form.declaracaoResponsabilidade) {
      setErro("Você precisa aceitar todas as declarações éticas para se cadastrar.");
      return;
    }
    // Só exige a verificação no cadastro novo — quem já está logado editando
    // o próprio perfil não é o risco que o captcha existe pra filtrar.
    if (!editando && turnstileConfigurado() && !turnstileToken) {
      setErro("Confirme a verificação antes de continuar.");
      return;
    }
    if (!editando && turnstileConfigurado()) {
      try {
        const valido = await verificarTurnstile(turnstileToken);
        if (!valido) {
          setErro("Não foi possível confirmar a verificação. Recarregue a página e tente de novo.");
          return;
        }
      } catch (e) {
        // A Edge Function verify-turnstile pode ainda não estar implantada
        // no Supabase — não bloqueia o cadastro por causa disso, já que o
        // token não-vazio checado acima continua valendo como camada
        // mínima. Assim que a função for implantada, essa checagem passa a
        // valer de verdade sem precisar mudar mais nada aqui.
        console.warn("Verificação do Turnstile no servidor indisponível:", e);
      }
    }
    setSaving(true);
    setErro("");
    try {
      await cadastrarFisio(form);
      if (!editando) {
        trackEvent(Events.SIGNUP_COMPLETED, {
          especialidades: form.especialidades.join(", "),
          cidade: form.cidade,
          bairros: form.bairros.join(", "),
        });
      }
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

      {editando && <MfaConfiguracao onToast={onToast} />}

      {editando && (
        <Card>
          <h2 className="text-lg font-medium mb-1">Seus atendimentos</h2>
          <p className="text-sm mb-1" style={{ color: "var(--muted1)" }}>
            Pacientes que fecharam atendimento com você.
          </p>
          {agendamentos.length === 0 ? (
            <Vazio>Você ainda não tem nenhum atendimento fechado.</Vazio>
          ) : (
            agendamentos.map((ag) => (
              <CartaAgendamentoFisio
                key={ag.id}
                agendamento={ag}
                onAtualizado={atualizarStatusAgendamentoLocal}
              />
            ))
          )}
        </Card>
      )}

      <Card>
        <h2 className="text-lg font-medium mb-1">
          {editando ? "Seu cadastro" : "Cadastre-se como fisioterapeuta"}
        </h2>
        <p className="text-sm mb-5" style={{ color: "var(--muted1)" }}>
          {editando
            ? "Altere o que quiser e salve — os pacientes já veem seus dados atualizados."
            : "Apareça na busca de pacientes procurando atendimento domiciliar na sua região."}
        </p>

        {editando && crefitoStatus === "verificado" && (
          <p className="text-sm flex items-center gap-1.5 mb-4" style={{ color: "#2FAE72" }}>
            <ShieldCheck size={15} /> Seu CREFITO foi verificado pela nossa equipe.
          </p>
        )}
        {editando && crefitoStatus === "rejeitado" && (
          <p className="text-sm flex items-center gap-1.5 mb-4" style={{ color: "#C24A3E" }}>
            <ShieldAlert size={15} /> Não conseguimos confirmar seu CREFITO. Confira o número
            cadastrado ou fale com a gente.
          </p>
        )}
        {editando && !form.lat && (
          <p className="text-sm mb-4" style={{ color: "#16C4A8" }}>
            Seu cadastro está sem CEP, então a busca dos pacientes usa só cidade e bairro. Preencha
            o CEP abaixo e salve para aparecer também por distância real, dentro do seu raio de{" "}
            {form.raioKm} km.
          </p>
        )}

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
              placeholder="Ex: 123456 ou 123456-F"
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
                      ? { background: "#009E86", borderColor: "#009E86", color: "#FFFFFF" }
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
          <p className="text-sm font-medium mb-3" style={{ color: "#16C4A8" }}>
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

        {!editando && (
          <div className="mb-4">
            <TurnstileWidget onToken={setTurnstileToken} />
          </div>
        )}

        <ErroInline>{erro}</ErroInline>
        <PrimaryButton
          type="submit"
          loading={saving}
          disabled={!editando && turnstileConfigurado() && !turnstileToken}
        >
          {editando ? "Salvar alterações" : "Cadastrar"} <ArrowRight size={16} />
        </PrimaryButton>
      </form>
    </Card>
    </div>
  );
}
