; Instalador do Herald: nunca pergunta "todos os usuários ou só pra mim".
; - Instalação nova: só pro usuário atual, sem pedir administrador (como Discord/Spotify).
; - Quem já tinha instalado "pra todos" (versões até 1.0.3): continua assim, sem duplicar.
!macro customInstallMode
  ${if} $hasPerMachineInstallation == "1"
    StrCpy $isForceMachineInstall "1"
  ${else}
    StrCpy $isForceCurrentInstall "1"
  ${endif}
!macroend
