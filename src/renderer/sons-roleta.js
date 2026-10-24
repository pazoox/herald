// Sons da roleta, sintetizados na hora (sem arquivos de áudio).
//   arrancada()  "whoosh" quando a roda começa a girar
//   tec()        a lingueta batendo num pino (um por nome que passa)
//   vitoria()    fanfarra curta + brilho quando alguém é sorteado

export function criarSonsRoleta(obterContexto, estaMudo) {
  let ruido = null;
  let saida = null;

  // Prepara o contexto, um buffer de ruído reaproveitável e um volume geral
  function preparar() {
    const ctx = obterContexto();
    if (!ctx || estaMudo()) return null;
    if (!saida || saida.context !== ctx) {
      saida = new GainNode(ctx, { gain: 0.6 });
      saida.connect(ctx.destination);
      ruido = new AudioBuffer({ length: ctx.sampleRate, sampleRate: ctx.sampleRate, numberOfChannels: 1 });
      const d = ruido.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return ctx;
  }

  function envelope(ctx, pico, ataque, duracao, inicio = ctx.currentTime) {
    const g = new GainNode(ctx, { gain: 0.0001 });
    g.gain.setValueAtTime(0.0001, inicio);
    g.gain.exponentialRampToValueAtTime(pico, inicio + ataque);
    g.gain.exponentialRampToValueAtTime(0.0001, inicio + duracao);
    g.connect(saida);
    return g;
  }

  return {
    arrancada() {
      const ctx = preparar();
      if (!ctx) return;
      const agora = ctx.currentTime;
      const fonte = new AudioBufferSourceNode(ctx, { buffer: ruido });
      const filtro = new BiquadFilterNode(ctx, { type: 'bandpass', Q: 1.2, frequency: 300 });
      filtro.frequency.exponentialRampToValueAtTime(2600, agora + 0.45);
      fonte.connect(filtro).connect(envelope(ctx, 0.22, 0.12, 0.6, agora));
      fonte.start(agora);
      fonte.stop(agora + 0.65);
    },

    tec() {
      const ctx = preparar();
      if (!ctx) return;
      const agora = ctx.currentTime;
      // clique de plástico: ruído curtinho e agudo...
      const fonte = new AudioBufferSourceNode(ctx, { buffer: ruido });
      const filtro = new BiquadFilterNode(ctx, { type: 'bandpass', Q: 3, frequency: 2000 + Math.random() * 600 });
      fonte.connect(filtro).connect(envelope(ctx, 0.5, 0.001, 0.035, agora));
      fonte.start(agora, Math.random() * 0.5);
      fonte.stop(agora + 0.04);
      // ...com um "toc" grave por baixo
      const toc = new OscillatorNode(ctx, { type: 'sine', frequency: 220 });
      toc.frequency.exponentialRampToValueAtTime(110, agora + 0.04);
      toc.connect(envelope(ctx, 0.25, 0.001, 0.05, agora));
      toc.start(agora);
      toc.stop(agora + 0.06);
    },

    vitoria() {
      const ctx = preparar();
      if (!ctx) return;
      const agora = ctx.currentTime;
      // arpejo subindo (Mi maior) e um acorde final
      [659.3, 830.6, 987.8, 1318.5].forEach((f, i) => {
        const o = new OscillatorNode(ctx, { type: 'triangle', frequency: f });
        o.connect(envelope(ctx, 0.28, 0.01, 0.45, agora + i * 0.085));
        o.start(agora + i * 0.085);
        o.stop(agora + i * 0.085 + 0.5);
      });
      const acorde = agora + 0.34;
      [659.3, 987.8, 1318.5, 1975.5].forEach((f) => {
        const o = new OscillatorNode(ctx, { type: 'sine', frequency: f });
        const vibrato = new OscillatorNode(ctx, { frequency: 6 });
        const prof = new GainNode(ctx, { gain: f * 0.004 });
        vibrato.connect(prof).connect(o.frequency);
        o.connect(envelope(ctx, 0.12, 0.02, 1.1, acorde));
        o.start(acorde);
        vibrato.start(acorde);
        o.stop(acorde + 1.15);
        vibrato.stop(acorde + 1.15);
      });
      // brilho: chiadinho agudo descendo
      const fonte = new AudioBufferSourceNode(ctx, { buffer: ruido });
      const filtro = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 7000 });
      fonte.connect(filtro).connect(envelope(ctx, 0.06, 0.02, 0.9, acorde));
      fonte.start(acorde);
      fonte.stop(acorde + 0.95);
    },
  };
}
