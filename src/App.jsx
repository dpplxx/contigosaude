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
import { AuthEmail } from "./components/AuthEmail";
import { Painel } from "./components/Painel";
import { Login } from "./components/Login";

// A biblioteca de gráficos é o maior pedaço do bundle e só a área restrita usa.
// Carregar sob demanda deixa a home do paciente bem mais leve no celular.
const Metricas = lazy(() =>
  import("./components/Metricas").then((m) => ({ default: m.Metricas }))
);
import { aoMudarSessao, carregarPainel, ehAdmin, ehFisio, sair, sessaoAtual } from "./lib/api";
import { supabaseConfigurado } from "./lib/supabase";
import { mensagemDeErro } from "./lib/utils";
import { ativarPush, pushSuportado } from "./lib/push";
import { initSession, trackEvent, Events } from "./lib/analytics";

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
        style={{ background: "#16C4A8" }}
      />
      <div className="relative flex items-center justify-between gap-3 mb-2 flex-wrap">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "#009E8622", border: "1px solid #009E8655" }}
          >
            <Home size={20} style={{ color: "#16C4A8" }} />
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
      <p className="text-sm flex items-start gap-2" style={{ color: "#C24A3E" }}>
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
  const [tema, setTema] = useState("claro");
  const [toasts, setToasts] = useState([]);
  const [sessao, setSessao] = useState(null);
  const [souAdmin, setSouAdmin] = useState(false);
  const [souFisio, setSouFisio] = useState(false);
  const [dadosPainel, setDadosPainel] = useState(PAINEL_VAZIO);
  const [loadingPainel, setLoadingPainel] = useState(false);
  const [erroPainel, setErroPainel] = useState("");
  const [autorizada, setAutorizada] = useState(true);

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

  const pedirPermissaoNotificacao = async () => {
    try {
      if (typeof Notification === "undefined") {
        addToast("Este navegador não suporta notificações.", "erro");
        return;
      }

      // Logada + suporte a push real: notificação chega mesmo com a aba
      // fechada, não só enquanto o app está aberto.
      if (sessao && pushSuportado()) {
        await ativarPush();
        addToast("Notificações ativadas — você recebe mesmo com o app fechado.");
        return;
      }

      if (Notification.permission === "default") {
        Notification.requestPermission();
      } else {
        addToast("As notificações já estão configuradas no navegador.");
      }
    } catch (e) {
      addToast(mensagemDeErro(e, "Não foi possível ativar as notificações."), "erro");
    }
  };

  useEffect(() => {
    initSession();
    trackEvent(Events.PAGE_VIEW);
    sessaoAtual().then(setSessao);
    return aoMudarSessao(setSessao);
  }, []);

  // Painel/Métricas só aparecem na navegação para quem é admin de verdade —
  // qualquer paciente ou fisio autenticado também tem "sessao" preenchida
  // (é a mesma sessão do Supabase Auth), então checar isso evita mostrar
  // essas abas para quem não tem nada a ver com elas.
  //
  // Paciente e fisio usam a mesma conta pra logar. Sem a trava abaixo, quem
  // já tem cadastro de fisioterapeuta podia cair (ou voltar) pro lado de
  // paciente sem querer — e criar pedido como se fosse cliente da própria
  // conta. Uma vez detectado, trava direto no lado fisio — EXCETO pra conta
  // admin, que precisa transitar pelos dois lados de propósito (testar o
  // fluxo completo, atender pedido também como paciente de teste etc.).
  // As duas checagens (admin e fisio) rodam juntas nesta única chamada pra
  // não ter corrida entre elas: sem isso, a trava do lado fisio podia
  // disparar antes da confirmação de admin chegar.
  useEffect(() => {
    if (!sessao) {
      setSouAdmin(false);
      setSouFisio(false);
      return;
    }
    let ativo = true;
    Promise.all([ehAdmin().catch(() => false), ehFisio().catch(() => false)]).then(
      ([admin, fisio]) => {
        if (!ativo) return;
        setSouAdmin(admin);
        setSouFisio(fisio);
        if (fisio && !admin) setRole((r) => (r === "paciente" ? "fisio" : r));
      }
    );
    return () => {
      ativo = false;
    };
  }, [sessao]);

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
      className={`min-h-screen w-full ${tema === "escuro" ? "theme-dark" : ""}`}
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
        {(!souFisio || souAdmin) && (
          <RoleButton active={role === "paciente"} onClick={() => setRole("paciente")}>
            <Home size={16} /> Sou paciente
          </RoleButton>
        )}
        <RoleButton active={role === "fisio"} onClick={() => setRole("fisio")}>
          <Stethoscope size={16} /> Sou fisioterapeuta
        </RoleButton>
        {souAdmin && (
          <>
            <RoleButton active={role === "painel"} onClick={() => setRole("painel")}>
              <ClipboardList size={16} /> Painel
            </RoleButton>
            <RoleButton active={role === "metricas"} onClick={() => setRole("metricas")}>
              <BarChart3 size={16} /> Métricas
            </RoleButton>
          </>
        )}
      </div>

      {role === "paciente" && sessao && (
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

      {role === "fisio" && sessao && (
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

        {role === "paciente" && !sessao && (
          <AuthEmail tipo="paciente" onAutenticado={() => addToast("Bem-vinda!")} />
        )}
        {role === "paciente" && sessao && pacienteView === "pedido" && (
          <RequestForm onToast={addToast} />
        )}
        {role === "paciente" && sessao && pacienteView === "acompanhar" && (
          <PatientTracking onNotify={notificar} />
        )}

        {role === "fisio" && !sessao && (
          <AuthEmail tipo="fisio" onAutenticado={() => addToast("Bem-vindo!")} />
        )}
        {role === "fisio" && sessao && fisioView === "cadastro" && (
          <PhysioForm onToast={addToast} />
        )}
        {role === "fisio" && sessao && fisioView === "agendamentos" && (
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

