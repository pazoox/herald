// Gravador (AudioWorklet do Audio Lab): manda cada pedacinho do microfone pra página, sem processar nada.
class Gravador extends AudioWorkletProcessor {
  process(entradas) {
    const canal = entradas[0]?.[0];
    if (canal) this.port.postMessage(canal.slice());
    return true;
  }
}
registerProcessor('gravador', Gravador);
