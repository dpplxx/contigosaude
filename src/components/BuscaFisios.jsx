import { useCallback, useState } from "react";
import { MapPin, Phone, MessageCircle, Loader } from "lucide-react";
import { Card, Field, TextInput, SelectInput, PrimaryButton } from "./ui";
import { CepInput, PhoneGate } from "./Compartilhados";
import { ESPECIALIDADES_PACIENTE, mensagemDeErro, waLink } from "../lib/utils";
import { supabase } from "../lib/supabase";
import { criarPedido } from "../lib/api";

const BUSCA_INITIAL = {
  nome: "",
  whatsapp: "",
  especialidade: ESPECIALIDADES_PACIENTE[0],
  cep: "",
  cidade: "",
  bairro: "",
  uf: "",
  lat: null,
  lng: null,
};

export function BuscaFisios() {
  const [form, setForm] = useState(BUSCA_INITIAL);
  const [fisios, setFisios] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");

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
    if (!form.cidade || !form.bairro) {
      setErro("Informe a cidade e o bairro.");
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
                placeholder="Ex: São Paulo"
                disabled={loading}
              />
            </Field>
            <Field label="Bairro">
              <TextInput
                value={form.bairro}
                onChange={set("bairro")}
                placeholder="Ex: Tatuapé"
                disabled={loading}
              />
            </Field>
          </div>

          {erro && <div style={{ color: "#D98C6E", fontSize: "0.875rem" }}>{erro}</div>}

          <PrimaryButton type="submit" disabled={loading || !form.cidade || !form.bairro || !form.whatsapp}>
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
