// O que tem de novo em cada versão (aparece num pop-up quando o Herald abre já atualizado).
// A cada release: adicione a versão nova NO TOPO, com as novidades e as correções.

export const NOVIDADES = [
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
