// Herald — interface.
// Contas, Nests, canais e mensagens ficam no Supabase. Voz e tela são P2P (voz.js).

import './style.css';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { icone, aplicarIcones } from './icones.js';
import { t, traduzirPagina, mudarIdioma, idiomaAtual, IDIOMAS, quando, horaCurta } from './i18n.js';
import * as chamada from './voz.js';
import { criarSeletor } from './seletor.js';
import { criarRoleta } from './roleta.js';
import { criarRadio } from './radio.js';
import { novidadesEntre } from './novidades.js';
import { criarPainelSistema } from './sistema.js';

const { voz } = chamada;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const configurado = !SUPABASE_URL.includes('SEU-PROJETO') && !SUPABASE_KEY.includes('SUA-CHAVE');
// No app, o login fica num arquivo criptografado (window.herald.sessao); no navegador, no localStorage.
// Na primeira vez, aproveita um login que já estava no localStorage.
const armazenamento = window.herald?.sessao && {
  async getItem(chave) {
    const valor = await window.herald.sessao.ler(chave);
    if (valor != null) return valor;
    const antigo = ler(chave);
    if (antigo != null) await window.herald.sessao.gravar(chave, antigo);
    return antigo;
  },
  setItem: (chave, valor) => window.herald.sessao.gravar(chave, valor),
  removeItem: (chave) => {
    try { localStorage.removeItem(chave); } catch {}
    return window.herald.sessao.apagar(chave);
  },
};
const sb = configurado
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, ...(armazenamento && { storage: armazenamento }) } })
  : null;

// ================= Estado =================

const est = {
  eu: null, // profile
  nests: new Map(), // id -> nest
  membros: new Map(), // nestId -> Map(userId -> role)
  perfis: new Map(), // userId -> profile
  canais: new Map(), // nestId -> [channel]
  mensagens: new Map(), // channelId -> [message]
  presenca: new Map(), // nestId -> Map(userId -> { voz, mudo, surdo, aoVivo })
  nestAtual: null,
  textoPorNest: new Map(), // nestId -> channelId (último canal de texto aberto)
  vozVista: null, // channelId de voz sendo mostrado
  vista: 'texto',
  naoLidas: new Set(), // channelIds
  falando: new Set(), // userIds
};
const canaisRealtime = new Map(); // nestId -> RealtimeChannel (presença)
let conviteDepois = null; // código recebido antes de logar

function guardar(k, v) { try { localStorage.setItem(k, v); } catch {} }
function ler(k) { try { return localStorage.getItem(k); } catch { return null; } }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const GRADIENTES = ['--g-blue', '--g-olive', '--g-teal', '--g-green', '--g-rose', '--g-violet'];
function gradiente(semente) {
  let h = 0;
  for (const c of String(semente)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `var(${GRADIENTES[h % GRADIENTES.length]})`;
}
function avatarHtml(userId, classe = '') {
  const p = est.perfis.get(userId);
  const nome = p?.display_name || '?';
  if (p?.avatar_url) return `<div class="avatar ${classe}" data-fala="${userId}"><img src="${esc(p.avatar_url)}" alt=""></div>`;
  return `<div class="avatar ${classe}" data-fala="${userId}" style="background:${gradiente(userId)}">${esc(nome[0].toUpperCase())}</div>`;
}
function nomeDe(userId) {
  return est.perfis.get(userId)?.display_name || '…';
}

// Cargos no Nest: owner 3 · admin 2 · moderator 1 · member 0 (as regras de verdade ficam no Supabase)
const NIVEIS = { owner: 3, admin: 2, moderator: 1, member: 0 };
const NOMES_CARGO = { owner: 'Owner', admin: 'Admin', moderator: 'Moderator', member: 'Member' };
function cargoDe(nestId, userId) {
  if (est.nests.get(nestId)?.owner_id === userId) return 'owner';
  return est.membros.get(nestId)?.get(userId) || 'member';
}
function nivelDe(nestId, userId) {
  return est.membros.get(nestId)?.has(userId) || est.nests.get(nestId)?.owner_id === userId ? NIVEIS[cargoDe(nestId, userId)] : -1;
}
const meuNivel = (nestId = est.nestAtual) => nivelDe(nestId, est.eu?.id);
// Cargos que eu posso dar pra alguém (sempre abaixo do meu)
function cargosQuePossoDar(nestId) {
  return ['member', 'moderator', 'admin'].filter((r) => NIVEIS[r] < meuNivel(nestId) && meuNivel(nestId) >= 2);
}
// Posso mexer nessa pessoa? (expulsar / trocar cargo) — só quem está abaixo de mim
const possoGerenciar = (nestId, userId) => userId !== est.eu?.id && meuNivel(nestId) >= 1 && meuNivel(nestId) > nivelDe(nestId, userId);
function etiquetaCargo(nestId, userId) {
  const cargo = cargoDe(nestId, userId);
  return cargo === 'member' ? '' : ` <span class="tag-dono tag-${cargo}">${esc(t(NOMES_CARGO[cargo]))}</span>`;
}

// Pop-up "o que tem de novo" (todas as versões entre a antiga e a atual)
function abrirNovidades(antes, agora) {
  const lista = novidadesEntre(antes, agora);
  if (!lista.length) return aviso(t('Herald updated to {v}', { v: agora }));
  const pt = idiomaAtual() === 'pt';
  $('#novidades-titulo').textContent = t("What's new in {v}", { v: agora });
  $('#novidades-corpo').innerHTML = lista.map((n, i) => {
    const txt = pt ? n.pt : n.en;
    const item = (s, tipo) => `<li class="${tipo}">${icone(tipo === 'nova' ? 'mais' : 'certo')}<span>${esc(s)}</span></li>`;
    return `<section class="novidades-versao">
      ${lista.length > 1 || i > 0 ? `<h3>${esc(n.versao)}</h3>` : ''}
      ${txt.novas.length ? `<div class="novidades-rotulo">${esc(t('New'))}</div><ul>${txt.novas.map((s) => item(s, 'nova')).join('')}</ul>` : ''}
      ${txt.correcoes.length ? `<div class="novidades-rotulo">${esc(t('Fixes & tips'))}</div><ul>${txt.correcoes.map((s) => item(s, 'correcao')).join('')}</ul>` : ''}
    </section>`;
  }).join('');
  $('#dlg-novidades').showModal();
  document.activeElement?.blur();
}

function aviso(texto) {
  const el = document.createElement('div');
  el.className = 'aviso';
  el.textContent = texto;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

function confirmar(texto) {
  return new Promise((resolve) => {
    const dlg = $('#dlg-confirmar');
    $('#confirmar-texto').textContent = texto;
    const ok = () => { fechar(); resolve(true); };
    const fechar = () => { $('#btn-confirmar').removeEventListener('click', ok); dlg.removeEventListener('close', cancelar); dlg.close(); };
    const cancelar = () => { $('#btn-confirmar').removeEventListener('click', ok); resolve(false); };
    $('#btn-confirmar').addEventListener('click', ok);
    dlg.addEventListener('close', cancelar, { once: true });
    dlg.showModal();
  });
}

function mostrarTela(qual) {
  $('#carregando').hidden = qual !== 'carregando';
  $('#entrada').hidden = qual !== 'entrada';
  $('#app').hidden = qual !== 'app';
}

// ================= Entrada (login / cadastro) =================

let modoCadastro = false;

function atualizarModoEntrada() {
  $('#campo-nome').hidden = !modoCadastro;
  $('#ent-nome').required = modoCadastro;
  $('#ent-senha').autocomplete = modoCadastro ? 'new-password' : 'current-password';
  $('#btn-entrar').dataset.i18nOriginal = modoCadastro ? 'Create account' : 'Sign in';
  $('#troca-texto').dataset.i18nOriginal = modoCadastro ? 'Already have an account?' : 'No account yet?';
  $('#btn-trocar-modo').dataset.i18nOriginal = modoCadastro ? 'Sign in' : 'Create account';
  $('#erro-entrada').textContent = '';
  traduzirPagina($('#entrada'));
}

$('#btn-trocar-modo').onclick = () => {
  modoCadastro = !modoCadastro;
  atualizarModoEntrada();
};

function traduzirErro(err) {
  const m = String(err?.message || err || '');
  if (/invalid login credentials/i.test(m)) return t('Wrong email or password.');
  if (/already registered|already exists/i.test(m)) return t('This email is already registered.');
  if (/at least 6|password should/i.test(m)) return t('Password must have at least 6 characters.');
  if (/failed to fetch|network/i.test(m)) return t('Could not connect. Check your internet.');
  if (/invalid invite/i.test(m)) return t('This invite is not valid.');
  if (/not allowed|only the owner|row-level security|permission denied/i.test(m)) return t("You don't have permission to do that.");
  return t('Something went wrong: {msg}', { msg: m });
}

$('#form-entrada').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!sb) return;
  const email = $('#ent-email').value.trim();
  const senha = $('#ent-senha').value;
  $('#btn-entrar').disabled = true;
  $('#erro-entrada').textContent = '';
  const { error } = modoCadastro
    ? await sb.auth.signUp({ email, password: senha, options: { data: { display_name: $('#ent-nome').value.trim() } } })
    : await sb.auth.signInWithPassword({ email, password: senha });
  $('#btn-entrar').disabled = false;
  if (error) $('#erro-entrada').textContent = traduzirErro(error);
});

// ================= Carregar dados =================

async function iniciar() {
  aplicarIcones();
  mudarIdioma(idiomaAtual());
  atualizarModoEntrada();

  window.herald?.aoConvite?.((codigo) => {
    if (est.eu) entrarComConvite(codigo);
    else conviteDepois = codigo;
  });
  // Avisa quando o app abre numa versão nova (depois de atualizar)
  window.herald?.versao?.().then((versao) => {
    const antes = ler('herald-versao');
    if (antes && antes !== versao) setTimeout(() => abrirNovidades(antes, versao), 1200);
    guardar('herald-versao', versao);
  });
  window.herald?.aoAtualizar?.((d) => {
    if (d.estado !== 'pronta') return;
    const b = $('#btn-atualizar');
    b.hidden = false;
    b.dataset.tip = t('Update ready ({v}) — click to restart', { v: d.versao });
    b.onclick = () => window.herald.instalarAtualizacao();
  });
  window.herald?.aoAtalho?.((acao) => {
    if (!voz.conectado) return;
    if (acao === 'mudo') chamada.alternarMudo();
    if (acao === 'surdo') chamada.alternarSurdo();
  });

  if (!sb) {
    mostrarTela('entrada');
    $('#erro-entrada').textContent = t('Herald is not set up yet (missing Supabase keys).');
    $('#btn-entrar').disabled = true;
    return;
  }

  let primeira = true;
  sb.auth.onAuthStateChange((evento, sessao) => {
    if (evento === 'SIGNED_OUT') location.reload();
    if (sessao && (primeira || evento === 'SIGNED_IN') && !est.eu) carregarConta(sessao.user);
    if (!sessao && primeira) mostrarTela('entrada');
    primeira = false;
  });
}

async function carregarConta(user) {
  mostrarTela('carregando');
  // O perfil é criado por um gatilho no banco; tenta algumas vezes logo após o cadastro
  let perfil = null;
  for (let i = 0; i < 5 && !perfil; i++) {
    const { data } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    perfil = data;
    if (!perfil) await new Promise((r) => setTimeout(r, 400));
  }
  if (!perfil) {
    mostrarTela('entrada');
    $('#erro-entrada').textContent = t('Something went wrong: {msg}', { msg: 'profile' });
    return;
  }
  est.eu = perfil;
  est.perfis.set(perfil.id, perfil);
  // calibração da voz fica na conta: por pessoa e por microfone
  chamada.definirArmazenamentoVoz({
    ler: async (mic) => (await sb.from('voice_profiles').select('profile').eq('user_id', est.eu.id).eq('mic', mic).maybeSingle()).data?.profile ?? null,
    gravar: (mic, perfil) => sb.from('voice_profiles').upsert({ user_id: est.eu.id, mic, profile: perfil, updated_at: new Date().toISOString() }),
    apagar: (mic) => sb.from('voice_profiles').delete().eq('user_id', est.eu.id).eq('mic', mic),
  });
  await carregarEstrutura();
  assinarBanco();
  mostrarTela('app');

  const ultimo = ler('herald-nest');
  abrirNest(est.nests.has(ultimo) ? ultimo : [...est.nests.keys()][0] || null);
  if (conviteDepois) {
    entrarComConvite(conviteDepois);
    conviteDepois = null;
  }
}

// Nests, membros, canais e perfis de quem está nos meus Nests
async function carregarEstrutura() {
  const [{ data: nests }, { data: membros }, { data: canais }] = await Promise.all([
    sb.from('nests').select('*').order('created_at'),
    sb.from('nest_members').select('nest_id,user_id,role'),
    sb.from('channels').select('*').order('position'),
  ]);
  est.nests = new Map((nests || []).map((n) => [n.id, n]));
  est.membros = new Map();
  for (const m of membros || []) {
    if (!est.membros.has(m.nest_id)) est.membros.set(m.nest_id, new Map());
    est.membros.get(m.nest_id).set(m.user_id, m.role);
  }
  est.canais = new Map();
  for (const c of canais || []) {
    if (!est.canais.has(c.nest_id)) est.canais.set(c.nest_id, []);
    est.canais.get(c.nest_id).push(c);
  }
  const ids = [...new Set((membros || []).map((m) => m.user_id))].filter((id) => !est.perfis.has(id));
  if (ids.length) {
    const { data: perfis } = await sb.from('profiles').select('*').in('id', ids);
    for (const p of perfis || []) est.perfis.set(p.id, p);
  }
  sincronizarPresencas();
}

let recarregando = null;
function recarregarEstrutura() {
  clearTimeout(recarregando);
  recarregando = setTimeout(async () => {
    await carregarEstrutura();
    if (est.nestAtual && !est.nests.has(est.nestAtual)) abrirNest([...est.nests.keys()][0] || null);
    else render();
  }, 250);
}

// Tempo real: mensagens, mudanças de Nests/canais/membros e perfis
function assinarBanco() {
  sb.channel('banco')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: m }) => receberMensagem(m))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, ({ old }) => {
      for (const [canal, lista] of est.mensagens) {
        const i = lista.findIndex((m) => m.id === old.id);
        if (i >= 0) {
          lista.splice(i, 1);
          if (canal === canalTextoAtual()) renderMensagens();
        }
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'channels' }, recarregarEstrutura)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'nest_members' }, recarregarEstrutura)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'nests' }, recarregarEstrutura)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, ({ new: p }) => {
      est.perfis.set(p.id, p);
      if (p.id === est.eu?.id) est.eu = p;
      render();
    })
    .subscribe();
}

// ================= Presença (quem está online e em qual canal de voz) =================

function meuEstadoPresenca(nestId) {
  const canal = voz.canalId && (est.canais.get(nestId) || []).some((c) => c.id === voz.canalId) ? voz.canalId : null;
  // `quando` deixa escolher o estado mais recente (a presença guarda versões antigas por um tempo)
  return { voz: canal, mudo: voz.mudo, surdo: voz.surdo, aoVivo: voz.aoVivo, quando: Date.now() };
}

function sincronizarPresencas() {
  for (const [id, ch] of canaisRealtime) {
    if (!est.nests.has(id)) {
      sb.removeChannel(ch);
      canaisRealtime.delete(id);
      est.presenca.delete(id);
    }
  }
  for (const nestId of est.nests.keys()) {
    if (canaisRealtime.has(nestId)) continue;
    const ch = sb.channel(`nest:${nestId}`, { config: { presence: { key: est.eu.id } } });
    ch.on('presence', { event: 'sync' }, () => {
      const mapa = new Map();
      for (const [userId, metas] of Object.entries(ch.presenceState())) {
        mapa.set(userId, metas.reduce((a, b) => ((b.quando || 0) > (a.quando || 0) ? b : a)));
      }
      est.presenca.set(nestId, mapa);
      if (nestId === est.nestAtual) {
        renderCanais();
        renderMembros();
        renderPalco();
      }
    });
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') ch.track(meuEstadoPresenca(nestId));
    });
    canaisRealtime.set(nestId, ch);
  }
}

// Junta avisos seguidos num só (mudar de canal gera vários em sequência)
let presencaPendente = null;
function anunciarPresenca() {
  clearTimeout(presencaPendente);
  presencaPendente = setTimeout(() => {
    for (const [nestId, ch] of canaisRealtime) ch.track(meuEstadoPresenca(nestId));
  }, 120);
}

// Presença do Nest com o meu estado local por cima (aparece na hora, sem esperar o servidor)
function presencaDe(nestId) {
  const mapa = new Map(est.presenca.get(nestId) || []);
  if (est.eu) mapa.set(est.eu.id, meuEstadoPresenca(nestId));
  return mapa;
}

// ================= Navegação =================

function canalTextoAtual() {
  return est.textoPorNest.get(est.nestAtual) || null;
}

function abrirNest(nestId) {
  est.nestAtual = nestId;
  if (nestId) guardar('herald-nest', nestId);
  const canais = est.canais.get(nestId) || [];
  if (!est.textoPorNest.get(nestId) || !canais.some((c) => c.id === est.textoPorNest.get(nestId))) {
    const primeiro = canais.find((c) => c.kind === 'text');
    if (primeiro) est.textoPorNest.set(nestId, primeiro.id);
  }
  // Se estou numa chamada deste Nest, mostra a voz; senão o chat
  const vozAqui = voz.canalId && canais.some((c) => c.id === voz.canalId);
  est.vista = vozAqui && est.vozVista === voz.canalId ? 'voz' : 'texto';
  if (est.vista === 'texto') carregarMensagens(canalTextoAtual());
  render();
}

function abrirCanal(canal) {
  if (canal.kind === 'text') {
    est.textoPorNest.set(canal.nest_id, canal.id);
    est.naoLidas.delete(canal.id);
    est.vista = 'texto';
    carregarMensagens(canal.id);
  } else {
    est.vozVista = canal.id;
    est.vista = 'voz';
    if (voz.canalId !== canal.id) entrarNaVoz(canal);
  }
  render();
  if (canal.kind === 'text') setTimeout(() => $('#texto-msg').focus(), 0);
}

// ================= Mensagens =================

async function carregarMensagens(canalId) {
  if (!canalId || est.mensagens.has(canalId)) {
    renderMensagens(true);
    return;
  }
  est.mensagens.set(canalId, []);
  const { data } = await sb.from('messages').select('*').eq('channel_id', canalId).order('created_at', { ascending: false }).limit(100);
  const lista = (data || []).reverse();
  const atuais = est.mensagens.get(canalId);
  for (const m of lista) if (!atuais.some((x) => x.id === m.id)) atuais.push(m);
  atuais.sort((a, b) => a.id - b.id);
  await garantirPerfis(lista.map((m) => m.author_id));
  if (canalId === canalTextoAtual()) renderMensagens(true);
}

async function garantirPerfis(ids) {
  const faltando = [...new Set(ids)].filter((id) => !est.perfis.has(id));
  if (!faltando.length) return;
  const { data } = await sb.from('profiles').select('*').in('id', faltando);
  for (const p of data || []) est.perfis.set(p.id, p);
}

async function receberMensagem(m) {
  if (!est.mensagens.has(m.channel_id)) {
    // canal ainda não aberto: só marca como não lida
    if (m.author_id !== est.eu.id) est.naoLidas.add(m.channel_id);
    renderNests();
    if (m.nest_id === est.nestAtual) renderCanais();
    return;
  }
  const lista = est.mensagens.get(m.channel_id);
  if (lista.some((x) => x.id === m.id)) return;
  lista.push(m);
  await garantirPerfis([m.author_id]);
  const vendo = m.channel_id === canalTextoAtual() && est.vista === 'texto' && document.hasFocus();
  if (m.author_id !== est.eu.id) {
    if (!vendo) est.naoLidas.add(m.channel_id);
    chamada.tocarSom('msg');
  }
  if (m.channel_id === canalTextoAtual()) renderMensagens();
  renderNests();
  if (m.nest_id === est.nestAtual) renderCanais();
}

$('#form-msg').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#texto-msg');
  const texto = input.value.trim();
  const canal = canalTextoAtual();
  if (!texto || !canal) return;
  input.value = '';
  const { data, error } = await sb.from('messages').insert({ channel_id: canal, author_id: est.eu.id, content: texto }).select().single();
  if (error) {
    input.value = texto;
    aviso(traduzirErro(error));
    return;
  }
  receberMensagem(data);
});

function linkificar(texto) {
  return esc(texto).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" target="_blank" rel="noreferrer">${url}</a>`);
}

function renderMensagens(rolarFim = false) {
  const ul = $('#mensagens');
  const canalId = canalTextoAtual();
  const canal = (est.canais.get(est.nestAtual) || []).find((c) => c.id === canalId);
  const lista = est.mensagens.get(canalId) || [];
  const noFim = rolarFim || ul.scrollHeight - ul.scrollTop - ul.clientHeight < 60;
  let html = canal ? `<li class="inicio-canal"><div class="ic-icone">${icone('hash')}</div><h3>${esc(t('This is the start of #{name}.', { name: canal.name }))}</h3></li>` : '';
  let anterior = null;
  for (const m of lista) {
    const agrupa = anterior && anterior.author_id === m.author_id && new Date(m.created_at) - new Date(anterior.created_at) < 5 * 60000;
    const meu = m.author_id === est.eu.id || meuNivel() >= 1; // Moderator pra cima apaga a dos outros
    const apagar = meu ? `<button class="msg-apagar" data-apagar="${m.id}" title="${esc(t('Delete message'))}">${icone('lixo')}</button>` : '';
    if (agrupa) {
      html += `<li class="msg continua"><span class="msg-hora-lado">${horaCurta(m.created_at)}</span><div class="msg-texto">${linkificar(m.content)}</div>${apagar}</li>`;
    } else {
      html += `<li class="msg">${avatarHtml(m.author_id)}<div class="msg-corpo"><div class="msg-cab"><span class="msg-autor">${esc(nomeDe(m.author_id))}</span><span class="msg-hora">${quando(m.created_at)}</span></div><div class="msg-texto">${linkificar(m.content)}</div></div>${apagar}</li>`;
    }
    anterior = m;
  }
  ul.innerHTML = html;
  if (noFim) ul.scrollTop = ul.scrollHeight;
}

$('#mensagens').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-apagar]');
  if (!b) return;
  await sb.from('messages').delete().eq('id', b.dataset.apagar);
  const lista = est.mensagens.get(canalTextoAtual()) || [];
  const i = lista.findIndex((m) => String(m.id) === b.dataset.apagar);
  if (i >= 0) lista.splice(i, 1);
  renderMensagens();
});

// ================= Render =================

function render() {
  if (!est.eu) return;
  renderNests();
  renderCanais();
  renderUsuario();
  renderMembros();
  const temNest = Boolean(est.nestAtual);
  $('#painel-canais').classList.toggle('vazio', !temNest);
  $('#sem-nests').hidden = temNest;
  $('#vista-texto').hidden = !temNest || est.vista !== 'texto';
  $('#vista-voz').hidden = !temNest || est.vista !== 'voz';
  if (temNest && est.vista === 'texto') {
    const canal = (est.canais.get(est.nestAtual) || []).find((c) => c.id === canalTextoAtual());
    $('#texto-nome').textContent = canal?.name || '';
    $('#texto-msg').placeholder = canal ? t('Message #{name}', { name: canal.name }) : '';
    renderMensagens();
  }
  if (temNest && est.vista === 'voz') renderPalco();
}

function renderNests() {
  $('#lista-nests').innerHTML = [...est.nests.values()]
    .map((n) => {
      const naoLida = (est.canais.get(n.id) || []).some((c) => est.naoLidas.has(c.id));
      const iniciais = n.name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
      const conteudo = n.icon_url ? `<img src="${esc(n.icon_url)}" alt="">` : esc(iniciais);
      return `<button class="nest-botao ${n.id === est.nestAtual ? 'ligado' : ''} ${naoLida ? 'nao-lida' : ''}" data-nest="${n.id}" data-tip="${esc(n.name)}" style="${n.icon_url ? '' : `background:${gradiente(n.id)}`}">${conteudo}</button>`;
    })
    .join('');
}

$('#lista-nests').addEventListener('click', (e) => {
  const b = e.target.closest('[data-nest]');
  if (b) abrirNest(b.dataset.nest);
});

function renderCanais() {
  const nest = est.nests.get(est.nestAtual);
  $('#nest-nome').textContent = nest?.name || '';
  if (!nest) {
    $('#canais-lista').innerHTML = '';
    return;
  }
  const dono = meuNivel(nest.id) >= 2; // Admin pra cima mexe nos canais
  const canais = est.canais.get(nest.id) || [];
  const presenca = presencaDe(nest.id);
  const secao = (tipo, titulo) => {
    const itens = canais.filter((c) => c.kind === tipo);
    const mais = dono ? `<button class="botao-icone pequeno" data-novo-canal="${tipo}" title="${esc(t('New channel'))}">${icone('mais')}</button>` : '';
    let html = `<div class="secao-canais"><span>${esc(t(titulo))}</span>${mais}</div>`;
    for (const c of itens) {
      const ativo = tipo === 'text' ? est.vista === 'texto' && c.id === canalTextoAtual() : est.vista === 'voz' && c.id === est.vozVista;

      html += `<div class="canal ${ativo ? 'ligado' : ''} ${est.naoLidas.has(c.id) ? 'nao-lida' : ''} ${voz.canalId === c.id ? 'conectado' : ''}" data-canal="${c.id}">
        ${icone(tipo === 'text' ? 'hash' : 'volume')}<span class="canal-nome">${esc(c.name)}</span></div>`;
      if (tipo === 'voice') {
        const pessoas = [...presenca.entries()].filter(([, p]) => p.voz === c.id);
        if (pessoas.length) {
          html += '<div class="voz-pessoas">';
          for (const [userId, p] of pessoas) {
            const marcas = [p.aoVivo ? `<span class="tag-vivo">${esc(t('LIVE'))}</span>` : '', userId !== est.eu.id && chamada.mudoLocal(userId) ? `<span class="mudo-local">${icone('som-off')}</span>` : '', p.surdo ? icone('fone-off') : p.mudo ? icone('mic-off') : ''].join('');
            html += `<div class="voz-pessoa" data-usuario="${userId}">${avatarHtml(userId, 'mini')}<span>${esc(nomeDe(userId))}</span><span class="vp-marcas">${marcas}</span></div>`;
          }
          html += '</div>';
        }
      }
    }
    return html;
  };
  $('#canais-lista').innerHTML = secao('text', 'Text channels') + secao('voice', 'Voice channels');
  aplicarFala();
}

$('#canais-lista').addEventListener('click', async (e) => {
  const novo = e.target.closest('[data-novo-canal]');
  if (novo) return abrirNovoCanal(novo.dataset.novoCanal);
  const item = e.target.closest('[data-canal]');
  if (!item) return;
  const canal = (est.canais.get(est.nestAtual) || []).find((c) => c.id === item.dataset.canal);
  if (canal) abrirCanal(canal);
});

function renderUsuario() {
  $('#eu-avatar').outerHTML = avatarHtml(est.eu.id).replace('class="avatar ', 'id="eu-avatar" class="avatar ');
  $('#eu-nome').textContent = est.eu.display_name;
  $('#eu-sub').textContent = voz.conectado ? t('Voice connected') : t('Online');
  const mudo = $('#btn-mudo');
  mudo.innerHTML = icone(voz.mudo ? 'mic-off' : 'mic');
  mudo.classList.toggle('desligado', voz.mudo);
  mudo.title = t(voz.mudo ? 'Unmute' : 'Mute');
  const surdo = $('#btn-surdo');
  surdo.innerHTML = icone(voz.surdo ? 'fone-off' : 'fone');
  surdo.classList.toggle('desligado', voz.surdo);
  surdo.title = t(voz.surdo ? 'Undeafen' : 'Deafen');

  // Painel "voz conectada"
  const canal = voz.canalId && [...est.canais.values()].flat().find((c) => c.id === voz.canalId);
  $('#painel-voz').hidden = !canal;
  if (canal) {
    $('#pv-onde').textContent = `${canal.name} / ${est.nests.get(canal.nest_id)?.name || ''}`;
    $('#btn-tela-pv').classList.toggle('ligado', voz.aoVivo);
  }
}

function renderMembros() {
  const membros = est.membros.get(est.nestAtual) || new Map();
  const presenca = presencaDe(est.nestAtual);
  const lista = [...membros.keys()].sort((a, b) => nomeDe(a).localeCompare(nomeDe(b)));
  const online = lista.filter((id) => presenca.has(id));
  const offline = lista.filter((id) => !presenca.has(id));
  const item = (id, on) => {
    const p = presenca.get(id);
    const sub = p?.voz ? `${icone('volume')} ${esc((est.canais.get(est.nestAtual) || []).find((c) => c.id === p.voz)?.name || '')}` : '';
    return `<div class="membro ${on ? '' : 'off'}" data-usuario="${id}">${avatarHtml(id)}<div class="membro-info"><span class="membro-nome">${esc(nomeDe(id))}${etiquetaCargo(est.nestAtual, id)}</span>${sub ? `<span class="membro-sub">${sub}</span>` : ''}</div></div>`;
  };
  $('#contagem-membros').textContent = lista.length ? `· ${lista.length}` : '';
  est.contagemMembros = { online: online.length, total: lista.length };
  $('#membros').innerHTML =
    (online.length ? `<div class="membros-grupo">${esc(t('Online'))} — ${online.length}</div>${online.map((id) => item(id, true)).join('')}` : '') +
    (offline.length ? `<div class="membros-grupo">${esc(t('Offline'))} — ${offline.length}</div>${offline.map((id) => item(id, false)).join('')}` : '');
  aplicarFala();
}

// ================= Painel da direita (gaveta): Membros / Sistema =================
// Recolhido por padrão: fica só uma trilha fina com os ícones. Lembra o que estava aberto.

const painelSistema = criarPainelSistema({ el: $('#sistema'), voz, chamada, nomeDe, demo: new URLSearchParams(location.search).has('demo') });
let abaLateral = ler('herald-lateral') || ''; // '' = recolhido

function aplicarLateral() {
  $('#app').classList.toggle('lateral-aberta', Boolean(abaLateral));
  document.body.classList.toggle('lateral-aberta', Boolean(abaLateral)); // o Rádio flutuante sai da frente
  $$('[data-aba-lateral]').forEach((b) => b.classList.toggle('ligado', b.dataset.abaLateral === abaLateral));
  $('#membros').hidden = abaLateral !== 'membros';
  $('.lateral-titulo-membros').hidden = abaLateral !== 'membros';
  $('#sistema').hidden = abaLateral !== 'sistema';
  $('#painel-radio').hidden = abaLateral !== 'radio';
  if (abaLateral === 'sistema') painelSistema.redesenhar();
  // aba Rádio: o player encaixa no painel (o pop-up some); fora da call mostra um aviso
  const naCall = voz.conectado;
  $('#painel-radio-vazio').textContent = t(naCall ? '' : 'Join a voice channel to listen to the Radio together.');
  $('#painel-radio-vazio').hidden = naCall;
  radio.encaixar(abaLateral === 'radio' && naCall);
  guardar('herald-lateral', abaLateral);
}
$('#lateral').addEventListener('click', (e) => {
  const b = e.target.closest('[data-lateral], [data-aba-lateral]');
  if (!b) return;
  const acao = b.dataset.lateral || b.dataset.abaLateral;
  if (acao === 'fechar') abaLateral = '';
  else if (acao === 'abrir') abaLateral = ler('herald-lateral-ultima') || 'membros';
  else abaLateral = acao;
  if (abaLateral) guardar('herald-lateral-ultima', abaLateral);
  aplicarLateral();
});
// Anéis da trilha (estilo Rexie): Membros = online/total, Rádio = progresso da música,
// Sistema = CPU do PC (ou fps da sua transmissão, quando você está ao vivo)
const CIRCUNFERENCIA = 2 * Math.PI * 19;
function anel(el, fracao, cor, rotulo) {
  const p = el.querySelector('.anel-progresso');
  p.style.strokeDasharray = CIRCUNFERENCIA;
  p.style.strokeDashoffset = CIRCUNFERENCIA * (1 - Math.max(0, Math.min(1, fracao || 0)));
  el.dataset.cor = cor || '';
  el.querySelector('.anel-rotulo').textContent = rotulo;
}
const tempoCurto = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function atualizarTrilho(sis) {
  const m = est.contagemMembros || { online: 0, total: 0 };
  anel($('#anel-membros'), m.total ? m.online / m.total : 0, 'lima', m.total ? `${m.online}/${m.total}` : '–');
  const r = radio.info();
  // o Rádio só aparece (anel e aba) quando está ligado — e entra com animação
  const anelRadio = $('#anel-radio');
  if (r.ligado === anelRadio.classList.contains('oculto')) {
    anelRadio.classList.toggle('oculto', !r.ligado);
    if (r.ligado) {
      anelRadio.classList.remove('entrando');
      void anelRadio.offsetWidth; // reinicia a animação
      anelRadio.classList.add('entrando');
    }
    $('[data-aba-lateral="radio"]').hidden = !r.ligado;
  }
  anelRadio.classList.toggle('tocando', r.tocando);
  anel($('#anel-radio'), r.progresso, r.ativo ? 'roxo' : '', r.ativo && r.restante != null ? `-${tempoCurto(r.restante)}` : '–');
  $('#anel-radio').dataset.tip = r.titulo || t('Radio');
  if (sis?.fps != null) anel($('#anel-sistema'), sis.fps / sis.alvoFps, sis.cor, `${sis.fps}fps`);
  else anel($('#anel-sistema'), (sis?.cpu ?? 0) / 100, sis?.cor, sis?.cpu == null ? '–' : `${Math.round(sis.cpu)}%`);
}
setInterval(async () => {
  atualizarTrilho(await painelSistema.atualizar(abaLateral === 'sistema'));
}, 1000);
queueMicrotask(aplicarLateral); // depois que o Rádio (mais embaixo) já existir

// ================= Nest: criar / entrar / convidar / sair =================

let abaNest = 'criar';
function abrirDialogNest(aba) {
  abaNest = aba;
  $$('#abas-nest button').forEach((b) => b.classList.toggle('ligado', b.dataset.aba === aba));
  $('#dlg-nest-titulo').textContent = t(aba === 'criar' ? 'Create a Nest' : 'Join a Nest');
  $('#nest-rotulo').textContent = t(aba === 'criar' ? 'Nest name' : 'Invite link or code');
  $('#btn-nest-ok').textContent = t(aba === 'criar' ? 'Create' : 'Join');
  $('#nest-campo').value = aba === 'criar' ? t("{name}'s Nest", { name: est.eu.display_name }) : '';
  $('#nest-campo').placeholder = aba === 'criar' ? '' : 'herald://invite/…';
  $('#erro-nest').textContent = '';
  if (!$('#dlg-nest').open) $('#dlg-nest').showModal();
  $('#nest-campo').select();
}

$('#btn-novo-nest').onclick = () => abrirDialogNest('criar');
$('#abas-nest').onclick = (e) => {
  const b = e.target.closest('[data-aba]');
  if (b) abrirDialogNest(b.dataset.aba);
};
$('#sem-nests').addEventListener('click', (e) => {
  const b = e.target.closest('[data-acao]');
  if (b) abrirDialogNest(b.dataset.acao === 'criar-nest' ? 'criar' : 'entrar');
});

function extrairCodigo(texto) {
  const m = texto.match(/invite\/([a-z0-9]+)/i);
  return (m ? m[1] : texto).trim().toLowerCase();
}

$('#form-nest').addEventListener('submit', async (e) => {
  e.preventDefault();
  const valor = $('#nest-campo').value.trim();
  if (!valor) return;
  $('#btn-nest-ok').disabled = true;
  const { data, error } = abaNest === 'criar' ? await sb.rpc('create_nest', { nest_name: valor }) : await sb.rpc('join_nest', { code: extrairCodigo(valor) });
  $('#btn-nest-ok').disabled = false;
  if (error) {
    $('#erro-nest').textContent = traduzirErro(error);
    return;
  }
  $('#dlg-nest').close();
  await carregarEstrutura();
  abrirNest(data);
});

async function entrarComConvite(codigo) {
  const { data, error } = await sb.rpc('join_nest', { code: extrairCodigo(codigo) });
  if (error) return aviso(traduzirErro(error));
  await carregarEstrutura();
  abrirNest(data);
}

function linkConvite(nest) {
  return `herald://invite/${nest.invite_code}`;
}

function abrirConvite() {
  const nest = est.nests.get(est.nestAtual);
  if (!nest) return;
  $('#convite-titulo').textContent = t('Invite friends to {name}', { name: nest.name });
  $('#convite-link').value = linkConvite(nest);
  $('#btn-novo-convite').hidden = meuNivel(nest.id) < 2;
  $('#dlg-convite').showModal();
}

$('#btn-copiar-convite').onclick = async () => {
  await navigator.clipboard.writeText($('#convite-link').value);
  aviso(t('Copied!'));
};
$('#btn-novo-convite').onclick = async () => {
  if (!(await confirmar(t('The old link will stop working.')))) return;
  const { data, error } = await sb.rpc('reset_invite', { n: est.nestAtual });
  if (error) return aviso(traduzirErro(error));
  est.nests.get(est.nestAtual).invite_code = data;
  $('#convite-link').value = linkConvite(est.nests.get(est.nestAtual));
  if (!$('#dlg-convite').open) $('#dlg-convite').showModal();
};

// Menu do Nest (setinha ao lado do nome)
$('#btn-menu-nest').onclick = (e) => {
  e.stopPropagation();
  const nest = est.nests.get(est.nestAtual);
  if (!nest) return;
  const dono = nest.owner_id === est.eu.id;
  const menu = $('#menu-nest');
  menu.innerHTML = `<button data-menu="convidar">${icone('convite')}${esc(t('Invite people'))}</button>
    ${meuNivel(nest.id) >= 2 ? `<button data-menu="editar">${icone('ajustes')}${esc(t('Edit Nest'))}</button>` : ''}
    ${dono ? `<button data-menu="apagar" class="perigo">${icone('lixo')}${esc(t('Delete Nest'))}</button>` : `<button data-menu="sair" class="perigo">${icone('porta')}${esc(t('Leave Nest'))}</button>`}`;
  menu.hidden = !menu.hidden;
};
document.addEventListener('click', (e) => {
  if (!e.target.closest('#menu-nest')) $('#menu-nest').hidden = true;
});
$('#menu-nest').onclick = async (e) => {
  const b = e.target.closest('[data-menu]');
  if (!b) return;
  $('#menu-nest').hidden = true;
  const nest = est.nests.get(est.nestAtual);
  if (b.dataset.menu === 'convidar') return abrirConvite();
  if (b.dataset.menu === 'editar') return abrirEditarNest(nest);
  sairOuApagarNest(nest, b.dataset.menu === 'apagar');
};

// Sair do Nest (ou apagar, se for o dono) — usado no menu do nome e no botão direito do ícone
async function sairOuApagarNest(nest, apagar) {
  const texto = apagar ? t('Delete {name} for everyone? This cannot be undone.', { name: nest.name }) : t('Leave {name}?', { name: nest.name });
  if (!(await confirmar(texto))) return;
  if (voz.canalId && (est.canais.get(nest.id) || []).some((c) => c.id === voz.canalId)) await chamada.sair();
  const { error } = apagar
    ? await sb.from('nests').delete().eq('id', nest.id)
    : await sb.from('nest_members').delete().eq('nest_id', nest.id).eq('user_id', est.eu.id);
  if (error) return aviso(traduzirErro(error));
  await carregarEstrutura();
  abrirNest([...est.nests.keys()][0] || null);
}

// Botão direito no ícone do Nest (barra da esquerda)
function iconeNest(n) {
  const iniciais = n.name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  return `<span class="mp-nest" style="${n.icon_url ? '' : `background:${gradiente(n.id)}`}">${n.icon_url ? `<img src="${esc(n.icon_url)}" alt="">` : esc(iniciais)}</span>`;
}
function abrirMenuNest(nest, x, y) {
  fecharMenuPessoa();
  const dono = nest.owner_id === est.eu.id;
  menuPessoa = document.createElement('div');
  menuPessoa.className = 'menu-pessoa';
  menuPessoa.innerHTML = `<div class="mp-topo">${iconeNest(nest)}<div><b>${esc(nest.name)}</b><span>${esc(t((est.membros.get(nest.id)?.size || 1) === 1 ? '{n} member' : '{n} members', { n: est.membros.get(nest.id)?.size || 1 }))}</span></div></div>
    <button data-mn="convidar">${icone('convite')}${esc(t('Invite people'))}</button>
    ${meuNivel(nest.id) >= 2 ? `<button data-mn="editar">${icone('ajustes')}${esc(t('Edit Nest'))}</button>` : ''}
    ${dono
      ? `<button data-mn="apagar" class="perigo">${icone('lixo')}${esc(t('Delete Nest'))}</button>`
      : `<button data-mn="sair" class="perigo">${icone('porta')}${esc(t('Leave Nest'))}</button>`}`;
  document.body.appendChild(menuPessoa);
  const r = menuPessoa.getBoundingClientRect();
  menuPessoa.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  menuPessoa.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  menuPessoa.addEventListener('click', (e) => {
    const acao = e.target.closest('[data-mn]')?.dataset.mn;
    if (!acao) return;
    fecharMenuPessoa();
    if (acao === 'convidar') {
      if (est.nestAtual !== nest.id) abrirNest(nest.id);
      abrirConvite();
    } else if (acao === 'editar') abrirEditarNest(nest);
    else sairOuApagarNest(nest, acao === 'apagar');
  });
}
document.addEventListener('contextmenu', (e) => {
  const b = e.target.closest('[data-nest]');
  const nest = b && est.nests.get(b.dataset.nest);
  if (!nest || !est.eu) return;
  e.preventDefault();
  abrirMenuNest(nest, e.clientX, e.clientY);
});

// Novo canal
let tipoNovoCanal = 'text';
let canalEditando = null; // renomeando (o mesmo diálogo do "novo canal")
function abrirNovoCanal(tipo) {
  tipoNovoCanal = tipo;
  canalEditando = null;
  $('#canal-titulo').textContent = t('New channel');
  $('#canal-salvar').textContent = t('Create');
  $('#canal-nome').value = '';
  $('#dlg-canal').showModal();
}
function abrirRenomearCanal(canal) {
  tipoNovoCanal = canal.kind;
  canalEditando = canal;
  $('#canal-titulo').textContent = t('Rename channel');
  $('#canal-salvar').textContent = t('Save');
  $('#canal-nome').value = canal.name;
  $('#dlg-canal').showModal();
  $('#canal-nome').select();
}
$('#form-canal').addEventListener('submit', async (e) => {
  e.preventDefault();
  let nome = $('#canal-nome').value.trim();
  if (tipoNovoCanal === 'text') nome = nome.toLowerCase().replace(/\s+/g, '-');
  if (!nome) return;
  const canais = est.canais.get(est.nestAtual) || [];
  const { error } = canalEditando
    ? await sb.from('channels').update({ name: nome }).eq('id', canalEditando.id)
    : await sb.from('channels').insert({ nest_id: est.nestAtual, name: nome, kind: tipoNovoCanal, position: canais.length });
  if (error) return aviso(traduzirErro(error));
  $('#dlg-canal').close();
  recarregarEstrutura();
});

// ================= Voz =================

// Credenciais do servidor de apoio (TURN), geradas pela função do Supabase.
// Valem 24 h; renova antes de vencer. Sem TURN, a chamada funciona direto.
let turnCache = { servidores: [], validoAte: 0 };
async function obterTurn() {
  if (turnCache.validoAte - Date.now() > 3600 * 1000) return turnCache.servidores;
  try {
    const { data, error } = await sb.functions.invoke('turn-credentials');
    if (error || !data?.iceServers?.length) return [];
    turnCache = { servidores: data.iceServers, validoAte: data.validoAte || Date.now() + 12 * 3600 * 1000 };
  } catch {
    return [];
  }
  return turnCache.servidores;
}

async function entrarNaVoz(canal) {
  try {
    const turn = await obterTurn();
    await chamada.entrar({ canalId: canal.id, chave: canal.voice_key, userId: est.eu.id, turn, sinal: sb });
  } catch (err) {
    console.error(err);
    aviso(t('Could not access the microphone.'));
  }
  anunciarPresenca();
  render();
}

async function sairDaVoz() {
  await chamada.sair();
  anunciarPresenca();
  render();
}

chamada.aoMudar((tipo, dados) => {
  if (DEMO && (tipo === 'fala' || tipo === 'stats')) return;
  if (tipo === 'fala') {
    est.falando = dados;
    aplicarFala();
    return;
  }
  if (tipo === 'stats') return atualizarStats(dados);
  if (tipo === 'roleta') return roleta.receber(dados);
  if (tipo === 'calibrado') return aviso(t('Your mic is now calibrated ✓ Hear the difference in Settings → Audio'));
  if (tipo === 'calibracao') return $('#dlg-config').open && renderCalibracao();
  if (tipo === 'radio') return radio.receber(dados);
  if (tipo === 'chegou') return radio.chegou(dados);
  if (tipo === 'eu') radio.atualizarSom();
  if (tipo === 'conexao' && !voz.conectado) radio.desligar();
  if (tipo === 'conexao' && abaLateral === 'radio') aplicarLateral();
  if (tipo === 'eu' || tipo === 'conexao') anunciarPresenca();
  renderUsuario();
  renderCanais();
  if (est.vista === 'voz') renderPalco();
});

function aplicarFala() {
  for (const el of $$('[data-fala]')) el.classList.toggle('falando', est.falando.has(el.dataset.fala));
}

$('#btn-mudo').onclick = () => chamada.alternarMudo();
$('#btn-surdo').onclick = () => chamada.alternarSurdo();
$('#doca-mudo').onclick = () => chamada.alternarMudo();
$('#doca-surdo').onclick = () => chamada.alternarSurdo();
$('#btn-desconectar').onclick = sairDaVoz;
$('#doca-sair').onclick = sairDaVoz;
$('#doca-entrar').onclick = () => {
  const canal = (est.canais.get(est.nestAtual) || []).find((c) => c.id === est.vozVista);
  if (canal) entrarNaVoz(canal);
};
$('#btn-tela-pv').onclick = () => abrirSeletorTela();
$('#doca-tela').onclick = () => abrirSeletorTela();
$('#pv-onde').onclick = () => {
  const canal = [...est.canais.values()].flat().find((c) => c.id === voz.canalId);
  if (!canal) return;
  if (est.nestAtual !== canal.nest_id) abrirNest(canal.nest_id);
  abrirCanal(canal);
};

// Palco: vídeos assistidos (grandes) + cartões das pessoas no canal de voz
function renderPalco() {
  const canal = (est.canais.get(est.nestAtual) || []).find((c) => c.id === est.vozVista);
  if (!canal) return;
  $('#voz-nome').textContent = canal.name;
  const dentro = voz.canalId === canal.id;
  $('#doca-entrar').hidden = dentro;
  $('#doca-controles').hidden = !dentro;
  $('#doca-mudo').innerHTML = icone(voz.mudo ? 'mic-off' : 'mic');
  $('#doca-mudo').classList.toggle('desligado', voz.mudo);
  $('#doca-mudo').dataset.tip = `${t(voz.mudo ? 'Unmute' : 'Mute')}  (Ctrl+Shift+M)`;
  $('#doca-surdo').innerHTML = icone(voz.surdo ? 'fone-off' : 'fone');
  $('#doca-surdo').classList.toggle('desligado', voz.surdo);
  $('#doca-surdo').dataset.tip = `${t(voz.surdo ? 'Undeafen' : 'Deafen')}  (Ctrl+Shift+D)`;
  $('#doca-tela').classList.toggle('ligado', voz.aoVivo);
  $('#doca-tela').dataset.tip = t(voz.aoVivo ? 'Stop sharing' : 'Share screen');

  const videos = [];
  const pessoas = [];
  if (dentro) {
    if (voz.telaStream) videos.push({ chave: 'video-eu', nome: t('Your screen'), stream: voz.telaStream, local: true, userId: est.eu.id });
    for (const p of voz.participantes.values()) {
      if (p.assistindo && p.aoVivo) videos.push({ chave: `video-${p.peerId}`, nome: nomeDe(p.userId), stream: p.telaStream, peerId: p.peerId, userId: p.userId });
    }
    pessoas.push({ chave: 'pessoa-eu', userId: est.eu.id, mudo: voz.mudo, surdo: voz.surdo, aoVivo: voz.aoVivo, ehEu: true });
    const conectados = new Set();
    for (const p of voz.participantes.values()) {
      if (!p.userId) continue;
      // chave pelo usuário: o cartão "conectando…" vira o cartão conectado sem piscar
      const chave = conectados.has(p.userId) ? `pessoa-${p.peerId}` : `pessoa-${p.userId}`;
      conectados.add(p.userId);
      pessoas.push({ chave, userId: p.userId, peerId: p.peerId, mudo: p.mudo, surdo: p.surdo, aoVivo: p.aoVivo, assistindo: p.assistindo, ping: p.ping, conexao: p.estadoConexao });
    }
    // Quem já está no canal (pela presença) mas a conexão direta ainda não fechou:
    // aparece na hora, com "conectando…", em vez de surgir só depois
    for (const [userId, p] of presencaDe(est.nestAtual)) {
      if (p.voz === canal.id && userId !== est.eu.id && !conectados.has(userId)) {
        pessoas.push({ chave: `pessoa-${userId}`, userId, mudo: p.mudo, surdo: p.surdo, aoVivo: p.aoVivo, conectando: true });
      }
    }
  } else {
    // Fora da chamada: mostra quem está lá (pela presença)
    const presenca = presencaDe(est.nestAtual);
    for (const [userId, p] of presenca) {
      if (p.voz === canal.id) pessoas.push({ chave: `fora-${userId}`, userId, mudo: p.mudo, surdo: p.surdo, aoVivo: p.aoVivo, fora: true });
    }
  }

  $('#palco').classList.toggle('com-video', videos.length > 0);
  $('#palco-pessoas').dataset.vazio = pessoas.length ? '' : t('Nobody here yet. Jump in!');
  sincronizar($('#palco-videos'), videos, atualizarVideo);
  limparJanelas(new Set(videos.map((v) => v.chave)));
  sincronizar($('#palco-pessoas'), pessoas, atualizarCartao);
  aplicarFala();
}

function sincronizar(container, itens, atualizar) {
  const chaves = new Set(itens.map((d) => d.chave));
  for (const el of [...container.children]) if (!chaves.has(el.dataset.chave)) el.remove();
  itens.forEach((d, i) => {
    let el = container.querySelector(`[data-chave="${d.chave}"]`);
    if (!el) {
      el = document.createElement('div');
      el.dataset.chave = d.chave;
    }
    if (container.children[i] !== el) container.insertBefore(el, container.children[i] || null);
    atualizar(el, d);
  });
}

function textoPing(d) {
  if (d.ehEu || d.fora) return '';
  if (d.conexao === 'failed') return `<span class="ping ruim">${esc(t('no connection'))}</span>`;
  if (d.ping == null) return `<span class="ping">${esc(t('connecting…'))}</span>`;
  return `<span class="ping ${d.ping < 60 ? 'bom' : d.ping < 140 ? 'medio' : 'ruim'}">${d.ping} ms</span>`;
}

function atualizarCartao(el, d) {
  el.className = d.conectando ? 'cartao-pessoa conectando' : 'cartao-pessoa';
  el.dataset.fala = d.userId;
  if (d.conectando) el.dataset.tip = t('connecting…');
  else delete el.dataset.tip;
  const marcas = (!d.ehEu && chamada.mudoLocal(d.userId) ? icone('som-off') : '') || (d.surdo ? icone('fone-off') : d.mudo ? icone('mic-off') : '');
  const html = `${d.aoVivo ? `<span class="etiqueta-vivo">${esc(t('LIVE'))}</span>` : ''}
    ${avatarHtml(d.userId)}
    <div class="nome">${esc(nomeDe(d.userId))}${d.ehEu ? ` <span class="voce">(${esc(t('you'))})</span>` : ''}</div>
    ${textoPing(d)}
    ${marcas ? `<div class="marcas"><span class="marca">${marcas}</span></div>` : ''}
    ${d.aoVivo && d.peerId && !d.assistindo ? `<div class="assistir"><button class="botao-assistir" data-assistir="${d.peerId}">${icone('olho')}${esc(t('Watch'))}</button></div>` : ''}`;
  if (el.dataset.html !== html) {
    el.dataset.html = html;
    el.innerHTML = html;
  }
}

function atualizarVideo(el, d) {
  if (!el.querySelector('video')) {
    el.className = 'cartao-video';
    el.innerHTML = `<video autoplay playsinline ${d.local ? 'muted' : 'data-remoto'}></video>
      <div class="carregando-texto">${esc(t('Connecting to stream…'))}</div>
      <div class="sobre">
        <div class="linha"><span class="etiqueta-vivo" style="position:static">${esc(t('LIVE'))}</span><span class="stats"></span></div>
        <div class="linha baixo">
          <span class="quem">${esc(d.nome)}</span>
          <div class="acoes">
            <button data-janela>${icone('janela')}${esc(t('Pop out'))}</button>
            <button data-cheia>${icone('maximizar')}${esc(t('Fullscreen'))}</button>
            ${d.local ? `<button data-parar-tela>${icone('x')}${esc(t('Stop'))}</button>` : `<button data-sair-video="${d.peerId}">${icone('x')}${esc(t('Close'))}</button>`}
          </div>
        </div>
      </div>
      <div class="em-janela"><span>${esc(t('Watching in another window'))}</span><button data-trazer>${esc(t('Bring it back'))}</button></div>`;
    if (!d.local) {
      const v = el.querySelector('video');
      v.volume = volumeTela(d.userId);
      // o som da tela sai no mesmo fone/caixa escolhido pras vozes
      if (chamada.saidaAtual()) v.setSinkId?.(chamada.saidaAtual()).catch(() => {});
    }
  }
  el.dataset.peer = d.peerId || 'eu';
  el.dataset.usuarioTela = d.userId;
  el.classList.toggle('stats-fixas', ler('herald-stats-fixas') === '1');
  const video = el.querySelector('video');
  if (video.srcObject !== (d.stream || null)) video.srcObject = d.stream || null;
  // o deafen só silencia as vozes; o som da transmissão continua (dá pra baixar no botão direito)
  el.classList.toggle('popout', Boolean(janelasTela.get(d.chave) && !janelasTela.get(d.chave).closed));
  el.classList.toggle('carregando', !d.stream);
  el.querySelector('.carregando-texto').hidden = Boolean(d.stream);
}

$('#palco').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.assistir) chamada.assistir(b.dataset.assistir, true);
  else if (b.dataset.sairVideo) chamada.assistir(b.dataset.sairVideo, false);
  else if ('pararTela' in b.dataset) chamada.pararTela();
  else if ('cheia' in b.dataset) b.closest('.cartao-video').requestFullscreen();
  else if ('janela' in b.dataset) abrirEmJanela(b.closest('.cartao-video'));
  else if ('trazer' in b.dataset) fecharJanela(b.closest('.cartao-video').dataset.chave);
});
$('#palco').addEventListener('dblclick', (e) => {
  const v = e.target.closest('.cartao-video');
  if (!v) return;
  document.fullscreenElement ? document.exitFullscreen() : v.requestFullscreen();
});
$('#palco').addEventListener('input', (e) => {
  if (e.target.dataset.vol) chamada.definirVolume(e.target.dataset.vol, Number(e.target.value));
});

function atualizarStats({ video, enviando }) {
  for (const [peerId, texto] of Object.entries(video)) {
    const el = $(`[data-chave="video-${peerId}"] .stats`);
    if (el) el.textContent = texto;
  }
  const el = $('[data-chave="video-eu"] .stats');
  if (el) {
    if (!voz.espectadores.size) el.textContent = t('nobody watching yet');
    else if (enviando) {
      const motivo = { cpu: t('limited: CPU'), bandwidth: t('limited: internet') }[enviando.limite];
      el.textContent = `${t('{n} watching', { n: voz.espectadores.size })} · ${enviando.largura}×${enviando.altura} · ${enviando.fps} fps${motivo ? ' · ' + motivo : ''}`;
      el.classList.toggle('ruim', Boolean(motivo));
    }
  }
  // atualiza o ping dos cartões sem redesenhar tudo
  if (est.vista === 'voz') renderPalco();
}

// ================= Ferramentas do canal (Roleta; Rádio vem depois) =================

function pessoasDaChamada() {
  const ids = [est.eu.id, ...[...voz.participantes.values()].map((p) => p.userId).filter(Boolean)];
  return [...new Set(ids)];
}

const roleta = criarRoleta({
  eu: () => est.eu.id,
  pessoas: pessoasDaChamada,
  nomeDe,
  avatarHtml: (id) => avatarHtml(id),
  enviar: (giro) => chamada.enviarRoleta(giro),
  audio: () => chamada.contextoAudio(),
  mudo: () => voz.surdo,
  aviso,
});

// o deafen não cala o Rádio (igual à transmissão): cada um baixa no volume dele
const radio = criarRadio({
  eu: () => est.eu.id,
  nomeDe,
  enviar: (estado, peerId) => chamada.enviarRadio(estado, peerId),
  mudo: () => false,
  aviso,
  buscar: (texto) => window.herald.radioBuscar(texto),
});

$('#btn-ferramentas').onclick = (e) => {
  e.stopPropagation();
  const menu = $('#menu-ferramentas');
  const naChamada = voz.conectado && voz.canalId === est.vozVista;
  menu.innerHTML = `
    <button data-ferramenta="roleta" ${naChamada ? '' : 'disabled'}>${icone('roleta')}<span><b>${esc(t('Roulette'))}</b><small>${esc(t(naChamada ? 'Pick people at random' : 'Join the voice channel first'))}</small></span></button>
    <button data-ferramenta="radio" ${naChamada ? '' : 'disabled'}>${icone('radio')}<span><b>${esc(t('Radio'))}</b><small>${esc(t(!naChamada ? 'Join the voice channel first' : radio.tocandoAlgo() ? 'Playing now' : 'Listen to music together'))}</small></span></button>`;
  menu.hidden = !menu.hidden;
};
$('#menu-ferramentas').onclick = (e) => {
  const b = e.target.closest('[data-ferramenta]');
  if (!b || b.disabled) return;
  $('#menu-ferramentas').hidden = true;
  if (b.dataset.ferramenta === 'roleta') roleta.abrir();
  if (b.dataset.ferramenta === 'radio') radio.abrir();
};
document.addEventListener('click', (e) => {
  if (!e.target.closest('.ferramentas')) $('#menu-ferramentas').hidden = true;
});

// ================= Transmissão em outra janela =================
// A janela nova é uma página nossa (janela-tela.html); entregamos o vídeo direto pra ela.
// O som continua saindo daqui, então o cartão fica tocando por baixo do aviso.

const janelasTela = new Map(); // chave do cartão -> Window

function volumeTela(userId) {
  return Number(ler('herald-vol-tela-' + userId) ?? 1);
}

function abrirEmJanela(cartao) {
  const chave = cartao.dataset.chave;
  const aberta = janelasTela.get(chave);
  if (aberta && !aberta.closed) return aberta.focus();
  const video = cartao.querySelector('video');
  const nome = cartao.querySelector('.quem')?.textContent || 'Herald';
  const w = window.open('janela-tela.html', `tela-${chave}`);
  if (!w) return;
  janelasTela.set(chave, w);
  const preparar = () => {
    const v = w.document?.getElementById('video');
    if (!v) return setTimeout(preparar, 50);
    v.srcObject = video.srcObject;
    v.muted = true;
    w.document.getElementById('nome').textContent = nome;
    w.document.title = `${nome} — Herald`;
    // esconde o nome quando o mouse para
    let parado;
    w.document.addEventListener('mousemove', () => {
      w.document.body.classList.remove('parado');
      clearTimeout(parado);
      parado = setTimeout(() => w.document.body.classList.add('parado'), 2500);
    });
    w.document.addEventListener('dblclick', () => (w.document.fullscreenElement ? w.document.exitFullscreen() : w.document.documentElement.requestFullscreen()));
  };
  preparar();
  cartao.classList.add('popout');
  // percebe quando a pessoa fecha a janela
  const vigia = setInterval(() => {
    if (!w.closed) return;
    clearInterval(vigia);
    janelasTela.delete(chave);
    $(`[data-chave="${chave}"]`)?.classList.remove('popout');
  }, 700);
}

function fecharJanela(chave) {
  janelasTela.get(chave)?.close();
  janelasTela.delete(chave);
  $(`[data-chave="${chave}"]`)?.classList.remove('popout');
}

// Fecha janelas de transmissões que acabaram
function limparJanelas(chavesAtivas) {
  for (const chave of [...janelasTela.keys()]) if (!chavesAtivas.has(chave)) fecharJanela(chave);
}

// ================= Menu de botão direito na transmissão =================

function abrirMenuTela(cartao, x, y) {
  fecharMenuPessoa();
  const local = cartao.dataset.peer === 'eu';
  const peerId = cartao.dataset.peer;
  const userId = cartao.dataset.usuarioTela;
  const participante = voz.participantes.get(peerId);
  const video = cartao.querySelector('video');
  const emJanela = cartao.classList.contains('popout');
  const statsFixas = ler('herald-stats-fixas') === '1';
  const vol = Math.round(video.volume * 100);

  let html = `<div class="mp-topo">${avatarHtml(userId)}<div><b>${esc(local ? t('Your screen') : t("{name}'s stream", { name: nomeDe(userId) }))}</b></div></div>`;
  if (!local) {
    html += `<div class="mp-bloco">
      <div class="mp-rotulo"><span>${esc(t('Stream volume'))}</span><b id="mt-vol-valor">${vol}%</b></div>
      <input type="range" id="mt-vol" min="0" max="100" step="1" value="${vol}">
    </div>`;
  }
  html += `<button data-mt="janela">${icone('janela')}${esc(t(emJanela ? 'Bring it back' : 'Pop out'))}</button>
    <button data-mt="cheia">${icone('maximizar')}${esc(t('Fullscreen'))}</button>
    <label class="alternador mp-alternador"><input type="checkbox" id="mt-stats" ${statsFixas ? 'checked' : ''}><span class="trilha"></span><span>${esc(t('Always show stats'))} <small>${esc(t('resolution, fps and speed'))}</small></span></label>`;
  if (!local) {
    html += `<label class="alternador mp-alternador"><input type="checkbox" id="mt-baixa" ${participante?.qualidadeBaixa ? 'checked' : ''}><span class="trilha"></span><span>${esc(t('Lower quality'))} <small>${esc(t('720p 30fps — for weak internet'))}</small></span></label>
      <button data-mt="parar" class="perigo">${icone('x')}${esc(t('Stop watching'))}</button>`;
  } else {
    html += `<button data-mt="parar" class="perigo">${icone('x')}${esc(t('Stop sharing'))}</button>`;
  }

  menuPessoa = document.createElement('div');
  menuPessoa.className = 'menu-pessoa';
  menuPessoa.innerHTML = html;
  document.body.appendChild(menuPessoa);
  const r = menuPessoa.getBoundingClientRect();
  menuPessoa.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  menuPessoa.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;

  menuPessoa.addEventListener('input', (e) => {
    if (e.target.id !== 'mt-vol') return;
    video.volume = Number(e.target.value) / 100;
    guardar('herald-vol-tela-' + userId, video.volume);
    $('#mt-vol-valor').textContent = `${e.target.value}%`;
  });
  menuPessoa.addEventListener('change', (e) => {
    if (e.target.id === 'mt-stats') {
      guardar('herald-stats-fixas', e.target.checked ? '1' : '0');
      $$('.cartao-video').forEach((c) => c.classList.toggle('stats-fixas', e.target.checked));
    }
    if (e.target.id === 'mt-baixa') chamada.pedirQualidadeBaixa(peerId, e.target.checked);
  });
  menuPessoa.addEventListener('click', (e) => {
    const acao = e.target.closest('[data-mt]')?.dataset.mt;
    if (!acao) return;
    fecharMenuPessoa();
    if (acao === 'janela') emJanela ? fecharJanela(cartao.dataset.chave) : abrirEmJanela(cartao);
    if (acao === 'cheia') cartao.requestFullscreen();
    if (acao === 'parar') local ? chamada.pararTela() : chamada.assistir(peerId, false);
  });
}

document.addEventListener('contextmenu', (e) => {
  const cartao = e.target.closest('.cartao-video');
  if (!cartao || !est.eu) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  abrirMenuTela(cartao, e.clientX, e.clientY);
}, true);

// ================= Menu de botão direito nas pessoas =================
// Funciona na lista de canais, no palco da voz e na lista de membros.

let menuPessoa = null;

function fecharMenuPessoa() {
  menuPessoa?.remove();
  menuPessoa = null;
}

function abrirMenuPessoa(userId, x, y) {
  fecharMenuPessoa();
  const ehEu = userId === est.eu.id;
  const participante = [...voz.participantes.values()].find((p) => p.userId === userId);
  const presenca = presencaDe(est.nestAtual).get(userId);
  const canalDele = presenca?.voz && [...est.canais.values()].flat().find((c) => c.id === presenca.voz);
  const volume = Math.round(chamada.volumeDe(userId) * 100);

  let html = `<div class="mp-topo">${avatarHtml(userId)}<div><b>${esc(nomeDe(userId))}</b>${ehEu ? `<span>${esc(t('you'))}</span>` : ''}</div></div>`;
  if (!ehEu) {
    html += `<div class="mp-bloco">
      <div class="mp-rotulo"><span>${esc(t('User volume'))}</span><b id="mp-vol-valor">${volume}%</b></div>
      <input type="range" id="mp-vol" min="0" max="100" step="1" value="${volume}">
    </div>
    <label class="alternador mp-alternador">
      <input type="checkbox" id="mp-mudo" ${chamada.mudoLocal(userId) ? 'checked' : ''}>
      <span class="trilha"></span>
      <span>${esc(t('Mute for me'))} <small>${esc(t('Only you stop hearing them.'))}</small></span>
    </label>`;
    if (participante?.aoVivo) {
      html += `<button data-mp="assistir">${icone('olho')}${esc(t(participante.assistindo ? 'Stop watching' : 'Watch stream'))}</button>`;
    }
    if (canalDele && voz.canalId !== canalDele.id) {
      html += `<button data-mp="entrar">${icone('volume')}${esc(t('Join them in voice'))} · ${esc(canalDele.name)}</button>`;
    }
  }
  html += `<button data-mp="copiar">${icone('copiar')}${esc(t('Copy name'))}</button>`;
  if (possoGerenciar(est.nestAtual, userId)) {
    const cargos = cargosQuePossoDar(est.nestAtual);
    if (cargos.length) {
      html += `<div class="mp-linha"></div><div class="mp-bloco"><div class="mp-rotulo"><span>${esc(t('Role'))}</span></div><div class="segmentado mp-cargos">${cargos
        .map((r) => `<button data-cargo="${r}" class="${cargoDe(est.nestAtual, userId) === r ? 'ligado' : ''}">${esc(t(NOMES_CARGO[r]))}</button>`).join('')}</div></div>`;
    }
    html += `<button data-mp="expulsar" class="perigo">${icone('porta')}${esc(t('Kick from Nest'))}</button>`;
  }

  menuPessoa = document.createElement('div');
  menuPessoa.className = 'menu-pessoa';
  menuPessoa.innerHTML = html;
  document.body.appendChild(menuPessoa);
  aplicarFala();
  // posiciona sem sair da janela
  const r = menuPessoa.getBoundingClientRect();
  menuPessoa.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  menuPessoa.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;

  menuPessoa.addEventListener('input', (e) => {
    if (e.target.id !== 'mp-vol') return;
    chamada.definirVolume(userId, Number(e.target.value) / 100);
    $('#mp-vol-valor').textContent = `${e.target.value}%`;
  });
  menuPessoa.addEventListener('change', (e) => {
    if (e.target.id !== 'mp-mudo') return;
    chamada.definirMudoLocal(userId, e.target.checked);
    renderCanais();
    if (est.vista === 'voz') renderPalco();
  });
  menuPessoa.addEventListener('click', async (e) => {
    const acao = e.target.closest('[data-mp]')?.dataset.mp;
    if (!acao) return;
    fecharMenuPessoa();
    if (acao === 'assistir') chamada.assistir(participante.peerId, !participante.assistindo);
    if (acao === 'entrar') {
      if (est.nestAtual !== canalDele.nest_id) abrirNest(canalDele.nest_id);
      abrirCanal(canalDele);
    }
    if (acao === 'copiar') {
      await navigator.clipboard.writeText(nomeDe(userId));
      aviso(t('Copied!'));
    }
    if (acao === 'expulsar') expulsar(est.nestAtual, userId);
  });
  menuPessoa.querySelector('.mp-cargos')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cargo]');
    if (!b) return;
    fecharMenuPessoa();
    mudarCargo(est.nestAtual, userId, b.dataset.cargo);
  });
}

// ================= Cargos: trocar, expulsar, passar a posse =================

async function mudarCargo(nestId, userId, cargo) {
  if (cargoDe(nestId, userId) === cargo) return;
  const { error } = await sb.rpc('set_member_role', { n: nestId, target: userId, new_role: cargo });
  if (error) return aviso(traduzirErro(error));
  est.membros.get(nestId)?.set(userId, cargo);
  aviso(t('{name} is now {role}', { name: nomeDe(userId), role: t(NOMES_CARGO[cargo]) }));
  render();
  if ($('#dlg-editar-nest').open) renderMembrosNest();
}

async function expulsar(nestId, userId) {
  const nest = est.nests.get(nestId);
  if (!(await confirmar(t('Kick {name} from {nest}? They can come back with an invite link.', { name: nomeDe(userId), nest: nest.name })))) return;
  // sem permissão o banco não dá erro, só não apaga nada: confere a contagem
  const { error, count } = await sb.from('nest_members').delete({ count: 'exact' }).eq('nest_id', nestId).eq('user_id', userId);
  if (error || !count) return aviso(traduzirErro(error || 'not allowed'));
  est.membros.get(nestId)?.delete(userId);
  aviso(t('{name} was kicked', { name: nomeDe(userId) }));
  render();
  if ($('#dlg-editar-nest').open) renderMembrosNest();
}

async function passarPosse(nestId, userId) {
  const nest = est.nests.get(nestId);
  if (!(await confirmar(t('Make {name} the owner of {nest}? You will become an Admin.', { name: nomeDe(userId), nest: nest.name })))) return;
  const { error } = await sb.rpc('transfer_nest', { n: nestId, target: userId });
  if (error) return aviso(traduzirErro(error));
  await carregarEstrutura();
  render();
  if ($('#dlg-editar-nest').open) abrirEditarNest(est.nests.get(nestId));
}

// ================= Edit Nest =================

let nestEditando = null;

function abrirPaginaNest(pagina) {
  $$('#menu-editar-nest [data-pagina-nest]').forEach((b) => b.classList.toggle('ligado', b.dataset.paginaNest === pagina));
  $$('#dlg-editar-nest .config-pagina').forEach((s) => (s.hidden = s.dataset.paginaNest !== pagina));
  $$('#dlg-editar-nest .config-pagina:not([hidden])').forEach(atualizarFade);
}
$('#menu-editar-nest').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pagina-nest]');
  if (b) abrirPaginaNest(b.dataset.paginaNest);
});

function abrirEditarNest(nest) {
  if (!nest) return;
  nestEditando = nest;
  $('#editar-nest-titulo').textContent = nest.name;
  $('#nest-nome-editar').value = nest.name;
  $('#nest-icone').outerHTML = iconeNest(nest).replace('class="mp-nest"', 'id="nest-icone" class="nest-icone-grande"');
  $('#nest-convite-editar').value = linkConvite(nest);
  $('#btn-apagar-nest').hidden = nest.owner_id !== est.eu.id;
  renderMembrosNest();
  if (!$('#dlg-editar-nest').open) {
    abrirPaginaNest('geral');
    $('#dlg-editar-nest').showModal();
  }
}

function renderMembrosNest() {
  const nest = nestEditando;
  const membros = [...(est.membros.get(nest.id)?.keys() || [])].sort(
    (a, b) => nivelDe(nest.id, b) - nivelDe(nest.id, a) || nomeDe(a).localeCompare(nomeDe(b)),
  );
  const cargos = cargosQuePossoDar(nest.id);
  const souDono = nest.owner_id === est.eu.id;
  $('#lista-membros-nest').innerHTML = membros
    .map((id) => {
      const cargo = cargoDe(nest.id, id);
      const pode = possoGerenciar(nest.id, id);
      const seletor = pode && cargos.length
        ? `<div class="seletor cargo-seletor" data-cargo-de="${id}"></div>`
        : `<span class="cargo-fixo">${cargo === 'member' ? esc(t('Member')) : etiquetaCargo(nest.id, id)}</span>`;
      const chute = pode ? `<button class="botao-icone pequeno perigo" data-expulsar="${id}" data-tip="${esc(t('Kick from Nest'))}">${icone('porta')}</button>` : '<span class="botao-icone pequeno"></span>';
      return `<div class="membro-nest" data-usuario="${id}">${avatarHtml(id)}<span class="membro-nest-nome">${esc(nomeDe(id))}${id === est.eu.id ? ` <small>(${esc(t('you'))})</small>` : ''}</span>${seletor}${chute}</div>`;
    })
    .join('');
  // dropdown do app (o <select> do Windows destoava)
  for (const el of $$('#lista-membros-nest [data-cargo-de]')) {
    const userId = el.dataset.cargoDe;
    const s = criarSeletor(el, {
      aoMudar: (valor) => {
        if (valor === 'dono') {
          s.definir(opcoesCargo, cargoDe(nest.id, userId));
          return passarPosse(nest.id, userId);
        }
        mudarCargo(nest.id, userId, valor);
      },
    });
    const opcoesCargo = [
      ...cargos.map((r) => ({ valor: r, rotulo: t(NOMES_CARGO[r]) })),
      ...(souDono ? [{ valor: 'dono', rotulo: t('Make owner…'), classe: 'perigo' }] : []),
    ];
    s.definir(opcoesCargo, cargoDe(nest.id, userId));
  }
}
$('#lista-membros-nest').addEventListener('click', (e) => {
  const b = e.target.closest('[data-expulsar]');
  if (b) expulsar(nestEditando.id, b.dataset.expulsar);
});

$('#btn-salvar-nest').onclick = async () => {
  const nome = $('#nest-nome-editar').value.trim().slice(0, 48);
  if (!nome) return;
  const { error } = await sb.from('nests').update({ name: nome }).eq('id', nestEditando.id);
  if (error) return aviso(traduzirErro(error));
  nestEditando.name = nome;
  $('#editar-nest-titulo').textContent = nome;
  aviso(t('Saved!'));
  render();
};

// Ícone do Nest: quadrado de 256px, na pasta nest-<id> do bucket de fotos
$('#nest-icone-arquivo').onchange = async (e) => {
  const arquivo = e.target.files[0];
  e.target.value = '';
  if (!arquivo) return;
  if (arquivo.size > 8 * 1024 * 1024) return aviso(t('Image must be under 2 MB.'));
  const img = await createImageBitmap(arquivo);
  const lado = Math.min(img.width, img.height);
  const canvas = new OffscreenCanvas(256, 256);
  canvas.getContext('2d').drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, 256, 256);
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
  const caminho = `nest-${nestEditando.id}/icone-${Date.now()}.webp`;
  const { error } = await sb.storage.from('avatars').upload(caminho, blob, { contentType: 'image/webp', upsert: true });
  if (error) return aviso(traduzirErro(error));
  const url = sb.storage.from('avatars').getPublicUrl(caminho).data.publicUrl;
  const { error: erro2 } = await sb.from('nests').update({ icon_url: url }).eq('id', nestEditando.id);
  if (erro2) return aviso(traduzirErro(erro2));
  nestEditando.icon_url = url;
  abrirEditarNest(nestEditando);
  aviso(t('Saved!'));
  render();
};

$('#btn-copiar-convite-nest').onclick = async () => {
  await navigator.clipboard.writeText($('#nest-convite-editar').value);
  aviso(t('Copied!'));
};
$('#btn-novo-convite-nest').onclick = async () => {
  if (!(await confirmar(t('The old link will stop working.')))) return;
  const { data, error } = await sb.rpc('reset_invite', { n: nestEditando.id });
  if (error) return aviso(traduzirErro(error));
  nestEditando.invite_code = data;
  $('#nest-convite-editar').value = linkConvite(nestEditando);
};
$('#btn-apagar-nest').onclick = async () => {
  $('#dlg-editar-nest').close();
  sairOuApagarNest(nestEditando, true);
};

document.addEventListener('contextmenu', (e) => {
  const alvo = e.target.closest('[data-usuario], .cartao-pessoa[data-fala], .msg [data-fala]');
  if (!alvo || !est.eu) return;
  const userId = alvo.dataset.usuario || alvo.dataset.fala;
  if (!est.perfis.has(userId)) return;
  e.preventDefault();
  abrirMenuPessoa(userId, e.clientX, e.clientY);
});
// ================= Menu de botão direito nos canais =================

function abrirMenuCanal(canal, x, y) {
  fecharMenuPessoa();
  const dono = meuNivel(canal.nest_id) >= 2; // Admin pra cima
  const texto = canal.kind === 'text';
  const aqui = voz.canalId === canal.id;

  let html = `<div class="mp-topo"><span class="mp-canal">${icone(texto ? 'hash' : 'volume')}</span><div><b>${esc(canal.name)}</b><span>${esc(t(texto ? 'Text channel' : 'Voice channel'))}</span></div></div>`;
  if (texto && est.naoLidas.has(canal.id)) html += `<button data-mc="lido">${icone('certo')}${esc(t('Mark as read'))}</button>`;
  if (!texto) html += aqui
    ? `<button data-mc="sair" class="perigo">${icone('sair')}${esc(t('Disconnect'))}</button>`
    : `<button data-mc="entrar">${icone('volume')}${esc(t('Join voice'))}</button>`;
  html += `<button data-mc="copiar">${icone('copiar')}${esc(t('Copy channel name'))}</button>`;
  if (dono) {
    html += `<div class="mp-linha"></div>
      <button data-mc="renomear">${icone('lapis')}${esc(t('Rename channel'))}</button>
      <button data-mc="novo">${icone('mais')}${esc(t(texto ? 'New text channel' : 'New voice channel'))}</button>
      <button data-mc="apagar" class="perigo">${icone('lixo')}${esc(t('Delete channel'))}</button>`;
  }

  menuPessoa = document.createElement('div');
  menuPessoa.className = 'menu-pessoa';
  menuPessoa.innerHTML = html;
  document.body.appendChild(menuPessoa);
  const r = menuPessoa.getBoundingClientRect();
  menuPessoa.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  menuPessoa.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;

  menuPessoa.addEventListener('click', async (e) => {
    const acao = e.target.closest('[data-mc]')?.dataset.mc;
    if (!acao) return;
    fecharMenuPessoa();
    if (acao === 'lido') {
      est.naoLidas.delete(canal.id);
      renderCanais();
    }
    if (acao === 'entrar') {
      abrirCanal(canal);
      if (voz.canalId !== canal.id) entrarNaVoz(canal);
    }
    if (acao === 'sair') sairDaVoz();
    if (acao === 'copiar') {
      await navigator.clipboard.writeText(canal.name);
      aviso(t('Copied!'));
    }
    if (acao === 'renomear') abrirRenomearCanal(canal);
    if (acao === 'novo') abrirNovoCanal(canal.kind);
    if (acao === 'apagar' && (await confirmar(t('Delete #{name}?', { name: canal.name })))) {
      if (voz.canalId === canal.id) await chamada.sair();
      await sb.from('channels').delete().eq('id', canal.id);
      recarregarEstrutura();
    }
  });
}

document.addEventListener('contextmenu', (e) => {
  const item = e.target.closest('[data-canal]');
  if (!item || !est.eu) return;
  const canal = [...est.canais.values()].flat().find((c) => c.id === item.dataset.canal);
  if (!canal) return;
  e.preventDefault();
  abrirMenuCanal(canal, e.clientX, e.clientY);
});

document.addEventListener('mousedown', (e) => {
  if (menuPessoa && !menuPessoa.contains(e.target)) fecharMenuPessoa();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') fecharMenuPessoa();
});
window.addEventListener('blur', fecharMenuPessoa);

// ================= Seletor de tela =================

let fonteEscolhida = null;
let qualidadeEscolhida = ler('herald-qualidade') || '1080p60';
let abaFonte = 'tela';
let listaFontes = [];

async function abrirSeletorTela() {
  if (!voz.conectado) return;
  if (voz.telaStream) return chamada.pararTela();
  fonteEscolhida = null;
  $('#btn-iniciar-tela').disabled = true;
  $$('#chips-qualidade button').forEach((b) => b.classList.toggle('ligado', b.dataset.q === qualidadeEscolhida));
  $('#lista-fontes').innerHTML = `<div class="carregando-texto estatico">${esc(t('Loading…'))}</div>`;
  $('#dlg-tela').showModal();
  listaFontes = await window.herald.fontes();
  renderFontes();
}

function renderFontes() {
  $$('#abas-fonte button').forEach((b) => b.classList.toggle('ligado', b.dataset.aba === abaFonte));
  const itens = listaFontes.filter((f) => f.tipo === abaFonte);
  $('#lista-fontes').innerHTML = itens.length
    ? itens
        .map(
          (f) => `<button class="fonte ${f.id === fonteEscolhida ? 'ligado' : ''}" data-fonte="${esc(f.id)}">
            <div class="mini" style="${f.miniatura ? `background-image:url('${f.miniatura}')` : ''}"></div>
            <div class="rotulo">${f.icone ? `<img src="${f.icone}" alt="">` : ''}<span>${esc(f.nome)}</span></div>
          </button>`,
        )
        .join('')
    : `<div class="carregando-texto estatico">${esc(t('Nothing here.'))}</div>`;
}

$('#abas-fonte').onclick = (e) => {
  const b = e.target.closest('[data-aba]');
  if (!b) return;
  abaFonte = b.dataset.aba;
  renderFontes();
};
$('#lista-fontes').onclick = (e) => {
  const b = e.target.closest('[data-fonte]');
  if (!b) return;
  fonteEscolhida = b.dataset.fonte;
  $('#btn-iniciar-tela').disabled = false;
  renderFontes();
};
$('#lista-fontes').ondblclick = (e) => {
  if (e.target.closest('[data-fonte]')) iniciarTela();
};
$('#chips-qualidade').onclick = (e) => {
  const b = e.target.closest('[data-q]');
  if (!b) return;
  qualidadeEscolhida = b.dataset.q;
  guardar('herald-qualidade', qualidadeEscolhida);
  $$('#chips-qualidade button').forEach((x) => x.classList.toggle('ligado', x === b));
};
$('#btn-iniciar-tela').onclick = () => iniciarTela();

async function iniciarTela() {
  if (!fonteEscolhida) return;
  $('#dlg-tela').close();
  const ok = await chamada.iniciarTela(fonteEscolhida, qualidadeEscolhida, $('#com-audio').checked);
  if (!ok) aviso(t('Could not capture this screen.'));
  else if (est.vista !== 'voz') {
    est.vozVista = voz.canalId;
    const canal = [...est.canais.values()].flat().find((c) => c.id === voz.canalId);
    if (canal) abrirCanal(canal);
  }
}

// ================= Configurações =================

let medidor = null;

const seletorIdioma = criarSeletor($('#sel-idioma'), {
  aoMudar: (id) => {
    mudarIdioma(id);
    render();
    atualizarOpcoesAudio();
  },
});
const seletorMic = criarSeletor($('#sel-mic'), {
  aoMudar: async (id) => {
    guardar('herald-mic', id);
    await chamada.abrirMicrofone(id); // a chamada continua; só troca a entrada
  },
});
const seletorSaida = criarSeletor($('#sel-saida'), { aoMudar: (id) => chamada.definirSaida(id) });

// "Microfone (2- Fifine Microphone) (3142:5060)" -> "Fifine Microphone"
function limparNome(nome) {
  const s = nome.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '');
  const dentro = s.match(/^[^(]*\((?:\d+-\s*)?(.+)\)$/);
  return (dentro ? dentro[1] : s).trim() || nome;
}
function nomeDispositivo(d) {
  if (d.deviceId === 'default') return `${t('Default')} — ${limparNome(d.label.replace(/^(Default|Padrão)\s*-\s*/i, ''))}`;
  return limparNome(d.label || 'Device');
}

function atualizarOpcoesAudio() {
  const a = chamada.audio;
  $('#chk-ruido').checked = a.ruido;
  $('#chk-auto').checked = a.auto;
  $('#chk-eco').checked = a.eco;
  $('#seg-forca').hidden = !a.ruido;
  $$('#seg-forca button').forEach((b) => b.classList.toggle('ligado', b.dataset.forca === a.forca));
  $('#bloco-ganho').hidden = a.auto;
  $('#rng-ganho').value = a.ganho;
  $('#ganho-valor').textContent = `${a.ganho > 0 ? '+' : ''}${a.ganho} dB`;
}

// Fade nas bordas das páginas que rolam (Settings, Edit Nest): aparece aos poucos,
// em cima depois de rolar e embaixo enquanto ainda tem conteúdo escondido
const FADE = 48;
function atualizarFade(el) {
  if (!el.classList.contains('com-fade')) el = el.querySelector('.com-fade') || el;
  const sobraBaixo = el.scrollHeight - el.clientHeight - el.scrollTop;
  el.style.setProperty('--fade-topo', `${Math.min(FADE, el.scrollTop)}px`);
  el.style.setProperty('--fade-base', `${Math.min(FADE, Math.max(0, sobraBaixo))}px`);
}
// Título ancorado: o título da página fica fixo e só o conteúdo embaixo dele rola (com o fade)
$$('.config-pagina').forEach((pagina) => {
  const titulo = pagina.querySelector(':scope > h3');
  let rolagem = pagina;
  if (titulo) {
    rolagem = document.createElement('div');
    rolagem.className = 'config-rolagem';
    while (titulo.nextSibling) rolagem.appendChild(titulo.nextSibling);
    pagina.appendChild(rolagem);
    pagina.classList.add('com-titulo');
  }
  rolagem.classList.add('com-fade');
});
document.addEventListener('scroll', (e) => e.target.classList?.contains('com-fade') && atualizarFade(e.target), true);
const observarFade = new ResizeObserver((itens) => itens.forEach((i) => atualizarFade(i.target)));
$$('.com-fade').forEach((el) => {
  observarFade.observe(el);
  new MutationObserver(() => atualizarFade(el)).observe(el, { childList: true, subtree: true });
});

// Settings: menu à esquerda troca a página (Profile / Audio / Preferences)
function abrirPaginaConfig(pagina) {
  $$('.config-menu [data-pagina]').forEach((b) => b.classList.toggle('ligado', b.dataset.pagina === pagina));
  $$('#dlg-config .config-pagina').forEach((s) => (s.hidden = s.dataset.pagina !== pagina));
  $$('#dlg-config .config-pagina:not([hidden])').forEach(atualizarFade);
}
$('.config-menu').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pagina]');
  if (b) abrirPaginaConfig(b.dataset.pagina);
});

$('#btn-config').onclick = async () => {
  abrirPaginaConfig('perfil');
  $('#perfil-nome').value = est.eu.display_name;
  sb?.auth.getUser().then(({ data }) => ($('#perfil-email').value = data?.user?.email || ''));
  window.herald?.versao?.().then((v) => ($('#config-versao').textContent = `Herald ${v}`));
  $('#perfil-avatar').outerHTML = avatarHtml(est.eu.id, 'grande').replace('class="avatar ', 'id="perfil-avatar" class="avatar ');
  seletorIdioma.definir(IDIOMAS.map((i) => ({ valor: i.id, rotulo: i.nome, bandeira: i.bandeira })), idiomaAtual());
  if (!voz.micStream) {
    try { await chamada.abrirMicrofone(); } catch {}
  }
  const dispositivos = await navigator.mediaDevices.enumerateDevices();
  const lista = (tipo) =>
    dispositivos.filter((d) => d.kind === tipo && d.deviceId !== 'communications').map((d) => ({ valor: d.deviceId, rotulo: nomeDispositivo(d) }));
  seletorMic.definir(lista('audioinput'), ler('herald-mic') || 'default');
  seletorSaida.definir(lista('audiooutput'), chamada.saidaAtual() || 'default');
  atualizarOpcoesAudio();
  renderCalibracao();
  $('#chk-esconder-ip').checked = chamada.esconderIp();
  atualizarAvisoRede();
  $('#dlg-config').showModal();
  document.activeElement?.blur(); // sem contorno de foco no primeiro botão ao abrir

  // Medidor em dB (-60 a 0); a marquinha é o volume ideal da fala (-18 dB)
  medidor = setInterval(() => {
    const db = 20 * Math.log10(Math.max(chamada.nivelMicrofone(), 1e-6));
    $('#medidor-barra').style.width = `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
    $('#medidor-barra').classList.toggle('alto', db > -6);
    const g = Math.round(chamada.audio.ganhoAuto);
    void g; // o volume automático agora é o do Chrome (não dá pra ler o ganho dele)
    $('#medidor-info').textContent = '';
  }, 70);
};

$('#dlg-config').addEventListener('close', () => {
  clearInterval(medidor);
  pararTeste();
  chamada.cancelarCalibracao();
  calibNova = null;
  previaCalib.parar();
});

// ================= Calibração da voz (Settings → Audio) =================


let calibNova = null; // perfil recém-calculado no "Calibrar agora", esperando salvar
let calibProgresso = null; // 0..1 enquanto grava

// Toca o antes/depois juntos e alterna entre eles sem parar (A/B)
const previaCalib = (() => {
  let ctx = null, fontes = [], ganhos = null, qual = 'depois', tocando = false;
  return {
    async tocar(buffers, lado) {
      this.parar();
      ctx ??= new AudioContext({ sampleRate: 48000 });
      if (chamada.saidaAtual()) ctx.setSinkId?.(chamada.saidaAtual()).catch(() => {});
      qual = lado;
      ganhos = {};
      for (const k of ['antes', 'depois']) {
        const g = new GainNode(ctx, { gain: k === lado ? 1 : 0 });
        const f = new AudioBufferSourceNode(ctx, { buffer: buffers[k] });
        f.connect(g).connect(ctx.destination);
        f.start(ctx.currentTime + 0.05);
        f.onended = () => { tocando = false; renderCalibracao(); };
        fontes.push(f);
        ganhos[k] = g;
      }
      tocando = true;
    },
    trocar(lado) {
      qual = lado;
      if (!ganhos) return;
      for (const [k, g] of Object.entries(ganhos)) g.gain.setTargetAtTime(k === lado ? 1 : 0, ctx.currentTime, 0.01);
    },
    parar() {
      for (const f of fontes) { f.onended = null; try { f.stop(); } catch {} }
      fontes = [];
      ganhos = null;
      tocando = false;
    },
    get lado() { return qual; },
    get tocando() { return tocando; },
  };
})();

function renderCalibracao() {
  const el = $('#calib-cartao');
  if (!el) return;
  const e = chamada.estadoCalibracao();
  // gravando o "Calibrar agora"
  if (calibProgresso !== null) {
    el.innerHTML = `<p class="calib-pergunta">${esc(t('Speak like you would in a call'))}</p>
      <div class="medidor"><div class="calib-barra" style="width:${Math.round(calibProgresso * 100)}%"></div></div>
      <div class="calib-linha"><span class="texto-3">${esc(t('It only counts while you speak.'))}</span><button class="link" data-calib="cancelar">${esc(t('Cancel'))}</button></div>`;
    return;
  }
  const perfil = calibNova || e.perfil;
  const tom = perfil?.tom || 0;
  const tons = [[-1, 'Warmer'], [0, 'Natural'], [1, 'Brighter']];
  const ab = (e.temAmostra && perfil)
    ? `<div class="calib-linha">
        <div class="segmentado calib-ab">${['antes', 'depois'].map((k) => `<button data-calib-ab="${k}" class="${previaCalib.tocando && previaCalib.lado === k ? 'ligado' : ''}">${esc(t(k === 'antes' ? 'Before' : 'After'))}</button>`).join('')}</div>
        <span class="texto-3">${esc(t('Plays your voice from the calibration. Switch while it plays.'))}</span>
      </div>` : '';
  const tomHtml = perfil
    ? `<div class="calib-linha"><span class="calib-rotulo">${esc(t('Tone'))}</span><div class="segmentado">${tons.map(([v, n]) => `<button data-calib-tom="${v}" class="${tom === v ? 'ligado' : ''}">${esc(t(n))}</button>`).join('')}</div></div>` : '';
  if (calibNova) {
    el.innerHTML = `<p class="calib-status"><b>${esc(t('Done! Compare before and after.'))}</b></p>${ab}${tomHtml}
      <div class="calib-linha calib-acoes"><button class="botao-primario" data-calib="salvar">${esc(t('Save calibration'))}</button><button class="botao-secundario" data-calib="descartar">${esc(t('Discard'))}</button></div>`;
    return;
  }
  const status = e.perfil
    ? `${icone('certo')}<span>${esc(t('Calibrated for {mic}', { mic: e.mic }))}</span>`
    : e.coletando === 'auto'
      ? `<span>${esc(t('Calibrating automatically in your next call — {s} of {alvo} s of voice', { s: e.segundos, alvo: e.alvo }))}</span>`
      : `<span>${esc(t('Not calibrated yet for {mic}. It happens automatically in your next call.', { mic: e.mic || t('your microphone') }))}</span>`;
  el.innerHTML = `<p class="calib-status ${e.perfil ? 'ok' : ''}">${status}</p>${ab}${tomHtml}
    <div class="calib-linha calib-acoes">
      <button class="botao-secundario" data-calib="agora">${esc(t(e.perfil ? 'Calibrate again' : 'Calibrate now'))}</button>
      ${e.perfil ? `<button class="link calib-reset" data-calib="apagar">${esc(t('Reset'))}</button>` : ''}
    </div>`;
}

$('#calib-cartao').addEventListener('click', async (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  const acao = b.dataset.calib;
  if (acao === 'agora') {
    previaCalib.parar();
    calibProgresso = 0;
    renderCalibracao();
    const perfil = await chamada.calibrarAgora(10, (p) => { calibProgresso = p; renderCalibracao(); });
    calibProgresso = null;
    calibNova = perfil;
    renderCalibracao();
    if (perfil) tocarPrevia('depois');
  }
  if (acao === 'cancelar') {
    chamada.cancelarCalibracao();
    calibProgresso = null;
    renderCalibracao();
  }
  if (acao === 'salvar') {
    previaCalib.parar();
    await chamada.salvarPerfil(calibNova, true);
    calibNova = null;
    aviso(t('Saved!'));
    renderCalibracao();
  }
  if (acao === 'descartar') {
    previaCalib.parar();
    calibNova = null;
    renderCalibracao();
  }
  if (acao === 'apagar' && (await confirmar(t('Reset the calibration for this microphone? It will calibrate again in your next call.')))) {
    await chamada.apagarPerfil();
    renderCalibracao();
  }
  if (b.dataset.calibAb) {
    if (previaCalib.tocando) previaCalib.trocar(b.dataset.calibAb);
    else tocarPrevia(b.dataset.calibAb);
    renderCalibracao();
  }
  if (b.dataset.calibTom) {
    const tom = Number(b.dataset.calibTom);
    if (calibNova) calibNova = { ...calibNova, tom };
    else await chamada.salvarPerfil({ ...chamada.estadoCalibracao().perfil, tom });
    if (previaCalib.tocando) tocarPrevia(previaCalib.lado);
    renderCalibracao();
  }
});

async function tocarPrevia(lado) {
  const perfil = calibNova || chamada.estadoCalibracao().perfil;
  const buffers = await chamada.previaCalibracao(perfil);
  if (!buffers) return;
  await previaCalib.tocar(buffers, lado);
  renderCalibracao();
}

$('#chk-ruido').onchange = (e) => {
  chamada.configurarAudio({ ruido: e.target.checked });
  atualizarOpcoesAudio();
};
$('#seg-forca').onclick = (e) => {
  const b = e.target.closest('[data-forca]');
  if (!b) return;
  chamada.configurarAudio({ forca: b.dataset.forca });
  atualizarOpcoesAudio();
};
$('#chk-auto').onchange = (e) => {
  chamada.configurarAudio({ auto: e.target.checked });
  atualizarOpcoesAudio();
};
$('#rng-ganho').oninput = (e) => {
  chamada.configurarAudio({ ganho: Number(e.target.value) });
  atualizarOpcoesAudio();
};
function atualizarAvisoRede() {
  const el = $('#aviso-rede');
  el.className = 'aviso-rede';
  if (!chamada.esconderIp()) return (el.textContent = '');
  if (!voz.conectado) return (el.textContent = t('Applies when you join a voice channel.'));
  el.textContent = t(chamada.rede.viaApoio ? 'Protected: your IP is hidden in this call.' : 'Relay unavailable right now — connecting directly.');
  el.classList.add(chamada.rede.viaApoio ? 'ok' : 'ruim');
}
$('#chk-esconder-ip').onchange = async (e) => {
  chamada.definirEsconderIp(e.target.checked);
  // numa chamada, reconecta pra valer na hora
  const canal = voz.canalId && [...est.canais.values()].flat().find((c) => c.id === voz.canalId);
  if (canal) {
    await chamada.sair();
    await entrarNaVoz(canal);
  }
  atualizarAvisoRede();
};

$('#chk-eco').onchange = (e) => {
  chamada.configurarAudio({ eco: e.target.checked });
  atualizarOpcoesAudio();
};

// Teste: grava 5 s e depois toca o que a galera ouviria
let testeLigado = false;
function textoTeste(chave, vars) {
  const b = $('#btn-testar-mic');
  b.textContent = t(chave, vars);
  b.dataset.i18nOriginal = chave;
}
async function ligarTeste() {
  testeLigado = true;
  $('#btn-testar-mic').classList.add('ligado');
  await chamada.testarMicrofone(5, (fase, falta) => {
    if (fase === 'gravando') textoTeste('Recording… talk now ({n})', { n: falta });
    if (fase === 'tocando') textoTeste('Playing back — this is how you sound');
  });
  pararTeste();
}
function pararTeste() {
  testeLigado = false;
  chamada.pararTeste();
  $('#btn-testar-mic').classList.remove('ligado');
  textoTeste('Test microphone (record 5 seconds)');
}
$('#btn-testar-mic').onclick = () => (testeLigado ? pararTeste() : ligarTeste());

$('#btn-salvar-perfil').onclick = async () => {
  const nome = $('#perfil-nome').value.trim().slice(0, 32);
  if (!nome) return;
  const { data, error } = await sb.from('profiles').update({ display_name: nome }).eq('id', est.eu.id).select().single();
  if (error) return aviso(traduzirErro(error));
  est.eu = data;
  est.perfis.set(data.id, data);
  aviso(t('Saved!'));
  render();
};

// Foto: reduz pra 256px antes de enviar (fica leve)
$('#perfil-arquivo').onchange = async (e) => {
  const arquivo = e.target.files[0];
  e.target.value = '';
  if (!arquivo) return;
  if (arquivo.size > 8 * 1024 * 1024) return aviso(t('Image must be under 2 MB.'));
  const img = await createImageBitmap(arquivo);
  const lado = Math.min(img.width, img.height);
  const canvas = new OffscreenCanvas(256, 256);
  canvas.getContext('2d').drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, 256, 256);
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
  const caminho = `${est.eu.id}/avatar-${Date.now()}.webp`;
  const { error } = await sb.storage.from('avatars').upload(caminho, blob, { contentType: 'image/webp', upsert: true });
  if (error) return aviso(traduzirErro(error));
  const url = sb.storage.from('avatars').getPublicUrl(caminho).data.publicUrl;
  const { data, error: erro2 } = await sb.from('profiles').update({ avatar_url: url }).eq('id', est.eu.id).select().single();
  if (erro2) return aviso(traduzirErro(erro2));
  est.eu = data;
  est.perfis.set(data.id, data);
  $('#perfil-avatar').outerHTML = avatarHtml(est.eu.id, 'grande').replace('class="avatar ', 'id="perfil-avatar" class="avatar ');
  aviso(t('Saved!'));
  render();
};

$('#btn-sair-conta').onclick = async () => {
  await chamada.sair();
  await sb.auth.signOut();
};

// ================= Diálogos =================

$$('dialog [data-fechar]').forEach((b) => (b.onclick = () => b.closest('dialog').close()));
$$('dialog').forEach((d) =>
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close(); // clicar fora fecha
  }),
);

// ================= Modo demonstração =================
// HERALD_DEMO=1 abre o app com dados de mentira, sem conta nem rede.
// Serve pra tirar prints da landing (não aparece pra quem usa o app).

const DEMO = new URLSearchParams(location.search).has('demo');

function montarDemo() {
  const pessoas = [
    ['u-eu', 'Pazi'], ['u-lu', 'Lu'], ['u-beto', 'Beto'], ['u-gui', 'Gui'],
    ['u-nina', 'Nina'], ['u-caio', 'Caio'], ['u-theo', 'Theo'], ['u-bia', 'Bia'],
  ];
  for (const [id, nome] of pessoas) est.perfis.set(id, { id, display_name: nome, avatar_url: null });
  est.eu = est.perfis.get('u-eu');

  const nests = [
    { id: 'n-crew', name: 'The Crew', owner_id: 'u-eu', invite_code: 'demo' },
    { id: 'n-ranked', name: 'Ranked Grind', owner_id: 'u-beto', invite_code: 'demo' },
    { id: 'n-movie', name: 'Movie Night', owner_id: 'u-nina', invite_code: 'demo' },
  ];
  est.nests = new Map(nests.map((n) => [n.id, n]));
  const cargosDemo = { 'u-eu': 'owner', 'u-lu': 'admin', 'u-beto': 'moderator' };
  est.membros = new Map([['n-crew', new Map(pessoas.map(([id]) => [id, cargosDemo[id] || 'member']))]]);
  est.canais = new Map([[
    'n-crew',
    [
      { id: 'c-general', nest_id: 'n-crew', name: 'general', kind: 'text' },
      { id: 'c-clips', nest_id: 'n-crew', name: 'clips', kind: 'text' },
      { id: 'c-memes', nest_id: 'n-crew', name: 'memes', kind: 'text' },
      { id: 'c-lobby', nest_id: 'n-crew', name: 'Lobby', kind: 'voice' },
      { id: 'c-ranked', nest_id: 'n-crew', name: 'Ranked', kind: 'voice' },
      { id: 'c-afk', nest_id: 'n-crew', name: 'AFK', kind: 'voice' },
    ],
  ]]);
  const agora = Date.now();
  const msgs = [
    ['u-lu', 'anyone up for ranked tonight?', 38],
    ['u-beto', 'after dinner, 9pm?', 36],
    ['u-gui', "I'm in 🎮", 35],
    ['u-nina', 'cant tonight, movie night with the fam', 30],
    ['u-eu', "going live in Ranked, come watch the clutch attempts", 4],
    ['u-beto', 'that last round was insane', 1],
  ];
  est.mensagens.set('c-general', msgs.map(([autor, texto, min], i) => ({ id: i + 1, channel_id: 'c-general', nest_id: 'n-crew', author_id: autor, content: texto, created_at: new Date(agora - min * 60000).toISOString() })));
  est.mensagens.set('c-clips', []);
  est.mensagens.set('c-memes', []);
  est.naoLidas = new Set(['c-clips']);
  est.presenca.set('n-crew', new Map([
    ['u-lu', { voz: 'c-ranked', mudo: false }],
    ['u-beto', { voz: 'c-ranked', aoVivo: true }],
    ['u-gui', { voz: 'c-ranked', mudo: true }],
    ['u-nina', { voz: 'c-lobby' }],
    ['u-bia', { voz: null }],
  ]));

  // Chamada de mentira: eu no "Ranked", assistindo a tela do Beto
  voz.canalId = 'c-ranked';
  voz.conectado = true;
  const tela = telaDemo();
  voz.participantes.set('p-lu', { peerId: 'p-lu', userId: 'u-lu', ping: 18, estadoConexao: 'connected' });
  voz.participantes.set('p-beto', { peerId: 'p-beto', userId: 'u-beto', aoVivo: true, assistindo: true, telaStream: tela, ping: 24, estadoConexao: 'connected' });
  voz.participantes.set('p-gui', { peerId: 'p-gui', userId: 'u-gui', mudo: true, ping: 31, estadoConexao: 'connected' });
  est.falando = new Set(['u-lu']);

  mostrarTela('app');
  est.nestAtual = 'n-crew';
  est.textoPorNest.set('n-crew', 'c-general');
  est.vozVista = 'c-ranked';
  est.vista = new URLSearchParams(location.search).get('demo') === 'chat' ? 'texto' : 'voz';
  render();
  if (new URLSearchParams(location.search).get('novidades')) setTimeout(() => abrirNovidades(new URLSearchParams(location.search).get('novidades'), '1.4.0'), 600);
  const yt = (id, titulo, autor, por) => ({ uid: id, tipo: 'youtube', id, titulo, autor, por, capa: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` });
  radio.demo([
    yt('fJ9rUzIMcZQ', 'Queen – Bohemian Rhapsody (Official Video Remastered)', 'Queen Official', 'u-lu'),
    yt('dQw4w9WgXcQ', 'Rick Astley - Never Gonna Give You Up (Official Video)', 'Rick Astley', 'u-beto'),
    yt('btPJPFnesV4', 'Survivor - Eye Of The Tiger (Official HD Video)', 'Survivor', 'u-eu'),
  ], 62);
}

// Uma "partida" desenhada, só pra ter o que mostrar na tela compartilhada
function telaDemo() {
  const cv = document.createElement('canvas');
  cv.width = 1920;
  cv.height = 1080;
  const g = cv.getContext('2d');
  let t = 0;
  const desenhar = () => {
    t++;
    const ceu = g.createLinearGradient(0, 0, 0, 1080);
    ceu.addColorStop(0, '#1b2350');
    ceu.addColorStop(0.6, '#e0805a');
    ceu.addColorStop(1, '#f2c27a');
    g.fillStyle = ceu;
    g.fillRect(0, 0, 1920, 1080);
    g.fillStyle = '#ffe3a3';
    g.beginPath();
    g.arc(1400, 640, 120, 0, 7);
    g.fill();
    const camada = (cor, base, amp, fase) => {
      g.fillStyle = cor;
      g.beginPath();
      g.moveTo(0, 1080);
      for (let i = 0; i <= 1920; i += 40) g.lineTo(i, base + Math.sin(i / 180 + fase + t / 200) * amp);
      g.lineTo(1920, 1080);
      g.fill();
    };
    camada('#5a3a5e', 700, 80, 0);
    camada('#3a2442', 800, 60, 2);
    camada('#1d1426', 900, 40, 4);
    g.fillStyle = '#000a';
    g.fillRect(60, 60, 440, 120);
    g.fillStyle = '#d6f36a';
    g.font = 'bold 44px sans-serif';
    g.fillText('ROUND 7', 90, 120);
    g.fillStyle = '#fff';
    g.font = '32px sans-serif';
    g.fillText('Team Raven  13 × 11', 90, 165);
    g.fillRect(950, 530, 20, 4);
    g.fillRect(958, 522, 4, 20);
    requestAnimationFrame(desenhar);
  };
  desenhar();
  return cv.captureStream(60);
}

if (DEMO) {
  aplicarIcones();
  mudarIdioma(idiomaAtual());
  montarDemo();
} else {
  iniciar();
}
