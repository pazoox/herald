// Copia os módulos de áudio pra pasta da interface:
// - DeepFilterNet3 (supressão de ruído com IA, estilo Krisp; modelo embutido no .wasm)
// - nivelador (volume automático)
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const destino = path.join(raiz, 'src', 'renderer', 'dist', 'audio');
const dfn = path.join(raiz, 'node_modules', '@lofcz', 'deepfilternet-web', 'dist');

fs.mkdirSync(destino, { recursive: true });
// O processador de áudio do navegador não tem TextDecoder nem crypto;
// o DeepFilterNet usa os dois só em mensagens de erro e na inicialização.
const substitutos = `
if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = class {
    decode(bytes) {
      if (!bytes) return '';
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      try { return decodeURIComponent(escape(s)); } catch { return s; }
    }
  };
}
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = { getRandomValues(a) { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a; } };
}
`;
fs.writeFileSync(path.join(destino, 'deepfilter.js'), substitutos + fs.readFileSync(path.join(dfn, 'worklet.js'), 'utf8'));
fs.copyFileSync(path.join(dfn, 'df_bg.wasm'), path.join(destino, 'deepfilter.wasm'));
for (const arquivo of ['nivelador.js', 'dinamica.js', 'gravador.js', 'ia-ponte.js', 'ia-worker.js']) {
  fs.copyFileSync(path.join(raiz, 'src', 'renderer', 'audio', arquivo), path.join(destino, arquivo));
}
