// Supabase Edge Function: cria contas novas no Herald.
//
// O cadastro é fechado: o app não cria conta direto. Ele manda nome, email, senha e o
// código do dia pra cá; esta função confere o código (só CEO vê o código no app),
// confere se o nome está livre e só então cria a conta.
//
// O banco também tem uma trava: conta sem a marca "herald_ok" (que só esta função
// consegue pôr) é recusada. Então mesmo chamando o Supabase direto, ninguém entra.
//
// Precisa ser publicada sem verificação de login (quem chama ainda não tem conta):
//   npx supabase functions deploy criar-conta --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta({ erro: 'method' }, 405);

  let dados: Record<string, unknown>;
  try {
    dados = await req.json();
  } catch {
    return resposta({ erro: 'invalid' }, 400);
  }
  const nome = String(dados.nome ?? '').trim().slice(0, 32);
  const email = String(dados.email ?? '').trim().toLowerCase().slice(0, 200);
  const senha = String(dados.senha ?? '');
  const codigo = String(dados.codigo ?? '').trim().slice(0, 20);

  if (!nome) return resposta({ erro: 'name-required' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return resposta({ erro: 'email-invalid' }, 400);
  if (senha.length < 6 || senha.length > 200) return resposta({ erro: 'password-short' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: valido, error: erroCodigo } = await admin.rpc('codigo_valido', { c: codigo });
  if (erroCodigo) return resposta({ erro: 'server' }, 500);
  if (!valido) {
    await espera(800); // atrasa quem tenta adivinhar
    return resposta({ erro: 'code-invalid' }, 403);
  }

  const { data: livre, error: erroNome } = await admin.rpc('nome_disponivel', { n: nome });
  if (erroNome) return resposta({ erro: 'server' }, 500);
  if (!livre) return resposta({ erro: 'name-taken' }, 409);

  const { error } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    // o código vai junto: a trava do banco confere ele na hora em que a conta é inserida
    user_metadata: { display_name: nome, herald_codigo: codigo.toUpperCase() },
    app_metadata: { herald_ok: true },
  });
  if (error) {
    const m = error.message || '';
    if (/already|registered|exists/i.test(m)) return resposta({ erro: 'email-taken' }, 409);
    if (/password/i.test(m)) return resposta({ erro: 'password-short' }, 400);
    console.error('criar-conta:', m); // aparece nos logs da função
    return resposta({ erro: 'server' }, 500);
  }
  return resposta({ ok: true });
});
