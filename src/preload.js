// Ponte segura entre a página e o Electron: só expõe o que o app precisa.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('herald', {
  fontes: () => ipcRenderer.invoke('fontes'),
  escolherFonte: (id, audio) => ipcRenderer.invoke('escolher-fonte', id, audio),
  aoAtalho: (fn) => ipcRenderer.on('atalho', (_e, acao) => fn(acao)),
  // Login guardado pelo processo principal (arquivo criptografado)
  sessao: {
    ler: (chave) => ipcRenderer.invoke('sessao-ler', chave),
    gravar: (chave, valor) => ipcRenderer.invoke('sessao-gravar', chave, valor),
    apagar: (chave) => ipcRenderer.invoke('sessao-apagar', chave),
  },
  // Atualização automática
  aoAtualizar: (fn) => ipcRenderer.on('atualizacao', (_e, dados) => fn(dados)),
  instalarAtualizacao: () => ipcRenderer.invoke('instalar-atualizacao'),
  // Convites: o que abriu o app + os que chegarem depois
  aoConvite: (fn) => {
    ipcRenderer.on('convite', (_e, codigo) => fn(codigo));
    ipcRenderer.invoke('convite-pendente').then((codigo) => codigo && fn(codigo));
  },
});
