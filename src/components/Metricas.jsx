import { Award, MousePointerClick } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, StarRow, Vazio } from "./ui";
import { pluralAvaliacoes } from "../lib/utils";

// Posição estável e pseudo-aleatória a partir do nome do bairro. Não é
// coordenada real: serve só para ver onde os pontos se agrupam.
function hashPos(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) & 0xffffffff;
  }
  return {
    x: Math.abs(hash % 1000) / 1000,
    y: Math.abs((hash >> 3) % 1000) / 1000,
  };
}

function MapaRelativo({ pedidos, fisios }) {
  const chaves = new Map();

  pedidos
    .filter((r) => r.status !== "arquivado" && r.cidade && r.bairro)
    .forEach((r) => {
      const key = `${r.cidade.toLowerCase()}|${r.bairro.toLowerCase()}`;
      if (!chaves.has(key))
        chaves.set(key, { cidade: r.cidade, bairro: r.bairro, pacientes: 0, fisios: 0 });
      chaves.get(key).pacientes += 1;
    });

  fisios
    .filter((p) => p.cidade && p.bairros?.length)
    .forEach((p) => {
      p.bairros.forEach((b) => {
        const key = `${p.cidade.toLowerCase()}|${b.toLowerCase()}`;
        if (!chaves.has(key))
          chaves.set(key, { cidade: p.cidade, bairro: b, pacientes: 0, fisios: 0 });
        chaves.get(key).fisios += 1;
      });
    });

  const nodes = Array.from(chaves.values());

  if (nodes.length === 0) {
    return <Vazio>Sem dados suficientes pra mostrar o mapa ainda.</Vazio>;
  }

  return (
    <div>
      <p className="text-xs mb-3" style={{ color: "var(--muted2)" }}>
        Posições aproximadas por bairro — não são coordenadas geográficas reais, é só pra ver onde
        há cluster de pedidos e de fisios.
      </p>
      <div
        className="relative rounded-xl"
        style={{ height: 260, background: "var(--card-inner)", border: "1px solid var(--border)" }}
      >
        {nodes.map((n, i) => {
          const { x, y } = hashPos(n.cidade + n.bairro);
          return (
            <div
              key={i}
              className="absolute flex flex-col items-center"
              style={{
                left: `${8 + x * 80}%`,
                top: `${10 + y * 70}%`,
                transform: "translate(-50%, -50%)",
              }}
              title={`${n.bairro}, ${n.cidade} · ${n.pacientes} pedido(s) · ${n.fisios} fisio(s)`}
            >
              <div className="flex gap-1 items-end justify-center">
                {n.pacientes > 0 && (
                  <div
                    className="rounded-full"
                    style={{
                      width: Math.min(10 + n.pacientes * 4, 28),
                      height: Math.min(10 + n.pacientes * 4, 28),
                      background: "#E2685C88",
                      border: "1px solid #E2685C",
                    }}
                  />
                )}
                {n.fisios > 0 && (
                  <div
                    className="rounded-full"
                    style={{
                      width: Math.min(10 + n.fisios * 4, 28),
                      height: Math.min(10 + n.fisios * 4, 28),
                      background: "#2FAE7288",
                      border: "1px solid #2FAE72",
                    }}
                  />
                )}
              </div>
              <span
                className="text-[10px] mt-1 text-center truncate"
                style={{ color: "var(--muted1)", maxWidth: 70 }}
              >
                {n.bairro}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex gap-4 mt-2 text-xs" style={{ color: "var(--muted2)" }}>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block rounded-full"
            style={{ width: 10, height: 10, background: "#E2685C" }}
          />
          Pacientes
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block rounded-full"
            style={{ width: 10, height: 10, background: "#2FAE72" }}
          />
          Fisioterapeutas
        </span>
      </div>
    </div>
  );
}

export function Metricas({ dados }) {
  const { fisios, pedidos, avaliacoes, agendamentos } = dados;

  const seteDiasMs = 7 * 24 * 60 * 60 * 1000;
  const pedidos7dias = pedidos.filter(
    (r) => Date.now() - new Date(r.criado_em).getTime() <= seteDiasMs
  ).length;

  const contagem = {};
  pedidos.forEach((r) => {
    contagem[r.especialidade] = (contagem[r.especialidade] || 0) + 1;
  });
  const dadosGrafico = Object.entries(contagem)
    .map(([especialidade, total]) => ({ especialidade, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const taxaAgendamento =
    pedidos.length > 0 ? Math.round((agendamentos.length / pedidos.length) * 100) : 0;

  const mediasPorFisio = fisios
    .map((p) => {
      const notas = avaliacoes.filter(
        (a) => a.fisio_id === p.id && a.status !== "removida"
      );
      const media = notas.length > 0 ? notas.reduce((s, a) => s + a.nota, 0) / notas.length : null;
      return { p, media, count: notas.length };
    })
    .filter((x) => x.media !== null)
    .sort((a, b) => b.media - a.media || b.count - a.count);

  const melhorAvaliado = mediasPorFisio[0];
  const maisAcionado = [...fisios].sort(
    (a, b) => (b.contador_cliques || 0) - (a.contador_cliques || 0)
  )[0];

  return (
    <div className="space-y-6">
      <Card>
        <p className="text-sm" style={{ color: "var(--muted1)" }}>
          Números gerais pra acompanhar a saúde do marketplace e decidir onde focar o marketing.
        </p>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <p className="text-xs uppercase tracking-wide mb-1" style={{ color: "var(--muted1)" }}>
            Pedidos nos últimos 7 dias
          </p>
          <p className="text-3xl" style={{ fontFamily: "Georgia, serif" }}>
            {pedidos7dias}
          </p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide mb-1" style={{ color: "var(--muted1)" }}>
            Total de pedidos
          </p>
          <p className="text-3xl" style={{ fontFamily: "Georgia, serif" }}>
            {pedidos.length}
          </p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide mb-1" style={{ color: "var(--muted1)" }}>
            Pedidos que viraram agendamento
          </p>
          <p className="text-3xl" style={{ fontFamily: "Georgia, serif" }}>
            {taxaAgendamento}%
          </p>
        </Card>
      </div>

      <Card>
        <p className="text-sm font-medium mb-3">Especialidades mais pedidas</p>
        {dadosGrafico.length === 0 ? (
          <Vazio>Ainda não há pedidos suficientes.</Vazio>
        ) : (
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={dadosGrafico} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" stroke="var(--muted1)" fontSize={12} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="especialidade"
                  stroke="var(--muted1)"
                  fontSize={11}
                  width={140}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                  }}
                />
                <Bar dataKey="total" fill="#009E86" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <p
            className="text-xs uppercase tracking-wide mb-2 flex items-center gap-1.5"
            style={{ color: "var(--muted1)" }}
          >
            <Award size={14} /> Melhor avaliado
          </p>
          {melhorAvaliado ? (
            <>
              <p className="font-medium">{melhorAvaliado.p.nome}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <StarRow value={melhorAvaliado.media} />
                <span className="text-xs" style={{ color: "var(--muted2)" }}>
                  {melhorAvaliado.media.toFixed(1)} ({pluralAvaliacoes(melhorAvaliado.count)})
                </span>
              </div>
            </>
          ) : (
            <Vazio>Nenhuma avaliação ainda.</Vazio>
          )}
        </Card>
        <Card>
          <p
            className="text-xs uppercase tracking-wide mb-2 flex items-center gap-1.5"
            style={{ color: "var(--muted1)" }}
          >
            <MousePointerClick size={14} /> Mais acionado no WhatsApp
          </p>
          {maisAcionado && maisAcionado.contador_cliques > 0 ? (
            <>
              <p className="font-medium">{maisAcionado.nome}</p>
              <p className="text-xs mt-1" style={{ color: "var(--muted2)" }}>
                {maisAcionado.contador_cliques} clique
                {maisAcionado.contador_cliques > 1 ? "s" : ""}
              </p>
            </>
          ) : (
            <Vazio>Nenhum clique registrado ainda.</Vazio>
          )}
        </Card>
      </div>

      <Card>
        <p className="text-sm font-medium mb-3">Mapa relativo por bairro</p>
        <MapaRelativo pedidos={pedidos} fisios={fisios} />
      </Card>
    </div>
  );
}
