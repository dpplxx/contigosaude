// Script da landing (index.html). Fica num arquivo próprio, em vez de
// inline no HTML, pra dar pra travar o CSP em script-src 'self' sem
// precisar de 'unsafe-inline' — inline script é o alvo clássico de XSS.

// Calcula o base path dinamicamente para funcionar tanto em dev (/)
// quanto em produção (/saude-domiciliar/)
function getAppUrl(papel) {
  const path = window.location.pathname;
  const baseMatch = path.match(/^(.*?)(?:index\.html)?$/);
  const basePath = baseMatch ? baseMatch[1] : path.replace(/[^/]*\.html$/, "");
  return basePath + "app.html" + (papel ? "?papel=" + papel : "");
}

document.querySelectorAll('a[href*="app.html"]').forEach((link) => {
  const url = link.getAttribute("href");
  const papel = new URL(url, window.location.href).searchParams.get("papel");
  link.href = getAppUrl(papel);
});

// Prova social real: busca a contagem de fisioterapeutas cadastrados.
// A anon key do Supabase é pública por design (o RLS protege os dados,
// não a chave) — o mesmo valor já vai embutido no bundle do app.
(async function contarFisios() {
  const SUPABASE_URL = "https://zjeyzqxphzzbitgrkoac.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_D5UJYqzJGBI1jU5-NjtwhQ_DqU-qOE2";
  const elemento = document.getElementById("contador-fisios");
  const texto = document.getElementById("contador-fisios-texto");
  if (!elemento || !texto) return;

  try {
    const resposta = await fetch(SUPABASE_URL + "/rest/v1/rpc/hc_contar_fisios", {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: "Bearer " + SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
    });
    if (!resposta.ok) return;
    const total = await resposta.json();
    if (typeof total !== "number") return;

    // Honestidade acima de tudo: com poucos cadastros, dizemos isso
    // com todas as letras em vez de forçar um número que soa maior.
    if (total === 0) return;
    texto.textContent =
      total === 1 ? "1 fisioterapeuta já cadastrado" : total + " fisioterapeutas já cadastrados";
    elemento.style.display = "inline-flex";
  } catch {
    // Sem contador em caso de falha de rede: melhor omitir do que travar a página.
  }
})();
