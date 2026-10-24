// Aba "Sistema" do painel da direita: o quanto o Herald pesa no PC e como está a call.
// A transmissão de tela é o que mais pesa no app, então ela vem primeiro (quando existe).
// Atualiza a cada segundo; os números principais têm um mini-gráfico do último minuto.

import { icone } from './icones.js';
import { t } from './i18n.js';

const HISTORICO = 60;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// faixas: [bom até, médio até] (acima disso = ruim)
const FAIXAS = {
  heraldCpu: [15, 30],
  pcCpu: [70, 90],
  ping: [80, 150],
  perda: [1, 3],
};
const nivel = (chave, v) => (v == null ? '' : v <= FAIXAS[chave][0] ? 'bom' : v <= FAIXAS[chave][1] ? 'medio' : 'ruim');

export function criarPainelSistema({ el, voz, chamada, nomeDe, demo }) {
  const series = {}; // chave -> últimos valores
  let ultimo = null;
  let estadoAtual = { cor: 'bom', cpu: null, fps: null, alvoFps: null };

  const guardar = (chave, v) => {
    if (v == null || Number.isNaN(v)) return;
    (series[chave] ??= []).push(v);
    if (series[chave].length > HISTORICO) series[chave].shift();
  };

  function grafico(chave, max) {
    const xs = series[chave] || [];
    if (xs.length < 2) return '<svg class="kpi-grafico" viewBox="0 0 100 28" preserveAspectRatio="none"></svg>';
    const topo = Math.max(max ?? 0, ...xs) || 1;
    // o valor mais novo fica na ponta direita
    const x = (i) => (100 - (xs.length - 1 - i) * (100 / (HISTORICO - 1))).toFixed(1);
    const pts = xs.map((v, i) => `${x(i)},${(26 - (v / topo) * 24).toFixed(1)}`).join(' ');
    return `<svg class="kpi-grafico" viewBox="0 0 100 28" preserveAspectRatio="none">
      <polyline class="area" points="${x(0)},28 ${pts} 100,28"/>
      <polyline points="${pts}"/></svg>`;
  }

  const kpi = (rotulo, valor, unidade, { chave, faixa, max, classe } = {}) => `
    <div class="kpi ${classe ?? (faixa ? nivel(faixa, valor) : '')}">
      <span class="kpi-rotulo">${esc(rotulo)}</span>
      <span class="kpi-valor">${valor == null ? '–' : esc(valor)}<small>${esc(unidade)}</small></span>
      ${chave ? grafico(chave, max) : ''}
    </div>`;

  // estado geral (o anel da trilha e a frase do topo), do mais grave pro mais leve
  function saude(m, rede, tx) {
    const env = tx?.enviando;
    if (m && m.pcCpu > FAIXAS.pcCpu[1]) return ['ruim', t('Your PC is at its limit'), t('Close heavy programs, or lower the screen share quality.')];
    if (env?.limite === 'cpu') return ['ruim', t('Your stream is limited by the CPU'), t('Share in 720p or close heavy programs.')];
    if (env?.limite === 'bandwidth') return ['medio', t('Your stream is limited by your internet'), t('Use a cable, or fewer people watching in 1080p.')];
    const travando = tx?.assistindo?.find((a) => a.travadas > 0);
    if (travando) return ['medio', t("{name}'s stream is freezing", { name: nomeDe(travando.userId) }), t('Right-click it → Lower quality.')];
    if (m && m.heraldCpu > FAIXAS.heraldCpu[1]) return ['ruim', t('Herald is working hard'), t('Turning off the AI noise filter or watching fewer streams helps.')];
    if (rede && (rede.perda > FAIXAS.perda[1] || rede.ping > FAIXAS.ping[1])) return ['medio', t('Unstable connection'), t('Your voice may cut out. A cable or closer Wi-Fi helps.')];
    if (env && !env.gpu) return ['medio', t('Your stream is using the CPU'), t('Your video card could not take it; games may lose FPS.')];
    if (m && m.pcCpu > FAIXAS.pcCpu[0]) return ['medio', t('Your PC is busy'), t('Herald is fine, but the PC is working hard.')];
    return ['bom', t('All good'), voz.conectado ? t('Herald is light and the call is stable.') : t('Herald is light on your PC.')];
  }

  function secaoTransmissao(tx) {
    const env = tx?.enviando;
    const vendo = tx?.assistindo || [];
    if (!env && !vendo.length) return '';
    let html = `<div class="sistema-secao">${icone('tela')}<span>${esc(t('Screen share'))}</span></div>`;
    if (env) {
      const limites = { none: ['bom', t('Nothing')], cpu: ['ruim', 'CPU'], bandwidth: ['medio', t('Internet')], other: ['medio', t('Other')] };
      const [corLim, textoLim] = limites[env.limite] || limites.other;
      html += `<div class="kpis">
        ${kpi(t('Sending'), env.fps, ` / ${env.alvoFps} fps`, { chave: 'fpsEnvio', max: env.alvoFps, classe: env.fps < env.alvoFps * 0.8 ? 'medio' : '' })}
        ${kpi(t('Resolution'), `${env.altura}p`, env.altura < env.alvoAltura ? ` / ${env.alvoAltura}p` : '', { classe: env.altura < env.alvoAltura ? 'medio' : '' })}
        ${kpi(t('Limited by'), textoLim, '', { classe: corLim === 'bom' ? '' : corLim })}
        ${kpi(t('Encoding'), env.gpu ? t('Video card') : 'CPU', '', { classe: env.gpu ? '' : 'medio' })}
        ${kpi(t('Upload'), env.mbps.toFixed(1), ' Mbps', { chave: 'mbpsEnvio' })}
        ${kpi(t('Watching you'), env.espectadores, '')}
      </div>`;
    }
    for (const a of vendo) {
      html += `<div class="sistema-assistindo ${a.travadas ? 'medio' : ''}">
        <b>${esc(nomeDe(a.userId))}</b>
        <span>${a.altura}p · ${a.fps} fps · ${a.mbps.toFixed(1)} Mbps</span>
        <em>${a.travadas ? esc(t('froze {n}×', { n: a.travadas })) : esc(t('smooth'))}</em>
      </div>`;
    }
    return html;
  }

  function render(m) {
    const rede = voz.rede;
    const tx = voz.transmissao;
    const [cor, titulo, sub] = saude(m, rede, tx);
    const cal = chamada.estadoCalibracao();
    const a = chamada.audio;
    let html = `<div class="sistema-status ${cor}"><i class="ponto-saude ${cor}"></i><div><b>${esc(titulo)}</b><span>${esc(sub)}</span></div></div>`;

    html += secaoTransmissao(tx);

    html += `<div class="sistema-secao">${icone('atividade')}<span>${esc(t('Performance'))}</span></div><div class="kpis">
      ${kpi(t('Your PC (CPU)'), m ? Math.round(m.pcCpu) : null, '%', { chave: 'pcCpu', faixa: 'pcCpu', max: 100 })}
      ${kpi(t('Herald (CPU)'), m ? m.heraldCpu.toFixed(1) : null, '%', { chave: 'heraldCpu', faixa: 'heraldCpu', max: 20 })}
    </div>`;
    if (m) html += `<p class="sistema-nota">${esc(t('Memory: Herald {h} MB · PC {p}% in use', { h: Math.round(m.heraldMem), p: Math.round(100 * (1 - m.pcMemLivre / m.pcMemTotal)) }))}</p>`;

    html += `<div class="sistema-secao">${icone('volume')}<span>${esc(t('Call'))}</span>${rede?.viaApoio ? `<em>${esc(t('via relay'))}</em>` : ''}</div>`;
    html += voz.conectado && rede
      ? `<div class="kpis">
          ${kpi(t('Ping'), rede.ping == null ? null : Math.round(rede.ping), ' ms', { chave: 'ping', faixa: 'ping', max: 120 })}
          ${kpi(t('Packet loss'), rede.perda.toFixed(1), '%', { chave: 'perda', faixa: 'perda', max: 5 })}
        </div>`
      : `<p class="sistema-vazio">${esc(t(voz.conectado ? 'Connecting…' : 'Join a voice channel to see the connection.'))}</p>`;

    const nivelMic = Math.max(0, Math.min(100, ((20 * Math.log10(Math.max(chamada.nivelMicrofone(), 1e-6)) + 60) / 60) * 100));
    html += `<div class="sistema-secao">${icone('mic')}<span>${esc(t('Your voice'))}</span></div>
      <div class="sistema-voz">
        <div class="medidor"><div style="width:${voz.mudo ? 0 : nivelMic}%"></div></div>
        <div class="sistema-linhas">
          <span>${esc(t('AI noise filter'))}<b>${esc(a.ruido ? t(a.forca === 'forte' ? 'Strong' : 'Natural') : t('Off'))}</b></span>
          <span>${esc(t('Calibration'))}<b class="${cal.perfil ? 'ok' : ''}">${esc(cal.perfil ? t('Done') : cal.coletando === 'auto' ? `${cal.segundos}/${cal.alvo} s` : t('Pending'))}</b></span>
          <span>${esc(t('Added delay'))}<b>~${a.ruido ? 70 : 10} ms</b></span>
          <span>${esc(t('Echo cancellation'))}<b>${esc(t(a.eco ? 'On' : 'Off'))}</b></span>
        </div>
      </div>`;
    el.innerHTML = html;
  }

  async function medir() {
    let m = null;
    try { m = await window.herald?.metricas?.(); } catch {}
    if (demo && voz.conectado) {
      // demonstração: call e transmissão de mentira com números realistas
      const r = () => Math.random();
      voz.rede = { ping: 24 + r() * 10, perda: r() * 0.4, subida: Math.round(110 + r() * 30), descida: Math.round(5200 + r() * 900), jitter: 3 + r() * 2, viaApoio: 0, pessoas: 3 };
      voz.transmissao = { enviando: null, assistindo: [{ userId: 'u-beto', largura: 1920, altura: 1080, fps: 58 + Math.round(r() * 2), mbps: 5.6 + r(), travadas: 0 }] };
    }
    if (m) {
      guardar('heraldCpu', m.heraldCpu);
      guardar('pcCpu', m.pcCpu);
    }
    if (voz.rede) {
      guardar('ping', voz.rede.ping);
      guardar('perda', voz.rede.perda);
    }
    const env = voz.transmissao?.enviando;
    if (env) {
      guardar('fpsEnvio', env.fps);
      guardar('mbpsEnvio', env.mbps);
    }
    ultimo = m;
    const [cor] = saude(m, voz.rede, voz.transmissao);
    estadoAtual = { cor, cpu: m ? m.pcCpu : null, fps: env?.fps ?? null, alvoFps: env?.alvoFps ?? null };
    return m;
  }

  return {
    // chamado a cada segundo; desenha só se a aba estiver visível
    async atualizar(visivel) {
      const m = await medir();
      if (visivel) render(m);
      return estadoAtual;
    },
    redesenhar: () => render(ultimo),
  };
}
