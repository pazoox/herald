// Processo principal do Electron: cria a janela, libera microfone/tela,
// mostra as telas/janelas pra escolher e registra os atalhos globais.

const { app, BrowserWindow, session, desktopCapturer, ipcMain, globalShortcut, shell, Menu, protocol, net, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// A interface é servida por app://herald/ (em vez de file://) pra poder carregar
// os módulos de áudio (AudioWorklet + WebAssembly) que tratam o microfone.
const PASTA_INTERFACE = path.join(__dirname, 'renderer');
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// HERALD_PERFIL=2 abre uma segunda cópia separada (pra testar com você mesmo)
if (process.env.HERALD_PERFIL) {
  app.setPath('userData', path.join(app.getPath('userData'), `perfil-${process.env.HERALD_PERFIL}`));
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

app.setAppUserModelId('app.herald');

// Links herald://invite/CODIGO abrem o app e entram no Nest
if (process.defaultApp) {
  app.setAsDefaultProtocolClient('herald', process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient('herald');
}

let janela;
let fontes = new Map(); // id -> DesktopCapturerSource (da última listagem)
let escolha = null; // { id, audio } — o que a pessoa escolheu no seletor
let conviteGuardado = acharConvite(process.argv); // convite que abriu o app

const ARQUIVO_SESSAO = () => path.join(app.getPath('userData'), 'sessao.bin');

function lerSessao() {
  try {
    const bruto = fs.readFileSync(ARQUIVO_SESSAO());
    const texto = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(bruto) : bruto.toString('utf8');
    return JSON.parse(texto);
  } catch {
    return {};
  }
}

function gravarSessao(dados) {
  const texto = JSON.stringify(dados);
  const bruto = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(texto) : Buffer.from(texto, 'utf8');
  const temp = ARQUIVO_SESSAO() + '.tmp';
  fs.writeFileSync(temp, bruto);
  fs.renameSync(temp, ARQUIVO_SESSAO()); // troca de uma vez: nunca fica arquivo pela metade
}

function acharConvite(argv) {
  const link = argv.find((a) => /^herald:\/\//i.test(a));
  const m = link && link.match(/invite\/([a-z0-9]+)/i);
  return m ? m[1].toLowerCase() : null;
}

function criarJanela() {
  janela = new BrowserWindow({
    width: 1320,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'Herald',
    backgroundColor: '#0b0a0f',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0a0f', symbolColor: '#aaa5b8', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false, // voz e tela continuam lisas com a janela minimizada
    },
  });

  janela.loadURL('app://herald/index.html');
  janela.once('ready-to-show', () => janela.show());

  // Links externos abrem no navegador, nunca dentro do app
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  janela.webContents.on('will-navigate', (e) => e.preventDefault());
}

const PERMITIDAS = new Set(['media', 'display-capture', 'fullscreen', 'clipboard-sanitized-write', 'speaker-selection']);

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const s = session.defaultSession;

  protocol.handle('app', (req) => {
    const caminho = path.normalize(path.join(PASTA_INTERFACE, decodeURIComponent(new URL(req.url).pathname)));
    if (!caminho.startsWith(PASTA_INTERFACE)) return new Response('', { status: 403 });
    return net.fetch(pathToFileURL(caminho).toString());
  });

  s.setPermissionRequestHandler((_wc, permissao, cb) => cb(PERMITIDAS.has(permissao)));
  s.setPermissionCheckHandler((_wc, permissao) => PERMITIDAS.has(permissao));

  // Quando a página pede getDisplayMedia, entrega a tela/janela escolhida no nosso seletor
  s.setDisplayMediaRequestHandler((_req, callback) => {
    const fonte = escolha && fontes.get(escolha.id);
    if (!fonte) return callback({});
    callback({ video: fonte, audio: escolha.audio ? 'loopback' : undefined });
    escolha = null;
  });

  ipcMain.handle('fontes', async () => {
    const lista = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 480, height: 270 },
      fetchWindowIcons: true,
    });
    fontes = new Map(lista.map((f) => [f.id, f]));
    return lista
      .filter((f) => f.name !== 'Herald')
      .map((f) => ({
        id: f.id,
        nome: f.name,
        tipo: f.id.startsWith('screen') ? 'tela' : 'janela',
        miniatura: f.thumbnail.isEmpty() ? null : f.thumbnail.toDataURL(),
        icone: f.appIcon && !f.appIcon.isEmpty() ? f.appIcon.toDataURL() : null,
      }));
  });

  ipcMain.handle('escolher-fonte', (_e, id, audio) => {
    escolha = { id, audio: Boolean(audio) };
  });

  // Login: guardado num arquivo criptografado pelo Windows (sobrevive a fechar o app de qualquer jeito)
  ipcMain.handle('sessao-ler', (_e, chave) => lerSessao()[chave] ?? null);
  ipcMain.handle('sessao-gravar', (_e, chave, valor) => {
    const dados = lerSessao();
    dados[chave] = valor;
    gravarSessao(dados);
  });
  ipcMain.handle('sessao-apagar', (_e, chave) => {
    const dados = lerSessao();
    delete dados[chave];
    gravarSessao(dados);
  });

  // A página pergunta se o app foi aberto por um convite
  ipcMain.handle('convite-pendente', () => {
    const c = conviteGuardado;
    conviteGuardado = null;
    return c;
  });

  criarJanela();

  // Atalhos que funcionam mesmo com o jogo em primeiro plano
  const atalhos = { 'CommandOrControl+Shift+M': 'mudo', 'CommandOrControl+Shift+D': 'surdo' };
  for (const [tecla, acao] of Object.entries(atalhos)) {
    globalShortcut.register(tecla, () => janela?.webContents.send('atalho', acao));
  }
});

// Com o app já aberto, um convite clicado chega aqui
app.on('second-instance', (_e, argv) => {
  if (!janela) return;
  if (janela.isMinimized()) janela.restore();
  janela.focus();
  const convite = acharConvite(argv);
  if (convite) janela.webContents.send('convite', convite);
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
