// IA de ruído (DeepFilterNet3) rodando num Worker, fora do processador de áudio.
// O processador de áudio tem ~2,7 ms pra entregar cada pedacinho; a IA às vezes demora
// mais que isso e o som "picava". Aqui ela pode demorar à vontade: a ponte (ia-ponte.js)
// segura uma folga de alguns ms e o som nunca fura.
//
// Dois modos:
//   'filtro'   a IA limpa a voz (o som que sai é o da IA)
//   'porteiro' a IA só ESCUTA e decide se tem voz; o som que sai é o original, intacto,
//              abaixado `fundo` dB nas pausas (some estalo, teclado, batida na mesa).
//              Mais natural: a IA nunca encosta na voz.
//
// Reaproveita o processador original da biblioteca: ele só precisa de AudioWorkletProcessor
// e registerProcessor, que a gente imita aqui.

let Processador = null;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.port = { onmessage: null, postMessage() {} };
  }
};
globalThis.registerProcessor = (_nome, classe) => (Processador = classe);
importScripts('deepfilter.js');

const QUANTUM = 128;
const ATRASO_IA = 1952; // a IA devolve o som ~41 ms depois (medido)
const QUADRO = 480; // 10 ms
const ANTECIPA = QUADRO; // o porteiro "olha" 10 ms à frente pra não comer o começo das palavras

let ia = null;
let porta = null;
let modo = 'filtro';
const porteiro = { sensibilidade: 25, fundo: 40, segurar: 60 };

// estado do porteiro
const ATRASO = ATRASO_IA + ANTECIPA;
const anel = new Float32Array(ATRASO + QUANTUM * 64);
let escrita = 0;
let somaQuadro = 0;
let noQuadro = 0;
let nivelVoz = -30; // nível "alto típico" da voz (estimativa do percentil 95, igual o Audio Lab)
let semVoz = 1e9; // quadros desde a última voz
let alvo = 1;
let ganho = 1;

function configurar(msg) {
  if (msg.type === 'modo') return (modo = msg.value);
  if (msg.type === 'porteiro') return Object.assign(porteiro, msg.value);
  ia?.port.onmessage?.({ data: msg }); // setEnabled / setAttenuationLimit
}

// a cada 10 ms do som da IA: tem voz?
function fecharQuadro() {
  const db = 10 * Math.log10(somaQuadro / QUADRO + 1e-20);
  somaQuadro = 0;
  noQuadro = 0;
  // estimador de percentil 95: sobe 0,475 dB quando passa, desce 0,025 dB quando não (só com som)
  if (db > -70) nivelVoz += db > nivelVoz ? 0.475 : -0.025;
  const temVoz = db > Math.max(nivelVoz - porteiro.sensibilidade, -75);
  semVoz = temVoz ? 0 : semVoz + 1;
  alvo = semVoz * 10 <= porteiro.segurar ? 1 : 10 ** (-porteiro.fundo / 20);
}

function processar(entrada) {
  const saida = new Float32Array(entrada.length);
  const bloco = new Float32Array(QUANTUM);
  for (let i = 0; i < entrada.length; i += QUANTUM) {
    const pedaco = entrada.subarray(i, i + QUANTUM);
    bloco.fill(0);
    ia.process([[pedaco]], [[bloco]]);
    if (modo !== 'porteiro') {
      saida.set(bloco, i);
      continue;
    }
    for (let k = 0; k < pedaco.length; k++) {
      // som original guardado pra sair atrasado (alinhado com a decisão da IA)
      anel[escrita] = pedaco[k];
      const lido = anel[(escrita - ATRASO + anel.length) % anel.length];
      escrita = (escrita + 1) % anel.length;
      // energia do som da IA, por quadro de 10 ms
      somaQuadro += bloco[k] * bloco[k];
      if (++noQuadro === QUADRO) fecharQuadro();
      // abre rápido (~1 ms), fecha suave (~50 ms)
      ganho += (alvo - ganho) * (alvo > ganho ? 0.02 : 0.0004);
      saida[i + k] = lido * ganho;
    }
  }
  return saida;
}

self.onmessage = (e) => {
  const d = e.data;
  if (d.tipo === 'iniciar') {
    ia = new Processador({ processorOptions: { wasmModule: d.wasmModule, attenuationLimit: d.limite ?? 100 } });
    if (d.modo) modo = d.modo;
    if (d.porteiro) Object.assign(porteiro, d.porteiro);
    porta = e.ports[0];
    porta.onmessage = (m) => {
      const saida = processar(m.data);
      porta.postMessage(saida, [saida.buffer]);
    };
  } else {
    configurar(d); // { type: 'setEnabled' | 'setAttenuationLimit' | 'modo' | 'porteiro', value }
  }
};
