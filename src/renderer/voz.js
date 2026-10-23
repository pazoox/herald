// Chamada de voz + tela de um canal de voz.
// As pessoas se encontram pelo Trystero (relays Nostr) usando o id do canal e o
// segredo do canal (voice_key, que só membros do Nest conseguem ler no banco).
// Voz e tela vão direto de PC pra PC (WebRTC).

import { joinRoom } from 'trystero/nostr';
import { APP_ID } from './config.js';

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
      enc.maxBitrate = telaQualidade.bitrate;
      enc.maxFramerate = telaQualidade.fps;
      enc.scaleResolutionDownBy = 1;
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

function contexto() {
  if (!audioCtx) audioCtx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// ================= Tratamento do microfone =================
//
// microfone → filtro de graves (80 Hz) → supressão de ruído com IA (DeepFilterNet3)
//   → volume automático (nivelador) ou volume manual → timbre (EQ) → compressor suave
//   + limitador com antecipação (nunca clipa) → o que vai pra chamada
//
// O que sai daqui é sempre a mesma trilha: trocar microfone ou opção não
// interrompe a chamada (só a entrada da cadeia muda).

const PADRAO_AUDIO = { ruido: true, forca: 'forte', auto: true, ganho: 0, eco: true };
export const audio = { ...PADRAO_AUDIO, ...lerJson('herald-audio'), ganhoAuto: 0 };

function lerJson(k) {
  try { return JSON.parse(ler(k)) || {}; } catch { return {}; }
}

let cadeia = null;
let entradaStream = null;
let fonte = null;
let entradaDispositivo = null;

async function montarCadeia() {
  if (cadeia) return cadeia;
  const ctx = contexto();
  await Promise.all(['deepfilter', 'nivelador', 'dinamica'].map((m) => ctx.audioWorklet.addModule(`dist/audio/${m}.js`)));
  const bytes = await fetch('dist/audio/deepfilter.wasm').then((r) => r.arrayBuffer());
  const modulo = await WebAssembly.compile(bytes);

  const graves = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 80, Q: 0.7 });
  const ruido = new AudioWorkletNode(ctx, 'deepfilternet-processor', {
    numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit',
    processorOptions: { wasmModule: modulo, attenuationLimit: 100 },
  });
  const nivelador = new AudioWorkletNode(ctx, 'nivelador', { channelCount: 1, channelCountMode: 'explicit' });
  nivelador.port.onmessage = (e) => { audio.ganhoAuto = e.data; };
  const manual = new GainNode(ctx);
  // Timbre: tira um pouco do "embolado" (300 Hz) e dá um brilho sutil (6 kHz)
  const embolado = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 300, Q: 1, gain: -2.5 });
  const brilho = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 6000, gain: 2 });
  // Compressor suave + limitador com antecipação (nunca clipa) — ver audio/dinamica.js
  const dinamica = new AudioWorkletNode(ctx, 'dinamica', { channelCount: 1, channelCountMode: 'explicit' });
  const destino = ctx.createMediaStreamDestination();
  const medidor = new AnalyserNode(ctx, { fftSize: 512 });

  embolado.connect(brilho).connect(dinamica).connect(destino);
  dinamica.connect(medidor);

  cadeia = { ctx, graves, ruido, nivelador, manual, timbre: embolado, destino, medidor };
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
  const { graves, ruido, nivelador, manual, timbre } = cadeia;
  for (const no of [graves, ruido, nivelador, manual]) no.disconnect();
  ruido.port.postMessage({ type: 'setEnabled', value: audio.ruido });
  ruido.port.postMessage({ type: 'setAttenuationLimit', value: audio.forca === 'forte' ? 100 : 24 });
  manual.gain.value = 10 ** (audio.ganho / 20);
  const volume = audio.auto ? nivelador : manual;
  graves.connect(ruido).connect(volume).connect(timbre);
  if (fonte) fonte.connect(graves);
}

export function configurarAudio(mudancas) {
  const precisaRecapturar = 'eco' in mudancas && mudancas.eco !== audio.eco;
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
      // O cancelamento de eco do navegador fica (opcional); ruído e ganho são nossos
      echoCancellation: audio.eco,
      noiseSuppression: false,
      autoGainControl: false,
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
  return voz.micStream;
}

export function microfoneAtual() {
  return entradaDispositivo || '';
}

// ================= Entrar / sair =================

export async function entrar({ canalId, chave, userId }) {
  if (voz.canalId === canalId) return;
  if (sala) await sair();
  perfil = { userId };
  contexto();
  if (!micTrack) await abrirMicrofone();

  voz.canalId = canalId;
  voz.conectado = true;
  sala = joinRoom({ appId: APP_ID, password: chave, rtcConfig: { iceServers: ICE }, rtcPolyfill: Conexao }, canalId);

  acoes.estado = sala.makeAction('estado');
  acoes.assistir = sala.makeAction('assistir');

  sala.onPeerJoin = (id) => {
    voz.participantes.set(id, {
      peerId: id, userId: null, mudo: false, surdo: false, aoVivo: false,
      audioEl: null, volume: 1, assistindo: false, telaStream: null, ping: null, estadoConexao: 'new',
    });
    sala.addTrack(micTrack, voz.micStream, { target: id, metadata: { tipo: 'mic' } });
    acoes.estado.send(estadoAtual(), { target: id });
    tocarSom('entrou');
    avisar('participantes');
  };

  sala.onPeerLeave = (id) => {
    const p = voz.participantes.get(id);
    if (!p) return;
    if (p.audioEl) p.audioEl.srcObject = null;
    analisadores.delete(id);
    voz.espectadores.delete(id);
    voz.participantes.delete(id);
    tocarSom('saiu');
    avisar('participantes');
  };

  sala.onPeerTrack = (track, stream, id, metadata) => {
    const p = voz.participantes.get(id);
    if (!p) return;
    if (metadata?.tipo === 'tela') {
      p.telaStream = stream;
      avisar('participantes');
      return;
    }
    if (track.kind !== 'audio') return;
    if (!p.audioEl) {
      p.audioEl = new Audio();
      p.audioEl.autoplay = true;
    }
    p.audioEl.srcObject = stream;
    p.audioEl.volume = p.volume;
    p.audioEl.muted = voz.surdo;
    if (saidaId && p.audioEl.setSinkId) p.audioEl.setSinkId(saidaId).catch(() => {});
    p.audioEl.play().catch(() => {});
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
      if (p.audioEl) p.audioEl.volume = p.volume;
    }
    if (!p.aoVivo) {
      p.assistindo = false;
      p.telaStream = null;
    }
    avisar('participantes');
  };

  acoes.assistir.onMessage = (dados, { peerId }) => {
    if (dados.quer) enviarTelaPara(peerId);
    else pararTelaPara(peerId);
  };

  tocarSom('entrou');
  avisar('conexao');
}

export async function sair() {
  if (!sala) return;
  if (voz.telaStream) pararTela();
  for (const p of voz.participantes.values()) if (p.audioEl) p.audioEl.srcObject = null;
  const s = sala;
  sala = null;
  acoes = {};
  voz.participantes.clear();
  voz.espectadores.clear();
  voz.canalId = null;
  voz.conectado = false;
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
  for (const p of voz.participantes.values()) if (p.audioEl) p.audioEl.muted = voz.surdo;
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
    if (p.audioEl) p.audioEl.volume = volume;
  }
}

export function volumeDe(userId) {
  return Number(ler('herald-vol-' + userId) ?? 1);
}

export function definirSaida(deviceId) {
  saidaId = deviceId;
  guardar('herald-saida', deviceId);
  for (const p of voz.participantes.values()) p.audioEl?.setSinkId?.(deviceId).catch(() => {});
  testeAudio?.setSinkId?.(deviceId).catch(() => {});
}

export function saidaAtual() {
  return saidaId;
}

// ================= Tela =================

export async function iniciarTela(fonteId, qualidadeId, comAudio) {
  const q = QUALIDADES[qualidadeId] || QUALIDADES['1080p60'];
  await window.herald.escolherFonte(fonteId, comAudio);
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: q.w, max: q.w },
        height: { ideal: q.h, max: q.h },
        frameRate: { ideal: q.fps, max: q.fps },
      },
      audio: comAudio,
    });
  } catch (err) {
    console.error(err);
    return false;
  }
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
  voz.telaStream = null;
  telaQualidade = null;
  voz.aoVivo = false;
  anunciarEstado();
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

let testeAudio = null;
export function testarMicrofone(ligar) {
  if (!ligar) {
    if (testeAudio) {
      testeAudio.pause();
      testeAudio.srcObject = null;
      testeAudio = null;
    }
    return;
  }
  if (!voz.micStream) return;
  testeAudio = new Audio();
  testeAudio.srcObject = voz.micStream;
  if (saidaId) testeAudio.setSinkId?.(saidaId).catch(() => {});
  testeAudio.play();
}

// ================= Sons =================

const SONS = {
  entrou: [[523, 0], [784, 0.09]],
  saiu: [[784, 0], [523, 0.09]],
  mudo: [[440, 0]],
  desmudo: [[660, 0]],
  msg: [[880, 0]],
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
setInterval(async () => {
  if (!sala) return;
  const conexoes = sala.getPeers();
  const video = {}; // peerId -> texto
  let enviando = null;
  for (const [id, pc] of Object.entries(conexoes)) {
    const p = voz.participantes.get(id);
    if (!p) continue;
    p.estadoConexao = pc.connectionState;
    const stats = await pc.getStats();
    stats.forEach((s) => {
      if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded' && s.currentRoundTripTime != null) {
        p.ping = Math.round(s.currentRoundTripTime * 1000);
      }
      if (s.type === 'inbound-rtp' && s.kind === 'video' && p.assistindo && s.frameWidth) {
        const antes = bytesAntes.get(s.id) ?? s.bytesReceived;
        bytesAntes.set(s.id, s.bytesReceived);
        const mbps = ((s.bytesReceived - antes) * 8) / 1e6;
        video[id] = `${s.frameWidth}×${s.frameHeight} · ${Math.round(s.framesPerSecond || 0)} fps · ${mbps.toFixed(1)} Mbps`;
      }
      if (s.type === 'outbound-rtp' && s.kind === 'video' && s.frameWidth && !enviando) enviando = s;
    });
  }
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
