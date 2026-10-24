// Supabase Edge Function: entrega credenciais temporárias do TURN da Cloudflare.
//
// O TURN é o "servidor de apoio": repassa voz e tela quando a conexão direta
// entre dois PCs não rola (CGNAT, 4G) e esconde o IP de quem ativa "Hide my IP".
//
// TRAVA DE GASTO: a Cloudflare não tem limite de gasto pro TURN, então a trava é
// aqui. Antes de entregar credenciais, consulta quanto já foi usado no mês; passou
// do limite (padrão 800 GB, o grátis é 1.000 GB), não entrega mais nada — o app
// continua funcionando, só conectando direto. As credenciais valem 4 h, então a
// trava pega rápido.
//
// A chave da Cloudflare fica só aqui (segredos do Supabase), nunca no app.
// Só quem está logado consegue chamar (verificação de JWT ligada).
//
// Segredos (Supabase → Edge Functions → Secrets):
//   CLOUDFLARE_TURN_KEY_ID       ID da chave TURN
//   CLOUDFLARE_TURN_API_TOKEN    token da chave TURN
//   CLOUDFLARE_ACCOUNT_ID        ID da conta (pra ler o uso)
//   CLOUDFLARE_ANALYTICS_TOKEN   token com permissão "Account Analytics: Read"
//   TURN_LIMITE_GB               opcional, padrão 800

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const VALIDADE_S = 4 * 3600;

const resposta = (corpo: unknown) =>
  new Response(JSON.stringify(corpo), { headers: { ...CORS, 'Content-Type': 'application/json' } });

// Uso do mês (GB), guardado por 5 min pra não consultar a cada chamada
let usoCache: { gb: number; em: number } | null = null;

async function usoDoMesGb(conta: string, token: string): Promise<number> {
  if (usoCache && Date.now() - usoCache.em < 5 * 60 * 1000) return usoCache.gb;
  const hoje = new Date();
  const inicio = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const fim = hoje.toISOString().slice(0, 10);
  const consulta = `{
    viewer {
      accounts(filter: { accountTag: "${conta}" }) {
        callsTurnUsageAdaptiveGroups(limit: 1, filter: { date_geq: "${inicio}", date_leq: "${fim}" }) {
          sum { egressBytes ingressBytes }
        }
      }
    }
  }`;
  const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: consulta }),
  });
  const dados = await r.json();
  if (!r.ok || dados.errors?.length) throw new Error(dados.errors?.[0]?.message || `HTTP ${r.status}`);
  const soma = dados.data?.viewer?.accounts?.[0]?.callsTurnUsageAdaptiveGroups?.[0]?.sum;
  const gb = ((soma?.egressBytes || 0) + (soma?.ingressBytes || 0)) / 1e9;
  usoCache = { gb, em: Date.now() };
  return gb;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const id = Deno.env.get('CLOUDFLARE_TURN_KEY_ID');
  const token = Deno.env.get('CLOUDFLARE_TURN_API_TOKEN');
  if (!id || !token) return resposta({ iceServers: [], erro: 'TURN não configurado' });

  // Trava de gasto. Se a consulta falhar, NÃO entrega (melhor sem apoio do que pagar).
  const conta = Deno.env.get('CLOUDFLARE_ACCOUNT_ID');
  const tokenUso = Deno.env.get('CLOUDFLARE_ANALYTICS_TOKEN');
  const limite = Number(Deno.env.get('TURN_LIMITE_GB') || 800);
  let usoGb: number | null = null;
  if (conta && tokenUso) {
    try {
      usoGb = await usoDoMesGb(conta, tokenUso);
    } catch (e) {
      return resposta({ iceServers: [], erro: `não deu pra ler o uso: ${(e as Error).message}` });
    }
    if (usoGb >= limite) return resposta({ iceServers: [], erro: 'limite do mês atingido', usoGb, limiteGb: limite });
  }

  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: VALIDADE_S }),
  });
  if (!r.ok) return resposta({ iceServers: [], erro: `Cloudflare respondeu ${r.status}` });

  const dados = await r.json();
  const lista = Array.isArray(dados.iceServers) ? dados.iceServers : [dados.iceServers];
  // Navegadores bloqueiam a porta 53; a Cloudflare recomenda tirar essas URLs
  const servidores = lista.map((s: { urls: string | string[] }) => ({
    ...s,
    urls: ([] as string[]).concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)),
  }));
  return resposta({
    iceServers: servidores,
    validoAte: Date.now() + VALIDADE_S * 1000,
    usoGb: usoGb == null ? null : Math.round(usoGb * 100) / 100,
    limiteGb: limite,
    travaAtiva: usoGb != null,
  });
});
