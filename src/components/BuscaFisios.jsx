import { useCallback, useEffect, useState } from "react";
import { MapPin, Phone, MessageCircle, Loader, ShieldCheck, Star, ChevronDown, ChevronUp, Flag, Share2, Check } from "lucide-react";
import { Card, Field, TextInput, SelectInput, PrimaryButton, StarRow } from "./ui";
import { CepInput } from "./Compartilhados";
import { ESPECIALIDADES_PACIENTE, URGENCIAS, mensagemDeErro, tempoRelativo, waLink } from "../lib/utils";
import { supabase } from "../lib/supabase";
import {
  avaliacoesFisio,
  denunciarAvaliacao,
  registrarEventoMarketplace,
  obterFisioPublico,
} from "../lib/api";
import { normalizarTexto } from "../lib/normalizacao";
import { TurnstileWidget, turnstileConfigurado } from "../lib/turnstile";
import { trackEvent, Events } from "../lib/analytics";

const MOTIVOS_DENUNCIA = [
  { valor: "falsa", label: "Avaliação falsa" },
  { valor: "concorrencia", label: "Concorrência desleal" },
  { valor: "autopromocao", label: "Autopromoção" },
  { valor: "ofensiva", label: "Conteúdo ofensivo" },
  { valor: "publicidade", label: "Publicidade disfarçada" },
  { valor: "outro", label: "Outro motivo" },
];

const BUSCA_INITIAL = {
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

function fisioInicialDaUrl() {
  try {
    return new URLSearchParams(window.location.search).get("fisio") || "";
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
  const [fisioCompartilhado, setFisioCompartilhado] = useState(null);
  const [carregandoPerfil, setCarregandoPerfil] = useState(false);
  // Honeypot: campo escondido de humano nenhum, mas visível pra bot que
  // preenche todo input do formulário. Filtra os robôs mais simples sem
  // depender de captcha pago e sem falso positivo em quem usa autofill
  // (diferente de um filtro por tempo de preenchimento). Se algum dia isso
  // não bastar, dá pra reforçar no backend.
  const [site, setSite] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");

  useEffect(() => {
    const fisioId = fisioInicialDaUrl();

    if (!fisioId) return;

    let ativo = true;

    const carregarPerfil = async () => {
      setCarregandoPerfil(true);
      setErro("");

      try {
        const fisio = await obterFisioPublico(fisioId);

        if (!ativo) return;

        setFisioCompartilhado(fisio);

        trackEvent(Events.PROFILE_OPENED, {
          fisio_id: fisio.id,
          origem: "link_direto",
        });

        registrarEventoMarketplace({
          tipo: "resultado_exibido",
          fisioId: fisio.id,
        }).catch(() => {});
      } catch (e) {
        if (ativo) {
          setErro(mensagemDeErro(e, "Não foi possível carregar o perfil do profissional."));
        }
      } finally {
        if (ativo) {
          setCarregandoPerfil(false);
        }
      }
    };

    carregarPerfil();

    return () => {
      ativo = false;
    };
  }, []);

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
      // Rastreia a intenção de busca.
      // A busca é pública e não cria pedido.
      trackEvent(Events.SEARCH_PERFORMED, {
        especialidade: form.especialidade,
        cidade: form.cidade,
        bairro: form.bairro,
      });
      trackEvent(Events.SPECIALTY_SEARCHED, { especialidade: form.especialidade });
      trackEvent(Events.LOCATION_SEARCHED, { cidade: form.cidade, bairro: form.bairro });

      // Busca os fisioterapeutas compatíveis.
      const { data, error } = await supabase.rpc("hc_listar_fisios", {
        p_especialidade: form.especialidade,
        p_cidade: form.cidade,
        p_bairro: form.bairro,
        p_lat: form.lat,
        p_lng: form.lng,
      });

      if (error) throw error;

      const resultados = data || [];

      if (resultados.length > 0) {
        trackEvent(Events.PROFESSIONAL_APPEARED, { count: resultados.length });
      } else {
        trackEvent(Events.SEARCH_NO_RESULTS, {
          especialidade: form.especialidade,
          cidade: form.cidade,
          bairro: form.bairro,
        });
      }

      // Registra a busca.
      // Se o analytics falhar, a busca continua normalmente.
      registrarEventoMarketplace({
        tipo: "busca",
        especialidade: form.especialidade,
        cidade: form.cidade,
        uf: form.uf,
        quantidadeResultados: resultados.length,
      }).catch(() => {});

      // Registra quais profissionais foram efetivamente apresentados.
      // Não usamos await para não atrasar a interface.
      resultados.forEach((fisio) => {
        registrarEventoMarketplace({
          tipo: "resultado_exibido",
          fisioId: fisio.id,
          especialidade: form.especialidade,
          cidade: form.cidade,
          uf: form.uf,
        }).catch(() => {});
      });

      setFisios(resultados);
    } catch (e) {
      setErro(mensagemDeErro(e, "Erro ao buscar profissionais."));
    } finally {
      setLoading(false);
    }
  };

  if (fisioInicialDaUrl()) {
    if (carregandoPerfil) {
      return (
        <Card>
          <div className="flex items-center gap-2">
            <Loader size={18} className="animate-spin" />
            Carregando perfil...
          </div>
        </Card>
      );
    }

    if (erro) {
      return (
        <Card>
          <div className="text-sm" style={{ color: "#C24A3E" }}>
            {erro}
          </div>
        </Card>
      );
    }

    if (fisioCompartilhado) {
      return (
        <PerfilCompartilhado
          fisio={fisioCompartilhado}
          onVoltar={() => {
            window.history.replaceState({}, "", window.location.pathname);
            setFisioCompartilhado(null);
          }}
        />
      );
    }
  }

  if (fisios !== null) {
    return <ListaFisios fisios={fisios} onVoltar={() => setFisios(null)} />;
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

          <Field label="Tipo de atendimento">
            <SelectInput value={form.especialidade} onChange={set("especialidade")}>
              {ESPECIALIDADES_PACIENTE.map((e) => (
                <option key={e} value={e}>
                  {e}
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

          {erro && <div style={{ color: "#C24A3E", fontSize: "0.875rem" }}>{erro}</div>}

          <PrimaryButton
            type="submit"
            disabled={
              loading ||
              !form.cidade ||
              !form.bairro ||
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

function ListaFisios({ fisios, onVoltar }) {
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium">
            {fisios.length} profissional{fisios.length !== 1 ? "is" : ""} encontrado{fisios.length !== 1 ? "s" : ""}
          </h2>
          <button onClick={onVoltar} className="text-sm underline" style={{ color: "#16C4A8" }}>
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
              <CartaFisio key={fisio.id} fisio={fisio} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function DenunciarAvaliacao({ avaliacaoId }) {
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState("");

  const enviar = async () => {
    if (!motivo) return;
    setEnviando(true);
    setErro("");
    try {
      await denunciarAvaliacao({ avaliacaoId, motivo });
      setEnviado(true);
      setAberto(false);
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível enviar a denúncia."));
    } finally {
      setEnviando(false);
    }
  };

  if (enviado) {
    return (
      <p className="text-xs mt-1" style={{ color: "var(--muted3)" }}>
        Denúncia enviada — nossa equipe vai analisar.
      </p>
    );
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="flex items-center gap-1 text-xs mt-1"
        style={{ color: "var(--muted3)" }}
      >
        <Flag size={11} /> Denunciar
      </button>
    );
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <select
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        className="text-xs rounded border outline-none py-1 px-1.5"
        style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--text)" }}
      >
        <option value="">Por quê?</option>
        {MOTIVOS_DENUNCIA.map((m) => (
          <option key={m.valor} value={m.valor}>
            {m.label}
          </option>
        ))}
      </select>
      <button
        onClick={enviar}
        disabled={!motivo || enviando}
        className="text-xs underline disabled:opacity-50"
        style={{ color: "#C24A3E" }}
      >
        {enviando ? "Enviando..." : "Enviar"}
      </button>
      <button
        onClick={() => setAberto(false)}
        className="text-xs underline"
        style={{ color: "var(--muted3)" }}
      >
        Cancelar
      </button>
      {erro && <span className="text-xs w-full" style={{ color: "#C24A3E" }}>{erro}</span>}
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
            avaliacoes?.map((a) => (
              <div key={a.id} className="pt-2" style={{ borderTop: "1px solid var(--border)" }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <StarRow value={a.nota} size={12} />
                    <span className="text-xs font-medium" style={{ color: "var(--muted1)" }}>
                      {a.nome_avaliador || "Anônimo"}
                    </span>
                  </div>
                  <span className="text-xs" style={{ color: "var(--muted3)" }}>
                    {tempoRelativo(a.criado_em)}
                  </span>
                </div>
                {a.comentario && (
                  <p className="text-xs mt-1" style={{ color: "var(--muted4)" }}>
                    {a.comentario}
                  </p>
                )}
                <DenunciarAvaliacao avaliacaoId={a.id} />
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function CartaFisio({ fisio }) {
  const [copiado, setCopiado] = useState(false);

  const handleWhatsAppClick = () => {
    trackEvent(Events.WHATSAPP_CLICKED, {
      fisio_id: fisio.id,
    });
    registrarEventoMarketplace({
      tipo: "whatsapp_clique",
      fisioId: fisio.id,
    }).catch(() => {});
  };

  const handleProfileClick = () => {
    trackEvent(Events.PROFILE_OPENED, {
      fisio_id: fisio.id,
    });
  };

  const handleShare = async (e) => {
    e.stopPropagation();
    trackEvent(Events.PROFILE_SHARED, { fisio_id: fisio.id });

    const texto = `${fisio.nome} — fisioterapeuta${fisio.bairro ? ` em ${fisio.bairro}` : ""}. Encontrei no Contigo Saúde:`;
    const url = `${window.location.origin}${window.location.pathname}?fisio=${encodeURIComponent(fisio.id)}`;

    try {
      if (navigator.share) {
        await navigator.share({ title: fisio.nome, text: texto, url });
        return;
      }
    } catch {
      // Usuário cancelou o compartilhamento nativo — não é erro, só não faz nada.
      return;
    }

    try {
      await navigator.clipboard.writeText(`${texto} ${url}`);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sem clipboard disponível (ex.: contexto não seguro) — sem fallback melhor aqui.
    }
  };

  return (
    <div
      className="border rounded-lg p-4 flex gap-4"
      style={{ borderColor: "var(--border)" }}
      onClick={handleProfileClick}
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
              style={{ color: "#2FAE72" }}
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
              <Star size={13} fill="#16C4A8" style={{ color: "#16C4A8" }} />
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
                className="text-xs px-2 py-1 rounded-full"
                style={{ background: "#009E8622", color: "#007F6C" }}
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
          onClick={handleWhatsAppClick}
          className="flex items-center gap-2 px-3 py-2 rounded text-xs font-medium"
          style={{ background: "#25D366", color: "white" }}
        >
          <MessageCircle size={14} />
          WhatsApp
        </a>
        <button
          onClick={handleShare}
          className="flex items-center gap-2 px-3 py-2 rounded text-xs font-medium border"
          style={{ borderColor: "var(--border)", color: "var(--muted1)" }}
        >
          {copiado ? <Check size={14} /> : <Share2 size={14} />}
          {copiado ? "Copiado!" : "Compartilhar"}
        </button>
      </div>
    </div>
  );
}

function PerfilCompartilhado({ fisio, onVoltar }) {
  const [copiado, setCopiado] = useState(false);

  const handleWhatsAppClick = () => {
    trackEvent(Events.WHATSAPP_CLICKED, {
      fisio_id: fisio.id,
      origem: "perfil_compartilhado",
    });

    registrarEventoMarketplace({
      tipo: "whatsapp_clique",
      fisioId: fisio.id,
    }).catch(() => {});
  };

  const handleShare = async () => {
    trackEvent(Events.PROFILE_SHARED, { fisio_id: fisio.id });

    const url = `${window.location.origin}${window.location.pathname}?fisio=${encodeURIComponent(fisio.id)}`;
    const texto = `${fisio.nome} — fisioterapeuta${fisio.bairro ? ` em ${fisio.bairro}` : ""}. Encontrei no Contigo Saúde:`;

    try {
      if (navigator.share) {
        await navigator.share({ title: fisio.nome, text: texto, url });
        return;
      }
    } catch {
      return;
    }

    try {
      await navigator.clipboard.writeText(`${texto} ${url}`);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sem clipboard disponível — sem fallback melhor aqui.
    }
  };

  return (
    <div className="space-y-4">
      <button onClick={onVoltar} className="text-sm underline" style={{ color: "#16C4A8" }}>
        ← Voltar para busca
      </button>

      <Card>
        <div className="flex flex-col items-center text-center">
          {fisio.foto_url ? (
            <img
              src={fisio.foto_url}
              alt={fisio.nome}
              className="w-28 h-28 rounded-full object-cover"
            />
          ) : (
            <div
              className="w-28 h-28 rounded-full flex items-center justify-center"
              style={{ background: "var(--card)" }}
            >
              <Phone size={42} style={{ color: "var(--muted)" }} />
            </div>
          )}

          <h1 className="text-2xl font-semibold mt-4">{fisio.nome}</h1>

          {fisio.formacao && (
            <p className="text-sm mt-1" style={{ color: "var(--muted1)" }}>
              {fisio.formacao}
            </p>
          )}

          {fisio.bairro && (
            <div className="flex items-center gap-1 text-sm mt-3" style={{ color: "var(--muted1)" }}>
              <MapPin size={15} />
              {fisio.bairro}
              {fisio.cidade ? `, ${fisio.cidade}` : ""}
              {fisio.uf ? ` - ${fisio.uf}` : ""}
            </div>
          )}

          {fisio.crefito && (
            <div className="mt-3">
              {fisio.crefito_status === "verificado" ? (
                <span className="flex items-center gap-1 text-sm" style={{ color: "#2FAE72" }}>
                  <ShieldCheck size={15} />
                  CREFITO verificado{fisio.crefito_uf ? ` (${fisio.crefito_uf})` : ""}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-sm" style={{ color: "var(--muted1)" }}>
                  <ShieldCheck size={15} />
                  CREFITO informado
                </span>
              )}
            </div>
          )}

          {fisio.total_avaliacoes > 0 && (
            <div className="flex items-center gap-2 mt-4">
              <Star size={18} fill="#16C4A8" style={{ color: "#16C4A8" }} />
              <strong>{fisio.nota_media}</strong>
              <span className="text-sm" style={{ color: "var(--muted1)" }}>
                ({fisio.total_avaliacoes} {fisio.total_avaliacoes === 1 ? "avaliação" : "avaliações"})
              </span>
            </div>
          )}

          {fisio.especialidades?.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2 mt-5">
              {fisio.especialidades.map((esp) => (
                <span
                  key={esp}
                  className="text-xs px-3 py-1.5 rounded-full"
                  style={{ background: "#009E8622", color: "#007F6C" }}
                >
                  {esp}
                </span>
              ))}
            </div>
          )}

          {fisio.resumo && (
            <div className="w-full text-left mt-6">
              <h2 className="font-medium mb-2">Sobre o profissional</h2>
              <p className="text-sm leading-relaxed" style={{ color: "var(--muted1)" }}>
                {fisio.resumo}
              </p>
            </div>
          )}

          <a
            href={waLink(
              fisio.whatsapp,
              "Oi, encontrei seu perfil no Contigo Saúde. Gostaria de saber mais sobre o atendimento."
            )}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleWhatsAppClick}
            className="flex items-center justify-center gap-2 w-full mt-6 px-4 py-3 rounded-lg font-medium"
            style={{ background: "#25D366", color: "white" }}
          >
            <MessageCircle size={18} />
            Falar com {fisio.nome.split(" ")[0]} pelo WhatsApp
          </a>

          <button
            onClick={handleShare}
            className="flex items-center justify-center gap-2 w-full mt-3 px-4 py-3 rounded-lg font-medium border"
            style={{ borderColor: "var(--border)", color: "var(--muted1)" }}
          >
            {copiado ? <Check size={18} /> : <Share2 size={18} />}
            {copiado ? "Copiado!" : "Compartilhar perfil"}
          </button>
        </div>
      </Card>

      {fisio.total_avaliacoes > 0 && (
        <Card>
          <h2 className="font-medium mb-3">Avaliações</h2>
          <AvaliacoesFisio fisioId={fisio.id} />
        </Card>
      )}
    </div>
  );
}
