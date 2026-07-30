import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  Bell,
  Calendar,
  ClipboardList,
  Home,
  LogOut,
  MessageCircle,
  Moon,
  Stethoscope,
  Sun,
} from "lucide-react";
import { Card, RoleButton, TabButton, ToastContainer } from "./components/ui";
import { RequestForm, PatientTracking } from "./components/Paciente";
import { PhysioForm, PhysioDashboard } from "./components/Fisio";
import { VerificacaoCREFITO } from "./components/VerificacaoCREFITO";
import { Painel } from "./components/Painel";
import { Login } from "./components/Login";

// A biblioteca de gráficos é o maior pedaço do bundle e só a área restrita usa.
// Carregar sob demanda deixa a home do paciente bem mais leve no celular.
const Metricas = lazy(() =>
  import("./components/Metricas").then((m) => ({ default: m.Metricas }))
);
import { aoMudarSessao, carregarPainel, ehAdmin, sair, sessaoAtual } from "./lib/api";
import { supabaseConfigurado } from "./lib/supabase";
import { mensagemDeErro } from "./lib/utils";

const PAINEL_VAZIO = {
  fisios: [],
  pedidos: [],
  agendamentos: [],
  avaliacoes: [],
  mensagens: [],
};

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// A landing manda ?papel=paciente ou ?papel=fisio nos botões, para a pessoa já
// cair na aba certa em vez de ter que procurar.
function papelInicial() {
  try {
    const papel = new URLSearchParams(window.location.search).get("papel");
    return papel === "fisio" || papel === "paciente" ? papel : "paciente";
  } catch {
    return "paciente";
  }
}

function Header({ tema, onToggleTema, onAtivarNotificacoes, sessao, onSair }) {
  return (
    <header className="max-w-3xl mx-auto px-4 sm:px-6 pt-10 pb-6 relative">
      <div
        className="portico-glow absolute -top-6 left-4 sm:left-6 w-24 h-24 rounded-full blur-2xl pointer-events-none"
        style={{ background: "#E3A873" }}
      />
      <div className="relative flex items-center justify-between gap-3 mb-2 flex-wrap">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "#C6693D22", border: "1px solid #C6693D55" }}
          >
            <Home size={20} style={{ color: "#E3A873" }} />
          </div>
          <h1
            className="text-2xl sm:text-3xl tracking-tight"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif", color: "var(--text)" }}
          >
            Contigo Saúde
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {sessao && (
            <button
              onClick={onSair}
              className="shrink-0 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border"
              style={{ borderColor: "var(--border)", color: "var(--muted1)" }}
            >
              <LogOut size={14} /> Sair
            </button>
          )}
          <button
            onClick={onAtivarNotificacoes}
            className="shrink-0 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border"
            style={{ borderColor: "var(--border)", color: "var(--muted1)" }}
          >
            <Bell size={14} /> Ativar notificações
          </button>
          <button
            onClick={onToggleTema}
            className="shrink-0 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border"
            style={{ borderColor: "var(--border)", color: "var(--muted1)" }}
          >
            {tema === "escuro" ? <Sun size={14} /> : <Moon size={14} />}
            {tema === "escuro" ? "Tema claro" : "Tema escuro"}
          </button>
        </div>
      </div>
      <p className="text-sm sm:text-[15px]" style={{ color: "var(--muted1)" }}>
        Saúde domiciliar com profissionais da sua região.
      </p>
    </header>
  );
}

function AvisoSemChaves() {
  return (
    <Card>
      <p className="text-sm flex items-start gap-2" style={{ color: "#D98C6E" }}>
        <AlertCircle size={16} className="shrink-0 mt-0.5" />
        <span>
          O app está sem as chaves do Supabase, então nada é salvo. Crie o arquivo{" "}
          <code>.env.local</code> com <code>VITE_SUPABASE_URL</code> e{" "}
          <code>VITE_SUPABASE_ANON_KEY</code> (veja o README) e reinicie o servidor.
        </span>
      </p>
    </Card>
  );
}

export default function App() {
  const [role, setRole] = useState(papelInicial);
  const [pacienteView, setPacienteView] = useState("pedido");
  const [fisioView, setFisioView] = useState("cadastro");
  const [tema, setTema] = useState("escuro");
  const [toasts, setToasts] = useState([]);
  const [sessao, setSessao] = useState(null);
  const [dadosPainel, setDadosPainel] = useState(PAINEL_VAZIO);
  const [loadingPainel, setLoadingPainel] = useState(false);
  const [erroPainel, setErroPainel] = useState("");
  const [autorizada, setAutorizada] = useState(true);
  const [crefitoCertificado, setCrefitoCertificado] = useState(false);

  const addToast = useCallback((msg, tipo = "ok") => {
    const id = uid();
    setToasts((t) => [...t, { id, msg, tipo }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);

  const notificar = useCallback(
    (titulo, corpo) => {
      addToast(titulo);
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(titulo, { body: corpo });
        }
      } catch {
        // O navegador pode bloquear notificação nativa; o toast já avisa.
      }
    },
    [addToast]
  );

  const pedirPermissaoNotificacao = () => {
    try {
      if (typeof Notification === "undefined") {
        addToast("Este navegador não suporta notificações.", "erro");
        return;
      }
      if (Notification.permission === "default") {
        Notification.requestPermission();
      } else {
        addToast("As notificações já estão configuradas no navegador.");
      }
    } catch {
      addToast("Este navegador não suporta notificações.", "erro");
    }
  };

  useEffect(() => {
    sessaoAtual().then(setSessao);
    return aoMudarSessao(setSessao);
  }, []);

  const recarregarPainel = useCallback(async () => {
    if (!sessao) return;
    setLoadingPainel(true);
    setErroPainel("");
    try {
      // Estar logada não basta: a conta precisa estar na tabela admins. Sem
      // isso o RLS devolveria listas vazias e pareceria "não há dados".
      if (!(await ehAdmin())) {
        setAutorizada(false);
        setDadosPainel(PAINEL_VAZIO);
        return;
      }
      setAutorizada(true);
      setDadosPainel(await carregarPainel());
    } catch (e) {
      setErroPainel(mensagemDeErro(e, "Não foi possível carregar os dados do painel."));
    } finally {
      setLoadingPainel(false);
    }
  }, [sessao]);

  const areaRestrita = role === "painel" || role === "metricas";

  useEffect(() => {
    if (sessao && areaRestrita) recarregarPainel();
  }, [sessao, areaRestrita, recarregarPainel]);

  const fazerLogout = async () => {
    await sair();
    setDadosPainel(PAINEL_VAZIO);
    addToast("Você saiu da área restrita.");
  };

  return (
    <div
      className={`min-h-screen w-full ${tema === "claro" ? "theme-light" : ""}`}
      style={{
        background: "var(--bg)",
        color: "var(--text)",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <ToastContainer toasts={toasts} />
      <Header
        tema={tema}
        onToggleTema={() => setTema((t) => (t === "escuro" ? "claro" : "escuro"))}
        onAtivarNotificacoes={pedirPermissaoNotificacao}
        sessao={sessao}
        onSair={fazerLogout}
      />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 flex gap-2 pb-3 flex-wrap">
        <RoleButton
          active={role === "paciente"}
          onClick={() => {
            setRole("paciente");
            setCrefitoCertificado(false);
          }}
        >
          <Home size={16} /> Sou paciente
        </RoleButton>
        <RoleButton
          active={role === "fisio"}
          onClick={() => {
            setRole("fisio");
            setCrefitoCertificado(false);
          }}
        >
          <Stethoscope size={16} /> Sou fisioterapeuta
        </RoleButton>
        <RoleButton active={role === "painel"} onClick={() => setRole("painel")}>
          <ClipboardList size={16} /> Painel
        </RoleButton>
        <RoleButton active={role === "metricas"} onClick={() => setRole("metricas")}>
          <BarChart3 size={16} /> Métricas
        </RoleButton>
      </div>

      {role === "paciente" && (
        <nav className="max-w-3xl mx-auto px-4 sm:px-6 flex gap-2 pb-4">
          <TabButton active={pacienteView === "pedido"} onClick={() => setPacienteView("pedido")}>
            Pedir atendimento
          </TabButton>
          <TabButton
            active={pacienteView === "acompanhar"}
            onClick={() => setPacienteView("acompanhar")}
          >
            <MessageCircle size={14} /> Acompanhar meu pedido
          </TabButton>
        </nav>
      )}

      {role === "fisio" && crefitoCertificado && (
        <nav className="max-w-3xl mx-auto px-4 sm:px-6 flex gap-2 pb-4">
          <TabButton active={fisioView === "cadastro"} onClick={() => setFisioView("cadastro")}>
            Cadastrar
          </TabButton>
          <TabButton
            active={fisioView === "agendamentos"}
            onClick={() => setFisioView("agendamentos")}
          >
            <Calendar size={14} /> Meus agendamentos
          </TabButton>
        </nav>
      )}

      <main className="max-w-3xl mx-auto px-4 sm:px-6 pb-16 space-y-4">
        {!supabaseConfigurado && <AvisoSemChaves />}

        {role === "paciente" && pacienteView === "pedido" && <RequestForm onToast={addToast} />}
        {role === "paciente" && pacienteView === "acompanhar" && (
          <PatientTracking onNotify={notificar} />
        )}
        {role === "fisio" && !crefitoCertificado && (
          <VerificacaoCREFITO
            onVerificado={(crefito) => {
              setCrefitoCertificado(true);
              addToast("CREFITO verificado com sucesso!");
            }}
          />
        )}
        {role === "fisio" && crefitoCertificado && fisioView === "cadastro" && (
          <PhysioForm onToast={addToast} />
        )}
        {role === "fisio" && crefitoCertificado && fisioView === "agendamentos" && (
          <PhysioDashboard onNotify={notificar} />
        )}

        {areaRestrita && !sessao && <Login onEntrou={setSessao} />}
        {areaRestrita && sessao && !autorizada && (
          <Card>
            <p className="text-sm" style={{ color: "var(--muted1)" }}>
              Esta conta está logada, mas não tem permissão para ver os dados dos pacientes. Para
              liberar, adicione o email dela na tabela <code>admins</code> do Supabase (o passo a
              passo está no README do projeto).
            </p>
          </Card>
        )}
        {role === "painel" && sessao && autorizada && (
          <Painel
            dados={dadosPainel}
            loading={loadingPainel}
            erro={erroPainel}
            onRefresh={recarregarPainel}
          />
        )}
        {role === "metricas" && sessao && autorizada && (
          <Suspense
            fallback={
              <Card>
                <p className="text-sm" style={{ color: "var(--muted1)" }}>
                  Carregando gráficos...
                </p>
              </Card>
            }
          >
            <Metricas dados={dadosPainel} />
          </Suspense>
        )}
      </main>
    </div>
  );
}

