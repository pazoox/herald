// Muda o tom da voz em tempo real (Court: Helium deixa fina, Monster deixa grossa).
// Técnica de "duas cabeças de leitura": a voz entra num buffer circular e é lida por duas
// cabeças que andam mais rápido (tom pra cima) ou mais devagar (tom pra baixo) que a escrita;
// as duas se revezam com um fade em forma de seno pra não estalar quando uma dá a volta.
class Tom extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'razao', defaultValue: 1, minValue: 0.25, maxValue: 4 }];
  }

  constructor() {
    super();
    this.tamanho = 8192;
    this.buffer = new Float32Array(this.tamanho);
    this.escrita = 0;
    this.fase = 0;
    this.janela = Math.round(sampleRate * 0.045); // 45 ms
  }

  ler(atraso) {
    const pos = this.escrita - atraso;
    const i = Math.floor(pos);
    const f = pos - i;
    const m = this.tamanho;
    const a = this.buffer[((i % m) + m) % m];
    const b = this.buffer[(((i + 1) % m) + m) % m];
    return a + (b - a) * f;
  }

  process(entradas, saidas, parametros) {
    const entrada = entradas[0][0];
    const saida = saidas[0];
    if (!saida || !saida[0]) return true;
    const razao = parametros.razao[0];
    const J = this.janela;
    const passo = (1 - razao) / J;
    for (let i = 0; i < saida[0].length; i++) {
      this.buffer[this.escrita] = entrada ? entrada[i] : 0;
      this.fase += passo;
      if (this.fase >= 1) this.fase -= 1;
      if (this.fase < 0) this.fase += 1;
      const f2 = (this.fase + 0.5) % 1;
      const y = this.ler(this.fase * J) * Math.sin(Math.PI * this.fase) + this.ler(f2 * J) * Math.sin(Math.PI * f2);
      for (let c = 0; c < saida.length; c++) saida[c][i] = y * 0.85;
      this.escrita = (this.escrita + 1) % this.tamanho;
    }
    return true;
  }
}

registerProcessor('tom', Tom);
