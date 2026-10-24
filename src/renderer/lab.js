// Audio Lab (ferramenta de desenvolvimento, abre com HERALD_LAB=1).
// Grava a voz uma vez e passa a MESMA gravação pela cadeia do Herald, fora do tempo real,
// guardando o som depois de cada etapa. Assim dá pra comparar etapa por etapa (A/B sem
// parar o som), ver o espectro, ajustar tudo e exportar WAVs pra ouvir na DAW.

import './lab.css';
import { icone } from './icones.js';
import { criarSeletor } from './seletor.js';

const $ = (s) => document.querySelector(s);
const TAXA = 48000;
const SEGUNDOS = 10;
const ler = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const db = (v) => 20 * Math.log10(Math.max(v, 1e-9));

// ================= Ajustes (padrões = cadeia atual do app) =================

const PADRAO = {
  graves: { ligado: true, freq: 80 },
  ia: { ligado: true, limite: 35, modo: 'filtro', sensibilidade: 45, fundo: 20, segurar: 250 },
  nivel: { ligado: true, alvo: -22, maximo: 18, minimo: -12, sobe: 1.5, desce: 0.12, acimaDoChao: 12, silencio: -55, manual: 0 },
  eq: {
    ligado: true,
    bandas: [
      { tipo: 'lowshelf', freq: 120, ganho: 0, q: 0.7 },
      { tipo: 'peaking', freq: 300, ganho: -2.5, q: 1 },
      { tipo: 'peaking', freq: 3000, ganho: 0, q: 1 },
      { tipo: 'highshelf', freq: 6000, ganho: 2, q: 0.7 },
    ],
  },
  dinamica: { comprimir: true, detector: 'pico', limiar: -26, razao: 2.5, joelho: 10, ganho: 3, ataque: 8, soltura: 200, teto: -1, portao: -100, profundidade: 15 },
};
// Proposta nova (afinada na gravação do Pazi): mais alto (~-18 dB de voz), menos grave embolado,
// mais presença, compressor por RMS (natural), limiter segurando picos e expansor nas pausas
const PROPOSTA = {
  graves: { ligado: true, freq: 100 },
  ia: { ligado: true, limite: 35 },
  nivel: { ligado: true, alvo: -18, maximo: 24, minimo: -12, sobe: 0.6, desce: 0.1, acimaDoChao: 10, silencio: -60, manual: 0 },
  eq: {
    ligado: true,
    bandas: [
      { tipo: 'lowshelf', freq: 180, ganho: -2, q: 0.7 },
      { tipo: 'peaking', freq: 350, ganho: -2, q: 1 },
      { tipo: 'peaking', freq: 3200, ganho: 2.5, q: 0.8 },
      { tipo: 'highshelf', freq: 8000, ganho: 2.5, q: 0.7 },
    ],
  },
  dinamica: { comprimir: true, detector: 'rms', limiar: -24, razao: 3, joelho: 8, ganho: 9, ataque: 8, soltura: 120, teto: -1, portao: -45, profundidade: 12 },
};
// Modo sólido: o tratamento vem do Chrome (WebRTC, o mesmo do Google Meet) já na gravação —
// supressão de ruído + volume automático + limitador dele. Aqui só entram o EQ e um limiter de segurança.
const SOLIDO = {
  graves: { ligado: true, freq: 90 },
  ia: { ligado: true, limite: 35, modo: 'porteiro', sensibilidade: 25, fundo: 40, segurar: 60 },
  nivel: { ligado: false, alvo: -18, maximo: 24, minimo: -12, sobe: 0.6, desce: 0.1, acimaDoChao: 10, silencio: -60, manual: 0 },
  eq: { ligado: true, bandas: copiaRasa(PROPOSTA.eq.bandas) },
  dinamica: { comprimir: false, detector: 'rms', limiar: -24, razao: 3, joelho: 8, ganho: 0, ataque: 8, soltura: 120, teto: -1, portao: -100, profundidade: 10 },
  // (porteiro com o ajuste que o Pazi achou melhor: 25 / 40 / 60)
};
function copiaRasa(bandas) { return bandas.map((b) => ({ ...b })); }
const copia = (o) => JSON.parse(JSON.stringify(o));
let ajustes = (() => {
  try {
    const salvo = JSON.parse(ler('herald-lab-ajustes')) || {};
    const a = copia(PADRAO);
    for (const k of Object.keys(a)) a[k] = { ...a[k], ...salvo[k] };
    return a;
  } catch { return copia(PADRAO); }
})();

const ETAPAS = [
  { id: 'cru', nome: 'Cru', desc: 'o mic como chega' },
  { id: 'graves', nome: 'High-pass', desc: 'corta graves' },
  { id: 'ia', nome: 'IA de ruído', desc: 'DeepFilterNet3' },
  { id: 'nivel', nome: 'Nivelador', desc: 'volume automático' },
  { id: 'eq', nome: 'EQ', desc: 'timbre' },
  { id: 'final', nome: 'Final', desc: 'comp + limiter (o que vai pra call)' },
];

// ================= Cadeia (a mesma do app, montável em qualquer contexto) =================

let moduloIA = null;
async function prepararContexto(ctx) {
  await Promise.all(['deepfilter', 'ia-ponte', 'nivelador', 'dinamica'].map((m) => ctx.audioWorklet.addModule(`dist/audio/${m}.js?v=${Date.now()}`)));
  moduloIA ??= await WebAssembly.compile(await fetch('dist/audio/deepfilter.wasm').then((r) => r.arrayBuffer()));
}

// Liga entrada → etapas; devolve a saída de cada etapa (etapa desligada = passa direto)
function montarCadeia(ctx, a) {
  const entrada = new GainNode(ctx);
  const saidas = { cru: entrada };
  let atual = entrada;
  const ligar = (no) => { atual.connect(no); atual = no; };

  if (a.graves.ligado) ligar(new BiquadFilterNode(ctx, { type: 'highpass', frequency: a.graves.freq, Q: 0.7 }));
  saidas.graves = atual;

  if (a.ia.ligado && a.ia.modo === 'porteiro' && ctx instanceof OfflineAudioContext) {
    // porteiro gravado: a IA decide fora da cadeia (em processar); o som passa intacto aqui
  } else if (a.ia.ligado && ctx instanceof OfflineAudioContext) {
    ligar(new AudioWorkletNode(ctx, 'deepfilternet-processor', {
      numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit',
      processorOptions: { wasmModule: moduloIA, attenuationLimit: a.ia.limite },
    }));
  } else if (a.ia.ligado) {
    // ao vivo: igual ao app (IA num Worker, com folga)
    const ponte = new AudioWorkletNode(ctx, 'ia-ponte', { channelCount: 1, channelCountMode: 'explicit' });
    const worker = new Worker('dist/audio/ia-worker.js');
    const canal = new MessageChannel();
    const { sensibilidade, fundo, segurar } = a.ia;
    worker.postMessage({ tipo: 'iniciar', wasmModule: moduloIA, limite: a.ia.modo === 'porteiro' ? 100 : a.ia.limite, modo: a.ia.modo, porteiro: { sensibilidade, fundo, segurar } }, [canal.port2]);
    ponte.port.postMessage({ tipo: 'porta' }, [canal.port1]);
    saidas.worker = worker;
    ligar(ponte);
  }
  saidas.ia = atual;

  if (a.nivel.ligado) {
    const { alvo, maximo, minimo, sobe, desce, acimaDoChao, silencio } = a.nivel;
    ligar(new AudioWorkletNode(ctx, 'nivelador', { channelCount: 1, channelCountMode: 'explicit', processorOptions: { alvo, maximo, minimo, sobe, desce, acimaDoChao, silencio } }));
  } else {
    ligar(new GainNode(ctx, { gain: 10 ** (a.nivel.manual / 20) }));
  }
  saidas.nivel = atual;

  if (a.eq.ligado) {
    for (const b of a.eq.bandas) ligar(new BiquadFilterNode(ctx, { type: b.tipo, frequency: b.freq, gain: b.ganho, Q: b.q }));
  }
  saidas.eq = atual;

  ligar(new AudioWorkletNode(ctx, 'dinamica', { channelCount: 1, channelCountMode: 'explicit', processorOptions: { ...a.dinamica } }));
  saidas.final = atual;
  return { entrada, saidas };
}

// Processa a gravação inteira de uma vez: cada etapa vira um canal do resultado
// Porteiro: a IA escuta (num processamento à parte) e só decide se tem voz; o som original
// passa intacto quando tem voz e é abaixado `fundo` dB nas pausas (some estalo, teclado, batida).
async function aplicarPorteiro(gravacao, p) {
  const ctx = new OfflineAudioContext(1, gravacao.length, TAXA);
  await prepararContexto(ctx);
  const fonte = new AudioBufferSourceNode(ctx, { buffer: gravacao });
  fonte.connect(new AudioWorkletNode(ctx, 'deepfilternet-processor', {
    numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit',
    processorOptions: { wasmModule: moduloIA, attenuationLimit: 100 },
  })).connect(ctx.destination);
  fonte.start();
  const ia = (await ctx.startRendering()).getChannelData(0);
  const cru = gravacao.getChannelData(0);
  const ATRASO = 1952; // atraso da IA (~41 ms)
  const T = 480; // quadros de 10 ms
  const nq = Math.floor(cru.length / T);
  const niveis = [];
  for (let q = 0; q < nq; q++) {
    let s = 0;
    for (let k = 0; k < T; k++) { const v = ia[q * T + ATRASO + k] || 0; s += v * v; }
    niveis.push(10 * Math.log10(s / T + 1e-20));
  }
  const ordenado = [...niveis].sort((x, y) => x - y);
  const limiar = ordenado[Math.floor(nq * 0.95)] - p.sensibilidade;
  const segurar = Math.round(p.segurar / 10);
  const fundo = 10 ** (-p.fundo / 20);
  const alvo = niveis.map((_, q) => {
    for (let k = -segurar; k <= 3; k++) if (niveis[q + k] > limiar) return 1;
    return fundo;
  });
  const saida = new Float32Array(cru.length);
  let g = 1;
  for (let i = 0; i < cru.length; i++) {
    const a = alvo[Math.min(nq - 1, Math.floor(i / T))];
    g += (a - g) * (a > g ? 0.02 : 0.0004); // abre em ~1 ms, fecha em ~50 ms
    saida[i] = cru[i] * g;
  }
  const b = new AudioBuffer({ length: cru.length, sampleRate: TAXA, numberOfChannels: 1 });
  b.copyToChannel(saida, 0);
  return b;
}

async function processar(gravacao, a) {
  const original = gravacao;
  if (a.ia.ligado && a.ia.modo === 'porteiro') {
    await prepararContexto(new OfflineAudioContext(1, 128, TAXA));
    gravacao = await aplicarPorteiro(gravacao, a.ia);
  }
  const ctx = new OfflineAudioContext({ numberOfChannels: ETAPAS.length, length: gravacao.length, sampleRate: TAXA });
  await prepararContexto(ctx);
  ctx.destination.channelInterpretation = 'discrete';
  const { entrada, saidas } = montarCadeia(ctx, a);
  const juntar = new ChannelMergerNode(ctx, { numberOfInputs: ETAPAS.length });
  ETAPAS.forEach((e, i) => saidas[e.id].connect(juntar, 0, i));
  juntar.connect(ctx.destination);
  const fonte = new AudioBufferSourceNode(ctx, { buffer: gravacao });
  fonte.connect(entrada);
  fonte.start();
  const r = await ctx.startRendering();
  const etapas = {};
  ETAPAS.forEach((e, i) => {
    const b = new AudioBuffer({ length: r.length, sampleRate: TAXA, numberOfChannels: 1 });
    b.copyToChannel(r.getChannelData(i), 0);
    etapas[e.id] = b;
  });
  etapas.cru = original; // no porteiro, o "Cru" continua sendo o mic sem nada
  return etapas;
}

// ================= Medidas =================

// FFT radix-2 (in-place)
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let tam = 2; tam <= n; tam <<= 1) {
    const ang = (-2 * Math.PI) / tam;
    for (let i = 0; i < n; i += tam) {
      for (let k = 0; k < tam / 2; k++) {
        const c = Math.cos(ang * k), s = Math.sin(ang * k);
        const a = i + k, b = a + tam / 2;
        const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}

// Quadros de 50 ms: quais têm voz (pela gravação crua, igual pra todas as etapas)
function quadrosComVoz(cru) {
  const d = cru.getChannelData(0);
  const tam = TAXA * 0.05;
  const rms = [];
  for (let i = 0; i + tam <= d.length; i += tam) {
    let s = 0;
    for (let k = 0; k < tam; k++) s += d[i + k] ** 2;
    rms.push(Math.sqrt(s / tam));
  }
  const ordenado = [...rms].sort((x, y) => x - y);
  const chao = ordenado[Math.floor(ordenado.length * 0.1)] || 1e-6;
  return rms.map((r) => r > chao * 10 ** (15 / 20) && r > 1e-4);
}

function medir(buffer, voz) {
  const d = buffer.getChannelData(0);
  const tam = TAXA * 0.05;
  let pico = 0;
  for (const x of d) pico = Math.max(pico, Math.abs(x));
  let somaVoz = 0, nVoz = 0;
  const silencios = [];
  for (let q = 0, i = 0; i + tam <= d.length; q++, i += tam) {
    let s = 0;
    for (let k = 0; k < tam; k++) s += d[i + k] ** 2;
    if (voz[q]) { somaVoz += s / tam; nVoz++; } else silencios.push(Math.sqrt(s / tam));
  }
  silencios.sort((x, y) => x - y);
  const rmsVoz = Math.sqrt(somaVoz / Math.max(1, nVoz));
  const ruido = silencios.length ? silencios[Math.floor(silencios.length / 2)] : 0;
  return { pico: db(pico), voz: db(rmsVoz), ruido: db(ruido), crista: db(pico) - db(rmsVoz) };
}

// Espectro médio só dos quadros com voz, suavizado em 1/6 de oitava
function espectro(buffer, voz) {
  const N = 4096;
  const d = buffer.getChannelData(0);
  const soma = new Float64Array(N / 2);
  const janela = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  let n = 0;
  for (let i = 0; i + N <= d.length; i += N / 2) {
    if (!voz[Math.floor((i + N / 2) / (TAXA * 0.05))]) continue;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let k = 0; k < N; k++) re[k] = d[i + k] * janela[k];
    fft(re, im);
    for (let k = 0; k < N / 2; k++) soma[k] += re[k] ** 2 + im[k] ** 2;
    n++;
  }
  const pontos = [];
  for (let f = 40; f <= 20000; f *= 2 ** (1 / 24)) {
    const lo = Math.max(1, Math.floor((f * 2 ** (-1 / 12) * N) / TAXA));
    const hi = Math.min(N / 2 - 1, Math.ceil((f * 2 ** (1 / 12) * N) / TAXA));
    let s = 0;
    for (let k = lo; k <= hi; k++) s += soma[k];
    pontos.push([f, 10 * Math.log10(s / Math.max(1, n) / (hi - lo + 1) + 1e-20)]);
  }
  return pontos;
}

// ================= Estado =================

let gravacao = null; // AudioBuffer mono 48 kHz
let resultado = null; // { etapaId: AudioBuffer }
let medidas = {};
let espectros = {};
let etapaSel = 'final';
let processando = false;
let deNovo = false;

async function reprocessar() {
  if (!gravacao) return;
  if (processando) return (deNovo = true);
  processando = true;
  status('Processando…');
  const t0 = performance.now();
  try {
    resultado = await processar(gravacao, ajustes);
    const voz = quadrosComVoz(resultado.cru);
    medidas = Object.fromEntries(ETAPAS.map((e) => [e.id, medir(resultado[e.id], voz)]));
    espectros = Object.fromEntries(ETAPAS.map((e) => [e.id, espectro(resultado[e.id], voz)]));
    status(`Pronto (${((performance.now() - t0) / 1000).toFixed(1)} s pra processar). Troque de etapa com 1–6 enquanto toca.`);
    player.trocarBuffers(resultado);
  } catch (err) {
    console.error(err);
    status('Erro ao processar: ' + err.message);
  }
  processando = false;
  renderEtapas();
  desenharOnda();
  desenharEspectro();
  $('#btn-tocar').disabled = !resultado;
  $('#btn-exportar').disabled = !resultado;
  if (deNovo) { deNovo = false; reprocessar(); }
}

function status(texto) {
  $('#status').textContent = texto;
}

// ================= Player A/B (todas as etapas tocam juntas; só uma fica audível) =================

const player = (() => {
  let ctx = null, fontes = [], ganhos = {}, inicio = 0, offset = 0, tocando = false, buffers = null;
  const contexto = () => (ctx ??= new AudioContext({ sampleRate: TAXA, latencyHint: 'interactive' }));
  const duracao = () => buffers?.cru.duration || 0;
  function parar(guardarPos = true) {
    if (guardarPos && tocando) offset = posicao();
    for (const f of fontes) { try { f.stop(); } catch {} }
    fontes = [];
    tocando = false;
    $('#btn-tocar').innerHTML = icone('tocar');
  }
  function tocar() {
    if (!buffers) return;
    const c = contexto();
    parar(false);
    if (offset >= duracao()) offset = 0;
    ganhos = {};
    for (const e of ETAPAS) {
      const g = new GainNode(c, { gain: e.id === etapaSel ? 1 : 0 });
      const f = new AudioBufferSourceNode(c, { buffer: buffers[e.id], loop: $('#chk-loop').checked });
      f.connect(g).connect(c.destination);
      f.start(c.currentTime + 0.03, offset);
      fontes.push(f);
      ganhos[e.id] = g;
    }
    fontes[0].onended = () => { if (tocando && !$('#chk-loop').checked) { parar(false); offset = 0; } };
    inicio = c.currentTime + 0.03 - offset;
    tocando = true;
    $('#btn-tocar').innerHTML = icone('pausar');
  }
  function posicao() {
    if (!tocando) return offset;
    const p = ctx.currentTime - inicio;
    return $('#chk-loop').checked ? p % duracao() : Math.min(p, duracao());
  }
  return {
    alternar: () => (tocando ? parar() : tocar()),
    escolher(id) {
      if (!tocando) return;
      for (const [k, g] of Object.entries(ganhos)) g.gain.setTargetAtTime(k === id ? 1 : 0, ctx.currentTime, 0.004);
    },
    irPara(seg) { offset = seg; if (tocando) tocar(); },
    trocarBuffers(b) { const estava = tocando; const p = posicao(); parar(false); buffers = b; offset = p; if (estava) tocar(); },
    posicao, duracao,
    get tocando() { return tocando; },
  };
})();

// ================= Tela: etapas, onda, espectro =================

function renderEtapas() {
  $('#etapas').innerHTML = ETAPAS.map((e, i) => {
    const m = medidas[e.id];
    const num = (v) => (Number.isFinite(v) ? v.toFixed(1) : '–');
    return `<button class="lab-etapa ${e.id === etapaSel ? 'ligado' : ''}" data-etapa="${e.id}">
      <span class="lab-etapa-n">${i + 1}</span>
      <b>${e.nome}</b><small>${e.desc}</small>
      ${m ? `<span class="lab-medidas"><span>voz <b>${num(m.voz)}</b></span><span>pico <b class="${m.pico > -0.1 ? 'ruim' : ''}">${num(m.pico)}</b></span><span>ruído <b>${num(m.ruido)}</b></span></span>` : ''}
    </button>`;
  }).join('');
}

function escolherEtapa(id) {
  etapaSel = id;
  player.escolher(id);
  renderEtapas();
  desenharOnda();
  desenharEspectro();
}

function desenharOnda() {
  const cv = $('#onda');
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  if (!resultado) return;
  const d = resultado[etapaSel].getChannelData(0);
  const meio = cv.height / 2;
  const porPx = d.length / cv.width;
  g.fillStyle = '#b18cff';
  for (let x = 0; x < cv.width; x++) {
    let min = 1, max = -1;
    for (let i = Math.floor(x * porPx); i < Math.floor((x + 1) * porPx); i++) { if (d[i] < min) min = d[i]; if (d[i] > max) max = d[i]; }
    g.fillRect(x, meio - max * meio, 1, Math.max(1, (max - min) * meio));
  }
  // linhas de -1 dBFS (teto do limiter)
  g.fillStyle = '#f27a6a55';
  const teto = 10 ** (-1 / 20) * meio;
  g.fillRect(0, meio - teto, cv.width, 1);
  g.fillRect(0, meio + teto, cv.width, 1);
  // cursor
  const x = (player.posicao() / player.duracao()) * cv.width;
  g.fillStyle = '#d6f36a';
  g.fillRect(x, 0, 2, cv.height);
}

function desenharEspectro() {
  const cv = $('#espectro');
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height, base = 40;
  g.clearRect(0, 0, W, H);
  const xDe = (f) => 50 + ((Math.log10(f) - Math.log10(40)) / (Math.log10(20000) - Math.log10(40))) * (W - 70);
  // dB relativos: 0 = ponto mais alto entre o cru e a etapa escolhida
  const vistos = [espectros.cru, espectros[etapaSel], espectros.final].filter(Boolean).flat().map((p) => p[1]);
  const ref = vistos.length ? Math.max(...vistos) : 0;
  const topo = 6;
  const yDe = (v) => 10 + ((topo - (v - ref)) / 72) * (H - base - 10);
  // grade
  g.font = '600 20px "Manrope Variable", sans-serif';
  g.fillStyle = '#716b82';
  g.strokeStyle = '#26222f';
  g.lineWidth = 1;
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
    g.beginPath(); g.moveTo(xDe(f), 10); g.lineTo(xDe(f), H - base); g.stroke();
    g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), xDe(f) - 14, H - 12);
  }
  for (let v = 0; v >= -66; v -= 12) {
    g.beginPath(); g.moveTo(50, yDe(ref + v)); g.lineTo(W - 20, yDe(ref + v)); g.stroke();
    g.fillText(`${v}`, 4, yDe(ref + v) + 6);
  }
  if (!espectros.cru) return;
  const linha = (pontos, cor, largura) => {
    g.strokeStyle = cor; g.lineWidth = largura; g.beginPath();
    pontos.forEach(([f, v], i) => (i ? g.lineTo(xDe(f), yDe(v)) : g.moveTo(xDe(f), yDe(v))));
    g.stroke();
  };
  linha(espectros.cru, '#716b82', 2);
  if (etapaSel !== 'final') linha(espectros.final, '#d6f36a99', 2);
  linha(espectros[etapaSel], '#b18cff', 3);
}

function loop() {
  if (player.tocando) {
    desenharOnda();
    const p = player.posicao();
    $('#tempo').textContent = `${Math.floor(p / 60)}:${(p % 60).toFixed(1).padStart(4, '0')}`;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ================= Ajustes (painel da direita) =================

const CONTROLES = [
  { grupo: 'graves', titulo: 'High-pass', liga: 'ligado', itens: [['freq', 'Frequência', 20, 250, 1, 'Hz']] },
  {
    grupo: 'ia', titulo: 'IA de ruído (DeepFilterNet3)', liga: 'ligado',
    escolha: ['modo', 'Modo', { filtro: 'Filtro (a IA limpa a voz)', porteiro: 'Porteiro (a IA só abre/fecha)' }],
    itens: [['limite', 'Redução máxima (filtro)', 0, 100, 1, 'dB'], ['sensibilidade', 'Porteiro: abre até', 25, 65, 1, 'dB abaixo'], ['fundo', 'Porteiro: abaixa pausas', 6, 40, 1, 'dB'], ['segurar', 'Porteiro: segura', 50, 600, 10, 'ms']],
    nota: 'Filtro: Strong = 35 dB, Natural = 18 dB. Porteiro: "abre até" maior = abre mais fácil (protege voz fraca, deixa passar mais estalo).',
  },
  {
    grupo: 'nivel', titulo: 'Nivelador (volume automático)', liga: 'ligado',
    itens: [['alvo', 'Alvo (RMS da fala)', -36, -10, 0.5, 'dB'], ['maximo', 'Ganho máximo', 0, 30, 0.5, 'dB'], ['minimo', 'Ganho mínimo', -24, 0, 0.5, 'dB'],
      ['sobe', 'Tempo pra subir', 0.1, 5, 0.05, 's'], ['desce', 'Tempo pra descer', 0.01, 1, 0.01, 's'], ['acimaDoChao', 'Voz acima do ruído', 3, 24, 0.5, 'dB'], ['silencio', 'Ignorar abaixo de', -70, -30, 1, 'dB']],
    desligado: [['manual', 'Ganho manual', -12, 24, 0.5, 'dB']],
  },
  { grupo: 'eq', titulo: 'EQ', liga: 'ligado', bandas: true },
  {
    grupo: 'dinamica', titulo: 'Compressor + limiter', liga: 'comprimir', ligaNome: 'Compressor',
    itens: [['limiar', 'Threshold', -50, 0, 0.5, 'dB'], ['razao', 'Ratio', 1, 10, 0.1, ':1'], ['joelho', 'Knee', 0, 20, 0.5, 'dB'], ['ganho', 'Makeup', -6, 12, 0.5, 'dB'],
      ['ataque', 'Attack', 0.5, 50, 0.5, 'ms'], ['soltura', 'Release', 20, 800, 5, 'ms'], ['teto', 'Teto do limiter', -6, 0, 0.1, 'dB'],
      ['portao', 'Expansor abaixo de', -100, -20, 1, 'dB'], ['profundidade', 'Expansor: até', 0, 30, 1, 'dB']],
    escolha: ['detector', 'Detector', { pico: 'Pico (segue cada pico)', rms: 'RMS (volume médio, mais natural)' }],
    nota: 'Expansor em -100 = desligado. Ele abaixa pausas e respiração.',
  },
];
const TIPOS_EQ = { lowshelf: 'Low shelf', peaking: 'Bell', highshelf: 'High shelf', highpass: 'High-pass', lowpass: 'Low-pass', notch: 'Notch' };

const slider = (caminho, [chave, nome, min, max, passo, un], valor) => `
  <label class="lab-slider">
    <span>${nome}</span>
    <input type="range" data-ajuste="${caminho}.${chave}" min="${min}" max="${max}" step="${passo}" value="${valor}">
    <b>${valor}${un === ':1' ? ':1' : ' ' + un}</b>
  </label>`;

function renderAjustes() {
  $('#ajustes').innerHTML = CONTROLES.map((c) => {
    const a = ajustes[c.grupo];
    let corpo = '';
    if (c.bandas) {
      corpo = a.bandas.map((b, i) => `
        <div class="lab-banda">
          <select data-ajuste="eq.bandas.${i}.tipo">${Object.entries(TIPOS_EQ).map(([v, n]) => `<option value="${v}" ${v === b.tipo ? 'selected' : ''}>${n}</option>`).join('')}</select>
          ${slider(`eq.bandas.${i}`, ['freq', 'Freq', 20, 16000, 1, 'Hz'], b.freq)}
          ${slider(`eq.bandas.${i}`, ['ganho', 'Ganho', -12, 12, 0.5, 'dB'], b.ganho)}
          ${slider(`eq.bandas.${i}`, ['q', 'Q', 0.1, 8, 0.05, ''], b.q)}
        </div>`).join('');
    } else {
      const lista = c.desligado && !a[c.liga] ? c.desligado : c.itens;
      if (c.escolha) {
        const [k, nome, opcoes] = c.escolha;
        corpo += `<label class="lab-slider"><span>${nome}</span><select class="lab-escolha" data-ajuste="${c.grupo}.${k}">${Object.entries(opcoes).map(([v, n]) => `<option value="${v}" ${a[k] === v ? 'selected' : ''}>${n}</option>`).join('')}</select><b></b></label>`;
      }
      corpo += lista.map((it) => slider(c.grupo, it, a[it[0]])).join('');
    }
    return `<div class="lab-grupo ${a[c.liga] === false && !c.desligado ? 'desligado' : ''}">
      <div class="lab-grupo-topo">
        <b>${c.titulo}</b>
        <label class="alternador lab-mini"><input type="checkbox" data-ajuste="${c.grupo}.${c.liga}" ${a[c.liga] ? 'checked' : ''}><span class="trilha"></span><span>${c.ligaNome || 'Ligado'}</span></label>
      </div>
      ${c.nota ? `<small class="lab-nota">${c.nota}</small>` : ''}
      ${corpo}
    </div>`;
  }).join('');
}

let espera = null;
function aplicarAjuste(caminho, valor) {
  const partes = caminho.split('.');
  let o = ajustes;
  for (const p of partes.slice(0, -1)) o = o[p];
  o[partes.at(-1)] = valor;
  guardar('herald-lab-ajustes', JSON.stringify(ajustes));
  clearTimeout(espera);
  espera = setTimeout(() => { reprocessar(); aoVivo.reconstruir(); }, 250);
}

$('#ajustes').addEventListener('input', (e) => {
  const el = e.target.closest('[data-ajuste]');
  if (!el || el.type !== 'range') return;
  const un = el.nextElementSibling.textContent.replace(/^[-\d.]+/, '');
  el.nextElementSibling.textContent = el.value + un;
  aplicarAjuste(el.dataset.ajuste, Number(el.value));
});
$('#ajustes').addEventListener('change', (e) => {
  const el = e.target.closest('[data-ajuste]');
  if (!el || el.type === 'range') return;
  aplicarAjuste(el.dataset.ajuste, el.type === 'checkbox' ? el.checked : el.value);
  renderAjustes();
});

// ================= Gravar / importar =================

// A última gravação fica guardada (16-bit) pra não se perder ao recarregar
function guardarGravacao() {
  try {
    const d = gravacao.getChannelData(0);
    const pcm = new Int16Array(d.length);
    for (let i = 0; i < d.length; i++) pcm[i] = Math.max(-1, Math.min(1, d[i])) * 32767;
    let bin = '';
    const bytes = new Uint8Array(pcm.buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    localStorage.setItem('herald-lab-gravacao', btoa(bin));
  } catch {}
}
function carregarGravacao() {
  try {
    const b64 = localStorage.getItem('herald-lab-gravacao');
    if (!b64) return false;
    const bin = atob(b64);
    const pcm = new Int16Array(bin.length / 2);
    const bytes = new Uint8Array(pcm.buffer);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    gravacao = new AudioBuffer({ length: pcm.length, sampleRate: TAXA, numberOfChannels: 1 });
    gravacao.copyToChannel(Float32Array.from(pcm, (v) => v / 32767), 0);
    return true;
  } catch { return false; }
}

const seletorMic = criarSeletor($('#sel-mic'), { aoMudar: (id) => guardar('herald-mic', id) });
$('#chk-eco').checked = ler('herald-lab-eco') !== '0';
$('#chk-eco').onchange = (e) => guardar('herald-lab-eco', e.target.checked ? '1' : '0');
$('#chk-chrome').checked = ler('herald-lab-chrome') === '1';
$('#chk-chrome').onchange = (e) => {
  guardar('herald-lab-chrome', e.target.checked ? '1' : '0');
  status(e.target.checked ? 'Tratamento do Chrome ligado: grave de novo e use "Modo sólido".' : 'Tratamento do Chrome desligado: grave de novo pra comparar.');
};
$('#btn-solido').onclick = () => {
  ajustes = copia(SOLIDO);
  guardar('herald-lab-ajustes', JSON.stringify(ajustes));
  renderAjustes();
  reprocessar();
  aoVivo.reconstruir();
  if (!$('#chk-chrome').checked) status('Modo sólido carregado. Ligue "Tratamento do Chrome" e grave de novo pra ouvir de verdade.');
};

function capturarMic() {
  const id = ler('herald-mic');
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: id ? { exact: id } : undefined,
      echoCancellation: $('#chk-eco').checked || $('#chk-chrome').checked,
      noiseSuppression: $('#chk-chrome').checked, autoGainControl: $('#chk-chrome').checked,
      channelCount: 1, sampleRate: TAXA,
    },
  });
}

async function listarMics() {
  try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop()); } catch {}
  const lista = (await navigator.mediaDevices.enumerateDevices())
    .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications')
    .map((d) => ({ valor: d.deviceId, rotulo: d.label || 'Microfone' }));
  seletorMic.definir(lista, ler('herald-mic') || 'default');
}

$('#btn-gravar').onclick = async () => {
  const botao = $('#btn-gravar');
  botao.disabled = true;
  let stream;
  try { stream = await capturarMic(); } catch (err) { botao.disabled = false; return status('Não consegui abrir o microfone: ' + err.message); }
  const ctx = new AudioContext({ sampleRate: TAXA });
  await ctx.audioWorklet.addModule('dist/audio/gravador.js');

  const no = new AudioWorkletNode(ctx, 'gravador');
  const pedacos = [];
  no.port.onmessage = (e) => pedacos.push(e.data);
  ctx.createMediaStreamSource(stream).connect(no);
  const t0 = performance.now();
  const relogio = setInterval(() => {
    const s = Math.max(0, SEGUNDOS - (performance.now() - t0) / 1000);
    botao.textContent = `Gravando… ${s.toFixed(1)} s`;
  }, 100);
  status('Gravando — fale normal, como numa call.');
  await new Promise((r) => setTimeout(r, SEGUNDOS * 1000));
  clearInterval(relogio);
  stream.getTracks().forEach((t) => t.stop());
  await ctx.close();
  const total = pedacos.reduce((n, p) => n + p.length, 0);
  gravacao = new AudioBuffer({ length: total, sampleRate: TAXA, numberOfChannels: 1 });
  let pos = 0;
  for (const p of pedacos) { gravacao.copyToChannel(p, 0, pos); pos += p.length; }
  botao.textContent = 'Gravar de novo';
  botao.disabled = false;
  guardarGravacao();
  reprocessar();
};

$('#arquivo').onchange = async (e) => {
  const arquivo = e.target.files[0];
  e.target.value = '';
  if (!arquivo) return;
  const ctx = new AudioContext({ sampleRate: TAXA });
  const lido = await ctx.decodeAudioData(await arquivo.arrayBuffer());
  await ctx.close();
  // mixa pra mono (a cadeia do app é mono)
  gravacao = new AudioBuffer({ length: lido.length, sampleRate: TAXA, numberOfChannels: 1 });
  const mono = new Float32Array(lido.length);
  for (let c = 0; c < lido.numberOfChannels; c++) lido.getChannelData(c).forEach((v, i) => (mono[i] += v / lido.numberOfChannels));
  gravacao.copyToChannel(mono, 0);
  guardarGravacao();
  status(`Importado: ${arquivo.name}`);
  reprocessar();
};

// ================= Ouvir ao vivo =================

const aoVivo = (() => {
  let ctx = null, stream = null, cadeia = null, fonte = null;
  async function ligar() {
    ctx ??= new AudioContext({ sampleRate: TAXA, latencyHint: 'interactive' });
    await prepararContexto(ctx);
    stream = await capturarMic();
    fonte = ctx.createMediaStreamSource(stream);
    reconstruir();
  }
  function reconstruir() {
    if (!fonte) return;
    fonte.disconnect();
    cadeia?.saidas.final.disconnect();
    cadeia?.saidas.worker?.terminate();
    cadeia = montarCadeia(ctx, ajustes);
    fonte.connect(cadeia.entrada);
    cadeia.saidas.final.connect(ctx.destination);
  }
  function desligar() {
    fonte?.disconnect();
    cadeia?.saidas.final.disconnect();
    stream?.getTracks().forEach((t) => t.stop());
    fonte = stream = cadeia = null;
  }
  return { ligar, desligar, reconstruir };
})();
$('#chk-aovivo').onchange = (e) => (e.target.checked ? aoVivo.ligar() : aoVivo.desligar());

// ================= Exportar / copiar =================

function wav24(buffer) {
  const d = buffer.getChannelData(0);
  const bytes = new DataView(new ArrayBuffer(44 + d.length * 3));
  const txt = (o, s) => [...s].forEach((c, i) => bytes.setUint8(o + i, c.charCodeAt(0)));
  txt(0, 'RIFF'); bytes.setUint32(4, 36 + d.length * 3, true); txt(8, 'WAVE'); txt(12, 'fmt ');
  bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, 1, true);
  bytes.setUint32(24, TAXA, true); bytes.setUint32(28, TAXA * 3, true); bytes.setUint16(32, 3, true); bytes.setUint16(34, 24, true);
  txt(36, 'data'); bytes.setUint32(40, d.length * 3, true);
  for (let i = 0; i < d.length; i++) {
    const v = Math.round(Math.max(-1, Math.min(1, d[i])) * 8388607);
    bytes.setUint8(44 + i * 3, v & 255); bytes.setUint8(45 + i * 3, (v >> 8) & 255); bytes.setUint8(46 + i * 3, (v >> 16) & 255);
  }
  return new Uint8Array(bytes.buffer);
}

$('#btn-exportar').onclick = async () => {
  if (!resultado) return;
  const arquivos = ETAPAS.map((e, i) => ({ nome: `${i + 1} - ${e.nome}.wav`, dados: wav24(resultado[e.id]) }));
  arquivos.push({ nome: 'ajustes.json', dados: new TextEncoder().encode(JSON.stringify(ajustes, null, 2)) });
  const pasta = await window.herald.labSalvar(arquivos);
  status(`WAVs salvos em ${pasta}`);
};
$('#btn-pasta').onclick = () => window.herald.labAbrirPasta();
$('#btn-copiar').onclick = async () => {
  await navigator.clipboard.writeText(JSON.stringify(ajustes, null, 2));
  status('Ajustes copiados. Cole no chat pra eu aplicar no app.');
};
$('#btn-proposta').onclick = () => {
  ajustes = copia(PROPOSTA);
  guardar('herald-lab-ajustes', JSON.stringify(ajustes));
  renderAjustes();
  reprocessar();
  aoVivo.reconstruir();
  status('Proposta nova carregada. Compare com "Som de hoje".');
};
$('#btn-padrao').onclick = () => {
  ajustes = copia(PADRAO);
  guardar('herald-lab-ajustes', JSON.stringify(ajustes));
  renderAjustes();
  reprocessar();
  aoVivo.reconstruir();
};

// ================= Teclado e cliques =================

$('#etapas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-etapa]');
  if (b) escolherEtapa(b.dataset.etapa);
});
$('#btn-tocar').onclick = () => player.alternar();
$('#onda').addEventListener('click', (e) => {
  if (!resultado) return;
  const r = e.currentTarget.getBoundingClientRect();
  player.irPara(((e.clientX - r.left) / r.width) * player.duracao());
  desenharOnda();
});
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select')) return;
  const n = Number(e.key);
  if (n >= 1 && n <= ETAPAS.length) escolherEtapa(ETAPAS[n - 1].id);
  if (e.code === 'Space' && resultado) { e.preventDefault(); player.alternar(); }
});

// pra eu (Claude) ler os ajustes e as medidas direto pelo DevTools
window.__lab = { get ajustes() { return ajustes; }, get medidas() { return medidas; }, get espectros() { return espectros; }, get resultado() { return resultado; } };

$('#btn-tocar').innerHTML = icone('tocar');
renderEtapas();
renderAjustes();
desenharEspectro();
listarMics();
if (carregarGravacao()) {
  $('#btn-gravar').textContent = 'Gravar de novo';
  reprocessar();
}
