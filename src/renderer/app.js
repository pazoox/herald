// Herald — interface.
// Contas, Nests, canais e mensagens ficam no Supabase. Voz e tela são P2P (voz.js).

import './style.css';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { icone, aplicarIcones } from './icones.js';
import { t, traduzirPagina, mudarIdioma, idiomaAtual, IDIOMAS, quando, horaCurta } from './i18n.js';
import * as chamada from './voz.js';
import { criarSeletor } from './seletor.js';

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
    const meu = m.author_id === est.eu.id || est.nests.get(est.nestAtual)?.owner_id === est.eu.id;
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
  const dono = nest.owner_id === est.eu.id;
  const canais = est.canais.get(nest.id) || [];
  const presenca = presencaDe(nest.id);
  const secao = (tipo, titulo) => {
    const itens = canais.filter((c) => c.kind === tipo);
    const mais = dono ? `<button class="botao-icone pequeno" data-novo-canal="${tipo}" title="${esc(t('New channel'))}">${icone('mais')}</button>` : '';
    let html = `<div class="secao-canais"><span>${esc(t(titulo))}</span>${mais}</div>`;
    for (const c of itens) {
      const ativo = tipo === 'text' ? est.vista === 'texto' && c.id === canalTextoAtual() : est.vista === 'voz' && c.id === est.vozVista;
      const apagar = dono ? `<button class="canal-apagar" data-apagar-canal="${c.id}" title="${esc(t('Delete channel'))}">${icone('lixo')}</button>` : '';
      html += `<div class="canal ${ativo ? 'ligado' : ''} ${est.naoLidas.has(c.id) ? 'nao-lida' : ''} ${voz.canalId === c.id ? 'conectado' : ''}" data-canal="${c.id}">
        ${icone(tipo === 'text' ? 'hash' : 'volume')}<span class="canal-nome">${esc(c.name)}</span>${apagar}</div>`;
      if (tipo === 'voice') {
        const pessoas = [...presenca.entries()].filter(([, p]) => p.voz === c.id);
        if (pessoas.length) {
          html += '<div class="voz-pessoas">';
          for (const [userId, p] of pessoas) {
            const marcas = [p.aoVivo ? `<span class="tag-vivo">${esc(t('LIVE'))}</span>` : '', p.surdo ? icone('fone-off') : p.mudo ? icone('mic-off') : ''].join('');
            html += `<div class="voz-pessoa">${avatarHtml(userId, 'mini')}<span>${esc(nomeDe(userId))}</span><span class="vp-marcas">${marcas}</span></div>`;
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
  const apagar = e.target.closest('[data-apagar-canal]');
  if (apagar) {
    e.stopPropagation();
    const canal = (est.canais.get(est.nestAtual) || []).find((c) => c.id === apagar.dataset.apagarCanal);
    if (canal && (await confirmar(t('Delete #{name}?', { name: canal.name })))) {
      if (voz.canalId === canal.id) await chamada.sair();
      await sb.from('channels').delete().eq('id', canal.id);
      recarregarEstrutura();
    }
    return;
  }
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
  const dono = est.nests.get(est.nestAtual)?.owner_id;
  const lista = [...membros.keys()].sort((a, b) => nomeDe(a).localeCompare(nomeDe(b)));
  const online = lista.filter((id) => presenca.has(id));
  const offline = lista.filter((id) => !presenca.has(id));
  const item = (id, on) => {
    const p = presenca.get(id);
    const sub = p?.voz ? `${icone('volume')} ${esc((est.canais.get(est.nestAtual) || []).find((c) => c.id === p.voz)?.name || '')}` : '';
    return `<div class="membro ${on ? '' : 'off'}">${avatarHtml(id)}<div class="membro-info"><span class="membro-nome">${esc(nomeDe(id))}${id === dono ? ` <span class="tag-dono">${esc(t('Owner'))}</span>` : ''}</span>${sub ? `<span class="membro-sub">${sub}</span>` : ''}</div></div>`;
  };
  $('#contagem-membros').textContent = lista.length ? `· ${lista.length}` : '';
  $('#membros').innerHTML =
    (online.length ? `<div class="membros-grupo">${esc(t('Online'))} — ${online.length}</div>${online.map((id) => item(id, true)).join('')}` : '') +
    (offline.length ? `<div class="membros-grupo">${esc(t('Offline'))} — ${offline.length}</div>${offline.map((id) => item(id, false)).join('')}` : '');
  aplicarFala();
}

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
  $('#btn-novo-convite').hidden = nest.owner_id !== est.eu.id;
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
  const apagar = b.dataset.menu === 'apagar';
  const texto = apagar ? t('Delete {name} for everyone? This cannot be undone.', { name: nest.name }) : t('Leave {name}?', { name: nest.name });
  if (!(await confirmar(texto))) return;
  if (voz.canalId && (est.canais.get(nest.id) || []).some((c) => c.id === voz.canalId)) await chamada.sair();
  const { error } = apagar
    ? await sb.from('nests').delete().eq('id', nest.id)
    : await sb.from('nest_members').delete().eq('nest_id', nest.id).eq('user_id', est.eu.id);
  if (error) return aviso(traduzirErro(error));
  await carregarEstrutura();
  abrirNest([...est.nests.keys()][0] || null);
};

// Novo canal
let tipoNovoCanal = 'text';
function abrirNovoCanal(tipo) {
  tipoNovoCanal = tipo;
  $('#canal-nome').value = '';
  $('#dlg-canal').showModal();
}
$('#form-canal').addEventListener('submit', async (e) => {
  e.preventDefault();
  let nome = $('#canal-nome').value.trim();
  if (tipoNovoCanal === 'text') nome = nome.toLowerCase().replace(/\s+/g, '-');
  if (!nome) return;
  const canais = est.canais.get(est.nestAtual) || [];
  const { error } = await sb.from('channels').insert({ nest_id: est.nestAtual, name: nome, kind: tipoNovoCanal, position: canais.length });
  if (error) return aviso(traduzirErro(error));
  $('#dlg-canal').close();
  recarregarEstrutura();
});

// ================= Voz =================

async function entrarNaVoz(canal) {
  try {
    await chamada.entrar({ canalId: canal.id, chave: canal.voice_key, userId: est.eu.id });
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
  if (tipo === 'fala') {
    est.falando = dados;
    aplicarFala();
    return;
  }
  if (tipo === 'stats') return atualizarStats(dados);
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
    if (voz.telaStream) videos.push({ chave: 'video-eu', nome: t('Your screen'), stream: voz.telaStream, local: true });
    for (const p of voz.participantes.values()) {
      if (p.assistindo && p.aoVivo) videos.push({ chave: `video-${p.peerId}`, nome: nomeDe(p.userId), stream: p.telaStream, peerId: p.peerId });
    }
    pessoas.push({ chave: 'pessoa-eu', userId: est.eu.id, mudo: voz.mudo, surdo: voz.surdo, aoVivo: voz.aoVivo, ehEu: true });
    for (const p of voz.participantes.values()) {
      if (p.userId) pessoas.push({ chave: `pessoa-${p.peerId}`, userId: p.userId, peerId: p.peerId, mudo: p.mudo, surdo: p.surdo, aoVivo: p.aoVivo, assistindo: p.assistindo, ping: p.ping, conexao: p.estadoConexao });
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
  el.className = 'cartao-pessoa';
  el.dataset.fala = d.userId;
  const marcas = d.surdo ? icone('fone-off') : d.mudo ? icone('mic-off') : '';
  const volume = !d.ehEu && !d.fora ? `<input type="range" class="cartao-volume" min="0" max="1" step="0.01" value="${chamada.volumeDe(d.userId)}" data-vol="${d.userId}" title="${esc(nomeDe(d.userId))}">` : '';
  const html = `${d.aoVivo ? `<span class="etiqueta-vivo">${esc(t('LIVE'))}</span>` : ''}
    ${avatarHtml(d.userId)}
    <div class="nome">${esc(nomeDe(d.userId))}${d.ehEu ? ` <span class="voce">(${esc(t('you'))})</span>` : ''}</div>
    ${textoPing(d)}
    ${marcas ? `<div class="marcas"><span class="marca">${marcas}</span></div>` : ''}
    ${d.aoVivo && d.peerId && !d.assistindo ? `<div class="assistir"><button class="botao-assistir" data-assistir="${d.peerId}">${icone('olho')}${esc(t('Watch'))}</button></div>` : ''}
    ${volume}`;
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
            <button data-cheia>${icone('maximizar')}${esc(t('Fullscreen'))}</button>
            ${d.local ? `<button data-parar-tela>${icone('x')}${esc(t('Stop'))}</button>` : `<button data-sair-video="${d.peerId}">${icone('x')}${esc(t('Close'))}</button>`}
          </div>
        </div>
      </div>`;
  }
  const video = el.querySelector('video');
  if (video.srcObject !== (d.stream || null)) video.srcObject = d.stream || null;
  if (!d.local) video.muted = voz.surdo;
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

$('#btn-config').onclick = async () => {
  $('#perfil-nome').value = est.eu.display_name;
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
  $('#dlg-config').showModal();

  // Medidor em dB (-60 a 0); a marquinha é o volume ideal da fala (-18 dB)
  medidor = setInterval(() => {
    const db = 20 * Math.log10(Math.max(chamada.nivelMicrofone(), 1e-6));
    $('#medidor-barra').style.width = `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
    $('#medidor-barra').classList.toggle('alto', db > -6);
    const g = Math.round(chamada.audio.ganhoAuto);
    $('#medidor-info').textContent = chamada.audio.auto ? t('Auto volume: {db}', { db: `${g > 0 ? '+' : ''}${g} dB` }) : '';
  }, 70);
};

$('#dlg-config').addEventListener('close', () => {
  clearInterval(medidor);
  pararTeste();
});

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
$('#chk-eco').onchange = (e) => {
  chamada.configurarAudio({ eco: e.target.checked });
  atualizarOpcoesAudio();
};

let testeLigado = false;
function ligarTeste() {
  testeLigado = true;
  chamada.testarMicrofone(true);
  $('#btn-testar-mic').dataset.i18nOriginal = 'Stop test';
  $('#btn-testar-mic').classList.add('ligado');
  traduzirPagina($('#dlg-config'));
}
function pararTeste() {
  testeLigado = false;
  chamada.testarMicrofone(false);
  $('#btn-testar-mic').dataset.i18nOriginal = 'Test microphone (hear yourself)';
  $('#btn-testar-mic').classList.remove('ligado');
  traduzirPagina($('#dlg-config'));
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

iniciar();
