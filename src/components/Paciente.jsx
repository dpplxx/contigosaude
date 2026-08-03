import { PrototypeWarning } from "./Ethics";
import { BuscaFisios } from "./BuscaFisios";

export function RequestForm() {
  return (
    <div className="space-y-4">
      <PrototypeWarning />
      <BuscaFisios />
    </div>
  );
}
