// Som só da janela compartilhada (AudioWorklet): recebe os pedaços de PCM que o processo
// principal captura do programa (16-bit, estéreo intercalado, 48 kHz) e toca como uma trilha
// normal, que vai junto com a transmissão. Segura ~30 ms de folga pra não picar.

const FOLGA = 1440; // amostras por canal antes de começar a tocar (~30 ms)
const TAMANHO = 48000; // 1 s de anel

class JanelaSom extends AudioWorkletProcessor {
  constructor() {
    super();
    this.esq = new Float32Array(TAMANHO);
    this.dir = new Float32Array(TAMANHO);
    this.escrita = 0;
    this.leitura = 0;
    this.tocando = false;
    this.port.onmessage = (e) => this.receber(e.data);
  }

  disponivel() {
    return (this.escrita - this.leitura + TAMANHO) % TAMANHO;
  }

  receber(bytes) {
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    for (let i = 0; i + 1 < pcm.length; i += 2) {
      this.esq[this.escrita] = pcm[i] / 32768;
      this.dir[this.escrita] = pcm[i + 1] / 32768;
      this.escrita = (this.escrita + 1) % TAMANHO;
    }
    // acumulou demais (aba travou um pouco)? descarta o excesso pra não ficar atrasado
    if (this.disponivel() > FOLGA * 4) this.leitura = (this.escrita - FOLGA + TAMANHO) % TAMANHO;
  }

  process(_entradas, saidas) {
    const [l, r] = saidas[0];
    if (!this.tocando && this.disponivel() >= FOLGA) this.tocando = true;
    if (!this.tocando || this.disponivel() < l.length) {
      // sem som chegando (o programa está em silêncio): sai silêncio e junta folga de novo
      l.fill(0);
      r?.fill(0);
      if (this.disponivel() < l.length) this.tocando = false;
      return true;
    }
    for (let i = 0; i < l.length; i++) {
      l[i] = this.esq[this.leitura];
      if (r) r[i] = this.dir[this.leitura];
      this.leitura = (this.leitura + 1) % TAMANHO;
    }
    return true;
  }
}

registerProcessor('janela-som', JanelaSom);
