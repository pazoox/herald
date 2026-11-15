// Court ⚖️: a call vota "Should Gui breathe helium?" (Yes/No, 20 s). Se a maioria disser Yes,
// a pessoa fica 30 s com o efeito. Ela pode tentar escapar uma vez num mini-game, e a call assiste ao vivo.
//
// Tudo vai pela conexão da call (ação "court"):
//   votar      {id, alvo, efeito, por, fim}   quem abriu a votação manda pra todos
//   voto       {id, sim}                       cada um manda o seu voto pra todos
//   resultado  {id, alvo, efeito, sim, fim}    quem abriu conta os votos e anuncia
//   fuga       {id, efeito, estado, progresso} o alvo manda o estado do mini-game (~10x por segundo)
//   fuga-fim   {id, venceu}
//   estado     {penas}                         pra quem chega no meio
// Os efeitos de voz são aplicados por quem ESCUTA, então o alvo não tem como desligar do lado dele.

import { t } from './i18n.js';
import { criarJogo, desenharJogo, JOGOS, DURACAO_FUGA } from './court-jogos.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const DURACAO = 30000;
const VOTACAO = 20000;

export const EFEITOS = {
  helium: { emoji: '🎈', cor: '#ff8fc8', pergunta: 'Should {name} breathe helium?', voce: "You're breathing helium" },
  monster: { emoji: '👹', cor: '#7bd66e', pergunta: 'Should {name} turn into a monster?', voce: "You've turned into a monster" },
  robo: { emoji: '🤖', cor: '#72d3d0', pergunta: 'Should {name} become a robot?', voce: "You're a robot now" },
  underwater: { emoji: '🌊', cor: '#4fb2f0', pergunta: 'Should {name} go underwater?', voce: "You're underwater" },
  longe: { emoji: '📣', cor: '#e8a25c', pergunta: 'Should we send {name} to the back?', voce: "You've been sent to the back" },
  atraso: { emoji: '🐌', cor: '#c3d96a', pergunta: 'Should {name} lag behind?', voce: "You're lagging behind" },
  engracado: { emoji: '🥁', cor: '#ffb347', pergunta: 'Should we make {name} funnier?', voce: "You're the comedian now" },
  censura: { emoji: '📺', cor: '#f2d04c', pergunta: 'Should we censor {name}?', voce: "You're being censored" },
  silencio: { emoji: '🔇', cor: '#a7a3b8', pergunta: 'Should we silence {name} for 30 seconds?', voce: "You've been silenced" },
  loser: { emoji: '🧢', cor: '#f27a6a', pergunta: 'Should {name} wear the loser cap?', voce: "You're wearing the loser cap" },
  vergonha: { emoji: '🚪', cor: '#b18cff', pergunta: 'Should we send {name} to the Shame Room?', voce: "You're in the Shame Room" },
};

const tempo = (ms) => `0:${String(Math.max(0, Math.ceil(ms / 1000))).padStart(2, '0')}`;

export function criarCourt(ctx) {
  // ctx: { eu(), pessoas(), nomeDe(id), avatarHtml(id), enviar(msg, peerId?), aplicarEfeito(userId, efeito|null),
  //        isolar(bool), aviso(texto), atualizar(), demo }
  const el = (html) => {
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstElementChild;
  };

  let votacao = null; // { id, alvo, efeito, por, fim, votos: Map(userId -> bool), decidido }
  const penas = new Map(); // userId -> { id, efeito, fim, tentou }
  let meuJogo = null;
  const plateia = new Map(); // id da pena -> { caixa, canvas, efeito }

  // ---------------------------------------------------------------- abrir uma votação
  const dlg = el(`<dialog class="modal court-modal na-atividade"></dialog>`);
  document.body.appendChild(dlg);
  let escolhaAlvo = null;
  let escolhaEfeito = 'helium';

  function renderDialogo() {
    const eu = ctx.eu();
    // na demo dá pra escolher a si mesmo (pra testar a fuga e a plateia sem outra pessoa)
    const alvos = ctx.pessoas().filter((id) => ctx.demo || id !== eu);
    if (!alvos.includes(escolhaAlvo)) escolhaAlvo = null;
    const nome = escolhaAlvo ? ctx.nomeDe(escolhaAlvo) : '…';
    dlg.innerHTML = `
      <div class="modal-topo"><h2>⚖️ Court</h2><button class="botao-icone" data-fechar>✕</button></div>
      <div class="secao-titulo">${esc(t('Who?'))}</div>
      <div class="court-alvos">${alvos.length ? alvos.map((id) => {
        const ocupado = penas.has(id);
        return `<button class="court-alvo ${id === escolhaAlvo ? 'ligado' : ''}" data-alvo="${id}" ${ocupado ? 'disabled' : ''}>${ctx.avatarHtml(id)}<span>${esc(ctx.nomeDe(id))}</span>${ocupado ? '<small>⚖️</small>' : ''}</button>`;
      }).join('') : `<p class="court-vazio">${esc(t('Nobody else in the call yet.'))}</p>`}</div>
      <div class="secao-titulo">${esc(t('What?'))}</div>
      <div class="court-efeitos">${Object.entries(EFEITOS).map(([id, ef]) =>
        `<button class="court-efeito ${id === escolhaEfeito ? 'ligado' : ''}" data-efeito="${id}" style="--cor:${ef.cor}"><span class="emoji">${ef.emoji}</span>${esc(t(ef.pergunta, { name: nome }))}</button>`).join('')}</div>
      <div class="court-rodape">
        <button class="botao-primario" data-chamar ${escolhaAlvo && !votacao ? '' : 'disabled'}>⚖️ ${esc(t('Call the vote'))}</button>
      </div>`;
  }

  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-fechar]')) return dlg.close();
    const alvo = e.target.closest('[data-alvo]');
    if (alvo && !alvo.disabled) { escolhaAlvo = alvo.dataset.alvo; return renderDialogo(); }
    const efeito = e.target.closest('[data-efeito]');
    if (efeito) { escolhaEfeito = efeito.dataset.efeito; return renderDialogo(); }
    if (e.target.closest('[data-chamar]') && escolhaAlvo) {
      dlg.close();
      iniciarVotacao(escolhaAlvo, escolhaEfeito);
    }
  });

  function abrir() {
    if (votacao) return ctx.aviso(t('A vote is already happening'));
    renderDialogo();
    dlg.showModal();
  }

  function iniciarVotacao(alvo, efeito) {
    if (votacao) return ctx.aviso(t('A vote is already happening'));
    if (penas.has(alvo)) return;
    const msg = { t: 'votar', id: crypto.randomUUID(), alvo, efeito, por: ctx.eu(), fim: Date.now() + VOTACAO };
    ctx.enviar(msg);
    receber({ ...msg, de: ctx.eu() });
    votar(true); // quem abre a votação já vota Yes
    if (ctx.demo) {
      // na demo, os outros "votam" sozinhos
      for (const id of eleitores()) {
        if (id === ctx.eu()) continue;
        setTimeout(() => receber({ t: 'voto', id: msg.id, sim: Math.random() < 0.8, de: id }), 700 + Math.random() * 2500);
      }
    }
  }

  // ---------------------------------------------------------------- pop-up da votação
  const caixaVoto = el(`<div class="court-voto" hidden></div>`);
  document.body.appendChild(caixaVoto);

  const eleitores = () => ctx.pessoas().filter((id) => id !== votacao?.alvo);

  function renderVotacao() {
    if (!votacao) {
      caixaVoto.hidden = true;
      return;
    }
    const ef = EFEITOS[votacao.efeito];
    const souAlvo = votacao.alvo === ctx.eu();
    const meu = votacao.votos.get(ctx.eu());
    const sim = [...votacao.votos.values()].filter(Boolean).length;
    const nao = votacao.votos.size - sim;
    const quem = (valor) => [...votacao.votos].filter(([, v]) => v === valor).map(([id]) => `<span data-tip="${esc(ctx.nomeDe(id))}">${ctx.avatarHtml(id)}</span>`).join('');
    const faltam = Math.max(0, eleitores().length - votacao.votos.size);
    const total = Math.max(1, sim + nao);
    const card = (valor, n) => {
      const ehSim = valor === 1;
      const escolhido = meu === Boolean(valor);
      return `<button class="cv-card ${ehSim ? 'cv-sim' : 'cv-nao'} ${escolhido ? 'ligado' : ''}" data-voto="${valor}" ${souAlvo || meu !== undefined ? 'disabled' : ''}>
        <span class="cv-icone">${ehSim ? '👍' : '👎'}</span>
        <span class="cv-rotulo">${ehSim ? 'Yes' : 'No'}</span>
        <span class="cv-conta">${n}</span>
        <span class="cv-quem">${quem(ehSim)}</span>
      </button>`;
    };
    caixaVoto.hidden = false;
    caixaVoto.style.setProperty('--cor', ef.cor);
    caixaVoto.innerHTML = `
      <div class="cv-faixa">
        <span class="cv-selo">⚖️ Court</span>
        <span class="cv-tempo" data-court-fim="${votacao.fim}">${tempo(votacao.fim - Date.now())}</span>
      </div>
      <div class="cv-alvo">
        <div class="cv-rosto">${ctx.avatarHtml(votacao.alvo)}<span class="cv-emoji">${ef.emoji}</span></div>
        <div class="cv-pergunta">${esc(souAlvo ? t('The call is voting: {q}', { q: t(ef.pergunta, { name: t('you') }) }) : t(ef.pergunta, { name: ctx.nomeDe(votacao.alvo) }))}</div>
      </div>
      <div class="cv-cards">${card(1, sim)}${card(0, nao)}</div>
      <div class="cv-medidor"><i class="m-sim" style="width:${(sim / total) * 100}%"></i><i class="m-nao" style="width:${(nao / total) * 100}%"></i></div>
      <div class="cv-placar">${esc(faltam ? t('{left} still voting', { left: faltam }) : t('Everyone voted'))}${souAlvo ? ` · ${esc(t("you can't vote"))}` : ''}</div>
      <div class="cv-barra"><i style="animation-duration:${VOTACAO}ms;animation-delay:-${Math.max(0, VOTACAO - (votacao.fim - Date.now()))}ms"></i></div>`;
  }
  caixaVoto.addEventListener('click', (e) => {
    const b = e.target.closest('[data-voto]');
    if (b && !b.disabled) votar(b.dataset.voto === '1');
  });

  function votar(sim) {
    if (!votacao || votacao.alvo === ctx.eu() || votacao.votos.has(ctx.eu())) return;
    const msg = { t: 'voto', id: votacao.id, sim };
    ctx.enviar(msg);
    receber({ ...msg, de: ctx.eu() });
  }

  function decidir() {
    if (!votacao || votacao.decidido || votacao.por !== ctx.eu()) return;
    votacao.decidido = true;
    const sim = [...votacao.votos.values()].filter(Boolean).length;
    const nao = votacao.votos.size - sim;
    const passou = sim > eleitores().length / 2;
    const msg = { t: 'resultado', id: votacao.id, alvo: votacao.alvo, efeito: votacao.efeito, sim: passou, placar: [sim, nao], fim: Date.now() + DURACAO };
    ctx.enviar(msg);
    receber({ ...msg, de: ctx.eu() });
  }

  // ---------------------------------------------------------------- efeitos (penas)
  function aplicarPena(alvo, efeito, id, fim) {
    penas.set(alvo, { id, efeito, fim, tentou: false });
    if (alvo === ctx.eu()) {
      if (efeito === 'vergonha') ctx.isolar(true);
    } else {
      ctx.aplicarEfeito(alvo, efeito);
    }
    renderMinhaPena();
    ctx.atualizar();
  }

  function removerPena(alvo) {
    const p = penas.get(alvo);
    if (!p) return;
    penas.delete(alvo);
    if (alvo === ctx.eu()) {
      if (p.efeito === 'vergonha') ctx.isolar(false);
      meuJogo?.parar();
      meuJogo = null;
      caixaFuga.close?.();
    } else {
      ctx.aplicarEfeito(alvo, null);
    }
    fecharPlateia(p.id);
    renderMinhaPena();
    ctx.atualizar();
  }

  // aviso fixo pra quem está com o efeito
  const caixaPena = el(`<div class="court-pena" hidden></div>`);
  document.body.appendChild(caixaPena);
  function renderMinhaPena() {
    const p = penas.get(ctx.eu());
    if (!p) {
      caixaPena.hidden = true;
      return;
    }
    const ef = EFEITOS[p.efeito];
    caixaPena.hidden = false;
    caixaPena.innerHTML = `<span class="emoji">${ef.emoji}</span><b>${esc(t(ef.voce))}</b>
      <span class="cp-tempo" data-court-fim="${p.fim}">${tempo(p.fim - Date.now())}</span>
      ${p.tentou ? '' : `<button class="cp-fugir" data-fugir>${esc(t('Try to escape'))}</button>`}`;
  }
  caixaPena.addEventListener('click', (e) => {
    if (e.target.closest('[data-fugir]')) tentarFugir();
  });

  // ---------------------------------------------------------------- fuga (mini-game)
  const caixaFuga = el(`<dialog class="modal court-fuga na-atividade"></dialog>`);
  document.body.appendChild(caixaFuga);
  caixaFuga.addEventListener('cancel', (e) => e.preventDefault()); // Esc não fecha no meio do jogo

  function tentarFugir() {
    const p = penas.get(ctx.eu());
    if (!p || p.tentou) return;
    p.tentou = true;
    renderMinhaPena();
    const jogo = JOGOS[p.efeito];
    caixaFuga.innerHTML = `
      <div class="cf-titulo">${esc(t(jogo.nome))}</div>
      <div class="cf-dica">${esc(t(jogo.dica))}</div>
      <canvas class="cf-jogo"></canvas>`;
    caixaFuga.showModal();
    const canvas = caixaFuga.querySelector('canvas');
    meuJogo = criarJogo(p.efeito, canvas, {
      aoEstado: (estado, progresso) => {
        ctx.enviar({ t: 'fuga', id: p.id, efeito: p.efeito, estado, progresso });
        if (ctx.demo) mostrarPlateia({ id: p.id, efeito: p.efeito, estado, progresso }); // na demo, mostra como a call vê
      },
      aoFim: (venceu) => {
        meuJogo = null;
        caixaFuga.close();
        const msg = { t: 'fuga-fim', id: p.id, venceu };
        ctx.enviar(msg);
        receber({ ...msg, de: ctx.eu() });
      },
    });
  }

  // quem assiste: janelinha com o jogo ao vivo
  const areaPlateia = el(`<div class="court-plateia"></div>`);
  document.body.appendChild(areaPlateia);
  function mostrarPlateia(m) {
    let v = plateia.get(m.id);
    const alvo = [...penas.entries()].find(([, p]) => p.id === m.id)?.[0] || m.de;
    if (!v) {
      const caixa = el(`<div class="cp-caixa">
        <div class="cp-quem">${esc(t('{name} is trying to escape punishment', { name: ctx.nomeDe(alvo) }))}</div>
        <canvas width="${Math.round(360 * Math.max(1, devicePixelRatio))}" height="${Math.round(220 * Math.max(1, devicePixelRatio))}"></canvas>
        <div class="cp-progresso"><i></i></div></div>`);
      areaPlateia.appendChild(caixa);
      v = { caixa, canvas: caixa.querySelector('canvas'), efeito: m.efeito };
      plateia.set(m.id, v);
    }
    desenharJogo(v.efeito, v.canvas, m.estado);
    v.caixa.querySelector('.cp-progresso i').style.width = `${Math.round((m.progresso || 0) * 100)}%`;
  }
  function fecharPlateia(id) {
    const v = plateia.get(id);
    if (!v) return;
    plateia.delete(id);
    setTimeout(() => v.caixa.remove(), 1200);
  }

  // ---------------------------------------------------------------- mensagens
  function receber(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'votar') {
      if (votacao || penas.has(m.alvo) || !EFEITOS[m.efeito]) return;
      votacao = { id: m.id, alvo: m.alvo, efeito: m.efeito, por: m.por, fim: Math.min(m.fim, Date.now() + VOTACAO), votos: new Map(), decidido: false };
      renderVotacao();
      const id = votacao.id;
      // o cronômetro é desta votação (não pode encerrar a próxima)
      if (votacao.por === ctx.eu()) setTimeout(() => { if (votacao?.id === id) decidir(); }, VOTACAO);
      // se quem abriu sair da call, a votação expira sozinha
      setTimeout(() => { if (votacao?.id === id) { votacao = null; renderVotacao(); } }, VOTACAO + 4000);
    } else if (m.t === 'voto') {
      if (!votacao || m.id !== votacao.id || !m.de || m.de === votacao.alvo || votacao.votos.has(m.de)) return;
      votacao.votos.set(m.de, Boolean(m.sim));
      renderVotacao();
      if (votacao.votos.size >= eleitores().length) decidir();
    } else if (m.t === 'resultado') {
      if (!votacao || m.id !== votacao.id) return;
      votacao = null;
      renderVotacao();
      const ef = EFEITOS[m.efeito];
      const nome = m.alvo === ctx.eu() ? t('you') : ctx.nomeDe(m.alvo);
      const placar = Array.isArray(m.placar) ? ` · ${Number(m.placar[0]) || 0}–${Number(m.placar[1]) || 0}` : '';
      if (m.sim) aplicarPena(m.alvo, m.efeito, m.id, Math.min(m.fim, Date.now() + DURACAO));
      ctx.aviso(`⚖️ ${t(ef.pergunta, { name: nome })} → ${m.sim ? 'Yes' : 'No'}${placar}`);
    } else if (m.t === 'estado') {
      for (const [alvo, p] of m.penas || []) if (!penas.has(alvo) && EFEITOS[p.efeito] && p.fim > Date.now()) aplicarPena(alvo, p.efeito, p.id, p.fim);
    } else if (m.t === 'fuga') {
      if (m.de === ctx.eu() || !EFEITOS[m.efeito]) return;
      mostrarPlateia(m);
    } else if (m.t === 'fuga-fim') {
      const alvo = [...penas.entries()].find(([, p]) => p.id === m.id)?.[0];
      if (!alvo) return;
      const nome = alvo === ctx.eu() ? t('You') : ctx.nomeDe(alvo);
      if (m.venceu) {
        removerPena(alvo);
        ctx.aviso(`🏃 ${t('{name} escaped punishment!', { name: nome })}`);
      } else {
        fecharPlateia(m.id);
        ctx.aviso(`⚖️ ${t("{name} couldn't escape", { name: nome })}`);
      }
    }
  }

  // quem chega no meio recebe as penas que estão valendo
  function chegou(peerId) {
    if (penas.size) ctx.enviar({ t: 'estado', penas: [...penas.entries()] }, peerId);
  }

  // relógio: contadores e fim dos efeitos
  setInterval(() => {
    const agora = Date.now();
    for (const [alvo, p] of penas) if (p.fim <= agora) removerPena(alvo);
    for (const n of document.querySelectorAll('[data-court-fim]')) n.textContent = (n.classList.contains('selo-court') ? '⚖️ ' : '') + tempo(Number(n.dataset.courtFim) - agora);
  }, 500);

  function sair() {
    for (const alvo of [...penas.keys()]) removerPena(alvo);
    votacao = null;
    renderVotacao();
    meuJogo?.parar();
    meuJogo = null;
    if (caixaFuga.open) caixaFuga.close();
    if (dlg.open) dlg.close();
    for (const id of [...plateia.keys()]) fecharPlateia(id);
  }

  return {
    abrir,
    receber,
    chegou,
    sair,
    penaDe: (userId) => penas.get(userId),
    selo(userId) {
      const p = penas.get(userId);
      return p ? `<span class="selo-court" data-court-fim="${p.fim}" data-tip="${esc(EFEITOS[p.efeito].emoji)}">⚖️ ${tempo(p.fim - Date.now())}</span>` : '';
    },
  };
}
