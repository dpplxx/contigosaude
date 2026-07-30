import React, { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Card, PrimaryButton, TextInput } from "./ui";

function validarCREFITO(valor) {
  if (!valor || !valor.trim()) return false;
  const padrao = /^CREFITO\/[A-Z]{2}\s\d{6}$/i;
  return padrao.test(valor.trim());
}

function formatarCREFITO(bruto) {
  const limpo = bruto.replace(/\s+/g, " ").toUpperCase().trim();
  if (!limpo.startsWith("CREFITO")) return limpo;
  const partes = limpo.split("/");
  if (partes.length !== 2) return limpo;
  const [prefix, resto] = partes;
  const digitos = resto.replace(/\D/g, "").slice(0, 6);
  const uf = resto.replace(/\d/g, "").trim().slice(0, 2);
  if (!uf || !digitos) return limpo;
  return `${prefix}/${uf} ${digitos}`;
}

export function VerificacaoCREFITO({ onVerificado }) {
  const [crefito, setCrefito] = useState("");

  const valido = validarCREFITO(crefito);

  const handleChange = (e) => {
    setCrefito(formatarCREFITO(e.target.value));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (valido) {
      onVerificado?.(crefito.trim());
    }
  };

  return (
    <Card>
      <div className="flex items-start gap-3 mb-4">
        <CheckCircle2 size={20} style={{ color: "#C6693D", flexShrink: 0, marginTop: 2 }} />
        <div>
          <h2 className="text-lg font-medium mb-1">Verifique seu registro profissional</h2>
          <p className="text-sm" style={{ color: "var(--muted1)" }}>
            Para garantir que você é um fisioterapeuta registrado, pedimos seu número CREFITO.
            <br />
            Formato: <code style={{ background: "var(--bg-soft)", padding: "2px 4px" }}>CREFITO/SP 123456</code>
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="text-sm font-medium block mb-2" style={{ color: "var(--text)" }}>
            Número CREFITO
          </label>
          <TextInput
            value={crefito}
            onChange={handleChange}
            placeholder="Ex: CREFITO/SP 123456"
            autoFocus
          />
          <p className="text-xs mt-2" style={{ color: "var(--muted2)" }}>
            Seu CREFITO é confidencial e não será compartilhado com pacientes.
          </p>
        </div>

        <PrimaryButton type="submit" disabled={!valido} className="w-full">
          Verificar CREFITO
        </PrimaryButton>
      </form>
    </Card>
  );
}
