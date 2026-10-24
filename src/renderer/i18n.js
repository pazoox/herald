// Textos do app. O original é em inglês; PT traduz pelo próprio texto em inglês.
// Uso: t('Sign in') ou t('{name} joined', { name: 'Lu' }).
// No HTML: <span data-i18n>Sign in</span> ou data-i18n-placeholder="Your name".

const PT = {
  // Entrada
  'Voice and screen with your crew.': 'Voz e tela com a sua galera.',
  'Sign in': 'Entrar',
  'Create account': 'Criar conta',
  'Email': 'E-mail',
  'Password': 'Senha',
  'Display name': 'Nome',
  'What your friends call you': 'Como a galera te chama',
  'At least 6 characters': 'Pelo menos 6 caracteres',
  'No account yet?': 'Ainda não tem conta?',
  'Already have an account?': 'Já tem conta?',
  'Wrong email or password.': 'E-mail ou senha errados.',
  'This email is already registered.': 'Esse e-mail já tem conta.',
  'Password must have at least 6 characters.': 'A senha precisa ter pelo menos 6 caracteres.',
  'Could not connect. Check your internet.': 'Não deu pra conectar. Confira sua internet.',
  'Something went wrong: {msg}': 'Algo deu errado: {msg}',
  'Herald is not set up yet (missing Supabase keys).': 'O Herald ainda não foi configurado (faltam as chaves do Supabase).',

  // Nests
  'Create a Nest': 'Criar um Nest',
  'Join a Nest': 'Entrar num Nest',
  'Nest name': 'Nome do Nest',
  "{name}'s Nest": 'Nest de {name}',
  'Create': 'Criar',
  'Join': 'Entrar',
  'Invite link or code': 'Link ou código de convite',
  'This invite is not valid.': 'Esse convite não vale.',
  'Your Nests are where your crew hangs out. Create one or join with an invite.': 'Nests são onde a sua galera se encontra. Crie um ou entre com um convite.',
  'Welcome to Herald': 'Bem-vindo ao Herald',
  'Invite people': 'Convidar pessoas',
  'Leave Nest': 'Sair do Nest',
  'Delete Nest': 'Apagar Nest',
  'Leave {name}?': 'Sair de {name}?',
  'Delete {name} for everyone? This cannot be undone.': 'Apagar {name} pra todo mundo? Não dá pra desfazer.',
  'Invite friends to {name}': 'Convide amigos pra {name}',
  'Send this link. Anyone with it can join.': 'Mande esse link. Quem tiver o link entra.',
  'New link': 'Gerar outro link',
  'The old link will stop working.': 'O link antigo para de funcionar.',
  'Copy': 'Copiar',
  'Copied!': 'Copiado!',
  'Text channels': 'Canais de texto',
  'Voice channels': 'Canais de voz',
  'New channel': 'Novo canal',
  'Channel name': 'Nome do canal',
  'Delete #{name}?': 'Apagar #{name}?',
  'Delete channel': 'Apagar canal',
  'Members': 'Membros',
  'Online': 'Online',
  'Offline': 'Offline',
  'Owner': 'Dono',

  // Chat
  'Message #{name}': 'Mensagem em #{name}',
  'This is the start of #{name}.': 'Este é o começo de #{name}.',
  'Delete message': 'Apagar mensagem',
  'Today at {time}': 'Hoje às {time}',
  'Yesterday at {time}': 'Ontem às {time}',

  // Voz
  'Voice connected': 'Voz conectada',
  'Connecting…': 'Conectando…',
  'Disconnect': 'Desconectar',
  'Mute': 'Mutar',
  'Unmute': 'Desmutar',
  'Deafen': 'Ensurdecer',
  'Undeafen': 'Voltar a ouvir',
  'Share screen': 'Compartilhar tela',
  'Stop sharing': 'Parar de compartilhar',
  'Join voice': 'Entrar na voz',
  'Nobody here yet. Jump in!': 'Ninguém aqui ainda. Entra aí!',
  'LIVE': 'AO VIVO',
  'Watch': 'Assistir',
  'Close': 'Fechar',
  'Stop': 'Parar',
  'Fullscreen': 'Tela cheia',
  'Your screen': 'Sua tela',
  'Connecting to stream…': 'Conectando à transmissão…',
  'nobody watching yet': 'ninguém assistindo ainda',
  '{n} watching': '{n} assistindo',
  'limited: CPU': 'limitado: CPU',
  'limited: internet': 'limitado: internet',
  'no connection': 'sem conexão',
  'connecting…': 'conectando…',
  'you': 'você',
  'Could not capture this screen.': 'Não deu pra capturar essa tela.',
  'Could not access the microphone.': 'Não consegui acessar o microfone.',
  'You are in a call in another channel.': 'Você está numa chamada em outro canal.',

  // Compartilhar tela
  'Screens': 'Telas',
  'Windows': 'Janelas',
  'Loading…': 'Carregando…',
  'Nothing here.': 'Nada aqui.',
  'Go live': 'Ao vivo',
  'games': 'jogos',
  'sharp text': 'texto nítido',
  'weak internet': 'internet fraca',
  'PC audio': 'Som do PC',
  "games, videos, music — Herald's own sounds stay out": 'jogo, vídeo, música — o som do Herald fica de fora',

  // Configurações
  'Settings': 'Configurações',
  'Profile': 'Perfil',
  'Change photo': 'Trocar foto',
  'Save': 'Salvar',
  'Saved!': 'Salvo!',
  'Language': 'Idioma',
  'Voice': 'Voz',
  'Microphone': 'Microfone',
  'Output': 'Saída de som',
  'Test microphone (record 5 seconds)': 'Testar microfone (gravar 5 segundos)',
  'Recording… talk now ({n})': 'Gravando… fale agora ({n})',
  'Playing back — this is how you sound': 'Tocando — é assim que a galera te ouve',
  'User volume': 'Volume do usuário',
  'Mute for me': 'Mutar pra mim',
  'Only you stop hearing them.': 'Só você deixa de ouvir.',
  'Watch stream': 'Assistir transmissão',
  'Stop watching': 'Parar de assistir',
  'Join them in voice': 'Entrar na voz com ele(a)',
  'Copy name': 'Copiar nome',
  'Not in your call': 'Fora da sua chamada',
  'AI noise suppression': 'Supressão de ruído com IA',
  'removes typing, clicks, fans and background noise': 'tira digitação, estalos, ventilador e ruído de fundo',
  'Strong': 'Forte',
  'Natural': 'Natural',
  'Automatic volume': 'Volume automático',
  'keeps your voice at the right level, never clipping': 'deixa sua voz sempre no volume certo, sem estourar',
  'Input volume': 'Volume do microfone',
  'Echo cancellation': 'Cancelamento de eco',
  'turn off if you use headphones — sounds more natural': 'desligue se usar fone — o som fica mais natural',
  'Auto volume: {db}': 'Volume automático: {db}',
  'Default': 'Padrão',
  'Shortcuts': 'Atalhos',
  'mute / unmute': 'mutar / desmutar',
  'deafen': 'ensurdecer',
  'Work even with your game open.': 'Funcionam mesmo com o jogo aberto.',
  'Sign out': 'Sair da conta',
  'Image must be under 2 MB.': 'A imagem precisa ter menos de 2 MB.',
  'Update ready ({v}) — click to restart': 'Atualização pronta ({v}) — clique pra reiniciar',
  'Privacy': 'Privacidade',
  'Hide my IP': 'Esconder meu IP',
  'your voice and screen go through a secure relay, so nobody in the call sees your IP. Adds a tiny delay and lowers screen sharing to 4 Mbps.': 'sua voz e tela passam por um servidor de apoio seguro, e ninguém na chamada vê seu IP. Adiciona um atraso bem pequeno e deixa a tela em 4 Mbps.',
  'Protected: your IP is hidden in this call.': 'Protegido: seu IP está escondido nesta chamada.',
  'Relay unavailable right now — connecting directly.': 'Servidor de apoio indisponível agora — conectando direto.',
  'Applies when you join a voice channel.': 'Vale quando você entrar num canal de voz.',
  'Pop out': 'Abrir em outra janela',
  'Bring it back': 'Trazer de volta',
  'Watching in another window': 'Assistindo em outra janela',
  "{name}'s stream": 'Transmissão de {name}',
  'Stream volume': 'Volume da transmissão',
  'Always show stats': 'Sempre mostrar estatísticas',
  'resolution, fps and speed': 'resolução, fps e velocidade',
  'Lower quality': 'Qualidade menor',
  '720p 30fps — for weak internet': '720p 30fps — pra internet fraca',
  'Herald updated to {v}': 'Herald atualizado pra {v}',
  'Tools': 'Ferramentas',
  'Roulette': 'Roleta',
  'Pick people at random': 'Sorteia pessoas da chamada',
  'Join the voice channel first': 'Entre no canal de voz primeiro',
  'Radio': 'Rádio',
  'Coming soon': 'Em breve',
  "Who's in": 'Quem entra',
  'How many to pick': 'Quantos sortear',
  'Spin': 'Girar',
  'Spinning…': 'Girando…',
  'Pick at least 2 people': 'Escolha pelo menos 2 pessoas',
  '{name} spun the roulette': '{name} girou a roleta',
  'Listen to music together': 'Ouçam música juntos',
  'Playing now': 'Tocando agora',
  'Close the Radio for me': 'Fechar o Rádio só pra mim',
  Skip: 'Pular',
  Queue: 'Fila',
  Expand: 'Expandir',
  Minimize: 'Minimizar',
  Play: 'Tocar',
  Pause: 'Pausar',
  'Add to queue': 'Adicionar na fila',
  'Paste a YouTube or SoundCloud link, or type a song': 'Cole um link do YouTube ou SoundCloud, ou digite uma música',
  'Nothing playing': 'Nada tocando',
  'Add a song to start the Radio for everyone in the call': 'Adicione uma música pra começar o Rádio pra todo mundo da chamada',
  'added by {name}': 'por {name}',
  'Up next': 'A seguir',
  Clear: 'Limpar',
  Remove: 'Tirar',
  'The queue is empty. Add more songs below.': 'A fila está vazia. Adicione mais músicas aqui embaixo.',
  "Couldn't find that song": 'Não achei essa música',
  'Only YouTube and SoundCloud links work': 'Só funcionam links do YouTube e SoundCloud',
  'The queue is full': 'A fila está cheia',
  'Added to the queue: {title}': 'Na fila: {title}',
  '{name} started the Radio': '{name} ligou o Rádio',
  "This song can't be played here — skipping": 'Essa música não pode tocar aqui — pulando',
  '{names} was picked!': '{names} foi sorteado(a)!',
  '{names} were picked!': '{names} foram sorteados!',
  'Cancel': 'Cancelar',
  'Confirm': 'Confirmar',
};

const DICIONARIOS = { en: {}, pt: PT };
export const IDIOMAS = [
  { id: 'en', nome: 'English', bandeira: 'us' },
  { id: 'pt', nome: 'Português (Brasil)', bandeira: 'br' },
];

let idioma = 'en';
try {
  idioma = localStorage.getItem('herald-idioma') || 'en';
} catch {}

export function idiomaAtual() {
  return idioma;
}

export function mudarIdioma(novo) {
  idioma = DICIONARIOS[novo] ? novo : 'en';
  try {
    localStorage.setItem('herald-idioma', idioma);
  } catch {}
  document.documentElement.lang = idioma === 'pt' ? 'pt-BR' : 'en';
  traduzirPagina();
}

export function t(texto, vars) {
  let s = DICIONARIOS[idioma][texto] ?? texto;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

// Traduz o HTML estático. Guarda o original em inglês pra poder trocar de novo.
export function traduzirPagina(raiz = document) {
  for (const el of raiz.querySelectorAll('[data-i18n]')) {
    if (!el.dataset.i18nOriginal) el.dataset.i18nOriginal = el.textContent.trim();
    el.textContent = t(el.dataset.i18nOriginal);
  }
  for (const el of raiz.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of raiz.querySelectorAll('[data-i18n-tip]')) el.dataset.tip = t(el.dataset.i18nTip);
  for (const el of raiz.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
}

export function horaCurta(data) {
  return new Date(data).toLocaleTimeString(idioma === 'pt' ? 'pt-BR' : 'en-US', { hour: '2-digit', minute: '2-digit' });
}

export function quando(data) {
  const d = new Date(data);
  const hoje = new Date();
  const ontem = new Date(Date.now() - 86400000);
  const time = horaCurta(d);
  if (d.toDateString() === hoje.toDateString()) return t('Today at {time}', { time });
  if (d.toDateString() === ontem.toDateString()) return t('Yesterday at {time}', { time });
  return d.toLocaleDateString(idioma === 'pt' ? 'pt-BR' : 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + time;
}
