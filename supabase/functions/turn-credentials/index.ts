// Supabase Edge Function: entrega credenciais temporárias do TURN da Cloudflare.
//
// O TURN é o "servidor de apoio": repassa voz e tela quando a conexão direta
// entre dois PCs não rola (CGNAT, 4G) e esconde o IP de quem ativa "Hide my IP".
//
// A chave da Cloudflare fica só aqui (segredos do Supabase), nunca no app.
// Só quem está logado consegue chamar (verificação de JWT ligada).
//
// Segredos necessários (Supabase → Edge Functions → Secrets):
//   CLOUDFLARE_TURN_KEY_ID
//   CLOUDFLARE_TURN_API_TOKEN

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const resposta = (corpo: unknown) =>
  new Response(JSON.stringify(corpo), { headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const id = Deno.env.get('CLOUDFLARE_TURN_KEY_ID');
  const token = Deno.env.get('CLOUDFLARE_TURN_API_TOKEN');
  if (!id || !token) return resposta({ iceServers: [], erro: 'TURN não configurado' });

  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: 86400 }), // 24 h
  });
  if (!r.ok) return resposta({ iceServers: [], erro: `Cloudflare respondeu ${r.status}` });

  const dados = await r.json();
  const lista = Array.isArray(dados.iceServers) ? dados.iceServers : [dados.iceServers];
  // Navegadores bloqueiam a porta 53; a Cloudflare recomenda tirar essas URLs
  const servidores = lista.map((s: { urls: string | string[] }) => ({
    ...s,
    urls: ([] as string[]).concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)),
  }));
  return resposta({ iceServers: servidores, validoAte: Date.now() + 86400 * 1000 });
});
