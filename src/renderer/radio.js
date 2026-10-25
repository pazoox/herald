// Rádio: uma fila de músicas que todo mundo da chamada ouve junto.
// Cada pessoa toca o player oficial (YouTube / SoundCloud) no próprio PC; o que
// viaja entre as pessoas é só o estado { fila, pausado, pos, v }:
//   fila[0] é a música tocando agora
//   pos é a posição dela (segundos) no momento em que o estado foi enviado
//   v sobe a cada mudança; vale o estado com o maior v

import { icone } from './icones.js';
import { t } from './i18n.js';

const MAX_FILA = 100;
const TOLERANCIA = 2.5; // segundos de diferença antes de reposicionar o player
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function guardar(k, v) { try { localStorage.setItem(k, v); } catch {} }
function ler(k) { try { return localStorage.getItem(k); } catch { return null; } }

function minutos(s) {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// O estado vem de outras pessoas: só aceita faixas que a gente sabe tocar
function faixaValida(f) {
  if (!f || typeof f !== 'object') return null;
  const id = String(f.id || '');
  if (f.tipo === 'youtube' ? !/^[\w-]{11}$/.test(id) : f.tipo === 'soundcloud' ? !/^https:\/\/(api\.)?soundcloud\.com\//.test(id) : true) return null;
  const capa = String(f.capa || '');
  return {
    uid: String(f.uid || '').slice(0, 40),
    tipo: f.tipo,
    id: id.slice(0, 300),
    titulo: String(f.titulo || '').slice(0, 200),
    autor: String(f.autor || '').slice(0, 120),
    capa: /^https:\/\/(i\.ytimg\.com|[\w-]+\.sndcdn\.com)\//.test(capa) ? capa.slice(0, 500) : '',
    por: String(f.por || '').slice(0, 60),
  };
}

// ================= Players (YouTube / SoundCloud por postMessage) =================

function criarPlayer(caixa, faixa, inicio, aoEvento) {
  const f = document.createElement('iframe');
  f.allow = 'autoplay; encrypted-media';
  // isolado: roda os scripts do player, mas não abre janelas nem navega o app
  f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
  f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  const p = { uid: faixa.uid, tempo: inicio, quando: performance.now(), duracao: 0, tocando: false, pronto: false, desde: performance.now() };

  if (faixa.tipo === 'youtube') {
    f.src = `https://www.youtube-nocookie.com/embed/${faixa.id}?enablejsapi=1&autoplay=1&controls=0&disablekb=1&rel=0&playsinline=1&iv_load_policy=3&cc_load_policy=0&fs=0&modestbranding=1&start=${Math.floor(inicio)}&origin=${encodeURIComponent(location.origin)}`;
    const mandar = (dados) => f.contentWindow?.postMessage(JSON.stringify({ ...dados, id: 1, channel: 'widget' }), '*');
    const cmd = (func, args = []) => mandar({ event: 'command', func, args });
    // fica avisando que queremos ouvir os eventos até o player responder
    const chamar = setInterval(() => mandar({ event: 'listening' }), 300);
    p.ouvir = (d) => {
      clearInterval(chamar);
      const info = d.info;
      if (d.event === 'onReady') { p.pronto = true; aoEvento('pronto'); }
      if (d.event === 'onError') aoEvento('erro', info);
      if (d.event === 'onStateChange' && info === 0) aoEvento('fim');
      if (d.event === 'infoDelivery' && info) {
        if (typeof info.currentTime === 'number') { p.tempo = info.currentTime; p.quando = performance.now(); }
        if (info.duration) p.duracao = info.duration;
        if (typeof info.playerState === 'number') {
          p.tocando = info.playerState === 1 || info.playerState === 3;
          if (info.playerState === 0) aoEvento('fim');
        }
        if (!p.pronto && typeof info.currentTime === 'number') { p.pronto = true; aoEvento('pronto'); }
      }
    };
    p.tocar = () => cmd('playVideo');
    p.pausar = () => cmd('pauseVideo');
    p.irPara = (s) => cmd('seekTo', [s, true]);
    p.volume = (v) => { cmd('setVolume', [v]); cmd(v > 0 ? 'unMute' : 'mute'); };
    // alguns clipes ligam a legenda sozinhos: no Rádio é só o vídeo rolando
    p.semLegenda = () => { cmd('unloadModule', ['captions']); cmd('unloadModule', ['cc']); };
    p.parar = () => clearInterval(chamar);
  } else {
    f.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(faixa.id)}&auto_play=true&visual=true&hide_related=true&show_comments=false&show_reposts=false&show_teaser=false&sharing=false&buying=false&download=false&show_playcount=false&show_artwork=true`;
    const mandar = (method, value) => f.contentWindow?.postMessage(JSON.stringify(value === undefined ? { method } : { method, value }), '*');
    f.addEventListener('load', () => {
      for (const ev of ['ready', 'playProgress', 'play', 'pause', 'finish', 'error']) mandar('addEventListener', ev);
    });
    p.ouvir = (d) => {
      if (d.method === 'ready') {
        p.pronto = true;
        mandar('getDuration');
        aoEvento('pronto');
      }
      if (d.method === 'getDuration' && d.value) p.duracao = d.value / 1000;
      if (d.method === 'playProgress' && d.value) {
        p.tempo = d.value.currentPosition / 1000;
        p.quando = performance.now();
        p.tocando = true;
        if (!p.duracao) mandar('getDuration');
      }
      if (d.method === 'play') p.tocando = true;
      if (d.method === 'pause') p.tocando = false;
      if (d.method === 'finish') aoEvento('fim');
      if (d.method === 'error') aoEvento('erro');
    };
    p.tocar = () => mandar('play');
    p.pausar = () => mandar('pause');
    p.irPara = (s) => mandar('seekTo', s * 1000);
    p.volume = (v) => mandar('setVolume', v);
    p.parar = () => {};
  }

  // posição estimada agora (o player só manda a posição de tempos em tempos)
  p.agora = () => p.tempo + (p.tocando ? (performance.now() - p.quando) / 1000 : 0);
  p.janela = f;
  p.destruir = () => { p.parar(); f.remove(); };
  caixa.append(f);
  return p;
}

// ================= Rádio =================

export function criarRadio(ctx) {
  // ctx: { eu(), nomeDe(id), enviar(estado, peerId?), mudo(), aviso(texto), buscar(texto) }
  const $ = (s) => document.querySelector(s);
  const el = $('#radio');
  let estado = { fila: [], pausado: false, pos: 0, v: 0 };
  let marco = performance.now();
  let aberto = false; // o player está tocando/visível pra mim
  let fechadoPorMim = false; // fechei: não reabre sozinho quando alguém mexe na fila
  // escondido: toca normalmente, sem o pop-up na tela (o anel da trilha mostra que está tocando).
  // É o mesmo "lugar" da aba Rádio do painel: o player só fica invisível, a música não reinicia.
  let escondido = ler('herald-radio-escondido') === '1';
  let verFila = false;
  let player = null;
  let volume = Number(ler('herald-radio-vol') ?? 50);
  let buscando = false;
  let noPainel = false; // encaixado na aba Rádio do painel da direita (sem pop-up)

  const posAgora = () => (estado.pausado ? estado.pos : estado.pos + (performance.now() - marco) / 1000);
  const pacote = () => ({ fila: estado.fila, pausado: estado.pausado, pos: posAgora(), v: estado.v });
  const volumeReal = () => (ctx.mudo() ? 0 : volume);

  // Mudança feita por mim: atualiza e manda pra todo mundo
  function alterar(fn) {
    estado.pos = posAgora();
    marco = performance.now();
    fn();
    estado.v++;
    ctx.enviar(pacote());
    aplicar();
  }

  // Mensagens dos players (cada iframe só fala com o player dele)
  addEventListener('message', (e) => {
    if (!player || e.source !== player.janela.contentWindow) return;
    let d = e.data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return; } }
    if (d && typeof d === 'object') player.ouvir(d);
  });

  function aoEventoDoPlayer(uid) {
    return (ev, info) => {
      if (!player || player.uid !== uid) return;
      if (ev === 'pronto') {
        player.volume(volumeReal());
        player.semLegenda?.();
        setTimeout(() => player?.semLegenda?.(), 1500); // a legenda às vezes carrega depois
        // SoundCloud não aceita "começar em": posiciona quando fica pronto
        if (estado.fila[0]?.tipo === 'soundcloud' && posAgora() > 1) player.irPara(posAgora());
        if (estado.pausado) player.pausar();
      }
      if (ev === 'fim') {
        // todo mundo chega no fim junto e avança sozinho (mesmo resultado em todos)
        if (estado.fila[0]?.uid !== uid) return;
        estado.fila.shift();
        estado.pos = 0;
        marco = performance.now();
        estado.v++;
        aplicar();
      }
      if (ev === 'erro') {
        if (estado.fila[0]?.uid !== uid) return;
        ctx.aviso(t("This song can't be played here — skipping"));
        alterar(() => {
          estado.fila.shift();
          estado.pos = 0;
        });
      }
    };
  }

  // Deixa o player igual ao estado (troca de música, pausa, posição)
  function aplicar() {
    const atual = estado.fila[0];
    if (!aberto || !atual) {
      player?.destruir();
      player = null;
    } else if (player?.uid !== atual.uid) {
      player?.destruir();
      player = criarPlayer($('#radio-tela'), atual, posAgora(), aoEventoDoPlayer(atual.uid));
    } else if (player.pronto) {
      if (estado.pausado && player.tocando) player.pausar();
      if (!estado.pausado && !player.tocando) player.tocar();
      if (!estado.pausado && Math.abs(player.agora() - posAgora()) > TOLERANCIA) player.irPara(posAgora());
      if (estado.pausado && Math.abs(player.agora() - estado.pos) > TOLERANCIA) player.irPara(estado.pos);
    }
    render();
  }

  // De tempos em tempos confere se o player não ficou pra trás (internet travou etc.)
  setInterval(() => {
    if (player?.pronto && performance.now() - player.desde > 4000) {
      const atrasado = Math.abs(player.agora() - posAgora()) > TOLERANCIA;
      if (!estado.pausado && (atrasado || !player.tocando)) aplicar();
    }
    if (aberto && estado.fila.length) renderTempo();
  }, 1000);

  // ================= Tela =================

  function render() {
    el.hidden = !aberto;
    if (!aberto) return;
    const atual = estado.fila[0];
    el.classList.toggle('escondido', escondido && !noPainel);
    el.classList.toggle('no-painel', noPainel);
    el.classList.toggle('vazio', !atual);
    el.classList.toggle('soundcloud', atual?.tipo === 'soundcloud');
    $('#radio-titulo').textContent = atual ? atual.titulo : t('Nothing playing');
    $('#radio-autor').textContent = atual
      ? [atual.autor, atual.por && t('added by {name}', { name: ctx.nomeDe(atual.por) })].filter(Boolean).join(' · ')
      : t('Add a song to start the Radio for everyone in the call');
    $('#radio-capa').src = atual?.capa || 'marca/herald.svg';
    $('#radio-play').innerHTML = icone(estado.pausado || !atual ? 'tocar' : 'pausar');
    $('#radio-play').classList.toggle('pausado', Boolean(atual && !estado.pausado)); // mostrando o ícone de pausa
    $('#radio-play').disabled = !atual;
    $('#radio-play').dataset.tip = t(estado.pausado ? 'Play' : 'Pause');
    $('#radio-pular').disabled = !atual;
    $('#radio-vol').value = volume;
    $('#radio-vol-icone').innerHTML = icone(volumeReal() ? 'volume' : 'som-off');
    const proximas = estado.fila.slice(1);
    $('#radio-qtd').textContent = proximas.length || '';
    $('#radio-ver-fila').classList.toggle('ligado', verFila);
    // na aba do painel a fila fica sempre aberta (interface dedicada)
    $('#radio-fila').hidden = !(verFila || noPainel);
    $('#radio-fila').innerHTML = proximas.length
      ? `<div class="radio-fila-topo"><span>${esc(t('Up next'))}</span><button class="link" data-radio-limpar>${esc(t('Clear'))}</button></div>` +
        proximas.map((f, i) => `
          <div class="radio-item">
            <span class="radio-item-n">${i + 1}</span>
            ${f.capa ? `<img src="${esc(f.capa)}" alt="">` : '<span class="radio-item-capa"></span>'}
            <span class="radio-item-texto"><b>${esc(f.titulo)}</b><small>${esc([f.autor, f.por && t('added by {name}', { name: ctx.nomeDe(f.por) })].filter(Boolean).join(' · '))}</small></span>
            <button class="botao-icone pequeno perigo" data-radio-tirar="${esc(f.uid)}" data-tip="${esc(t('Remove'))}">${icone('x')}</button>
          </div>`).join('')
      : `<p class="radio-fila-vazia">${esc(t('The queue is empty. Add more songs below.'))}</p>`;
    $('#radio-add').disabled = buscando;
    $('#radio-busca').disabled = buscando;
    renderTempo();
  }

  function renderTempo() {
    const atual = estado.fila[0];
    const dur = player?.duracao || 0;
    const pos = atual ? Math.min(posAgora(), dur || Infinity) : 0;
    $('#radio-barra').style.width = dur ? `${Math.min(100, (pos / dur) * 100)}%` : '0%';
    $('#radio-tempo').textContent = atual ? `${minutos(pos)} / ${dur ? minutos(dur) : '–:––'}` : '';
  }

  // ================= Botões =================

  $('#radio-play').onclick = () => {
    if (estado.fila.length) alterar(() => (estado.pausado = !estado.pausado));
  };
  $('#radio-pular').onclick = () => {
    if (!estado.fila.length) return;
    alterar(() => {
      estado.fila.shift();
      estado.pos = 0;
      estado.pausado = false;
    });
  };
  $('#radio-vol').oninput = (e) => {
    volume = Number(e.target.value);
    guardar('herald-radio-vol', volume);
    player?.volume(volumeReal());
    $('#radio-vol-icone').innerHTML = icone(volumeReal() ? 'volume' : 'som-off');
  };
  $('#radio-ver-fila').onclick = () => {
    verFila = !verFila;
    render();
  };
  function definirEscondido(sim) {
    escondido = sim;
    guardar('herald-radio-escondido', sim ? '1' : '0');
    render();
  }
  $('#radio-esconder').onclick = () => definirEscondido(true);
  const alternarPausa = () => {
    if (estado.fila.length) alterar(() => (estado.pausado = !estado.pausado));
  };
  const pularMusica = () => {
    if (!estado.fila.length) return;
    alterar(() => {
      estado.fila.shift();
      estado.pos = 0;
      estado.pausado = false;
    });
  };
  $('#radio-fechar').onclick = () => {
    aberto = false;
    fechadoPorMim = true;
    aplicar();
  };
  $('#radio-progresso').onclick = (e) => {
    const dur = player?.duracao;
    if (!dur || !estado.fila.length) return;
    const r = e.currentTarget.querySelector('.radio-trilho').getBoundingClientRect();
    const fracao = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    alterar(() => (estado.pos = fracao * dur));
  };
  $('#radio-fila').onclick = (e) => {
    const tirar = e.target.closest('[data-radio-tirar]');
    if (tirar) alterar(() => (estado.fila = estado.fila.filter((f, i) => i === 0 || f.uid !== tirar.dataset.radioTirar)));
    if (e.target.closest('[data-radio-limpar]')) alterar(() => (estado.fila = estado.fila.slice(0, 1)));
  };

  const ERROS = {
    'not-found': "Couldn't find that song",
    unsupported: 'Only YouTube and SoundCloud links work',
  };
  $('#radio-form').onsubmit = async (e) => {
    e.preventDefault();
    const texto = $('#radio-busca').value.trim();
    if (!texto || buscando) return;
    if (estado.fila.length >= MAX_FILA) return ctx.aviso(t('The queue is full'));
    buscando = true;
    $('#radio-erro').textContent = '';
    render();
    const achada = await ctx.buscar(texto).catch(() => ({ erro: 'not-found' }));
    buscando = false;
    const faixa = !achada?.erro && faixaValida({ ...achada, uid: crypto.randomUUID(), por: ctx.eu() });
    if (!faixa) {
      $('#radio-erro').textContent = t(ERROS[achada?.erro] || ERROS['not-found']);
      render();
      return;
    }
    $('#radio-busca').value = '';
    const comecou = !estado.fila.length;
    alterar(() => {
      estado.fila.push(faixa);
      if (comecou) {
        estado.pos = 0;
        estado.pausado = false;
      }
    });
    if (!comecou) ctx.aviso(t('Added to the queue: {title}', { title: faixa.titulo }));
    $('#radio-busca').focus();
  };

  // Arrastar o player pelo topo
  (() => {
    const topo = $('#radio-topo');
    const salvo = (() => { try { return JSON.parse(ler('herald-radio-pos')); } catch { return null; } })();
    const posicionar = (x, y) => {
      const r = el.getBoundingClientRect();
      x = Math.max(8, Math.min(innerWidth - r.width - 8, x));
      y = Math.max(48, Math.min(innerHeight - 60, y));
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      return { x, y };
    };
    if (salvo) requestAnimationFrame(() => !el.hidden && posicionar(salvo.x, salvo.y));
    topo.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button') || noPainel) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      topo.setPointerCapture(e.pointerId);
      el.classList.add('arrastando');
      const mover = (ev) => guardar('herald-radio-pos', JSON.stringify(posicionar(ev.clientX - dx, ev.clientY - dy)));
      const soltar = () => {
        el.classList.remove('arrastando');
        topo.removeEventListener('pointermove', mover);
        topo.removeEventListener('pointerup', soltar);
      };
      topo.addEventListener('pointermove', mover);
      topo.addEventListener('pointerup', soltar);
    });
  })();

  return {
    // Abre o player (menu Ferramentas)
    abrir() {
      aberto = true;
      fechadoPorMim = false;
      escondido = false; // abrir pelo menu Ferramentas mostra o pop-up
      guardar('herald-radio-escondido', '0');
      aplicar();
      if (!estado.fila.length) $('#radio-busca').focus();
    },
    // controles rápidos (botão direito no anel do Rádio)
    alternarPausa: () => alternarPausa(),
    pular: () => pularMusica(),
    mostrar: () => {
      aberto = true;
      fechadoPorMim = false;
      definirEscondido(false);
      aplicar();
    },
    esconder: () => definirEscondido(true),
    tocandoAlgo: () => estado.fila.length > 0,
    // pro anel da trilha: progresso da música e se está tocando
    info() {
      const atual = estado.fila[0];
      const dur = player?.duracao || 0;
      return {
        ativo: Boolean(atual),
        ligado: aberto || Boolean(atual), // o player está aberto ou tem música rolando na call
        tocando: Boolean(atual && !estado.pausado && aberto),
        pausado: estado.pausado,
        escondido: escondido && !noPainel,
        progresso: dur ? Math.min(1, posAgora() / dur) : 0,
        restante: dur ? Math.max(0, dur - posAgora()) : null,
        titulo: atual?.titulo || '',
      };
    },
    // aba Rádio do painel: o player vai pra lá e o pop-up some
    encaixar(sim) {
      if (sim === noPainel) return;
      noPainel = sim;
      if (sim && !aberto) {
        aberto = true;
        fechadoPorMim = false;
        aplicar();
      } else if (!sim && !estado.fila.length) {
        aberto = false; // não deixa um pop-up vazio aparecer ao sair da aba
        aplicar();
      } else render();
    },
    // Estado que veio de outra pessoa da chamada
    receber({ estado: novo, de }) {
      if (!novo || typeof novo !== 'object' || !Array.isArray(novo.fila)) return;
      const v = Number(novo.v) || 0;
      if (v <= estado.v) return;
      const fila = novo.fila.slice(0, MAX_FILA).map(faixaValida).filter(Boolean);
      const comecou = !estado.fila.length && fila.length > 0;
      estado = { fila, pausado: Boolean(novo.pausado), pos: Math.max(0, Number(novo.pos) || 0), v };
      marco = performance.now();
      if (comecou && !aberto && !fechadoPorMim) {
        aberto = true;
        if (de) ctx.aviso(t('{name} started the Radio', { name: ctx.nomeDe(de) }));
      }
      aplicar();
    },
    // Alguém entrou na chamada: manda a fila atual só pra essa pessoa
    chegou(peerId) {
      if (estado.fila.length) ctx.enviar(pacote(), peerId);
    },
    // Mudo/surdo mudou: ajusta o volume
    atualizarSom() {
      player?.volume(volumeReal());
      if (aberto) render();
    },
    // Saí da chamada: o rádio acaba pra mim
    desligar() {
      estado = { fila: [], pausado: false, pos: 0, v: 0 };
      aberto = false;
      fechadoPorMim = false;
      verFila = false;
      aplicar();
    },
    // Modo demonstração (prints)
    demo(fila, pos) {
      estado = { fila: fila.map(faixaValida).filter(Boolean), pausado: true, pos, v: 1 };
      marco = performance.now();
      aberto = true;
      aplicar();
    },
  };
}
