// Nivelador de voz (AudioWorklet): deixa a voz sempre no mesmo volume.
// - Mede o volume médio (RMS) dos últimos ~300 ms.
// - Acompanha o ruído de fundo (o "chão" do som) e só mexe no ganho quando
//   tem voz de verdade, bem acima dele — nunca aumenta ruído constante.
// - Sobe devagar (sem "bombear"), desce rápido.

const db = (v) => 10 ** (v / 20);

// Ajustes (todos opcionais; os padrões são os da versão atual do app)
const PADRAO_NIVELADOR = { alvo: -22, minimo: -12, maximo: 18, silencio: -55, acimaDoChao: 12, sobe: 1.5, desce: 0.12 };

class Nivelador extends AudioWorkletProcessor {
  constructor(opcoes) {
    super();
    this.configurar({ ...PADRAO_NIVELADOR, ...opcoes?.processorOptions });
    this.media = 1e-6; // média quadrática (energia)
    this.chao = db(-60); // estimativa do ruído de fundo
    this.ganho = 1;
    this.blocos = 0;
    this.port.onmessage = (e) => e.data?.tipo === 'config' && this.configurar({ ...this.ajustes, ...e.data.valores });
  }

  configurar(a) {
    this.ajustes = a;
    this.alvo = db(a.alvo); // volume médio da fala (folga de sobra pros picos)
    this.minimo = db(a.minimo);
    this.maximo = db(a.maximo);
    this.silencio = db(a.silencio); // abaixo disso nem conta
    this.acimaDoChao = db(a.acimaDoChao); // quanto a voz precisa estar acima do ruído
  }

  process(entradas, saidas) {
    const entrada = entradas[0]?.[0];
    const saida = saidas[0];
    if (!entrada) return true;

    const n = entrada.length;
    const dt = n / sampleRate;
    let soma = 0;
    for (let i = 0; i < n; i++) soma += entrada[i] * entrada[i];
    this.media += (soma / n - this.media) * (1 - Math.exp(-dt / 0.3));
    const rms = Math.sqrt(this.media);

    // Chão de ruído: desce rápido, sobe bem devagar (voz não "puxa" ele)
    const tempoChao = rms < this.chao ? 0.5 : 8;
    this.chao += (rms - this.chao) * (1 - Math.exp(-dt / tempoChao));

    const temVoz = rms > this.silencio && rms > this.chao * this.acimaDoChao;
    let desejado = this.ganho;
    if (temVoz) desejado = Math.min(this.maximo, Math.max(this.minimo, this.alvo / rms));
    const tempo = desejado < this.ganho ? this.ajustes.desce : this.ajustes.sobe;
    const novo = this.ganho + (desejado - this.ganho) * (1 - Math.exp(-dt / tempo));

    // ganho interpolado amostra a amostra (sem degraus/estalos)
    for (const canal of saida) {
      for (let i = 0; i < n; i++) canal[i] = entrada[i] * (this.ganho + ((novo - this.ganho) * i) / n);
    }
    this.ganho = novo;

    if (++this.blocos % 40 === 0) this.port.postMessage(20 * Math.log10(this.ganho));
    return true;
  }
}

registerProcessor('nivelador', Nivelador);
