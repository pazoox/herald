// Ponte entre o processador de áudio e a IA de ruído que roda no Worker (ia-worker.js).
// Manda o som em pedaços pro Worker e devolve o som limpo com uma folga fixa: se o Worker
// atrasar um pouco (CPU ocupada, jogo aberto), a folga cobre e não sai buraco.

const LOTE = 128; // amostras por mensagem (~2,7 ms)
const FOLGA = 768; // quanto juntar antes de começar a tocar (~16 ms)
// Se acumular mais que isso (o Worker demorou pra começar ou travou e depois mandou tudo de uma vez),
// descarta o excesso: senão esse atraso ficava pra sempre (chegou a 230 ms de atraso na voz).
const MAXIMO = FOLGA + 512;

class IaPonte extends AudioWorkletProcessor {
  constructor() {
    super();
    this.porta = null;
    this.lote = new Float32Array(LOTE);
    this.noLote = 0;
    this.anel = new Float32Array(48000); // 1 s de sobra
    this.escrita = 0;
    this.leitura = 0;
    this.tocando = false;
    this.faltas = 0;
    this.port.onmessage = (e) => {
      if (e.data?.tipo !== 'porta') return;
      this.porta = e.ports[0];
      this.porta.onmessage = (m) => this.receber(m.data);
    };
  }

  disponivel() {
    return (this.escrita - this.leitura + this.anel.length) % this.anel.length;
  }

  receber(pedaco) {
    for (let i = 0; i < pedaco.length; i++) {
      this.anel[this.escrita] = pedaco[i];
      this.escrita = (this.escrita + 1) % this.anel.length;
    }
    const sobra = this.disponivel() - MAXIMO;
    if (sobra > 0) this.leitura = (this.leitura + sobra + (MAXIMO - FOLGA)) % this.anel.length;
  }

  process(entradas, saidas) {
    const entrada = entradas[0]?.[0];
    const saida = saidas[0]?.[0];
    if (!saida) return true;

    // sem Worker ainda: passa o som direto
    if (!this.porta) {
      if (entrada) saida.set(entrada);
      return true;
    }

    if (entrada) {
      this.lote.set(entrada, this.noLote);
      this.noLote += entrada.length;
      if (this.noLote >= LOTE) {
        const envio = this.lote.slice(0, LOTE);
        this.porta.postMessage(envio, [envio.buffer]);
        this.noLote = 0;
      }
    }

    if (!this.tocando && this.disponivel() >= FOLGA) this.tocando = true;
    if (this.tocando && this.disponivel() >= saida.length) {
      for (let i = 0; i < saida.length; i++) {
        saida[i] = this.anel[this.leitura];
        this.leitura = (this.leitura + 1) % this.anel.length;
      }
    } else {
      // o Worker atrasou mais que a folga: silêncio curto e junta a folga de novo
      saida.fill(0);
      if (this.tocando) {
        this.tocando = false;
        this.port.postMessage({ tipo: 'falta', total: ++this.faltas });
      }
    }
    for (let c = 1; c < saidas[0].length; c++) saidas[0][c].set(saida);
    return true;
  }
}

registerProcessor('ia-ponte', IaPonte);
