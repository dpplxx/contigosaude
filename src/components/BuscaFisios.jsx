import { useCallback, useState } from "react";
import { MapPin, Phone, MessageCircle, Loader, ShieldCheck, Star, ChevronDown, ChevronUp } from "lucide-react";
import { Card, Field, TextInput, SelectInput, PrimaryButton, StarRow } from "./ui";
import { CepInput } from "./Compartilhados";
import { ESPECIALIDADES_PACIENTE, URGENCIAS, mensagemDeErro, tempoRelativo, waLink } from "../lib/utils";
import { supabase } from "../lib/supabase";
import { criarPedido, avaliacoesFisio } from "../lib/api";
import { normalizarTexto } from "../lib/normalizacao";
import { TurnstileWidget, turnstileConfigurado } from "../lib/turnstile";

const BUSCA_INITIAL = {
  nome: "",
  whatsapp: "",
  especialidade: ESPECIALIDADES_PACIENTE[0],
  urgencia: URGENCIAS[0],
  cep: "",
  cidade: "",
  bairro: "",
  uf: "",
  lat: null,
  lng: null,
};

// As páginas de SEO por cidade (ex.: /fisioterapia-domiciliar/serra) linkam
// para cá com ?cidade=Serra, pra pessoa não ter que redigitar o que já disse
// na página de origem.
function cidadeInicialDaUrl() {
  try {
    return new URLSearchParams(window.location.search).get("cidade") || "";
  } catch {
    return "";
  }
}

export function BuscaFisios() {
  const [form, setForm] = useState(() => ({
    ...BUSCA_INITIAL,
    cidade: cidadeInicialDaUrl(),
  }));
  const [fisios, setFisios] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");
  // Honeypot: campo escondido de humano nenhum, mas visível pra bot que
  // preenche todo input do formulário. Filtra os robôs mais simples sem
  // depender de captcha pago e sem falso positivo em quem usa autofill
  // (diferente de um filtro por tempo de preenchimento). Se algum dia isso
  // não bastar, dá pra reforçar no backend.
  const [site, setSite] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const aplicarEndereco = (endereco) =>
    setForm((f) => ({
      ...f,
      cep: endereco.cep,
      cidade: endereco.cidade || f.cidade,
      bairro: endereco.bairro || f.bairro,
      uf: endereco.uf || f.uf,
      lat: endereco.lat,
      lng: endereco.lng,
    }));

  const buscar = async (e) => {
    e?.preventDefault?.();
    // Preencheu o campo escondido: provavelmente é robô. Sai calado, sem
    // dar pista de que foi barrado.
    if (site) {
      return;
    }
    if (!form.cidade || !form.bairro) {
      setErro("Informe a cidade e o bairro.");
      return;
    }
    if (turnstileConfigurado() && !turnstileToken) {
      setErro("Confirme a verificação antes de continuar.");
      return;
    }

    setLoading(true);
    setErro("");
    setFisios(null);

    try {
      // Cria o pedido no Supabase para registrar a demanda
      await criarPedido(form);

      // Busca os fisios compatíveis
      const { data, error } = await supabase.rpc("hc_listar_fisios", {
        p_especialidade: form.especialidade,
        p_cidade: form.cidade,
        p_bairro: form.bairro,
        p_lat: form.lat,
        p_lng: form.lng,
      });

      if (error) throw error;
      setFisios(data || []);
    } catch (e) {
      setErro(mensagemDeErro(e, "Erro ao buscar profissionais."));
    } finally {
      setLoading(false);
    }
  };

  if (form.whatsapp && fisios !== null) {
    return <ListaFisios fisios={fisios} onVoltar={() => setFisios(null)} whatsappPaciente={form.whatsapp} />;
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-lg font-medium mb-1">Busque um fisioterapeuta perto de você</h2>
        <p className="text-sm mb-5" style={{ color: "var(--muted1)" }}>
          Encontre profissionais disponíveis na sua região e entre em contato direto pelo WhatsApp.
        </p>

        <form onSubmit={buscar} className="space-y-4">
          <input
            type="text"
            name="site"
            value={site}
            onChange={(e) => setSite(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
          />

          <Field label="Seu nome (ou quem vai receber o atendimento)">
            <TextInput
              value={form.nome}
              onChange={set("nome")}
              placeholder="Ex: Maria Silva"
            />
          </Field>

          <Field label="WhatsApp para contato">
            <TextInput
              value={form.whatsapp}
              onChange={set("whatsapp")}
              placeholder="Ex: (11) 98765-4321"
              disabled={loading}
            />
          </Field>

          <Field label="Tipo de atendimento">
            <SelectInput value={form.especialidade} onChange={set("especialidade")}>
              {ESPECIALIDADES_PACIENTE.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </SelectInput>
          </Field>

          <Field label="Quando você precisa do atendimento?">
            <SelectInput value={form.urgencia} onChange={set("urgencia")}>
              {URGENCIAS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </SelectInput>
          </Field>

          <CepInput
            valor={form.cep}
            onChange={(cep) => setForm((f) => ({ ...f, cep }))}
            onResolvido={aplicarEndereco}
            ajuda="Usamos para achar quem atende perto de você."
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <Field label="Cidade">
              <TextInput
                value={form.cidade}
                onChange={set("cidade")}
                placeholder="Ex: São Paulo (ou Sao Paulo)"
                disabled={loading}
              />
              <p className="text-xs mt-1" style={{ color: "var(--muted2)" }}>
                💡 Funciona sem acentos: "Sao Paulo", "Santos", etc
              </p>
            </Field>
            <Field label="Bairro">
              <TextInput
                value={form.bairro}
                onChange={set("bairro")}
                placeholder="Ex: Tatuapé (ou Tatuape)"
                disabled={loading}
              />
              <p className="text-xs mt-1" style={{ color: "var(--muted2)" }}>
                💡 Funciona sem acentos: "Tatuape", "Centro", etc
              </p>
            </Field>
          </div>

          <TurnstileWidget onToken={setTurnstileToken} />

          {erro && <div style={{ color: "#D98C6E", fontSize: "0.875rem" }}>{erro}</div>}

          <PrimaryButton
            type="submit"
            disabled={
              loading ||
              !form.cidade ||
              !form.bairro ||
              !form.whatsapp ||
              (turnstileConfigurado() && !turnstileToken)
            }
          >
            {loading ? (
              <>
                <Loader size={16} className="animate-spin" /> Buscando...
              </>
            ) : (
              "Buscar profissionais"
            )}
          </PrimaryButton>
        </form>
      </Card>
    </div>
  );
}

function ListaFisios({ fisios, onVoltar, whatsappPaciente }) {
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium">
            {fisios.length} profissional{fisios.length !== 1 ? "is" : ""} encontrado{fisios.length !== 1 ? "s" : ""}
          </h2>
          <button onClick={onVoltar} className="text-sm underline" style={{ color: "#E3A873" }}>
            Nova busca
          </button>
        </div>

        {fisios.length === 0 ? (
          <div style={{ color: "var(--muted1)", fontSize: "0.875rem" }}>
            Nenhum profissional disponível nessa região. Tente outra localidade.
          </div>
        ) : (
          <div className="grid gap-4">
            {fisios.map((fisio) => (
              <CartaFisio key={fisio.id} fisio={fisio} whatsappPaciente={whatsappPaciente} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function AvaliacoesFisio({ fisioId }) {
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [avaliacoes, setAvaliacoes] = useState(null);

  const alternar = async () => {
    if (aberto) {
      setAberto(false);
      return;
    }
    setAberto(true);
    if (avaliacoes !== null) return;
    setCarregando(true);
    try {
      const lista = await avaliacoesFisio(fisioId);
      setAvaliacoes(lista);
    } catch {
      setAvaliacoes([]);
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="mt-2">
      <button
        onClick={alternar}
        className="flex items-center gap-1 text-xs underline"
        style={{ color: "var(--muted1)" }}
      >
        {aberto ? "Ocultar avaliações" : "Ver avaliações"}
        {aberto ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {aberto && (
        <div className="mt-2 space-y-2">
          {carregando && (
            <p className="text-xs" style={{ color: "var(--muted2)" }}>
              Carregando avaliações...
            </p>
          )}
          {!carregando && avaliacoes?.length === 0 && (
            <p className="text-xs" style={{ color: "var(--muted2)" }}>
              Nenhum comentário ainda.
            </p>
          )}
          {!carregando &&
            avaliacoes?.map((a, i) => (
              <div key={i} className="pt-2" style={{ borderTop: "1px solid var(--border)" }}>
                <div className="flex items-center justify-between gap-2">
                  <StarRow value={a.nota} size={12} />
                  <span className="text-xs" style={{ color: "var(--muted3)" }}>
                    {tempoRelativo(a.criado_em)}
                  </span>
                </div>
                {a.comentario && (
                  <p className="text-xs mt-1" style={{ color: "var(--muted4)" }}>
                    {a.comentario}
                  </p>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function CartaFisio({ fisio, whatsappPaciente }) {
  return (
    <div
      className="border rounded-lg p-4 flex gap-4"
      style={{ borderColor: "var(--border)" }}
    >
      {/* Foto */}
      {fisio.foto_url ? (
        <img
          src={fisio.foto_url}
          alt={fisio.nome}
          className="w-20 h-20 rounded-lg object-cover flex-shrink-0"
        />
      ) : (
        <div
          className="w-20 h-20 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "var(--card)" }}
        >
          <Phone size={32} style={{ color: "var(--muted)" }} />
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-base">{fisio.nome}</h3>

        {fisio.formacao && (
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            {fisio.formacao}
          </p>
        )}

        {fisio.bairro && (
          <div className="flex items-center gap-1 mt-2 text-xs" style={{ color: "var(--muted1)" }}>
            <MapPin size={14} />
            {fisio.bairro}
            {fisio.distancia_km && ` • ${fisio.distancia_km.toFixed(1)} km`}
          </div>
        )}

        <div className="flex items-center gap-3 mt-2 flex-wrap">
          {fisio.crefito && fisio.crefito_status === "verificado" && (
            <span
              className="flex items-center gap-1 text-xs"
              style={{ color: "#8FAE8B" }}
              title="Registro profissional conferido pela nossa equipe"
            >
              <ShieldCheck size={13} />
              CREFITO verificado{fisio.crefito_uf ? ` (${fisio.crefito_uf})` : ""}
            </span>
          )}
          {fisio.crefito && fisio.crefito_status !== "verificado" && (
            <span
              className="flex items-center gap-1 text-xs"
              style={{ color: "var(--muted1)" }}
              title="Número informado no cadastro, ainda não conferido pela nossa equipe"
            >
              <ShieldCheck size={13} />
              CREFITO informado{fisio.crefito_uf ? ` (${fisio.crefito_uf})` : ""}
            </span>
          )}
          {fisio.total_avaliacoes > 0 && (
            <span className="flex items-center gap-1 text-xs" style={{ color: "var(--muted1)" }}>
              <Star size={13} fill="#E3A873" style={{ color: "#E3A873" }} />
              {fisio.nota_media} ({fisio.total_avaliacoes}{" "}
              {fisio.total_avaliacoes === 1 ? "avaliação" : "avaliações"})
            </span>
          )}
        </div>

        {fisio.total_avaliacoes > 0 && <AvaliacoesFisio fisioId={fisio.id} />}

        {fisio.especialidades && fisio.especialidades.length > 0 && (
          <div className="flex gap-1 flex-wrap mt-3">
            {fisio.especialidades.slice(0, 2).map((esp) => (
              <span
                key={esp}
                className="text-xs px-2 py-1 rounded"
                style={{ background: "rgba(199, 105, 61, 0.15)", color: "#E3A873" }}
              >
                {esp}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Botão */}
      <div className="flex flex-col gap-2 justify-center ml-4">
        <a
          href={waLink(fisio.whatsapp, `Oi, encontrei seu perfil no Contigo Saúde. Gostaria de agendar uma sessão!`)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2 rounded text-xs font-medium"
          style={{ background: "#25D366", color: "white" }}
        >
          <MessageCircle size={14} />
          WhatsApp
        </a>
      </div>
    </div>
  );
}
