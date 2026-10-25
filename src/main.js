// Processo principal do Electron: cria a janela, libera microfone/tela,
// mostra as telas/janelas pra escolher e registra os atalhos globais.

const { app, BrowserWindow, session, desktopCapturer, ipcMain, globalShortcut, shell, Menu, protocol, net, safeStorage } = require('electron');
const path = require('path');
const os = require('os');
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
const LAB = Boolean(process.env.HERALD_LAB);
let fontes = new Map(); // id -> DesktopCapturerSource (da última listagem)
let escolha = null; // { id, audio } — o que a pessoa escolheu no seletor
let conviteGuardado = acharConvite(process.argv); // convite que abriu o app

// Atualização automática pelo GitHub Releases (lê o latest.yml da release mais nova).
// Baixa em segundo plano; a página mostra "Atualização pronta — reiniciar".
function iniciarAtualizador() {
  if (!app.isPackaged) return;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // se a pessoa só fechar o app, instala na saída
  const avisar = (estado, dados = {}) => janela?.webContents.send('atualizacao', { estado, ...dados });
  autoUpdater.on('update-available', (i) => avisar('baixando', { versao: i.version }));
  autoUpdater.on('download-progress', (p) => avisar('baixando', { progresso: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => avisar('pronta', { versao: i.version }));
  autoUpdater.on('error', (e) => console.error('atualizador:', e?.message));
  // silencioso (sem as telas do instalador) e reabre o Herald no fim
  ipcMain.handle('instalar-atualizacao', () => autoUpdater.quitAndInstall(true, true));
  const procurar = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(procurar, 5000);
  setInterval(procurar, 15 * 60 * 1000); // de 15 em 15 minutos
}

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

// ================= Rádio =================
// YouTube e SoundCloud tocam pelo player oficial de cada um; texto solto vira busca no YouTube.
// (Spotify fica de fora: o player dele só toca 30s sem login Premium de cada um.)

const pegarTexto = async (url) => (await net.fetch(url, { headers: { 'Accept-Language': 'en', 'User-Agent': 'Mozilla/5.0' } })).text();
const pegarJson = async (url) => {
  const r = await net.fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

function idDoYoutube(texto) {
  const m = texto.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/|music\.youtube\.com\/watch\?(?:.*&)?v=)([\w-]{11})/i);
  return m?.[1] || null;
}

async function faixaDoYoutube(id) {
  const info = await pegarJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`);
  return { tipo: 'youtube', id, titulo: info.title, autor: info.author_name, capa: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` };
}

async function buscarNoYoutube(busca) {
  const html = await pegarTexto('https://www.youtube.com/results?search_query=' + encodeURIComponent(busca));
  const id = html.match(/"videoRenderer":\{"videoId":"([\w-]{11})"/)?.[1];
  if (!id) return { erro: 'not-found' };
  return faixaDoYoutube(id);
}

async function buscarFaixa(texto) {
  if (!texto) return { erro: 'not-found' };
  const yt = idDoYoutube(texto);
  if (yt) return faixaDoYoutube(yt);

  if (/^https?:\/\/(on\.|m\.)?soundcloud\.com\//i.test(texto)) {
    const info = await pegarJson(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(texto)}`);
    const url = decodeURIComponent(info.html.match(/url=([^&"]+)/)?.[1] || '') || texto;
    return { tipo: 'soundcloud', id: url, titulo: info.title, autor: info.author_name, capa: info.thumbnail_url };
  }

  if (/^https?:\/\//i.test(texto)) return { erro: 'unsupported' };
  return buscarNoYoutube(texto); // nome da música
}

// Qual processo é dono de uma janela (HWND)? Pergunta pro Windows pelo PowerShell
// (só acontece ao começar a transmitir uma janela com o som dela).
function pidDaJanela(hwnd) {
  const { execFile } = require('child_process');
  const script = `Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint p);'; $p = 0; [void][W.U]::GetWindowThreadProcessId([System.IntPtr]${Math.trunc(hwnd)}, [ref]$p); $p`;
  return new Promise((pronto) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 8000 }, (erro, saida) => {
      const pid = Number(String(saida || '').trim());
      pronto(!erro && pid > 0 ? pid : null);
    });
  });
}

// Tamanho/posição da janela: lembra o último; na primeira vez ocupa ~85% da tela
const ARQUIVO_JANELA = () => path.join(app.getPath('userData'), 'janela.json');

function tamanhoInicial() {
  const { screen } = require('electron');
  try {
    const salvo = JSON.parse(fs.readFileSync(ARQUIVO_JANELA(), 'utf8'));
    // só usa a posição salva se ela ainda cabe em algum monitor
    const visivel = screen.getAllDisplays().some(({ workArea: a }) => salvo.x >= a.x - 50 && salvo.y >= a.y - 50 && salvo.x < a.x + a.width - 100 && salvo.y < a.y + a.height - 100);
    if (visivel) return salvo;
  } catch {}
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.min(1800, Math.round(workArea.width * 0.85));
  const height = Math.min(1100, Math.round(workArea.height * 0.85));
  return { width, height, x: workArea.x + Math.round((workArea.width - width) / 2), y: workArea.y + Math.round((workArea.height - height) / 2) };
}

function guardarTamanho() {
  if (!janela || janela.isMinimized()) return;
  const dados = { ...(janela.isMaximized() ? janela.getNormalBounds() : janela.getBounds()), maximizada: janela.isMaximized() };
  try { fs.writeFileSync(ARQUIVO_JANELA(), JSON.stringify(dados)); } catch {}
}

function criarJanela() {
  const inicial = tamanhoInicial();
  janela = new BrowserWindow({
    width: inicial.width,
    height: inicial.height,
    x: inicial.x,
    y: inicial.y,
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

  // HERALD_DEMO=1 (ou =chat) abre com dados de mentira, pra prints
  const demo = process.env.HERALD_DEMO;
  // HERALD_LAB=1 abre o Audio Lab (ferramenta de desenvolvimento pra ajustar o som da voz)
  if (LAB) janela.loadURL('app://herald/lab.html');
  else janela.loadURL(demo ? `app://herald/index.html?demo=${encodeURIComponent(demo)}` : 'app://herald/index.html');
  janela.once('ready-to-show', () => {
    if (inicial.maximizada) janela.maximize();
    janela.show();
  });
  let espera = null;
  const guardarDepois = () => {
    clearTimeout(espera);
    espera = setTimeout(guardarTamanho, 400);
  };
  for (const evento of ['resize', 'move', 'maximize', 'unmaximize']) janela.on(evento, guardarDepois);
  janela.on('close', guardarTamanho);

  // Links externos abrem no navegador, nunca dentro do app.
  // Exceção: a janela separada da transmissão (página nossa, mesma origem).
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('app://herald/janela-tela.html')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1280,
          height: 760,
          minWidth: 480,
          minHeight: 280,
          backgroundColor: '#000000',
          icon: path.join(__dirname, '..', 'build', 'icon.png'),
          titleBarStyle: 'hidden',
          titleBarOverlay: { color: '#00000000', symbolColor: '#aaa5b8', height: 40 },
          autoHideMenuBar: true,
        },
      };
    }
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

  // Rádio: o player do YouTube só toca se souber de qual site ele está embutido.
  // Como o app não tem site (é app://), dizemos que é a página do Herald.
  s.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube.com/embed/*', 'https://www.youtube-nocookie.com/embed/*'] }, (det, cb) => {
    det.requestHeaders.Referer = 'https://herald-chat.vercel.app/';
    cb({ requestHeaders: det.requestHeaders });
  });

  // Só páginas do próprio Herald ganham microfone/tela; o player do Rádio (YouTube/SoundCloud) nunca
  const doHerald = (url) => String(url || '').startsWith('app://herald');
  s.setPermissionRequestHandler((_wc, permissao, cb, det) => cb(PERMITIDAS.has(permissao) && doHerald(det?.requestingUrl)));
  s.setPermissionCheckHandler((_wc, permissao, origem) => PERMITIDAS.has(permissao) && doHerald(origem));

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

  // Som só da janela compartilhada: descobre o programa dono da janela e captura só o
  // som dele (e dos processos filhos — navegadores tocam som num processo à parte).
  // Usa a captura por processo do Windows (10 versão 2004+ / 11) via loopback-capture.
  let capturaJanela = null;
  const pararCapturaJanela = () => {
    try { capturaJanela?.stop(); } catch {}
    capturaJanela = null;
  };
  ipcMain.handle('audio-janela-iniciar', async (e, fonteId) => {
    pararCapturaJanela();
    const hwnd = Number(String(fonteId).split(':')[1]);
    if (!hwnd || process.platform !== 'win32') return { ok: false };
    const pid = await pidDaJanela(hwnd);
    if (!pid) return { ok: false };
    try {
      const { LoopbackCapture } = require('loopback-capture');
      capturaJanela = new LoopbackCapture();
      const destino = e.sender;
      capturaJanela.start(pid, true, (pedaco) => {
        if (!destino.isDestroyed()) destino.send('audio-janela', pedaco); // PCM 16-bit, estéreo, 48 kHz
      });
      return { ok: true, pid };
    } catch (err) {
      console.error('audio da janela:', err?.message);
      pararCapturaJanela();
      return { ok: false };
    }
  });
  ipcMain.handle('audio-janela-parar', () => pararCapturaJanela());

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

  ipcMain.handle('versao', () => app.getVersion());

  // Painel "Sistema": quanto o Herald e o PC estão usando (CPU e memória)
  let cpusAntes = os.cpus();
  ipcMain.handle('metricas', () => {
    const cpus = os.cpus();
    let total = 0, ocioso = 0;
    cpus.forEach((c, i) => {
      const a = cpusAntes[i]?.times || c.times, b = c.times;
      const t = b.user - a.user + (b.nice - a.nice) + (b.sys - a.sys) + (b.idle - a.idle) + (b.irq - a.irq);
      total += t;
      ocioso += b.idle - a.idle;
    });
    cpusAntes = cpus;
    const processos = app.getAppMetrics();
    return {
      pcCpu: total ? 100 * (1 - ocioso / total) : 0,
      // percentCPUUsage: 100 = um núcleo inteiro → divide pelos núcleos pra virar % do PC
      heraldCpu: processos.reduce((s, p) => s + (p.cpu?.percentCPUUsage || 0), 0) / cpus.length,
      heraldMem: processos.reduce((s, p) => s + (p.memory?.workingSetSize || 0), 0) / 1024, // MB
      pcMemTotal: os.totalmem() / 2 ** 20,
      pcMemLivre: os.freemem() / 2 ** 20,
      nucleos: cpus.length,
      cpuNome: cpus[0]?.model?.replace(/\s+/g, ' ').trim() || '',
    };
  });

  // Audio Lab: salva os WAVs de cada etapa em Documentos\Herald Audio Lab\<data-hora>
  if (LAB) {
    const pastaLab = path.join(app.getPath('documents'), 'Herald Audio Lab');
    let ultima = pastaLab;
    ipcMain.handle('lab-salvar', (_e, arquivos) => {
      const quando = new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-');
      ultima = path.join(pastaLab, quando);
      fs.mkdirSync(ultima, { recursive: true });
      for (const { nome, dados } of arquivos) fs.writeFileSync(path.join(ultima, path.basename(String(nome))), Buffer.from(dados));
      return ultima;
    });
    ipcMain.handle('lab-abrir-pasta', () => {
      fs.mkdirSync(ultima, { recursive: true });
      shell.openPath(ultima);
    });
  }

  // Rádio: transforma o que a pessoa colou (link ou nome da música) numa faixa tocável
  ipcMain.handle('radio-buscar', async (_e, texto) => {
    try {
      return await buscarFaixa(String(texto || '').trim().slice(0, 300));
    } catch (err) {
      console.error('radio:', err?.message);
      return { erro: 'not-found' };
    }
  });

  // A página pergunta se o app foi aberto por um convite
  ipcMain.handle('convite-pendente', () => {
    const c = conviteGuardado;
    conviteGuardado = null;
    return c;
  });

  criarJanela();
  iniciarAtualizador();

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
