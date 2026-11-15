// Court: mini-games pra escapar de um efeito. Cada efeito tem um jogo com o tema dele.
// Quem joga roda a lógica e manda o "estado" do jogo pra call; quem assiste só desenha esse
// estado com a mesma função de desenho — por isso tudo que aparece na tela mora no estado.

export const DURACAO_FUGA = 15000;
const W = 360;
const H = 220;

export const JOGOS = {
  helium: { nome: 'Pop the balloons', dica: 'Click 8 balloons before they float away' },
  monster: { nome: 'Tame the beast', dica: 'Press the arrow keys in order' },
  underwater: { nome: 'Swim up', dica: 'Mash Space (or click) to reach the surface' },
  censura: { nome: 'Cut the wire', dica: 'Click the wire with the color shown, 4 times — read carefully' },
  silencio: { nome: 'Catch the mic', dica: "Click the microphone 5 times — it won't sit still" },
  vergonha: { nome: 'Pick the lock', dica: 'Press Space when the pin is in the green zone, 3 times' },
  robo: { nome: 'Reboot', dica: 'Type the code on the screen — twice' },
  longe: { nome: 'Run back', dica: 'Alternate ← and → to run back to the call' },
  atraso: { nome: 'Beat the lag', dica: 'Click (or Space) the moment it turns green, 3 times — not before!' },
  engracado: { nome: 'Pop quiz', dica: 'Answer 4 questions — click or press 1, 2, 3' },
  loser: { nome: "Prove you're no loser", dica: 'Watch the tiles light up, then repeat (click or 1–4)' },
};

const COR = { fundo: '#15131c', painel: '#221f2c', texto: '#f4f2f8', fraco: '#8a8499', lima: '#d6f36a', lilas: '#b18cff', erro: '#f27a6a' };
const FIOS = [
  ['red', '#e2483d'], ['blue', '#3d7be2'], ['green', '#4fc26a'], ['yellow', '#f2c94c'], ['white', '#eceaf2'],
];
const SETAS = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
const LETRAS = 'ABCDEFHJKLMNPRTUVWXY2345678';
const SIMON = ['#f27a6a', '#4fb2f0', '#d6f36a', '#f2c94c'];
const embaralhar = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map(([, v]) => v);

// ---------------------------------------------------------------- regras de cada jogo
const REGRAS = {
  helium: {
    inicio: () => ({ baloes: [], estourados: 0, meta: 8, proximo: 0 }),
    passo(e, dt) {
      e.proximo -= dt;
      if (e.proximo <= 0) {
        e.proximo = 0.55;
        e.baloes.push({ x: 30 + Math.random() * (W - 60), y: H + 20, r: 15 + Math.random() * 6, v: 45 + Math.random() * 35, c: Math.floor(Math.random() * 5) });
      }
      for (const b of e.baloes) b.y -= b.v * dt;
      e.baloes = e.baloes.filter((b) => b.y > -30);
    },
    clique(e, x, y) {
      const i = e.baloes.findIndex((b) => Math.hypot(b.x - x, b.y - y) <= b.r + 4);
      if (i >= 0) {
        e.baloes.splice(i, 1);
        e.estourados++;
      }
    },
    venceu: (e) => e.estourados >= e.meta,
    progresso: (e) => e.estourados / e.meta,
  },
  monster: {
    inicio: () => ({ seq: Array.from({ length: 8 }, () => Math.floor(Math.random() * 4)), i: 0, erro: 0 }),
    passo(e, dt) { e.erro = Math.max(0, e.erro - dt); },
    tecla(e, k) {
      const d = SETAS.indexOf(k) >= 0 ? SETAS.indexOf(k) : ['w', 'd', 's', 'a'].indexOf(k.toLowerCase());
      if (d < 0) return;
      if (d === e.seq[e.i]) e.i++;
      else {
        e.i = Math.max(0, e.i - 1);
        e.erro = 0.3;
      }
    },
    venceu: (e) => e.i >= e.seq.length,
    progresso: (e) => e.i / e.seq.length,
  },
  underwater: {
    inicio: () => ({ prof: 100, bolhas: [], chegou: false }),
    passo(e, dt) {
      if (!e.chegou) e.prof = Math.min(100, e.prof + 8 * dt);
      for (const b of e.bolhas) b.y -= 60 * dt;
      e.bolhas = e.bolhas.filter((b) => b.y > 20);
    },
    nadar(e) {
      e.prof = Math.max(0, e.prof - 5.5);
      if (e.prof <= 0) e.chegou = true; // chegou na superfície: vale na hora, sem afundar de volta
      e.bolhas.push({ x: W / 2 + (Math.random() * 30 - 15), y: 40 + e.prof * 1.5 });
    },
    tecla(e, k) { if (k === ' ') REGRAS.underwater.nadar(e); },
    clique(e) { REGRAS.underwater.nadar(e); },
    venceu: (e) => e.chegou,
    progresso: (e) => 1 - e.prof / 100,
  },
  censura: {
    inicio() {
      // pegadinha: em 1 ou 2 rodadas (nunca nas 2 primeiras) o nome da cor vem escrito com OUTRA cor
      const truques = Math.random() < 0.5 ? [2] : [2, 3];
      if (truques.length === 1 && Math.random() < 0.5) truques[0] = 3;
      const e = { rodada: 0, meta: 4, erro: 0, truques };
      REGRAS.censura.nova(e);
      return e;
    },
    nova(e) {
      e.fios = embaralhar([0, 1, 2, 3, 4]);
      e.alvo = Math.floor(Math.random() * 5);
      e.corTexto = e.alvo;
      if (e.truques.includes(e.rodada)) e.corTexto = (e.alvo + 1 + Math.floor(Math.random() * 4)) % 5;
    },
    passo(e, dt) { e.erro = Math.max(0, e.erro - dt); },
    clique(e, x, y) {
      if (y < 70 || y > 200) return;
      const i = Math.round((x - 60) / 60);
      if (i < 0 || i > 4) return;
      if (e.fios[i] === e.alvo) e.rodada++;
      else e.erro = 0.4;
      REGRAS.censura.nova(e);
    },
    venceu: (e) => e.rodada >= e.meta,
    progresso: (e) => e.rodada / e.meta,
  },
  silencio: {
    // o microfone foge pela tela, quica nas bordas e muda de direção de vez em quando
    inicio: () => ({ x: W / 2, y: H / 2, vx: 120, vy: 90, pegos: 0, meta: 5, troca: 0.8, erro: 0, acerto: 0 }),
    passo(e, dt) {
      e.erro = Math.max(0, e.erro - dt);
      e.acerto = Math.max(0, e.acerto - dt);
      e.troca -= dt;
      if (e.troca <= 0) {
        const ang = Math.random() * Math.PI * 2;
        const vel = 120 + e.pegos * 25;
        e.vx = Math.cos(ang) * vel;
        e.vy = Math.sin(ang) * vel;
        e.troca = 0.5 + Math.random() * 0.7;
      }
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      if (e.x < 22 || e.x > W - 22) { e.vx *= -1; e.x = Math.max(22, Math.min(W - 22, e.x)); }
      if (e.y < 40 || e.y > H - 22) { e.vy *= -1; e.y = Math.max(40, Math.min(H - 22, e.y)); }
    },
    clique(e, x, y) {
      if (Math.hypot(e.x - x, e.y - y) <= 32) {
        e.pegos++;
        e.acerto = 0.25;
        e.troca = 0; // escapa pra outro lado na hora
      } else e.erro = 0.25;
    },
    venceu: (e) => e.pegos >= e.meta,
    progresso: (e) => e.pegos / e.meta,
  },
  vergonha: {
    inicio: () => ({ pos: 0, dir: 1, acertos: 0, meta: 3, erro: 0, zona: { ini: 0.55, larg: 0.18 } }),
    passo(e, dt) {
      e.erro = Math.max(0, e.erro - dt);
      e.pos += e.dir * (0.9 + e.acertos * 0.25) * dt;
      if (e.pos > 1) { e.pos = 1; e.dir = -1; }
      if (e.pos < 0) { e.pos = 0; e.dir = 1; }
    },
    tecla(e, k) { if (k === ' ') REGRAS.vergonha.tentar(e); },
    clique(e) { REGRAS.vergonha.tentar(e); },
    tentar(e) {
      if (e.pos >= e.zona.ini && e.pos <= e.zona.ini + e.zona.larg) {
        e.acertos++;
        const larg = Math.max(0.1, e.zona.larg - 0.03);
        e.zona = { ini: Math.random() * (1 - larg), larg };
      } else e.erro = 0.35;
    },
    venceu: (e) => e.acertos >= e.meta,
    progresso: (e) => e.acertos / e.meta,
  },
  robo: {
    inicio: () => ({ codigos: [0, 1].map(() => Array.from({ length: 4 }, () => LETRAS[Math.floor(Math.random() * LETRAS.length)]).join('')), c: 0, i: 0, erro: 0 }),
    passo(e, dt) { e.erro = Math.max(0, e.erro - dt); },
    tecla(e, k) {
      if (k.length !== 1 || e.c >= e.codigos.length) return;
      if (k.toUpperCase() === e.codigos[e.c][e.i]) {
        e.i++;
        if (e.i >= e.codigos[e.c].length) { e.c++; e.i = 0; }
      } else {
        e.i = 0; // errou: o código volta do começo
        e.erro = 0.35;
      }
    },
    venceu: (e) => e.c >= e.codigos.length,
    progresso: (e) => (e.c * 4 + e.i) / (e.codigos.length * 4),
  },
  longe: {
    inicio: () => ({ passos: 0, meta: 24, ultimo: null, erro: 0, pe: 0 }),
    passo(e, dt) { e.erro = Math.max(0, e.erro - dt); },
    tecla(e, k) {
      const lado = k === 'ArrowLeft' || k.toLowerCase() === 'a' ? 'e' : k === 'ArrowRight' || k.toLowerCase() === 'd' ? 'd' : null;
      if (!lado) return;
      if (lado === e.ultimo) { e.erro = 0.25; return; } // tem que alternar
      e.ultimo = lado;
      e.passos++;
      e.pe ^= 1;
    },
    venceu: (e) => e.passos >= e.meta,
    progresso: (e) => e.passos / e.meta,
  },
  atraso: {
    inicio: () => ({ fase: 'espera', t: 1 + Math.random() * 1.3, acertos: 0, meta: 3, ms: null, aviso: 0, resultado: null }),
    passo(e, dt) {
      e.aviso = Math.max(0, e.aviso - dt);
      if (e.fase === 'ja') {
        e.t += dt;
        if (e.t > 0.6) REGRAS.atraso.proxima(e, 'lento');
      } else {
        e.t -= dt;
        if (e.t <= 0) { e.fase = 'ja'; e.t = 0; }
      }
    },
    proxima(e, resultado) {
      e.resultado = resultado;
      e.aviso = 0.9;
      e.fase = 'espera';
      e.t = (resultado === 'cedo' ? 1.2 : 0.7) + Math.random() * 1.4;
    },
    apertar(e) {
      if (e.fase === 'ja') {
        e.ms = Math.round(e.t * 1000);
        e.acertos++;
        REGRAS.atraso.proxima(e, 'ok');
      } else REGRAS.atraso.proxima(e, 'cedo');
    },
    tecla(e, k) { if (k === ' ') REGRAS.atraso.apertar(e); },
    clique(e) { REGRAS.atraso.apertar(e); },
    venceu: (e) => e.acertos >= e.meta,
    progresso: (e) => e.acertos / e.meta,
  },
  engracado: {
    inicio() {
      const e = { acertos: 0, meta: 4, erro: 0 };
      REGRAS.engracado.nova(e);
      return e;
    },
    nova(e) {
      const vezes = Math.random() < 0.4;
      const a = vezes ? 3 + Math.floor(Math.random() * 7) : 12 + Math.floor(Math.random() * 40);
      const b = vezes ? 3 + Math.floor(Math.random() * 7) : 8 + Math.floor(Math.random() * 30);
      const certo = vezes ? a * b : a + b;
      const errados = new Set();
      while (errados.size < 2) {
        const d = [1, 2, 10, -1, -2, -10][Math.floor(Math.random() * 6)];
        if (certo + d > 0) errados.add(certo + d);
      }
      e.conta = `${a} ${vezes ? '×' : '+'} ${b}`;
      e.ops = embaralhar([certo, ...errados]);
      e.certo = e.ops.indexOf(certo);
    },
    passo(e, dt) { e.erro = Math.max(0, e.erro - dt); },
    responder(e, i) {
      if (i === e.certo) e.acertos++;
      else e.erro = 0.4;
      REGRAS.engracado.nova(e);
    },
    tecla(e, k) { if (['1', '2', '3'].includes(k)) REGRAS.engracado.responder(e, Number(k) - 1); },
    clique(e, x, y) {
      if (y < 110 || y > 180) return;
      const i = Math.floor((x - 30) / 100);
      if (i >= 0 && i <= 2) REGRAS.engracado.responder(e, i);
    },
    venceu: (e) => e.acertos >= e.meta,
    progresso: (e) => e.acertos / e.meta,
  },
  loser: {
    inicio() {
      const e = { rodada: 0, tamanhos: [3, 5], erro: 0, aceso: -1 };
      REGRAS.loser.nova(e, true);
      return e;
    },
    nova(e, sortear) {
      if (sortear) e.seq = Array.from({ length: e.tamanhos[e.rodada] }, () => Math.floor(Math.random() * 4));
      e.fase = 'mostra';
      e.i = 0;
      e.t = -0.6; // pausinha antes de começar a mostrar
    },
    passo(e, dt) {
      e.erro = Math.max(0, e.erro - dt);
      if (e.fase === 'mostra') {
        e.t += dt;
        const passo = 0.6;
        const n = Math.floor(e.t / passo);
        e.aceso = e.t >= 0 && n < e.seq.length && e.t % passo < 0.42 ? e.seq[n] : -1;
        if (n >= e.seq.length) { e.fase = 'repete'; e.i = 0; e.aceso = -1; }
      } else if (e.aceso >= 0) {
        e.t -= dt;
        if (e.t <= 0) e.aceso = -1;
      }
    },
    escolher(e, b) {
      if (e.fase !== 'repete' || b < 0 || b > 3) return;
      e.aceso = b;
      e.t = 0.18;
      if (b !== e.seq[e.i]) {
        e.erro = 0.5;
        REGRAS.loser.nova(e, false); // mostra a mesma sequência de novo
        return;
      }
      e.i++;
      if (e.i >= e.seq.length) {
        e.rodada++;
        if (e.rodada < e.tamanhos.length) REGRAS.loser.nova(e, true);
      }
    },
    tecla(e, k) { if (['1', '2', '3', '4'].includes(k)) REGRAS.loser.escolher(e, Number(k) - 1); },
    clique(e, x, y) {
      if (y < 70 || y > 150 || x < 40) return;
      if ((x - 40) % 72 <= 64) REGRAS.loser.escolher(e, Math.floor((x - 40) / 72));
    },
    venceu: (e) => e.rodada >= e.tamanhos.length,
    progresso: (e) => (e.rodada + (e.fase === 'repete' && e.seq ? e.i / e.seq.length : 0)) / e.tamanhos.length,
  },
};

// ---------------------------------------------------------------- desenho (o mesmo pra quem joga e quem assiste)
function texto(g, s, x, y, { tam = 13, cor = COR.texto, peso = 700, alinha = 'center' } = {}) {
  g.font = `${peso} ${tam}px "Manrope Variable", system-ui, sans-serif`;
  g.fillStyle = cor;
  g.textAlign = alinha;
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
}

function seta(g, x, y, dir, cor) {
  g.save();
  g.translate(x, y);
  g.rotate((dir * Math.PI) / 2);
  g.fillStyle = cor;
  g.beginPath();
  g.moveTo(0, -12);
  g.lineTo(11, 4);
  g.lineTo(4, 4);
  g.lineTo(4, 12);
  g.lineTo(-4, 12);
  g.lineTo(-4, 4);
  g.lineTo(-11, 4);
  g.closePath();
  g.fill();
  g.restore();
}

const DESENHO = {
  helium(g, e) {
    const cores = ['#f27a6a', '#b18cff', '#d6f36a', '#6ad1f2', '#f2c94c'];
    for (const b of e.baloes) {
      g.strokeStyle = '#8a849966';
      g.beginPath();
      g.moveTo(b.x, b.y + b.r);
      g.lineTo(b.x + 3, b.y + b.r + 18);
      g.stroke();
      g.fillStyle = cores[b.c];
      g.beginPath();
      g.ellipse(b.x, b.y, b.r * 0.85, b.r, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffffff55';
      g.beginPath();
      g.ellipse(b.x - b.r * 0.3, b.y - b.r * 0.35, b.r * 0.2, b.r * 0.3, -0.4, 0, Math.PI * 2);
      g.fill();
    }
    texto(g, `🎈 ${e.estourados} / ${e.meta}`, W / 2, 20, { tam: 14 });
  },
  monster(g, e) {
    const esp = 40;
    const x0 = W / 2 - ((e.seq.length - 1) * esp) / 2;
    e.seq.forEach((d, i) => {
      const cor = i < e.i ? COR.lima : i === e.i ? (e.erro > 0 ? COR.erro : COR.texto) : COR.fraco;
      g.fillStyle = i === e.i ? '#ffffff14' : 'transparent';
      g.fillRect(x0 + i * esp - 17, 92, 34, 36);
      seta(g, x0 + i * esp, 110, d, cor);
    });
    texto(g, '👹', W / 2, 55, { tam: 36 });
  },
  underwater(g, e) {
    const grad = g.createLinearGradient(0, 30, 0, H);
    grad.addColorStop(0, '#2a6f8f');
    grad.addColorStop(1, '#0d2233');
    g.fillStyle = grad;
    g.fillRect(0, 30, W, H - 30);
    g.fillStyle = '#7fd4f2';
    g.fillRect(0, 28, W, 3);
    for (const b of e.bolhas) {
      g.strokeStyle = '#c8f0ff';
      g.beginPath();
      g.arc(b.x, b.y, 4, 0, Math.PI * 2);
      g.stroke();
    }
    texto(g, '🤿', W / 2, 45 + e.prof * 1.5, { tam: 28 });
    texto(g, '☀️', W - 30, 14, { tam: 16 });
  },
  censura(g, e) {
    texto(g, 'Cut the', W / 2 - 34, 30, { tam: 14, cor: COR.fraco });
    texto(g, FIOS[e.alvo][0].toUpperCase(), W / 2 + 34, 30, { tam: 16, cor: FIOS[e.corTexto ?? e.alvo][1], peso: 800 });
    e.fios.forEach((f, i) => {
      const x = 60 + i * 60;
      g.strokeStyle = FIOS[f][1];
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(x, 70);
      g.bezierCurveTo(x - 14, 110, x + 14, 160, x, 200);
      g.stroke();
    });
    g.lineWidth = 1;
    if (e.erro > 0) texto(g, '💥', W / 2, 140, { tam: 40 });
    texto(g, `✂️ ${e.rodada} / ${e.meta}`, W / 2, 210, { tam: 12, cor: COR.fraco });
  },
  silencio(g, e) {
    if (e.acerto > 0) {
      g.strokeStyle = COR.lima;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(e.x, e.y, 30 + (0.25 - e.acerto) * 60, 0, Math.PI * 2);
      g.stroke();
      g.lineWidth = 1;
    }
    texto(g, '🎤', e.x, e.y, { tam: 30 });
    texto(g, `🎤 ${e.pegos} / ${e.meta}`, W / 2, 20, { tam: 14, cor: e.erro > 0 ? COR.erro : COR.texto });
  },
  vergonha(g, e) {
    const x0 = 40;
    const larg = W - 80;
    g.fillStyle = COR.painel;
    g.fillRect(x0, 100, larg, 26);
    g.fillStyle = '#4fc26a';
    g.fillRect(x0 + e.zona.ini * larg, 100, e.zona.larg * larg, 26);
    g.fillStyle = e.erro > 0 ? COR.erro : COR.texto;
    g.fillRect(x0 + e.pos * larg - 3, 92, 6, 42);
    for (let i = 0; i < e.meta; i++) texto(g, i < e.acertos ? '🔓' : '🔒', W / 2 - 30 + i * 30, 60, { tam: 20 });
  },
  robo(g, e) {
    texto(g, '🤖', W / 2, 42, { tam: 34 });
    texto(g, 'SYSTEM FAILURE · ENTER CODE', W / 2, 80, { tam: 11, cor: COR.fraco, peso: 800 });
    const cod = e.codigos[Math.min(e.c, e.codigos.length - 1)];
    const x0 = W / 2 - 1.5 * 52;
    [...cod].forEach((ch, i) => {
      const feito = e.c >= e.codigos.length || i < e.i;
      g.fillStyle = e.erro > 0 ? '#f27a6a22' : i === e.i ? '#ffffff14' : COR.painel;
      g.fillRect(x0 + i * 52 - 22, 100, 44, 52);
      texto(g, ch, x0 + i * 52, 127, { tam: 28, peso: 800, cor: feito ? COR.lima : e.erro > 0 ? COR.erro : COR.texto });
    });
    texto(g, `${Math.min(e.c + 1, e.codigos.length)} / ${e.codigos.length}`, W / 2, 180, { tam: 12, cor: COR.fraco });
  },
  longe(g, e) {
    g.fillStyle = COR.painel;
    g.fillRect(30, 150, W - 60, 4);
    const x = 50 + (e.passos / e.meta) * (W - 130);
    texto(g, '👥', W - 45, 125, { tam: 34 });
    g.save();
    g.translate(x, 128 - e.pe * 4);
    g.scale(-1, 1); // vira o corredor pra direita
    texto(g, '🏃', 0, 0, { tam: 32 });
    g.restore();
    // a seta que vale agora fica acesa
    const proxima = e.ultimo === 'e' ? 'd' : e.ultimo === 'd' ? 'e' : null;
    const cor = (lado) => (e.erro > 0 ? COR.erro : !proxima || proxima === lado ? COR.lima : COR.fraco);
    seta(g, W / 2 - 30, 60, 3, cor('e'));
    seta(g, W / 2 + 30, 60, 1, cor('d'));
    texto(g, `${e.passos} / ${e.meta}`, W / 2, 190, { tam: 12, cor: COR.fraco });
  },
  atraso(g, e) {
    const ja = e.fase === 'ja';
    g.fillStyle = ja ? '#2f7a43' : '#3a2230';
    g.fillRect(20, 30, W - 40, 150);
    texto(g, ja ? 'NOW!' : 'wait…', W / 2, 95, { tam: ja ? 40 : 26, peso: 800, cor: ja ? '#eaffd8' : '#f2b6b0' });
    if (e.aviso > 0 && e.fase === 'espera') {
      const msg = e.resultado === 'ok' ? `✓ ${e.ms} ms` : e.resultado === 'cedo' ? 'Too early!' : 'Too slow!';
      texto(g, msg, W / 2, 140, { tam: 16, cor: e.resultado === 'ok' ? COR.lima : COR.erro });
    }
    for (let i = 0; i < e.meta; i++) texto(g, i < e.acertos ? '⚡' : '·', W / 2 - 30 + i * 30, 200, { tam: 18, cor: COR.fraco });
  },
  engracado(g, e) {
    texto(g, `${e.conta} = ?`, W / 2, 65, { tam: 32, peso: 800, cor: e.erro > 0 ? COR.erro : COR.texto });
    e.ops.forEach((op, i) => {
      g.fillStyle = COR.painel;
      g.fillRect(30 + i * 100 + 6, 110, 88, 70);
      texto(g, String(i + 1), 30 + i * 100 + 18, 122, { tam: 10, cor: COR.fraco });
      texto(g, String(op), 30 + i * 100 + 50, 147, { tam: 22, peso: 800 });
    });
    texto(g, `🥁 ${e.acertos} / ${e.meta}`, W / 2, 20, { tam: 13 });
  },
  loser(g, e) {
    texto(g, e.fase === 'mostra' ? 'Watch…' : 'Your turn!', W / 2, 40, { tam: 16, peso: 800, cor: e.erro > 0 ? COR.erro : e.fase === 'mostra' ? COR.fraco : COR.lima });
    for (let b = 0; b < 4; b++) {
      const x = 40 + b * 72;
      g.globalAlpha = e.aceso === b ? 1 : 0.22;
      g.fillStyle = SIMON[b];
      g.fillRect(x, 74, 64, 72);
      g.globalAlpha = 1;
      texto(g, String(b + 1), x + 32, 110, { tam: 16, cor: e.aceso === b ? '#15131c' : COR.fraco });
    }
    const pontos = e.seq.map((_, i) => (e.fase === 'repete' && i < e.i ? '●' : '○')).join(' ');
    texto(g, pontos, W / 2, 172, { tam: 14, cor: COR.fraco });
    texto(g, `🧢 ${e.rodada} / ${e.tamanhos.length}`, W / 2, 200, { tam: 12, cor: COR.fraco });
  },
};

export function desenharJogo(efeito, canvas, e) {
  const g = canvas.getContext('2d');
  // o jogo é pensado em 360×220; a tela de verdade tem mais pixels (pra não ficar borrado) e a gente só amplia o desenho
  const k = canvas.width / W;
  g.setTransform(k, 0, 0, k, 0, 0);
  g.imageSmoothingQuality = 'high';
  g.fillStyle = COR.fundo;
  g.fillRect(0, 0, W, H);
  if (!e) return;
  DESENHO[efeito](g, e);
  // tempo restante (barrinha embaixo)
  g.fillStyle = '#ffffff12';
  g.fillRect(0, H - 4, W, 4);
  g.fillStyle = e.restante < 4 ? COR.erro : COR.lilas;
  g.fillRect(0, H - 4, W * Math.max(0, e.restante / (DURACAO_FUGA / 1000)), 4);
  if (e.fim) {
    g.fillStyle = '#0b0a0fcc';
    g.fillRect(0, 0, W, H);
    texto(g, e.fim === 'venceu' ? 'ESCAPED!' : 'CAUGHT', W / 2, H / 2, { tam: 26, peso: 800, cor: e.fim === 'venceu' ? COR.lima : COR.erro });
  }
}

// ---------------------------------------------------------------- jogar (só quem está tentando escapar)
export function criarJogo(efeito, canvas, { aoEstado, aoFim }) {
  // resolução real = tamanho na tela × densidade do monitor (fica nítido em qualquer zoom do Windows)
  const larguraTela = canvas.getBoundingClientRect?.().width || W * 1.5;
  const k = Math.max(1, (larguraTela / W) * (globalThis.devicePixelRatio || 1));
  canvas.width = Math.round(W * k);
  canvas.height = Math.round(H * k);
  const regra = REGRAS[efeito];
  const e = regra.inicio();
  const inicio = performance.now();
  let antes = inicio;
  let ultimoEnvio = 0;
  let acabou = false;

  const fim = (venceu) => {
    if (acabou) return;
    acabou = true;
    e.fim = venceu ? 'venceu' : 'perdeu';
    desenharJogo(efeito, canvas, e);
    aoEstado?.(structuredClone(e), regra.progresso(e));
    parar();
    setTimeout(() => aoFim(venceu), 900);
  };

  const quadro = (agora) => {
    if (acabou) return;
    const dt = Math.min(0.05, (agora - antes) / 1000);
    antes = agora;
    e.restante = Math.max(0, (DURACAO_FUGA - (agora - inicio)) / 1000);
    regra.passo(e, dt);
    desenharJogo(efeito, canvas, e);
    if (agora - ultimoEnvio > 100) {
      ultimoEnvio = agora;
      aoEstado?.(structuredClone(e), regra.progresso(e));
    }
    if (regra.venceu(e)) return fim(true);
    if (e.restante <= 0) return fim(false);
    raf = requestAnimationFrame(quadro);
  };
  let raf = requestAnimationFrame(quadro);

  const tecla = (ev) => {
    if (acabou || !regra.tecla || ev.repeat) return;
    ev.preventDefault();
    ev.stopPropagation();
    regra.tecla(e, ev.key);
  };
  const clique = (ev) => {
    if (acabou || !regra.clique) return;
    const r = canvas.getBoundingClientRect();
    regra.clique(e, ((ev.clientX - r.left) / r.width) * W, ((ev.clientY - r.top) / r.height) * H);
  };
  window.addEventListener('keydown', tecla, true);
  canvas.addEventListener('pointerdown', clique);

  function parar() {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', tecla, true);
    canvas.removeEventListener('pointerdown', clique);
  }
  return { parar: () => { acabou = true; parar(); } };
}
