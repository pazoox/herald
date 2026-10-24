// "Apresentação" entre os PCs de uma chamada (sinalização do WebRTC) pelo nosso Supabase Realtime.
// Antes isso passava por servidores públicos da rede Nostr, que bloqueiam por excesso de
// mensagens e faziam a conexão demorar mais de um minuto. Só a apresentação passa aqui
// (poucas mensagens, criptografadas com a chave do canal); a voz e a tela continuam de PC pra PC.
// Adaptado de @trystero-p2p/supabase, usando o cliente do app (já logado) em vez de criar outro.

import { createTopicStrategy, fromJson, keys, values, entries, selfId } from '@trystero-p2p/core';

const EVENTOS = { entrar: 'join', sdp: 'sdp' };
const canaisDoCliente = new WeakMap();

function cacheDe(cliente) {
  if (!canaisDoCliente.has(cliente)) canaisDoCliente.set(cliente, {});
  return canaisDoCliente.get(cliente);
}

function criarCanal(cliente, topico) {
  let pronto;
  const entrada = { ouvintes: {}, ligados: {}, proximo: 0, anuncio: undefined };
  entrada.pronto = new Promise((r) => (pronto = r));
  entrada.canal = cliente.channel(`herald-sinal:${topico}`, { config: { broadcast: { self: false } } });
  let inscrito = false;
  entrada.canal.subscribe((status) => {
    if (status !== 'SUBSCRIBED') return;
    if (!inscrito) {
      inscrito = true;
      return pronto(entrada.canal);
    }
    // reconectou: se apresenta de novo
    if (entrada.anuncio !== undefined) entrada.canal.send({ type: 'broadcast', event: EVENTOS.entrar, payload: entrada.anuncio });
  });
  return entrada;
}

function canalDe(cliente, topico) {
  const cache = cacheDe(cliente);
  return (cache[topico] ??= criarCanal(cliente, topico));
}

function ouvir(entrada, evento, fn) {
  entrada.ouvintes[evento] ??= {};
  const id = String(entrada.proximo++);
  entrada.ouvintes[evento][id] = fn;
  if (!entrada.ligados[evento]) {
    entrada.ligados[evento] = true;
    entrada.canal.on('broadcast', { event: evento }, ({ payload }) => {
      values(entrada.ouvintes[evento] ?? {}).forEach((f) => f(payload));
    });
  }
  return () => {
    delete entrada.ouvintes[evento]?.[id];
    if (entrada.ouvintes[evento] && !keys(entrada.ouvintes[evento]).length) delete entrada.ouvintes[evento];
  };
}

function limparSemUso(cliente) {
  const cache = cacheDe(cliente);
  for (const [topico, entrada] of entries(cache)) {
    if (values(entrada.ouvintes).some((o) => keys(o).length)) continue;
    cliente.removeChannel(entrada.canal);
    delete cache[topico];
  }
}

const estrategias = new WeakMap(); // cliente -> joinRoom

// joinRoom igual ao do Trystero, mas recebendo o cliente Supabase do app
export function joinRoom(cliente, config, sala, callbacks) {
  let entrarSala = estrategias.get(cliente);
  if (!entrarSala) {
    entrarSala = createTopicStrategy({
      init: () => cliente,
      subscribeTopic: async (c, topico, aoReceber, { kind }) => {
        const entrada = canalDe(c, topico);
        const parar = ouvir(entrada, kind === 'root' ? EVENTOS.entrar : EVENTOS.sdp, (payload) => aoReceber(topico, payload));
        await entrada.pronto;
        return () => {
          parar();
          limparSemUso(c);
        };
      },
      publishTopic: (c, topico, msg, { kind }) => {
        const entrada = canalDe(c, topico);
        const payload = kind === 'announce' && typeof msg === 'string' ? fromJson(msg) : msg;
        if (kind === 'announce') entrada.anuncio = payload;
        return entrada.pronto.then((canal) =>
          canal.send({ type: 'broadcast', event: kind === 'announce' ? EVENTOS.entrar : EVENTOS.sdp, payload }).then(() => undefined),
        );
      },
    });
    estrategias.set(cliente, entrarSala);
  }
  return entrarSala(config, sala, callbacks);
}

export { selfId };
