// O que tem de novo em cada versão (aparece num pop-up quando o Herald abre já atualizado).
// A cada release: adicione a versão nova NO TOPO, com as novidades e as correções.

export const NOVIDADES = [
  {
    versao: '1.6.0',
    en: {
      novas: [
        'Turn people up to 200%: right-click someone and push the volume past 100%.',
        'Right-click a stream to control its sound: volume up to 200% and mute.',
        'Share just one window\'s sound: pick a window and Herald sends only that app\'s audio, not your whole PC.',
        'Radio: hide the pop-up and keep listening. Right-click the Radio ring for pause, skip and more. The video now plays clean, without buttons or captions.',
        'Tools moved to the bottom bar, next to Share screen.',
        'Side panel: click a ring to open it, the arrow closes it, and clicking anywhere else closes it too. Hover a ring to see what it shows.',
        'Refreshed look: new user card, softer dividers and tooltips that never get cut off.',
        'Safer Herald: new accounts need an access code, people who leave a Nest can no longer join its calls, and every name is unique.',
      ],
      correcoes: [
        'Profile photos and Nest icons are off for now. Ready-made avatars are on the way.',
        'The Radio panel now opens with the same slide as the other tabs.',
      ],
    },
    pt: {
      novas: [
        'Aumente as pessoas até 200%: clique com o botão direito em alguém e passe o volume dos 100%.',
        'Botão direito numa transmissão controla o som dela: volume até 200% e mudo.',
        'Som só da janela: ao compartilhar uma janela, o Herald manda só o som daquele programa, não o do PC inteiro.',
        'Rádio: esconda o pop-up e continue ouvindo. Botão direito no anel do Rádio tem pausar, pular e mais. O vídeo agora roda limpo, sem botões nem legendas.',
        'O Tools foi pra barra de baixo, ao lado do Share screen.',
        'Painel lateral: clique num anel pra abrir, a setinha fecha, e clicar em qualquer outro lugar fecha também. Passe o mouse num anel pra ver o que ele mostra.',
        'Visual renovado: cartão do usuário novo, divisórias mais suaves e dicas que nunca ficam cortadas.',
        'Herald mais seguro: contas novas precisam de um código de acesso, quem sai de um Nest não entra mais nas calls dele e cada nome é único.',
      ],
      correcoes: [
        'Fotos de perfil e ícones de Nest estão desligados por enquanto. Avatares prontos estão a caminho.',
        'O painel do Rádio agora abre com o mesmo deslize das outras abas.',
      ],
    },
  },
  {
    versao: '1.5.0',
    en: {
      novas: [
        'New side panel: collapsed by default, with rings showing who is online, the Radio song progress and how your PC is doing. Click a ring to open it.',
        'System tab: see how your screen share is doing (fps, what is limiting it, video card or CPU) and how your PC and connection are holding up.',
        'Radio tab: the player moves into the side panel with the queue always open. The Radio ring only shows up while the Radio is on.',
        'This window: from now on Herald shows what is new after every update.',
      ],
      correcoes: [
        'Settings: the page title stays in place while you scroll.',
        'Role picker in Edit Nest now matches the rest of the app.',
        'Voice calibration now just asks you to speak like you would in a call.',
      ],
    },
    pt: {
      novas: [
        'Painel lateral novo: vem recolhido, com anéis mostrando quem está online, o progresso da música do Rádio e como está o seu PC. Clique num anel pra abrir.',
        'Aba Sistema: veja como está a sua transmissão (fps, o que está limitando, placa de vídeo ou CPU) e como estão o seu PC e a conexão.',
        'Aba Rádio: o player vai pro painel lateral com a fila sempre aberta. O anel do Rádio só aparece quando o Rádio está ligado.',
        'Esta janela: a partir de agora o Herald mostra as novidades a cada atualização.',
      ],
      correcoes: [
        'Settings: o título da página fica fixo enquanto você rola.',
        'A escolha de cargo no Edit Nest agora tem o visual do app.',
        'A calibração da voz agora só pede pra você falar como falaria numa call.',
      ],
    },
  },
  {
    versao: '1.4.0',
    en: {
      novas: [
        'New voice processing: cleaner and more natural, with Chrome\'s own noise and volume control (the same as Google Meet).',
        'The AI noise filter is now a "gatekeeper": it never touches your voice, it only silences the pauses — clicks, keyboard and desk bumps disappear.',
        'Automatic voice calibration: in your first call with a microphone, Herald tunes the EQ for your voice. Saved per microphone, on your account.',
        'Settings → Audio → Voice calibration: calibrate again, compare before/after and choose a warmer or brighter tone.',
      ],
      correcoes: [
        'Fixed choppy voice: the AI now runs separately from the audio.',
        'Tip: with headphones, turn off Echo cancellation in Settings → Audio for the most natural sound.',
      ],
    },
    pt: {
      novas: [
        'Voz nova: mais limpa e natural, com o controle de ruído e de volume do próprio Chrome (o mesmo do Google Meet).',
        'A IA de ruído agora é um "porteiro": não mexe na sua voz, só silencia as pausas — estalo, teclado e batida na mesa somem.',
        'Calibração automática da voz: na primeira call com um microfone, o Herald ajusta o EQ pra sua voz. Fica salvo por microfone, na sua conta.',
        'Settings → Audio → Calibração da voz: calibre de novo, compare antes/depois e escolha um tom mais quente ou mais brilhante.',
      ],
      correcoes: [
        'Voz picada corrigida: a IA agora roda separada do áudio.',
        'Dica: com fone, desligue o Cancelamento de eco em Settings → Audio pro som mais natural.',
      ],
    },
  },
  {
    versao: '1.3.0',
    en: {
      novas: [
        'Roles: Owner, Admin, Moderator and Member.',
        'Edit Nest: name, icon, invite link and a member list to set roles or kick people.',
        'Right-click channels, Nest icons and people for quick actions.',
        'Settings now has pages: Profile, Audio and Preferences.',
      ],
      correcoes: ['Deafen now only silences voices — streams and the Radio keep playing.', 'New pop-out icon.'],
    },
    pt: {
      novas: [
        'Cargos: Owner, Admin, Moderator e Member.',
        'Edit Nest: nome, ícone, link de convite e lista de membros pra trocar cargo ou expulsar.',
        'Botão direito nos canais, nos ícones dos Nests e nas pessoas pra ações rápidas.',
        'Settings agora tem páginas: Profile, Audio e Preferences.',
      ],
      correcoes: ['O deafen agora só cala as vozes — transmissão e Rádio continuam.', 'Ícone novo de pop out.'],
    },
  },
  {
    versao: '1.2.1',
    en: { novas: ['People already in a channel show up right away while their voice connects.'], correcoes: ['Joining a call takes about a second (it sometimes took over a minute).'] },
    pt: { novas: ['Quem já está no canal aparece na hora enquanto a voz conecta.'], correcoes: ['Entrar na call leva cerca de 1 segundo (às vezes passava de 1 minuto).'] },
  },
  {
    versao: '1.2.0',
    en: { novas: ['Radio: listen to YouTube and SoundCloud together in a call (Tools → Radio).'], correcoes: [] },
    pt: { novas: ['Rádio: ouçam YouTube e SoundCloud juntos na call (Tools → Radio).'], correcoes: [] },
  },
  {
    versao: '1.1.1',
    en: { novas: ['PC audio is on by default when sharing your screen.'], correcoes: ['Screen share audio now reaches the people watching.', 'Updates are checked every 15 minutes.'] },
    pt: { novas: ['O som do PC vem ligado ao compartilhar a tela.'], correcoes: ['O som da transmissão agora chega pra quem assiste.', 'Atualizações são procuradas a cada 15 minutos.'] },
  },
  {
    versao: '1.1.0',
    en: { novas: ['Roulette: spin to pick people from the call (Tools → Roulette).'], correcoes: [] },
    pt: { novas: ['Roleta: gire pra sortear pessoas da call (Tools → Roulette).'], correcoes: [] },
  },
];

// "1.10.0" > "1.9.2"
export function versaoMaior(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

// Versões que a pessoa ainda não viu (mais nova primeiro)
export function novidadesEntre(antes, agora) {
  return NOVIDADES.filter((n) => versaoMaior(n.versao, antes) && !versaoMaior(n.versao, agora));
}
