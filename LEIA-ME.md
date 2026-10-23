# 🐦‍⬛ Herald

App de Windows pra voz e compartilhamento de tela com os amigos.

- **Site:** https://herald-chat.vercel.app
- **Download:** https://github.com/pazoox/herald/releases/latest

- **Voz**: Opus 128 kbps, direto de PC pra PC.
- **Tela**: até 1080p 60fps (H.264 pela placa de vídeo), só pra quem clica em **Assistir**.
- **Sem servidor**: as pessoas se acham pelo código da sala, usando relays públicos (Nostr, via [Trystero](https://github.com/dmotz/trystero)).
- **Atalhos globais**: `Ctrl+Shift+M` muta, `Ctrl+Shift+D` ensurdece.

## Pastas

| Pasta | O que é |
|---|---|
| `src/main.js` | Janela do app, seletor de tela, atalhos |
| `src/renderer/` | A interface (HTML, CSS, JS) |
| `landing/` | Site de download (vai pra Vercel) |
| `scripts/mascote.js` | Desenha o corvo e gera os ícones |
| `release/` | Onde o instalador `.exe` aparece |

## Comandos

```bash
npm start          # abre o app pra testar
npm run dist       # gera release/Herald-Setup.exe
npm run mascote    # regera ícones depois de mexer no corvo
```

Pra testar com você mesmo, abra uma segunda cópia separada:

```bash
set HERALD_PERFIL=2 && npx electron .
```

## Publicar

1. **Instalador → GitHub Releases**: crie um repositório `herald` no GitHub, vá em *Releases → Draft a new release*, crie a tag `v1.0.0` e anexe o `release/Herald-Setup.exe`.
2. **Link de download**: já aponta pra `github.com/pazoox/herald/releases/latest` (linha do `LINK_DOWNLOAD` no `landing/index.html`).
3. **Site → Vercel**: em vercel.com, *Add New → Project*, importe o repositório e coloque **Root Directory = `landing`**. Sem build, é só HTML.

## Limitações conhecidas

- **Som do PC na transmissão** captura o áudio do Windows inteiro, inclusive a voz da galera. Por isso vem desligado.
- **CGNAT**: se um amigo ficar em "conectando…", a operadora pode estar bloqueando a conexão direta. A solução é um servidor TURN (ainda não incluso).
- Funciona melhor com até 6 a 8 pessoas por sala.
- O instalador não tem assinatura paga, então o Windows mostra o aviso do SmartScreen na primeira vez.
