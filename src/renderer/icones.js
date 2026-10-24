// Ícones em traço (estilo Lucide), desenhados inline pra não depender de nada.
const CAMINHOS = {
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4"/>',
  'mic-off': '<path d="M15 9.3V5a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 5.1 2.1M19 10v1a7 7 0 0 1-.6 2.9M5 10v1a7 7 0 0 0 11.5 5.4M12 18v4M3 3l18 18"/>',
  fone: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
  'fone-off': '<path d="M21 14h-1.3M17 17v2a2 2 0 0 0 2 2h1M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 2.6-6.4M8.6 3.7A9 9 0 0 1 21 12v2M3 3l18 18"/>',
  tela: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4M9 10l3-3 3 3M12 7v6"/>',
  sair: '<path d="M10.7 13.3a16 16 0 0 0 3.4 2.5l1.3-1.3a1.5 1.5 0 0 1 1.6-.3c.9.3 1.9.6 2.9.7a1.5 1.5 0 0 1 1.3 1.5v3a1.5 1.5 0 0 1-1.6 1.5A19 19 0 0 1 2.1 4.6 1.5 1.5 0 0 1 3.6 3h3a1.5 1.5 0 0 1 1.5 1.3c.1 1 .4 2 .7 2.9a1.5 1.5 0 0 1-.3 1.6L7.2 10M22 2 2 22"/>',
  ajustes: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
  copiar: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  maximizar: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  olho: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  enviar: '<path d="m22 2-7 20-4-9-9-4zM22 2 11 13"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  'ao-vivo': '<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.5M7.8 16.2a6 6 0 0 1 0-8.5M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  'mais-opcoes': '<path d="m6 9 6 6 6-6"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  lixo: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  convite: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  'som-off': '<path d="M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6"/>',
  baixar: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  janela: '<rect x="3" y="7" width="13" height="13" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v11M13 11l8-8M16 3h5v5"/>',
  certo: '<path d="M20 6 9 17l-5-5"/>',
  menos: '<path d="M5 12h14"/>',
  ferramentas: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M17.5 14v7M14 17.5h7"/>',
  roleta: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6.4 6.4M12 12 5.6 18.4M12 12H3"/>',
  radio: '<path d="M4.9 16.1a10 10 0 0 1 0-8.2M19.1 7.9a10 10 0 0 1 0 8.2M7.8 13.6a5 5 0 0 1 0-3.2M16.2 10.4a5 5 0 0 1 0 3.2"/><circle cx="12" cy="12" r="2"/>',
  tocar: '<path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5z"/>',
  pausar: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  pular: '<path d="M5 4.5v15a1 1 0 0 0 1.5.9l10-7.5a1 1 0 0 0 0-1.8l-10-7.5A1 1 0 0 0 5 4.5zM19 4v16"/>',
  fila: '<path d="M3 6h13M3 12h13M3 18h9M17 15v6l4-3z"/>',
  recolher: '<path d="m18 15-6-6-6 6"/>',
  expandir: '<path d="m6 9 6 6 6-6"/>',
  porta:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
};

export function icone(nome) {
  return `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${CAMINHOS[nome] || ''}</svg>`;
}

// Preenche todo elemento com data-icone="nome"
export function aplicarIcones(raiz = document) {
  for (const el of raiz.querySelectorAll('[data-icone]')) el.innerHTML = icone(el.dataset.icone);
}
