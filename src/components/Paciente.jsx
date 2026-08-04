import { useState } from "react";
import { ClipboardList, Search } from "lucide-react";
import { PrototypeWarning } from "./Ethics";
import { BuscaFisios } from "./BuscaFisios";
import { MeusAtendimentos } from "./MeusAtendimentos";
import { TabButton } from "./ui";

export function RequestForm({ sessao }) {
  const [aba, setAba] = useState("buscar");

  return (
    <div className="space-y-4">
      <PrototypeWarning />

      {/* Sem sessão (ex.: link de perfil compartilhado) não tem "meus
          atendimentos" pra mostrar — hc_meus_pedidos exige conta logada. */}
      {sessao && (
        <div className="flex gap-2">
          <TabButton active={aba === "buscar"} onClick={() => setAba("buscar")}>
            <Search size={14} /> Buscar profissional
          </TabButton>
          <TabButton active={aba === "atendimentos"} onClick={() => setAba("atendimentos")}>
            <ClipboardList size={14} /> Meus atendimentos
          </TabButton>
        </div>
      )}

      {aba === "atendimentos" && sessao ? <MeusAtendimentos /> : <BuscaFisios />}
    </div>
  );
}
