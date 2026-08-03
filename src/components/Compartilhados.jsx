import { useState } from "react";
import { Check, Loader2, MapPin } from "lucide-react";
import { Field, TextInput } from "./ui";
import { cepCompleto, consultarCep, formatarCep } from "../lib/geo";

/**
 * Campo de CEP que preenche cidade, bairro e coordenadas sozinho.
 *
 * Se a consulta falhar, não trava nada: os campos de cidade e bairro ficam
 * editáveis e a pessoa digita na mão. O pedido é salvo do mesmo jeito, só sem
 * a distância exata.
 */
export function CepInput({ valor, onChange, onResolvido, ajuda, label }) {
  const [status, setStatus] = useState("vazio");
  const [erro, setErro] = useState("");

  const consultar = async (bruto) => {
    if (!cepCompleto(bruto)) return;
    setStatus("buscando");
    setErro("");
    try {
      const endereco = await consultarCep(bruto);
      onResolvido?.(endereco);
      setStatus(endereco.lat !== null ? "ok" : "semCoordenada");
    } catch (e) {
      setStatus("erro");
      setErro(
        /não encontrado/i.test(e?.message || "")
          ? "CEP não encontrado. Confira o número ou preencha cidade e bairro abaixo."
          : "Não conseguimos consultar o CEP agora. Preencha cidade e bairro abaixo."
      );
    }
  };

  const aoDigitar = (e) => {
    const formatado = formatarCep(e.target.value);
    onChange(formatado);
    if (status !== "vazio") setStatus("vazio");
    if (cepCompleto(formatado)) consultar(formatado);
  };

  return (
    <Field label={label || "CEP do endereço do atendimento"}>
      <div className="relative">
        <TextInput
          value={valor}
          onChange={aoDigitar}
          onBlur={() => consultar(valor)}
          placeholder="00000-000"
          inputMode="numeric"
          autoComplete="postal-code"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2">
          {status === "buscando" && (
            <Loader2 size={16} className="animate-spin" style={{ color: "#7A8580" }} />
          )}
          {(status === "ok" || status === "semCoordenada") && (
            <Check size={16} style={{ color: "#5E7F5A" }} />
          )}
        </span>
      </div>
      {status === "ok" && (
        <p className="text-xs mt-1.5 flex items-center gap-1" style={{ color: "#2FAE72" }}>
          <MapPin size={12} /> Endereço localizado.{" "}
          {ajuda || "Usamos isso só para calcular a distância — o endereço exato não aparece publicamente."}
        </p>
      )}
      {status === "semCoordenada" && (
        <p className="text-xs mt-1.5" style={{ color: "var(--muted2)" }}>
          Endereço preenchido, mas não conseguimos a localização exata. O match vai usar cidade e
          bairro.
        </p>
      )}
      {status === "erro" && (
        <p className="text-xs mt-1.5" style={{ color: "#C24A3E" }}>
          {erro}
        </p>
      )}
    </Field>
  );
}
