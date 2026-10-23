// Gera o mascote do Herald (o corvo) em SVG, PNG e ICO a partir de scripts/corvo.json.
// Rode com: npm run mascote
//
// corvo.json tem 3 quadros em pixel art (asa fechada, no meio e em cima).
// Cada letra da grade é uma cor da paleta; '.' é transparente.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { largura: W, altura: H, paleta: CORES, quadros } = require('./corvo.json');
const { fechada, meio, cima } = quadros;

// Linhas vazias em cima (espaço pra asa levantada) — o desenho parado corta isso
const TOPO = fechada.findIndex((l) => /[^.]/.test(l));

// ---------- SVG ----------
function retangulos(linhas, filtro = () => true, deslocY = 0) {
  let out = '';
  linhas.forEach((linha, y) => {
    let x = 0;
    while (x < linha.length) {
      const c = linha[x];
      if (c === '.' || !filtro(x, y)) { x++; continue; }
      let fim = x;
      while (fim < linha.length && linha[fim] === c && filtro(fim, y)) fim++;
      out += `<rect x="${x}" y="${y + deslocY}" width="${fim - x}" height="1" fill="${CORES[c]}"/>`;
      x = fim;
    }
  });
  return out;
}

// Só os pixels que mudam em relação à asa fechada (deixa o arquivo leve)
const diferente = (quadro) => (x, y) => quadro[y][x] !== fechada[y][x];

function svgParado() {
  const linhas = fechada.slice(TOPO);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H - TOPO}" shape-rendering="crispEdges">${retangulos(linhas)}</svg>`;
}

// Animado: pisca de vez em quando e bate as asas a cada 6 segundos
function svgAnimado() {
  const olhos = fechada.map((l) => l.replace(/[^EQ]/g, '.').replace(/[EQ]/g, 'g'));
  const estilo =
    '<style>' +
    '.meio,.cima,.lid{opacity:0;animation:6s infinite}' +
    '.meio{animation-name:meio}.cima{animation-name:cima}.lid{animation:blink 4.3s infinite}' +
    '@keyframes meio{0%,86.6%{opacity:0;animation-timing-function:steps(1,end)}86.7%{opacity:1}88.5%{opacity:0}90.3%{opacity:1}92.2%{opacity:0}94%{opacity:1}95.8%,100%{opacity:0}}' +
    '@keyframes cima{0%,88.4%{opacity:0}88.5%{opacity:1}90.3%{opacity:0}92.2%{opacity:1}94%,100%{opacity:0}}' +
    '@keyframes blink{0%,92%{opacity:0}93%,97%{opacity:1}98%,100%{opacity:0}}' +
    '.meio,.cima{animation-timing-function:steps(1,end)}.lid{animation-timing-function:steps(1,end)}' +
    '@media (prefers-reduced-motion:reduce){.meio,.cima,.lid{animation:none}}' +
    '</style>';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">${estilo}` +
    `<g>${retangulos(fechada)}</g>` +
    `<g class="lid">${retangulos(olhos)}</g>` +
    `<g class="meio">${retangulos(meio, diferente(meio))}</g>` +
    `<g class="cima">${retangulos(cima, diferente(cima))}</g>` +
    '</svg>'
  );
}

// ---------- PNG (sem dependências) ----------
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(tipo, dados) {
  const t = Buffer.from(tipo);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(dados.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, dados])));
  return Buffer.concat([len, t, dados, crc]);
}
function hex(c) {
  return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
}

// Corvo parado centralizado num quadrado arredondado. Em tamanhos pequenos
// faz média dos pixels (fica nítido em 16–32px em vez de virar ruído).
function png(tam, fundo) {
  const linhas = fechada.slice(TOPO);
  const sw = W, sh = H - TOPO;
  const bruta = (tam * 0.82) / Math.max(sw, sh);
  const escala = bruta >= 2 ? Math.floor(bruta) : bruta; // grande: pixels inteiros, nítidos
  const offX = bruta >= 2 ? Math.floor((tam - sw * escala) / 2) : (tam - sw * escala) / 2;
  const offY = bruta >= 2 ? Math.floor((tam - sh * escala) / 2) : (tam - sh * escala) / 2;
  const raio = tam * 0.22;
  const bg = hex(fundo);
  const raw = Buffer.alloc((tam * 4 + 1) * tam);
  for (let y = 0; y < tam; y++) {
    raw[y * (tam * 4 + 1)] = 0;
    for (let x = 0; x < tam; x++) {
      const i = y * (tam * 4 + 1) + 1 + x * 4;
      // área do pixel de saída na grade do corvo
      const x0 = (x - offX) / escala, x1 = (x + 1 - offX) / escala;
      const y0 = (y - offY) / escala, y1 = (y + 1 - offY) / escala;
      let soma = [0, 0, 0], peso = 0, total = 0;
      for (let gy = Math.floor(y0); gy < Math.ceil(y1); gy++) {
        for (let gx = Math.floor(x0); gx < Math.ceil(x1); gx++) {
          const cobre = (Math.min(gx + 1, x1) - Math.max(gx, x0)) * (Math.min(gy + 1, y1) - Math.max(gy, y0));
          if (cobre <= 0) continue;
          total += cobre;
          const c = gy >= 0 && gy < sh && gx >= 0 && gx < sw ? linhas[gy][gx] : '.';
          if (c === '.') continue;
          const rgb = hex(CORES[c]);
          soma = soma.map((v, k) => v + rgb[k] * cobre);
          peso += cobre;
        }
      }
      const a = total ? peso / total : 0;
      const corvo = peso ? soma.map((v) => v / peso) : bg;
      const dentro = dentroArredondado(x + 0.5, y + 0.5, tam, raio);
      if (!dentro) continue;
      raw.set([...corvo.map((v, k) => Math.round(v * a + bg[k] * (1 - a))), 255], i);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tam, 0);
  ihdr.writeUInt32BE(tam, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function dentroArredondado(x, y, tam, r) {
  const cx = Math.min(Math.max(x, r), tam - r);
  const cy = Math.min(Math.max(y, r), tam - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// ICO com PNGs dentro (Windows Vista+)
function ico(pngs) {
  const cab = Buffer.alloc(6);
  cab.writeUInt16LE(1, 2);
  cab.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entradas = pngs.map(({ tam, dados }) => {
    const e = Buffer.alloc(16);
    e[0] = tam >= 256 ? 0 : tam;
    e[1] = tam >= 256 ? 0 : tam;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(dados.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += dados.length;
    return e;
  });
  return Buffer.concat([cab, ...entradas, ...pngs.map((p) => p.dados)]);
}

// ---------- Saída ----------
const raiz = path.join(__dirname, '..');
const destinos = [path.join(raiz, 'src', 'renderer', 'marca'), path.join(raiz, 'landing', 'marca')];
// Ícone: corvo escuro sobre lavanda (contraste bom até em 16px)
const FUNDO = '#b18cff';

for (const dir of destinos) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'herald.svg'), svgParado());
  fs.writeFileSync(path.join(dir, 'herald-animado.svg'), svgAnimado());
}
fs.writeFileSync(path.join(raiz, 'landing', 'marca', 'og.png'), png(512, FUNDO));
fs.mkdirSync(path.join(raiz, 'build'), { recursive: true });
const tamanhos = [16, 24, 32, 48, 64, 128, 256];
fs.writeFileSync(path.join(raiz, 'build', 'icon.ico'), ico(tamanhos.map((tam) => ({ tam, dados: png(tam, FUNDO) }))));
fs.writeFileSync(path.join(raiz, 'build', 'icon.png'), png(512, FUNDO));

console.log('Mascote gerado.');
