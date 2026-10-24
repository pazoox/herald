// Calibração da voz: escuta a pessoa falando (depois da IA de ruído), mede o espectro
// médio da voz e monta um EQ suave que puxa a voz em direção a uma curva-alvo de voz bem
// gravada — igual um "match EQ" de DAW, mas corrigindo só metade da diferença e com limites,
// pra nunca deixar a voz estranha.

const TAXA = 48000;
const N = 2048; // tamanho da FFT
const PASSO = 1024;

// Terços de oitava e a curva-alvo (dB relativos). Baseada no espectro médio de fala
// (LTASS), com um pouco mais de presença em 2–5 kHz pra voz ficar clara na call.
const CENTROS = [63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500];
const ALVO = [-14, -9, -5, -2, 0, 1, 1, 1, 0, -1, -3, -4, -5, -6, -6.5, -6.5, -6.5, -7, -8, -9.5, -11.5, -13.5, -16, -20];

// EQ quando ainda não tem calibração (neutro, só um toque de clareza)
export const EQ_PADRAO = {
  graves: 90,
  bandas: [
    { tipo: 'lowshelf', freq: 150, ganho: 0, q: 0.7 },
    { tipo: 'peaking', freq: 350, ganho: -1.5, q: 1 },
    { tipo: 'peaking', freq: 1000, ganho: 0, q: 1 },
    { tipo: 'peaking', freq: 3200, ganho: 1.5, q: 0.8 },
    { tipo: 'highshelf', freq: 8000, ganho: 1.5, q: 0.7 },
  ],
};

// "Mais quente / mais brilhante": inclina o EQ calibrado (tom de -2 a +2)
export function eqComTom(eq, tom = 0) {
  const bandas = eq.bandas.map((b) => ({ ...b }));
  bandas[0].ganho += -0.75 * tom; // grave
  bandas[4].ganho += 1.5 * tom; // agudo
  return { ...eq, bandas };
}

// FFT radix-2 in-place
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let tam = 2; tam <= n; tam <<= 1) {
    const ang = (-2 * Math.PI) / tam;
    for (let i = 0; i < n; i += tam) {
      for (let k = 0; k < tam / 2; k++) {
        const c = Math.cos(ang * k), s = Math.sin(ang * k);
        const a = i + k, b = a + tam / 2;
        const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}

const JANELA = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
const dB = (v) => 10 * Math.log10(v + 1e-20);
const media = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const limitar = (v, min, max) => Math.max(min, Math.min(max, v));

// Junta a voz aos poucos (pedacinhos de 128 amostras) sem guardar o áudio todo
export function criarColetor() {
  const quadro = new Float32Array(N);
  let noQuadro = 0;
  const potencia = new Float64Array(N / 2);
  let quadrosVoz = 0;
  const niveis = []; // dB de cada quadro (pra achar o ruído de fundo)
  // últimos ~10 s de áudio CONTÍNUO, pra tocar o antes/depois.
  // (Guardar só os pedacinhos com voz e colar um no outro deixava a prévia picotada.)
  const amostra = new Float32Array(TAXA * 10);
  let posAmostra = 0;
  let cheia = false;

  function analisar() {
    let soma = 0;
    for (let i = 0; i < N; i++) soma += quadro[i] * quadro[i];
    const nivel = dB(soma / N);
    niveis.push(nivel);
    if (niveis.length > 4000) niveis.shift();
    const ordenado = [...niveis].sort((a, b) => a - b);
    const chao = ordenado[Math.floor(ordenado.length * 0.15)] ?? -100;
    const temVoz = niveis.length > 20 && nivel > chao + 12 && nivel > -60;
    if (!temVoz) return;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = quadro[i] * JANELA[i];
    fft(re, im);
    for (let k = 0; k < N / 2; k++) potencia[k] += re[k] * re[k] + im[k] * im[k];
    quadrosVoz++;
  }

  return {
    adicionar(pedaco) {
      for (let i = 0; i < pedaco.length; i++) {
        amostra[posAmostra] = pedaco[i];
        posAmostra = (posAmostra + 1) % amostra.length;
        if (posAmostra === 0) cheia = true;
        quadro[noQuadro++] = pedaco[i];
        if (noQuadro === N) {
          analisar();
          quadro.copyWithin(0, PASSO);
          noQuadro = N - PASSO;
        }
      }
    },
    // segundos de voz já ouvidos
    get segundos() {
      return (quadrosVoz * PASSO) / TAXA;
    },
    // trecho recente (em ordem), pra comparar antes/depois
    amostra() {
      if (!cheia) return amostra.slice(0, posAmostra);
      return Float32Array.from({ length: amostra.length }, (_, i) => amostra[(posAmostra + i) % amostra.length]);
    },
    calcular() {
      if (!quadrosVoz) return null;
      const medido = CENTROS.map((fc) => {
        const lo = Math.max(1, Math.floor((fc * 2 ** (-1 / 6) * N) / TAXA));
        const hi = Math.min(N / 2 - 1, Math.ceil((fc * 2 ** (1 / 6) * N) / TAXA));
        let s = 0;
        for (let k = lo; k <= hi; k++) s += potencia[k];
        return dB(s / (hi - lo + 1) / quadrosVoz);
      });
      // compara formato (não volume): referência = média de 250 Hz a 2 kHz
      const faixa = (lista) => media(lista.filter((_, i) => CENTROS[i] >= 250 && CENTROS[i] <= 2000));
      const refM = faixa(medido), refA = faixa(ALVO);
      const dif = CENTROS.map((_, i) => ALVO[i] - refA - (medido[i] - refM)); // + = falta, - = sobra
      const em = (...fs) => media(fs.map((f) => dif[CENTROS.indexOf(f)]));
      const forca = 0.5;
      const rumble = em(63, 80);
      return {
        versao: 1,
        criado: new Date().toISOString(),
        segundos: Math.round(this.segundos),
        // muito grave sobrando (mesa, ventilador, plosivas) → corta mais embaixo
        graves: rumble < -8 ? 100 : 90,
        bandas: [
          { tipo: 'lowshelf', freq: 150, ganho: +limitar(forca * em(100, 125, 160, 200), -2.5, 0).toFixed(1), q: 0.7 },
          { tipo: 'peaking', freq: 350, ganho: +limitar(forca * em(250, 315, 400, 500), -3, 1.5).toFixed(1), q: 1 },
          { tipo: 'peaking', freq: 1000, ganho: +limitar(forca * em(800, 1000, 1250), -2.5, 2).toFixed(1), q: 1 },
          { tipo: 'peaking', freq: 3200, ganho: +limitar(forca * em(2000, 2500, 3150, 4000, 5000), -3, 3).toFixed(1), q: 0.8 },
          { tipo: 'highshelf', freq: 8000, ganho: +limitar(forca * em(6300, 8000, 10000), -3, 2).toFixed(1), q: 0.7 },
        ],
        tom: 0,
      };
    },
  };
}

// Nome "limpo" do microfone, igual em qualquer PC:
// "Default - Microfone (2- Fifine Microphone) (3142:5060)" → "Fifine Microphone"
export function nomeDoMic(rotulo = '') {
  const s = rotulo.replace(/^(Default|Padrão|Communications|Comunicações)\s*-\s*/i, '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '');
  const dentro = s.match(/^[^(]*\((?:\d+-\s*)?(.+)\)$/);
  return ((dentro ? dentro[1] : s).trim() || 'Microfone').slice(0, 120);
}
