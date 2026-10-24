// Dinâmica da voz (AudioWorklet): compressor suave + limitador com antecipação.
//
// Compressor: acima de -26 dB comprime 2.5:1 com joelho macio (sem ganho
//   automático escondido — o ganho de saída é fixo e conhecido).
// Limitador: atrasa o som 4 ms e "olha pra frente": quando vem um pico, abaixa
//   o volume aos poucos ANTES dele chegar. A saída nunca passa do teto (-1 dB),
//   então não existe corte (clipping).

const paraDb = (v) => 20 * Math.log10(v + 1e-12);
const deDb = (d) => 10 ** (d / 20);

// Ajustes (todos opcionais; os padrões são os da versão atual do app). Tempos em ms.
// detector: 'pico' (segue cada pico) ou 'rms' (segue o volume médio — mais natural pra voz)
// portao: abaixo disso (dB) o som é abaixado (expansor 1:3, até 'profundidade' dB) — pausas e respiração ficam quietas; -100 = desligado
const PADRAO_DINAMICA = { comprimir: true, detector: 'pico', limiar: -26, razao: 2.5, joelho: 10, ganho: 3, ataque: 8, soltura: 200, teto: -1, portao: -100, profundidade: 15 };

class Dinamica extends AudioWorkletProcessor {
  constructor(opcoes) {
    super();
    this.configurar({ ...PADRAO_DINAMICA, ...opcoes?.processorOptions });
    this.port.onmessage = (e) => e.data?.tipo === 'config' && this.configurar({ ...this.ajustes, ...e.data.valores });
    this.envelope = 0;
    this.antecipacao = Math.round(0.004 * sampleRate);
    this.atraso = new Float32Array(this.antecipacao);
    this.posicao = 0;
    this.ganhoLim = 1;
    this.passo = 0;
    this.rampa = 0; // amostras ainda descendo
    this.segurar = 0; // amostras parado no nível baixo (até o pico passar)
    this.solturaLim = 1 - Math.exp(-1 / (0.08 * sampleRate));
  }

  configurar(a) {
    this.ajustes = a;
    // Compressor
    this.limiar = a.limiar;
    this.razao = a.comprimir ? a.razao : 1;
    this.joelho = a.joelho;
    this.saidaComp = deDb(a.comprimir ? a.ganho : 0); // ganho fixo depois de comprimir
    this.ataque = Math.exp(-1 / ((a.ataque / 1000) * sampleRate));
    this.soltura = Math.exp(-1 / ((a.soltura / 1000) * sampleRate));
    // Limitador
    this.teto = deDb(a.teto);
  }

  reducao(nivelDb) {
    const acima = nivelDb - this.limiar;
    const meio = this.joelho / 2;
    if (acima <= -meio) return 0;
    const inclinacao = 1 / this.razao - 1;
    if (acima < meio) return (inclinacao * (acima + meio) ** 2) / (2 * this.joelho);
    return inclinacao * acima;
  }

  process(entradas, saidas) {
    const entrada = entradas[0]?.[0];
    const saida = saidas[0]?.[0];
    if (!entrada || !saida) return true;
    const n = this.antecipacao;

    for (let i = 0; i < entrada.length; i++) {
      // --- compressor (detector de pico com ataque/soltura) ---
      const x = entrada[i];
      const rms = this.ajustes.detector === 'rms';
      const nivel = rms ? x * x : Math.abs(x);
      const coef = nivel > this.envelope ? this.ataque : this.soltura;
      this.envelope = coef * this.envelope + (1 - coef) * nivel;
      const medido = rms ? Math.sqrt(this.envelope) : this.envelope;
      const nivelDb = paraDb(medido);
      let reducao = this.reducao(nivelDb);
      if (nivelDb < this.ajustes.portao) reducao -= Math.min(this.ajustes.profundidade, (this.ajustes.portao - nivelDb) * 2);
      const comprimido = x * deDb(reducao) * this.saidaComp;

      // --- limitador com antecipação ---
      const precisa = Math.min(1, this.teto / (Math.abs(comprimido) + 1e-12));
      // ganho que esta amostra vai precisar quando sair (daqui a n amostras)
      const alvoAtual = this.ganhoLim - this.passo * this.rampa;
      if (precisa < alvoAtual) {
        // desce em rampa e chega exatamente no ponto quando o pico sair
        this.passo = (this.ganhoLim - precisa) / n;
        this.rampa = n;
        this.segurar = n;
      }
      if (this.rampa > 0) {
        this.ganhoLim -= this.passo;
        this.rampa--;
      } else if (this.segurar > 0) {
        this.segurar--;
      } else {
        this.ganhoLim += (1 - this.ganhoLim) * this.solturaLim;
      }

      const atrasado = this.atraso[this.posicao];
      this.atraso[this.posicao] = comprimido;
      this.posicao = (this.posicao + 1) % n;
      // trava final de segurança (na prática nunca é atingida)
      const y = atrasado * this.ganhoLim;
      saida[i] = y > this.teto ? this.teto : y < -this.teto ? -this.teto : y;
    }
    for (let c = 1; c < saidas[0].length; c++) saidas[0][c].set(saida);
    return true;
  }
}

registerProcessor('dinamica', Dinamica);
