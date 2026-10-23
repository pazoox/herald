// Gera as imagens do instalador (BMP, exigido pelo instalador do Windows).
// Rode com: npx electron scripts/instalador.js
//   build/instalador-lateral.bmp  164x314  (telas de boas-vindas e fim)
//   build/instalador-topo.bmp     150x57   (topo das outras telas)

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const corvo = fs.readFileSync(path.join(raiz, 'src', 'renderer', 'marca', 'herald.svg'), 'utf8');
const corvoUrl = 'data:image/svg+xml;base64,' + Buffer.from(corvo).toString('base64');

const base = `
  * { margin: 0; box-sizing: border-box; }
  html, body { overflow: hidden; background: #000; }
  body { position: absolute; left: 0; top: 0; width: var(--w); height: var(--h); }
  body { font-family: 'Segoe UI Variable Display', 'Segoe UI', sans-serif; color: #f4f2f8; -webkit-font-smoothing: antialiased; }
  img { image-rendering: pixelated; display: block; }
`;

const LATERAL = `<html><head><style>${base}
  body {
    background:
      radial-gradient(180px 160px at 50% 30%, #b18cff33, transparent 70%),
      linear-gradient(180deg, #17121f 0%, #0b0a0f 100%);
    display: flex; flex-direction: column; align-items: center; padding-top: 46px;
  }
  img { width: 122px; }
  h1 { margin-top: 16px; font-size: 30px; font-weight: 700; letter-spacing: -0.6px; }
  p { margin-top: 6px; font-size: 12px; color: #aaa5b8; text-align: center; line-height: 1.45; padding: 0 16px; }
  .linha { position: absolute; bottom: 0; left: 0; right: 0; height: 4px; background: #b18cff; }
</style></head><body>
  <img src="${corvoUrl}">
  <h1>Herald</h1>
  <p>Voice and screen<br>for your crew</p>
  <div class="linha"></div>
</body></html>`;

const TOPO = `<html><head><style>${base}
  body { background: #0b0a0f; display: flex; align-items: center; justify-content: center; gap: 8px; }
  img { width: 40px; }
  b { font-size: 19px; font-weight: 700; letter-spacing: -0.3px; }
</style></head><body><img src="${corvoUrl}"><b>Herald</b></body></html>`;

// BMP 24 bits, de baixo pra cima, linhas alinhadas em 4 bytes
function bmp(imagem) {
  const { width: w, height: h } = imagem.getSize();
  const bgra = imagem.toBitmap();
  const linha = Math.ceil((w * 3) / 4) * 4;
  const dados = Buffer.alloc(linha * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const o = (h - 1 - y) * linha + x * 3;
      dados[o] = bgra[i];
      dados[o + 1] = bgra[i + 1];
      dados[o + 2] = bgra[i + 2];
    }
  }
  const cab = Buffer.alloc(54);
  cab.write('BM', 0);
  cab.writeUInt32LE(54 + dados.length, 2);
  cab.writeUInt32LE(54, 10);
  cab.writeUInt32LE(40, 14);
  cab.writeInt32LE(w, 18);
  cab.writeInt32LE(h, 22);
  cab.writeUInt16LE(1, 26);
  cab.writeUInt16LE(24, 28);
  cab.writeUInt32LE(dados.length, 34);
  return Buffer.concat([cab, dados]);
}

async function fotografar(html, largura, altura, saida) {
  // janela bem maior que a arte (o Windows não cria janelas minúsculas); depois recorta
  const janela = new BrowserWindow({ width: 600, height: 600, show: false, useContentSize: true, webPreferences: { offscreen: true } });
  html = html.replace('<style>', `<style>:root{--w:${largura}px;--h:${altura}px}`);
  janela.webContents.setZoomFactor(1);
  const temp = path.join(app.getPath('temp'), `herald-arte-${largura}x${altura}.html`);
  fs.writeFileSync(temp, html);
  await janela.loadFile(temp);
  await new Promise((r) => setTimeout(r, 300));
  let imagem = await janela.webContents.capturePage({ x: 0, y: 0, width: largura, height: altura });
  if (imagem.getSize().width !== largura) imagem = imagem.resize({ width: largura, height: altura, quality: 'best' });
  fs.writeFileSync(saida, bmp(imagem));
  fs.writeFileSync(saida.replace('.bmp', '.png'), imagem.toPNG()); // prévia
  janela.destroy();
}

app.on('window-all-closed', () => {}); // não sai entre uma imagem e outra
app.whenReady().then(async () => {
  await fotografar(LATERAL, 164, 314, path.join(raiz, 'build', 'instalador-lateral.bmp'));
  await fotografar(TOPO, 150, 57, path.join(raiz, 'build', 'instalador-topo.bmp'));
  console.log('Imagens do instalador geradas.');
  app.quit();
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
