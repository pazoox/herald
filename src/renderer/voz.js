// Chamada de voz + tela de um canal de voz.
// As pessoas se encontram pelo Trystero (via nosso Supabase Realtime) usando o id do canal e o
// segredo do canal (voice_key, que só membros do Nest conseguem ler no banco).
// Voz e tela vão direto de PC pra PC (WebRTC).

import { joinRoom } from './sinal.js';
import { APP_ID } from './config.js';
import { criarColetor, nomeDoMic, eqComTom, EQ_PADRAO } from './calibracao.js';

const BITRATE_VOZ = 128_000;
export const QUALIDADES = {
  '1080p60': { w: 1920, h: 1080, fps: 60, bitrate: 8_000_000, hint: 'motion' },
  '1080p30': { w: 1920, h: 1080, fps: 30, bitrate: 6_000_000, hint: 'detail' },
  '720p60': { w: 1280, h: 720, fps: 60, bitrate: 4_000_000, hint: 'motion' },
};
const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];

// ================= Estado público =================

export const voz = {
  canalId: null,
  conectado: false,
  mudo: false,
  surdo: false,
  aoVivo: false,
  // peerId -> { peerId, userId, mudo, surdo, aoVivo, audioEl, volume, assistindo, telaStream, ping, estadoConexao }
  participantes: new Map(),
  espectadores: new Set(), // peerIds assistindo minha tela
  telaStream: null,
  micStream: null,
};

const ouvintes = new Set();
export function aoMudar(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}
function avisar(tipo, dados) {
  for (const fn of ouvintes) fn(tipo, dados);
}

let sala = null;
const preferenciasTela = new Map(); // peerId -> { baixa } (quem assiste minha tela)
const conexoesViaApoio = new WeakSet(); // conexões que passam pelo TURN
let acoes = {};
let perfil = null; // { userId }
let micTrack = null;
let telaQualidade = null;
let audioCtx = null;
let saidaId = ler('herald-saida') || '';
const analisadores = new Map(); // 'eu' | peerId -> AnalyserNode

function guardar(k, v) { try { localStorage.setItem(k, v); } catch {} }
function ler(k) { try { return localStorage.getItem(k); } catch { return null; } }

// ================= Qualidade (SDP) =================

function ajustarSdp(sdp) {
  const linhas = sdp.split('\r\n');
  const extras = {};
  for (const l of linhas) {
    let m = l.match(/^a=rtpmap:(\d+) opus\/48000/i);
    if (m) {
      extras[m[1]] = {
        minptime: '10', useinbandfec: '1', usedtx: '0',
        stereo: '1', 'sprop-stereo': '1', maxaveragebitrate: String(BITRATE_VOZ),
      };
    }
    m = l.match(/^a=rtpmap:(\d+) (H264|VP8|VP9|AV1)\/90000/i);
    if (m) extras[m[1]] = { 'x-google-start-bitrate': '4000', 'x-google-max-bitrate': '12000' };
  }
  const comFmtp = new Set();
  const ajustadas = linhas.map((l) => {
    const m = l.match(/^a=fmtp:(\d+) (.*)$/);
    if (!m || !extras[m[1]]) return l;
    comFmtp.add(m[1]);
    const params = new Map(m[2].split(';').map((kv) => kv.trim().split('=')));
    for (const [k, v] of Object.entries(extras[m[1]])) params.set(k, v);
    return `a=fmtp:${m[1]} ${[...params].map(([k, v]) => (v === undefined ? k : `${k}=${v}`)).join(';')}`;
  });
  const final = [];
  for (const l of ajustadas) {
    final.push(l);
    const m = l.match(/^a=rtpmap:(\d+) /);
    if (m && extras[m[1]] && !comFmtp.has(m[1])) {
      final.push(`a=fmtp:${m[1]} ${Object.entries(extras[m[1]]).map(([k, v]) => `${k}=${v}`).join(';')}`);
    }
  }
  return final.join('\r\n');
}

// H264 costuma ter codificação pela placa de vídeo => 1080p60 sem pesar a CPU
function preferirCodec(transceiver) {
  if (!transceiver?.setCodecPreferences || !RTCRtpReceiver.getCapabilities) return;
  const ordem = ['video/H264', 'video/VP9', 'video/VP8', 'video/AV1'];
  const peso = (c) => (ordem.includes(c.mimeType) ? ordem.indexOf(c.mimeType) : ordem.length);
  const codecs = [...RTCRtpReceiver.getCapabilities('video').codecs].sort((a, b) => peso(a) - peso(b));
  try { transceiver.setCodecPreferences(codecs); } catch {}
}

async function aplicarParametros(pc) {
  for (const sender of pc.getSenders()) {
    const track = sender.track;
    if (!track) continue;
    const params = sender.getParameters();
    if (!params.encodings?.length) continue;
    const enc = params.encodings[0];
    const ehTela = voz.telaStream?.getTracks().includes(track);
    if (track.kind === 'audio' && !ehTela) {
      enc.maxBitrate = BITRATE_VOZ;
      enc.priority = 'high';
      enc.networkPriority = 'high';
    } else if (track.kind === 'video' && telaQualidade) {
      // quem pediu "qualidade menor" (internet fraca) recebe 720p30 mais leve
      const peerId = Object.entries(sala?.getPeers() || {}).find(([, c]) => c === pc)?.[0];
      const baixa = preferenciasTela.get(peerId)?.baixa;
      // passando pelo servidor de apoio, tela mais leve (4 Mbps) pra poupar o limite da Cloudflare
      const teto = conexoesViaApoio.has(pc) ? Math.min(4_000_000, telaQualidade.bitrate) : telaQualidade.bitrate;
      enc.maxBitrate = baixa ? 2_500_000 : teto;
      enc.maxFramerate = baixa ? 30 : telaQualidade.fps;
      enc.scaleResolutionDownBy = baixa ? Math.max(1, telaQualidade.h / 720) : 1;
    } else {
      continue;
    }
    try { await sender.setParameters(params); } catch {}
  }
}

// O Trystero cria as conexões; esta subclasse ajusta cada uma pra qualidade máxima
class Conexao extends RTCPeerConnection {
  constructor(config) {
    super({ ...config, bundlePolicy: 'max-bundle' });
    this.addEventListener('signalingstatechange', () => {
      if (this.signalingState === 'stable') aplicarParametros(this);
    });
  }
  async setLocalDescription(desc) {
    if (desc?.type === 'rollback') return super.setLocalDescription(desc);
    if (!desc?.sdp) {
      const responder = this.signalingState === 'have-remote-offer' || this.signalingState === 'have-local-pranswer';
      desc = responder ? await this.createAnswer() : await this.createOffer();
    }
    return super.setLocalDescription({ type: desc.type, sdp: ajustarSdp(desc.sdp) });
  }
  setRemoteDescription(desc) {
    if (desc?.sdp) desc = { type: desc.type, sdp: ajustarSdp(desc.sdp) };
    return super.setRemoteDescription(desc);
  }
  addTrack(track, ...streams) {
    const sender = super.addTrack(track, ...streams);
    if (track.kind === 'video') preferirCodec(this.getTransceivers().find((t) => t.sender === sender));
    return sender;
  }
}

// ================= Microfone =================

export function contextoAudio() {
  return contexto();
}

function contexto() {
  if (!audioCtx) audioCtx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// ================= Tratamento do microfone =================
//
// "Modo sólido" (escolhido no Audio Lab, out/2026):
// microfone já tratado pelo Chrome (WebRTC, o mesmo do Google Meet: ruído constante + volume
//   automático) → corta graves → PORTEIRO de ruído (a IA DeepFilterNet3, num Worker, só decide
//   se tem voz; o som passa intacto e é abaixado nas pausas — some estalo, teclado, batida)
//   → EQ (o da calibração da pessoa, por microfone) → limitador com antecipação (nunca clipa)
//
// O que sai daqui é sempre a mesma trilha: trocar microfone ou opção não
// interrompe a chamada (só a entrada da cadeia muda).
//
// Empilhar etapas nossas (IA filtrando + volume + compressor + expansor) soava picado.

const PADRAO_AUDIO = { ruido: true, forca: 'forte', auto: true, ganho: 0, eco: true };
export const audio = { ...PADRAO_AUDIO, ...lerJson('herald-audio'), ganhoAuto: 0 };
// só o limitador de segurança (o volume já vem certo do Chrome)
const DINAMICA = { comprimir: false, ganho: 0, teto: -1, portao: -100 };
// Porteiro: Strong = ajuste do Pazi no Audio Lab (limpa tudo nas pausas); Natural = mais folgado (protege voz baixinha)
const PORTEIRO = {
  forte: { sensibilidade: 25, fundo: 40, segurar: 60 },
  natural: { sensibilidade: 32, fundo: 28, segurar: 180 },
};
const SEGUNDOS_AUTO = 40; // de voz, pra calibrar sozinho durante a call

function lerJson(k) {
  try { return JSON.parse(ler(k)) || {}; } catch { return {}; }
}

let cadeia = null;
let entradaStream = null;
let fonte = null;
let entradaDispositivo = null;

// Calibração: perfil do microfone atual + coleta da voz
const calib = {
  mic: null, // nome do mic ("Fifine Microphone")
  perfil: null, // EQ calibrado (null = ainda não calibrou)
  coletor: null,
  modo: null, // 'auto' | 'manual'
  armazenamento: null, // { ler(mic), gravar(mic, perfil), apagar(mic) } — vem do app (Supabase)
};

async function montarCadeia() {
  if (cadeia) return cadeia;
  const ctx = contexto();
  await Promise.all(['ia-ponte', 'dinamica', 'gravador'].map((m) => ctx.audioWorklet.addModule(`dist/audio/${m}.js`)));
  const bytes = await fetch('dist/audio/deepfilter.wasm').then((r) => r.arrayBuffer());
  const modulo = await WebAssembly.compile(bytes);

  const graves = new BiquadFilterNode(ctx, { type: 'highpass', frequency: EQ_PADRAO.graves, Q: 0.7 });
  // A IA roda num Worker (fora do processador de áudio): rodando direto nele ela às vezes
  // passava do tempo e o som "picava". A ponte segura ~20 ms de folga.
  const ruido = new AudioWorkletNode(ctx, 'ia-ponte', { channelCount: 1, channelCountMode: 'explicit' });
  const iaWorker = new Worker('dist/audio/ia-worker.js');
  const canalIA = new MessageChannel();
  iaWorker.postMessage({ tipo: 'iniciar', wasmModule: modulo, limite: 100, modo: 'porteiro', porteiro: PORTEIRO.forte }, [canalIA.port2]);
  ruido.port.postMessage({ tipo: 'porta' }, [canalIA.port1]);
  const manual = new GainNode(ctx); // volume manual (com o automático do Chrome ligado fica em 0 dB)
  // EQ de 5 bandas (valores vêm do perfil calibrado do microfone)
  const eq = EQ_PADRAO.bandas.map((b) => new BiquadFilterNode(ctx, { type: b.tipo, frequency: b.freq, gain: b.ganho, Q: b.q }));
  for (let i = 0; i < eq.length - 1; i++) eq[i].connect(eq[i + 1]);
  const dinamica = new AudioWorkletNode(ctx, 'dinamica', { channelCount: 1, channelCountMode: 'explicit', processorOptions: DINAMICA });
  const destino = ctx.createMediaStreamDestination();
  const medidor = new AnalyserNode(ctx, { fftSize: 512 });
  // escuta a voz depois da IA (só enquanto calibra)
  const escuta = new AudioWorkletNode(ctx, 'gravador', { channelCount: 1, channelCountMode: 'explicit' });
  escuta.port.onmessage = (e) => coletar(e.data);

  eq.at(-1).connect(dinamica).connect(destino);
  dinamica.connect(medidor);

  cadeia = { ctx, graves, ruido, iaWorker, manual, timbre: eq[0], eq, destino, medidor, escuta };
  ligarCadeia();

  micTrack = destino.stream.getAudioTracks()[0];
  micTrack.contentHint = 'speech';
  micTrack.enabled = !voz.mudo;
  voz.micStream = destino.stream;
  analisadores.set('eu', medidor);
  return cadeia;
}

// Liga os blocos conforme as opções (sem recapturar o microfone)
function ligarCadeia() {
  const { graves, ruido, iaWorker, manual, timbre } = cadeia;
  for (const no of [graves, ruido, manual]) no.disconnect();
  // IA ligada = porteiro (Strong/Natural); desligada = som passa direto
  iaWorker.postMessage({ type: 'setEnabled', value: audio.ruido });
  iaWorker.postMessage({ type: 'modo', value: audio.ruido ? 'porteiro' : 'filtro' });
  iaWorker.postMessage({ type: 'porteiro', value: PORTEIRO[audio.forca] || PORTEIRO.forte });
  manual.gain.value = audio.auto ? 1 : 10 ** (audio.ganho / 20);
  graves.connect(ruido).connect(manual).connect(timbre);
  if (calib.coletor) ruido.connect(cadeia.escuta);
  if (fonte) fonte.connect(graves);
}

// Põe um EQ na cadeia (devagar = troca suave, em alguns segundos, pra ninguém perceber)
function aplicarEq(eq, devagar = false) {
  if (!cadeia) return;
  const t = cadeia.ctx.currentTime;
  const tempo = devagar ? 2 : 0.05;
  cadeia.graves.frequency.setTargetAtTime(eq.graves, t, tempo);
  eq.bandas.forEach((b, i) => {
    const no = cadeia.eq[i];
    no.frequency.setTargetAtTime(b.freq, t, tempo);
    no.gain.setTargetAtTime(b.ganho, t, tempo);
    no.Q.setTargetAtTime(b.q, t, tempo);
  });
}

function eqDoPerfil(perfil) {
  return perfil ? eqComTom(perfil, perfil.tom || 0) : EQ_PADRAO;
}

// ---- coleta da voz pra calibrar ----

function iniciarColeta(modo) {
  if (!cadeia) return;
  calib.coletor = criarColetor();
  calib.modo = modo;
  cadeia.ruido.connect(cadeia.escuta);
  avisar('calibracao');
}

function pararColeta() {
  if (cadeia && calib.coletor) {
    try { cadeia.ruido.disconnect(cadeia.escuta); } catch {}
  }
  calib.coletor = null;
  calib.modo = null;
  avisar('calibracao');
}

function coletar(pedaco) {
  const c = calib.coletor;
  if (!c) return;
  // no automático só conta voz de verdade na call (mutado pode estar falando com alguém na sala)
  if (calib.modo === 'auto' && (!voz.conectado || voz.mudo)) return;
  c.adicionar(pedaco);
  if (calib.modo === 'auto' && c.segundos >= SEGUNDOS_AUTO) concluirAuto();
}

async function concluirAuto() {
  const c = calib.coletor;
  const perfil = c.calcular();
  calib.ultimaAmostra = c.amostra();
  pararColeta();
  if (!perfil) return;
  await salvarPerfil(perfil, true);
  avisar('calibrado', { mic: calib.mic });
}

// Carrega o perfil do microfone; sem perfil, calibra sozinho na próxima call
async function carregarPerfilDoMic(rotulo) {
  const mic = nomeDoMic(rotulo);
  if (mic === calib.mic && calib.perfil !== undefined) return;
  calib.mic = mic;
  calib.perfil = undefined;
  let perfil = lerJson('herald-voz-' + mic).perfil || null;
  try { perfil = (await calib.armazenamento?.ler(mic)) ?? perfil; } catch {}
  if (calib.mic !== mic) return; // trocou de mic no meio
  calib.perfil = perfil;
  aplicarEq(eqDoPerfil(perfil));
  if (!perfil && calib.armazenamento && !calib.coletor) iniciarColeta('auto');
  if (perfil && calib.modo === 'auto') pararColeta();
  avisar('calibracao');
}

export async function salvarPerfil(perfil, devagar = false) {
  calib.perfil = perfil;
  aplicarEq(eqDoPerfil(perfil), devagar);
  guardar('herald-voz-' + calib.mic, JSON.stringify({ perfil }));
  try { await calib.armazenamento?.gravar(calib.mic, perfil); } catch {}
  avisar('calibracao');
}

export function definirArmazenamentoVoz(armazenamento) {
  calib.armazenamento = armazenamento;
  if (entradaStream) carregarPerfilDoMic(entradaStream.getAudioTracks()[0]?.label || '');
}

export function estadoCalibracao() {
  return {
    mic: calib.mic,
    perfil: calib.perfil || null,
    coletando: calib.modo,
    segundos: calib.coletor ? Math.round(calib.coletor.segundos) : 0,
    alvo: calib.modo === 'auto' ? SEGUNDOS_AUTO : 10,
    temAmostra: Boolean(calib.ultimaAmostra?.length),
  };
}

// "Calibrar agora" (Settings): junta `segundos` de voz e devolve o perfil (sem salvar ainda)
export function calibrarAgora(segundos, aoProgresso) {
  return new Promise((pronto) => {
    iniciarColeta('manual');
    const c = calib.coletor;
    const relogio = setInterval(() => {
      if (calib.coletor !== c) {
        clearInterval(relogio);
        return pronto(null);
      }
      aoProgresso?.(Math.min(1, c.segundos / segundos));
      if (c.segundos >= segundos) {
        clearInterval(relogio);
        const perfil = c.calcular();
        calib.ultimaAmostra = c.amostra();
        pararColeta();
        pronto(perfil);
      }
    }, 100);
  });
}
export function cancelarCalibracao() {
  if (calib.modo === 'manual') pararColeta();
}

export async function apagarPerfil() {
  calib.perfil = null;
  aplicarEq(EQ_PADRAO, true);
  try { localStorage.removeItem('herald-voz-' + calib.mic); } catch {}
  try { await calib.armazenamento?.apagar(calib.mic); } catch {}
  avisar('calibracao');
}

// Antes/depois: passa o trecho guardado pela cadeia (sem a IA, que já foi aplicada nele)
// com o EQ padrão e com o EQ do perfil. Devolve dois AudioBuffers pra tocar.
export async function previaCalibracao(perfil) {
  const amostra = calib.ultimaAmostra;
  if (!amostra?.length) return null;
  const renderizar = async (eq) => {
    const ctx = new OfflineAudioContext(1, amostra.length, 48000);
    await ctx.audioWorklet.addModule('dist/audio/dinamica.js');
    const buf = new AudioBuffer({ length: amostra.length, sampleRate: 48000, numberOfChannels: 1 });
    buf.copyToChannel(amostra, 0);
    const src = new AudioBufferSourceNode(ctx, { buffer: buf });
    let atual = src.connect(new BiquadFilterNode(ctx, { type: 'highpass', frequency: eq.graves, Q: 0.7 }));
    for (const b of eq.bandas) atual = atual.connect(new BiquadFilterNode(ctx, { type: b.tipo, frequency: b.freq, gain: b.ganho, Q: b.q }));
    atual.connect(new AudioWorkletNode(ctx, 'dinamica', { channelCount: 1, channelCountMode: 'explicit', processorOptions: DINAMICA })).connect(ctx.destination);
    src.start();
    return ctx.startRendering();
  };
  return { antes: await renderizar(EQ_PADRAO), depois: await renderizar(eqDoPerfil(perfil)) };
}

export function configurarAudio(mudancas) {
  // eco e volume automático são do Chrome: mudam na captura do microfone
  const precisaRecapturar = ('eco' in mudancas && mudancas.eco !== audio.eco) || ('auto' in mudancas && mudancas.auto !== audio.auto);
  Object.assign(audio, mudancas);
  guardar('herald-audio', JSON.stringify({ ruido: audio.ruido, forca: audio.forca, auto: audio.auto, ganho: audio.ganho, eco: audio.eco }));
  if (!cadeia) return;
  if (precisaRecapturar) abrirMicrofone(entradaDispositivo || '');
  else ligarCadeia();
}

export async function abrirMicrofone(deviceId = ler('herald-mic') || '') {
  await montarCadeia();
  const novo = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      // Tratamento do Chrome (WebRTC): ruído constante + volume automático; eco opcional
      // (com fone fica melhor desligado). Estalo/teclado quem tira é o porteiro.
      echoCancellation: audio.eco,
      noiseSuppression: true,
      autoGainControl: audio.auto,
      channelCount: 1,
      sampleRate: 48000,
    },
  });
  fonte?.disconnect();
  entradaStream?.getTracks().forEach((t) => t.stop());
  entradaStream = novo;
  entradaDispositivo = novo.getAudioTracks()[0].getSettings().deviceId || deviceId;
  fonte = cadeia.ctx.createMediaStreamSource(novo);
  fonte.connect(cadeia.graves);
  if (deviceId) guardar('herald-mic', deviceId);
  carregarPerfilDoMic(novo.getAudioTracks()[0].label || '');
  return voz.micStream;
}
export function microfoneAtual() {
  return entradaDispositivo || '';
}

// ================= Entrar / sair =================

// turn: servidores de apoio (Cloudflare) vindos do Supabase. Com "esconder IP" ligado e
// TURN disponível, tudo passa pelo apoio (iceTransportPolicy 'relay') e ninguém vê seu IP.
export function esconderIp() {
  // Desligado por padrão: o apoio custa banda (limite grátis da Cloudflare);
  // sem isso ele só entra quando a conexão direta falha.
  return ler('herald-esconder-ip') === '1';
}
export function definirEsconderIp(ligado) {
  guardar('herald-esconder-ip', ligado ? '1' : '0');
}
export const rede = { viaApoio: false };

export async function entrar({ canalId, chave, userId, turn = [], sinal }) {
  if (voz.canalId === canalId) return;
  if (sala) await sair();
  perfil = { userId };
  contexto();
  if (!micTrack) await abrirMicrofone();

  voz.canalId = canalId;
  voz.conectado = true;
  ligarSala(canalId, chave, turn, sinal);
  tocarSom('entrou');
  avisar('conexao');
}

// A senha da call mudou (alguém saiu ou foi expulso do Nest): troca pra sala nova
// sem desligar o microfone nem a sua transmissão. Quem saiu fica sozinho na sala velha.
let chaveAtual = null;
let conexaoAtual = null; // { turn, sinal }
let silencioAte = 0; // sem os sons de entrar enquanto a galera volta pra sala nova
export async function trocarChave(chave) {
  if (!sala || !chave || chave === chaveAtual) return;
  const velha = sala;
  sala = null;
  acoes = {};
  for (const p of voz.participantes.values()) {
    if (p.audioEl) p.audioEl.srcObject = null;
    soltarVoz(p);
  }
  voz.participantes.clear();
  voz.espectadores.clear();
  preferenciasTela.clear();
  for (const id of [...analisadores.keys()]) if (id !== 'eu') analisadores.delete(id);
  silencioAte = Date.now() + 6000;
  await velha.leave();
  ligarSala(voz.canalId, chave, conexaoAtual.turn, conexaoAtual.sinal);
  avisar('participantes');
}

function ligarSala(canalId, chave, turn, sinal) {
  chaveAtual = chave;
  conexaoAtual = { turn, sinal };
  rede.viaApoio = esconderIp() && turn.length > 0;
  const rtcConfig = { iceServers: [...ICE, ...turn], iceTransportPolicy: rede.viaApoio ? 'relay' : 'all' };
  sala = joinRoom(sinal, { appId: APP_ID, password: chave, rtcConfig, rtcPolyfill: Conexao }, canalId);

  acoes.estado = sala.makeAction('estado');
  acoes.assistir = sala.makeAction('assistir');
  acoes.roleta = sala.makeAction('roleta');
  acoes.roleta.onMessage = (dados, { peerId }) => avisar('roleta', { ...dados, de: voz.participantes.get(peerId)?.userId });
  acoes.radio = sala.makeAction('radio');
  acoes.radio.onMessage = (dados, { peerId }) => avisar('radio', { estado: dados, de: voz.participantes.get(peerId)?.userId });

  sala.onPeerJoin = (id) => {
    voz.participantes.set(id, {
      peerId: id, userId: null, mudo: false, surdo: false, aoVivo: false,
      audioEl: null, volume: 1, assistindo: false, telaStream: null, ping: null, estadoConexao: 'new',
    });
    sala.addTrack(micTrack, voz.micStream, { target: id, metadata: { tipo: 'mic' } });
    acoes.estado.send(estadoAtual(), { target: id });
    avisar('chegou', id); // o Rádio manda a fila atual pra quem chegou
    if (Date.now() > silencioAte) tocarSom('entrou');
    avisar('participantes');
  };

  sala.onPeerLeave = (id) => {
    const p = voz.participantes.get(id);
    if (!p) return;
    if (p.audioEl) p.audioEl.srcObject = null;
    soltarVoz(p);
    analisadores.delete(id);
    voz.espectadores.delete(id);
    preferenciasTela.delete(id);
    voz.participantes.delete(id);
    tocarSom('saiu');
    avisar('participantes');
  };

  sala.onPeerTrack = (track, stream, id, metadata) => {
    const p = voz.participantes.get(id);
    if (!p) return;
    if (metadata?.tipo === 'tela') {
      // junta vídeo e som da tela num stream só, mesmo se chegarem separados
      if (!p.telaStream || p.telaStream.getTracks().every((t) => t.readyState === 'ended')) p.telaStream = new MediaStream();
      for (const t of p.telaStream.getTracks()) if (t.kind === track.kind && t !== track) p.telaStream.removeTrack(t);
      if (!p.telaStream.getTracks().includes(track)) p.telaStream.addTrack(track);
      avisar('participantes');
      return;
    }
    if (track.kind !== 'audio') return;
    // o elemento de áudio fica mudo: ele só mantém a voz chegando (o Chrome precisa disso);
    // quem toca é o mixer, que deixa subir cada pessoa além de 100%
    if (!p.audioEl) {
      p.audioEl = new Audio();
      p.audioEl.autoplay = true;
      p.audioEl.muted = true;
    }
    p.audioEl.srcObject = stream;
    p.audioEl.play().catch(() => {});
    ligarVozNoMixer(p, stream);
    aplicarMudoDe(p);
    monitorarFala(id, stream);
  };

  acoes.estado.onMessage = (dados, { peerId }) => {
    const p = voz.participantes.get(peerId);
    if (!p) return;
    const novoUser = !p.userId && dados.userId;
    p.userId = String(dados.userId || '');
    p.mudo = Boolean(dados.mudo);
    p.surdo = Boolean(dados.surdo);
    p.aoVivo = Boolean(dados.aoVivo);
    if (novoUser) {
      p.volume = Number(ler('herald-vol-' + p.userId) ?? 1);
      aplicarMudoDe(p);
    }
    if (!p.aoVivo) {
      p.assistindo = false;
      p.telaStream = null;
    }
    avisar('participantes');
  };

  acoes.assistir.onMessage = (dados, { peerId }) => {
    if (!dados.quer) {
      preferenciasTela.delete(peerId);
      return pararTelaPara(peerId);
    }
    preferenciasTela.set(peerId, { baixa: Boolean(dados.baixa) });
    if (voz.espectadores.has(peerId)) {
      const pc = sala.getPeers()[peerId];
      if (pc) aplicarParametros(pc);
    } else {
      enviarTelaPara(peerId);
    }
  };
}

export async function sair() {
  if (!sala) return;
  if (voz.telaStream) pararTela();
  for (const p of voz.participantes.values()) {
    if (p.audioEl) p.audioEl.srcObject = null;
    soltarVoz(p);
  }
  const s = sala;
  sala = null;
  acoes = {};
  chaveAtual = null;
  voz.participantes.clear();
  voz.espectadores.clear();
  preferenciasTela.clear();
  voz.canalId = null;
  voz.conectado = false;
  voz.rede = null;
  voz.transmissao = null;
  for (const id of [...analisadores.keys()]) if (id !== 'eu') analisadores.delete(id);
  tocarSom('saiu');
  avisar('conexao');
  await s.leave();
}

function estadoAtual() {
  return { userId: perfil?.userId, mudo: voz.mudo, surdo: voz.surdo, aoVivo: voz.aoVivo };
}
function anunciarEstado() {
  acoes.estado?.send(estadoAtual());
  avisar('eu');
}

// ================= Mudo / surdo / volume =================

function aplicarSilencio() {
  if (micTrack) micTrack.enabled = !voz.mudo;
  for (const p of voz.participantes.values()) aplicarMudoDe(p);
  anunciarEstado();
}

export function alternarMudo() {
  voz.mudo = !voz.mudo;
  if (!voz.mudo) voz.surdo = false;
  tocarSom(voz.mudo ? 'mudo' : 'desmudo');
  aplicarSilencio();
}

export function alternarSurdo() {
  voz.surdo = !voz.surdo;
  voz.mudo = voz.surdo;
  tocarSom(voz.surdo ? 'mudo' : 'desmudo');
  aplicarSilencio();
}

export function definirVolume(userId, volume) {
  guardar('herald-vol-' + userId, volume);
  for (const p of voz.participantes.values()) {
    if (p.userId !== userId) continue;
    p.volume = volume;
    aplicarMudoDe(p);
  }
}

// Mutar alguém só pra mim (os outros continuam ouvindo)
export function mudoLocal(userId) {
  return ler('herald-mudo-' + userId) === '1';
}
export function definirMudoLocal(userId, mudo) {
  guardar('herald-mudo-' + userId, mudo ? '1' : '0');
  for (const p of voz.participantes.values()) if (p.userId === userId) aplicarMudoDe(p);
  avisar('participantes');
}
function aplicarMudoDe(p) {
  const mudo = voz.surdo || (p.userId && mudoLocal(p.userId));
  if (p.ganhoVoz) p.ganhoVoz.gain.setTargetAtTime(mudo ? 0 : p.volume, p.ganhoVoz.context.currentTime, 0.02);
}

// ---- Mixer das vozes ----
// Cada voz passa por um ganho próprio (0 a 200%) e todas juntas por um limitador no fim:
// dá pra subir quem fala baixo sem estourar, mesmo com todo mundo falando ao mesmo tempo.
let mixer = null;
function mixerVozes() {
  if (mixer) return mixer;
  const ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
  const mestre = new GainNode(ctx);
  const limitador = new DynamicsCompressorNode(ctx, { threshold: -6, knee: 4, ratio: 20, attack: 0.002, release: 0.12 });
  mestre.connect(limitador).connect(ctx.destination);
  if (saidaId && saidaId !== 'default') ctx.setSinkId?.(saidaId).catch(() => {});
  mixer = { ctx, mestre };
  return mixer;
}
function ligarVozNoMixer(p, stream) {
  const m = mixerVozes();
  if (m.ctx.state === 'suspended') m.ctx.resume();
  p.fonteVoz?.disconnect();
  p.fonteVoz = m.ctx.createMediaStreamSource(stream);
  if (!p.ganhoVoz) {
    p.ganhoVoz = new GainNode(m.ctx, { gain: 0 });
    p.ganhoVoz.connect(m.mestre);
  }
  p.fonteVoz.connect(p.ganhoVoz);
}
// ---- Som das transmissões (também passa pelo mixer: até 200% e mutar) ----
const sonsTela = new Map(); // userId -> { faixa, fonte, ganho }

function ganhoTela(userId) {
  return ler('herald-mudo-tela-' + userId) === '1' ? 0 : volumeTelaDe(userId);
}
export function volumeTelaDe(userId) {
  return Number(ler('herald-vol-tela-' + userId) ?? 1);
}
export function mudoTela(userId) {
  return ler('herald-mudo-tela-' + userId) === '1';
}
// liga o som da transmissão de alguém no mixer (o <video> fica mudo, só mantendo o som chegando)
export function tocarSomTela(userId, stream) {
  const faixa = stream?.getAudioTracks()[0];
  const atual = sonsTela.get(userId);
  if (atual?.faixa === faixa) return;
  pararSomTela(userId);
  if (!faixa) return;
  const m = mixerVozes();
  if (m.ctx.state === 'suspended') m.ctx.resume();
  const fonte = m.ctx.createMediaStreamSource(new MediaStream([faixa]));
  const ganho = new GainNode(m.ctx, { gain: ganhoTela(userId) });
  fonte.connect(ganho).connect(m.mestre);
  sonsTela.set(userId, { faixa, fonte, ganho });
}
export function pararSomTela(userId) {
  const s = sonsTela.get(userId);
  if (!s) return;
  s.fonte.disconnect();
  s.ganho.disconnect();
  sonsTela.delete(userId);
}
// para o som de transmissões que não estão mais na tela
export function manterSonsTela(userIds) {
  for (const id of [...sonsTela.keys()]) if (!userIds.has(id)) pararSomTela(id);
}
function aplicarSomTela(userId) {
  const s = sonsTela.get(userId);
  if (s) s.ganho.gain.setTargetAtTime(ganhoTela(userId), s.ganho.context.currentTime, 0.02);
}
export function definirVolumeTela(userId, volume) {
  guardar('herald-vol-tela-' + userId, volume);
  aplicarSomTela(userId);
}
export function definirMudoTela(userId, mudo) {
  guardar('herald-mudo-tela-' + userId, mudo ? '1' : '0');
  aplicarSomTela(userId);
}

// A minha transmissão: liga/desliga o som do PC que estou mandando (sem parar de transmitir)
export function temSomNaMinhaTela() {
  return Boolean(voz.telaStream?.getAudioTracks().length);
}
export function somDaMinhaTelaLigado() {
  return Boolean(voz.telaStream?.getAudioTracks()[0]?.enabled);
}
export function ligarSomDaMinhaTela(ligado) {
  for (const t of voz.telaStream?.getAudioTracks() || []) t.enabled = ligado;
}

function soltarVoz(p) {
  p.fonteVoz?.disconnect();
  p.ganhoVoz?.disconnect();
  p.fonteVoz = null;
  p.ganhoVoz = null;
}

export function volumeDe(userId) {
  return Number(ler('herald-vol-' + userId) ?? 1);
}

export function definirSaida(deviceId) {
  saidaId = deviceId;
  guardar('herald-saida', deviceId);
  mixer?.ctx.setSinkId?.(deviceId === 'default' ? '' : deviceId).catch(() => {});
  testeAudio?.setSinkId?.(deviceId).catch(() => {});
  // o som das telas também sai no dispositivo escolhido
  for (const v of document.querySelectorAll('video[data-remoto]')) v.setSinkId?.(deviceId).catch(() => {});
}

export function saidaAtual() {
  return saidaId;
}

// ================= Tela =================

// Som só da janela: o processo principal captura o programa dono da janela e manda os
// pedaços de som; aqui eles viram uma trilha de áudio normal (que vai junto com a tela)
let somJanela = null; // { ctx, trilha }
let ouvindoJanela = false;
async function trilhaDaJanela(fonteId) {
  const r = await window.herald.audioJanela?.iniciar(fonteId);
  if (!r?.ok) return null;
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule('dist/audio/janela-som.js');
  const no = new AudioWorkletNode(ctx, 'janela-som', { numberOfInputs: 0, outputChannelCount: [2] });
  const destino = ctx.createMediaStreamDestination();
  destino.channelCount = 2;
  no.connect(destino);
  somJanela = { ctx, no, trilha: destino.stream.getAudioTracks()[0] };
  if (!ouvindoJanela) {
    ouvindoJanela = true;
    window.herald.audioJanela.aoDados((pedaco) => somJanela?.no.port.postMessage(pedaco));
  }
  return somJanela.trilha;
}
function pararSomJanela() {
  if (!somJanela) return;
  window.herald.audioJanela?.parar();
  somJanela.trilha.stop();
  somJanela.ctx.close();
  somJanela = null;
}

// comAudio: manda som junto. Numa janela (window:…), soDaJanela = só o som daquela janela.
// Se a captura da janela falhar (Windows antigo etc.), cai pro som do PC.
export async function iniciarTela(fonteId, qualidadeId, comAudio, soDaJanela = false) {
  const q = QUALIDADES[qualidadeId] || QUALIDADES['1080p60'];
  let trilhaJanela = null;
  if (comAudio && soDaJanela && String(fonteId).startsWith('window:')) {
    trilhaJanela = await trilhaDaJanela(fonteId).catch(() => null);
    if (!trilhaJanela) avisar('aviso-tela', 'janela-sem-som');
  }
  const usarSomDoPc = comAudio && !trilhaJanela;
  await window.herald.escolherFonte(fonteId, usarSomDoPc);
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: q.w, max: q.w },
        height: { ideal: q.h, max: q.h },
        frameRate: { ideal: q.fps, max: q.fps },
      },
      // som do PC "cru" (os filtros de voz estragam música/jogo) e sem o som
      // do próprio Herald, pra voz da galera não voltar pra eles
      audio: usarSomDoPc && {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
        restrictOwnAudio: true,
      },
    });
  } catch (err) {
    console.error(err);
    pararSomJanela();
    return false;
  }
  if (trilhaJanela) stream.addTrack(trilhaJanela);
  voz.telaStream = stream;
  telaQualidade = q;
  const video = stream.getVideoTracks()[0];
  video.contentHint = q.hint; // 'motion' prioriza fluidez, 'detail' prioriza nitidez
  video.onended = pararTela;
  voz.aoVivo = true;
  anunciarEstado();
  avisar('participantes');
  return true;
}

function enviarTelaPara(peerId) {
  if (!voz.telaStream || voz.espectadores.has(peerId)) return;
  voz.espectadores.add(peerId);
  for (const track of voz.telaStream.getTracks()) {
    sala.addTrack(track, voz.telaStream, { target: peerId, metadata: { tipo: 'tela' } });
  }
  avisar('participantes');
}

function pararTelaPara(peerId) {
  if (!voz.telaStream || !voz.espectadores.has(peerId)) return;
  voz.espectadores.delete(peerId);
  for (const track of voz.telaStream.getTracks()) {
    try { sala.removeTrack(track, { target: peerId }); } catch {}
  }
  avisar('participantes');
}

export function pararTela() {
  if (!voz.telaStream) return;
  for (const id of [...voz.espectadores]) pararTelaPara(id);
  voz.telaStream.getTracks().forEach((t) => t.stop());
  pararSomJanela();
  voz.telaStream = null;
  telaQualidade = null;
  voz.aoVivo = false;
  anunciarEstado();
  avisar('participantes');
}

// Roleta: manda o giro pra todo mundo da chamada (cada um anima igual a partir da semente)
export function enviarRoleta(giro) {
  acoes.roleta?.send(giro);
}

// Rádio: manda o estado (fila, pausado, posição) pra todos ou só pra quem acabou de chegar
export function enviarRadio(estado, peerId) {
  acoes.radio?.send(estado, peerId ? { target: peerId } : undefined);
}

// Pede pro transmissor mandar uma versão mais leve só pra mim
export function pedirQualidadeBaixa(peerId, baixa) {
  const p = voz.participantes.get(peerId);
  if (!p || !acoes.assistir) return;
  p.qualidadeBaixa = baixa;
  acoes.assistir.send({ quer: true, baixa }, { target: peerId });
  avisar('participantes');
}

export function assistir(peerId, quer) {
  const p = voz.participantes.get(peerId);
  if (!p || !acoes.assistir) return;
  p.assistindo = quer;
  if (!quer) p.telaStream = null;
  acoes.assistir.send({ quer }, { target: peerId });
  avisar('participantes');
}

// ================= Quem está falando =================

function monitorarFala(id, stream) {
  if (!stream.getAudioTracks().length) return;
  const ctx = contexto();
  const origem = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  origem.connect(an);
  analisadores.set(id, an);
}

const amostras = new Float32Array(512);
export function nivelMicrofone() {
  const an = analisadores.get('eu');
  return an ? rms(an) : 0;
}
function rms(an) {
  an.getFloatTimeDomainData(amostras);
  let soma = 0;
  for (const v of amostras) soma += v * v;
  return Math.sqrt(soma / amostras.length);
}

setInterval(() => {
  const falando = new Set();
  for (const [id, an] of analisadores) {
    if (id === 'eu') {
      if (voz.conectado && !voz.mudo && rms(an) > 0.015) falando.add(perfil?.userId);
      continue;
    }
    const p = voz.participantes.get(id);
    if (p?.userId && !p.mudo && rms(an) > 0.015) falando.add(p.userId);
  }
  avisar('fala', falando);
}, 90);

// ================= Teste de microfone =================

// Grava alguns segundos e DEPOIS toca de volta (como o Discord).
// Ouvir ao vivo enganava o cancelamento de eco: ele achava que a sua voz era
// eco dela mesma e cortava pedaços. Gravando em Opus 128 kbps, você ouve
// exatamente o que a galera ouve.
let testeAudio = null;
let testeGravador = null;

export async function testarMicrofone(segundos, aoMudar) {
  pararTeste();
  if (!voz.micStream) return;
  const pedacos = [];
  testeGravador = new MediaRecorder(voz.micStream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: BITRATE_VOZ });
  testeGravador.ondataavailable = (e) => e.data.size && pedacos.push(e.data);
  const gravado = new Promise((r) => (testeGravador.onstop = r));
  testeGravador.start();
  for (let falta = segundos; falta > 0; falta--) {
    aoMudar('gravando', falta);
    await new Promise((r) => setTimeout(r, 1000));
    if (!testeGravador) return; // cancelado
  }
  testeGravador.stop();
  await gravado;
  testeGravador = null;
  testeAudio = new Audio(URL.createObjectURL(new Blob(pedacos, { type: 'audio/webm' })));
  if (saidaId) await testeAudio.setSinkId?.(saidaId).catch(() => {});
  aoMudar('tocando');
  await new Promise((r) => {
    testeAudio.onended = r;
    testeAudio.onpause = r;
    testeAudio.play().catch(r);
  });
  testeAudio = null;
  aoMudar('fim');
}

export function pararTeste() {
  if (testeGravador) {
    const g = testeGravador;
    testeGravador = null;
    if (g.state !== 'inactive') g.stop();
  }
  if (testeAudio) {
    testeAudio.pause();
    testeAudio = null;
  }
}

// ================= Sons =================

const SONS = {
  entrou: [[523, 0], [784, 0.09]],
  saiu: [[784, 0], [523, 0.09]],
  mudo: [[440, 0]],
  desmudo: [[660, 0]],
  msg: [[880, 0]],
  tique: [[1400, 0]],
  vitoria: [[523, 0], [659, 0.1], [784, 0.2], [1046, 0.3]],
};
export function tocarSom(nome) {
  if (!audioCtx || voz.surdo) return;
  for (const [freq, atraso] of SONS[nome]) {
    const t = audioCtx.currentTime + atraso;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(audioCtx.destination);
    o.start(t);
    o.stop(t + 0.2);
  }
}

// ================= Estatísticas (ping, fps, resolução) =================

const bytesAntes = new Map();
const redeAntes = new Map(); // id da estatística -> contadores do segundo anterior
setInterval(async () => {
  if (!sala) return;
  const conexoes = sala.getPeers();
  const video = {}; // peerId -> texto
  let enviando = null;
  // rede da call (somando todas as pessoas): kbps de subida/descida, perda de pacotes, jitter
  const rede = { subida: 0, descida: 0, perdidos: 0, recebidos: 0, jitter: [], pings: [], viaApoio: 0 };
  const assistindo = []; // telas que eu estou assistindo
  let envioTela = 0; // Mbps saindo da minha tela (somando quem assiste)
  const delta = (id, campo, valor) => {
    const antes = redeAntes.get(id + campo);
    redeAntes.set(id + campo, valor);
    return antes == null ? 0 : Math.max(0, valor - antes);
  };
  for (const [id, pc] of Object.entries(conexoes)) {
    const p = voz.participantes.get(id);
    if (!p) continue;
    p.estadoConexao = pc.connectionState;
    const stats = await pc.getStats();
    stats.forEach((s) => {
      if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded' && s.currentRoundTripTime != null) {
        p.ping = Math.round(s.currentRoundTripTime * 1000);
        rede.pings.push(p.ping);
        rede.subida += (delta(s.id, 'env', s.bytesSent || 0) * 8) / 1000;
        rede.descida += (delta(s.id, 'rec', s.bytesReceived || 0) * 8) / 1000;
        // essa conexão passa pelo servidor de apoio? (qualquer um dos lados em 'relay')
        const viaApoio = [s.localCandidateId, s.remoteCandidateId].some((c) => stats.get(c)?.candidateType === 'relay');
        if (viaApoio !== conexoesViaApoio.has(pc)) {
          viaApoio ? conexoesViaApoio.add(pc) : conexoesViaApoio.delete(pc);
          if (voz.telaStream) aplicarParametros(pc);
        }
      }
      if (s.type === 'inbound-rtp' && s.kind === 'video' && p.assistindo && s.frameWidth) {
        const antes = bytesAntes.get(s.id) ?? s.bytesReceived;
        bytesAntes.set(s.id, s.bytesReceived);
        const mbps = ((s.bytesReceived - antes) * 8) / 1e6;
        video[id] = `${s.frameWidth}×${s.frameHeight} · ${Math.round(s.framesPerSecond || 0)} fps · ${mbps.toFixed(1)} Mbps`;
        assistindo.push({
          userId: p.userId, largura: s.frameWidth, altura: s.frameHeight, fps: Math.round(s.framesPerSecond || 0), mbps,
          travadas: delta(s.id, 'trav', s.freezeCount || 0), perdidos: delta(s.id, 'qperd', s.framesDropped || 0),
        });
      }
      if (s.type === 'outbound-rtp' && s.kind === 'video' && s.frameWidth) {
        if (!enviando) enviando = s;
        envioTela += (delta(s.id, 'tela', s.bytesSent || 0) * 8) / 1e6;
      }
      if (s.type === 'inbound-rtp' && s.kind === 'audio') {
        rede.perdidos += delta(s.id, 'perd', s.packetsLost || 0);
        rede.recebidos += delta(s.id, 'receb', s.packetsReceived || 0);
        if (s.jitter != null) rede.jitter.push(s.jitter * 1000);
      }
    });
    if (conexoesViaApoio.has(pc)) rede.viaApoio++;
  }
  const media = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  voz.rede = {
    subida: Math.round(rede.subida),
    descida: Math.round(rede.descida),
    perda: rede.recebidos + rede.perdidos ? (100 * rede.perdidos) / (rede.recebidos + rede.perdidos) : 0,
    jitter: media(rede.jitter),
    ping: media(rede.pings),
    viaApoio: rede.viaApoio,
    pessoas: Object.keys(conexoes).length,
  };
  // transmissão: o que mais pesa no app (pro painel Sistema)
  voz.transmissao = {
    enviando: enviando && {
      largura: enviando.frameWidth,
      altura: enviando.frameHeight,
      fps: Math.round(enviando.framesPerSecond || 0),
      alvoFps: telaQualidade?.fps || 60,
      alvoAltura: telaQualidade?.h || 1080,
      limite: enviando.qualityLimitationReason || 'none',
      // codificando na placa de vídeo (leve) ou na CPU (pesado)?
      gpu: enviando.powerEfficientEncoder ?? !/openh264|libvpx|libaom/i.test(enviando.encoderImplementation || ''),
      codificador: enviando.encoderImplementation || '',
      mbps: envioTela,
      espectadores: voz.espectadores.size,
    },
    assistindo,
  };
  avisar('stats', {
    video,
    enviando: enviando && {
      largura: enviando.frameWidth,
      altura: enviando.frameHeight,
      fps: Math.round(enviando.framesPerSecond || 0),
      limite: enviando.qualityLimitationReason,
    },
  });
}, 1000);
