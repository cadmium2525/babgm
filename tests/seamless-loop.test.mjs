import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../dist/seamless-loop.js', import.meta.url), 'utf8'))
  .replace('export class SeamlessLoop', 'globalThis.SeamlessLoop = class SeamlessLoop');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture({ fetchGate, decodeGate, resumeGate, rejectPreferred = false, fetchFailure = false } = {}) {
  const calls = [];
  const contexts = [];
  const nodes = [];
  const decoded = { duration: 7, length: 112000 };
  class Context {
    constructor(options) {
      calls.push(['construct', options]);
      if (rejectPreferred && options.sampleRate) throw new Error('Unsupported sample rate');
      this.state = 'suspended';
      this.currentTime = 0;
      this.destination = {};
      contexts.push(this);
    }
    addEventListener(type, callback) { this.statechange = callback; }
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    resume() {
      calls.push(['resume']);
      if (!resumeGate) this.state = 'running';
      return resumeGate?.promise.then(() => { this.state = 'running'; }) ?? Promise.resolve();
    }
    decodeAudioData() { calls.push(['decode']); return decodeGate?.promise ?? Promise.resolve(decoded); }
    createBufferSource() {
      const node = {
        connect() {}, disconnect() { this.disconnected = true; },
        start(when, offset) { this.started = { when, offset }; },
        stop() { this.stopped = true; this.onended?.(); },
      };
      nodes.push(node);
      return node;
    }
    advance(seconds) { if (this.state === 'running') this.currentTime += seconds; }
    setState(state) { this.state = state; this.statechange(); }
  }
  let changes = 0;
  const sandbox = {
    AudioContext: Context,
    navigator: { audioSession: { type: 'auto' } },
    fetch: async () => {
      calls.push(['fetch']);
      if (fetchGate) await fetchGate.promise;
      return { ok: !fetchFailure, arrayBuffer: async () => new ArrayBuffer(4) };
    },
  };
  vm.runInNewContext(source, sandbox);
  const player = new sandbox.SeamlessLoop({ url: 'audio/water.wav', onchange: () => changes++ });
  return { player, calls, contexts, nodes, sandbox, decoded, changes: () => changes };
}

test('resumes in the gesture before loading and creates one renderer-owned loop', async () => {
  const gate = deferred();
  const f = fixture({ fetchGate: gate });
  f.player.volume = 0.4;
  const playing = f.player.play(2);
  assert.deepEqual(f.calls.map(([name]) => name), ['construct', 'resume', 'fetch']);
  assert.equal(f.sandbox.navigator.audioSession.type, 'playback');
  assert.equal(f.nodes.length, 0);
  gate.resolve();
  await playing;
  assert.equal(f.nodes.length, 1);
  assert.equal(f.nodes[0].loop, true);
  assert.equal(f.nodes[0].loopStart, 0);
  assert.equal(f.nodes[0].loopEnd, 7);
  assert.equal(f.nodes[0].started.offset, 2);
  assert.equal(f.player.paused, false);
  f.contexts[0].advance(16);
  assert.equal(f.player.currentTime, 4);
  assert.equal(f.nodes.length, 1, 'loop boundaries never create replacement nodes');
  assert.equal(f.player._gain.gain.value, 0.4);
  f.player.volume = 0.6;
  assert.equal(f.player._gain.gain.value, 0.6);
});

test('pause retains phase, resume reuses decoded data with a fresh source', async () => {
  const f = fixture();
  await f.player.play(5);
  f.contexts[0].advance(3);
  f.player.pause();
  assert.equal(f.player.currentTime, 1);
  assert.equal(f.player.paused, true);
  assert.equal(f.nodes[0].stopped, true);
  f.contexts[0].advance(20);
  assert.equal(f.player.currentTime, 1);
  await f.player.play();
  assert.equal(f.nodes[1].started.offset, 1);
  assert.equal(f.calls.filter(([name]) => name === 'fetch').length, 1);
  assert.equal(f.calls.filter(([name]) => name === 'decode').length, 1);
  f.player.stop();
  assert.equal(f.player.currentTime, 0);
  assert.equal(f.player.paused, true);
});

test('suspension freezes phase and reports paused without a wall-clock timer', async () => {
  const f = fixture();
  await f.player.play();
  const context = f.contexts[0];
  context.advance(4);
  const changes = f.changes();
  context.setState('interrupted');
  context.advance(100);
  assert.equal(f.player.paused, true);
  assert.equal(f.player.currentTime, 4);
  assert.equal(f.changes(), changes + 1);
  await f.player.play();
  assert.equal(f.player.paused, false);
  assert.equal(f.nodes.length, 1);
  context.advance(4);
  assert.equal(f.player.currentTime, 1);
});

test('pause during decoding cannot start a source later', async () => {
  const gate = deferred();
  const f = fixture({ decodeGate: gate });
  const pending = f.player.play(2);
  await Promise.resolve();
  f.player.pause();
  gate.resolve(f.decoded);
  await pending;
  assert.equal(f.nodes.length, 0);
  assert.equal(f.player.paused, true);
  await f.player.play();
  assert.equal(f.nodes[0].started.offset, 2);
});

test('only the latest pending play starts and positions wrap by decoded duration', async () => {
  const gate = deferred();
  const f = fixture({ decodeGate: gate });
  const first = f.player.play(1);
  const second = f.player.play(1000);
  gate.resolve(f.decoded);
  await Promise.all([first, second]);
  assert.equal(f.nodes.length, 1);
  assert.equal(f.nodes[0].started.offset, 6);
  f.player.currentTime = -1;
  assert.equal(f.player.currentTime, 6);
  assert.equal(f.nodes[0].stopped, true);
  assert.equal(f.nodes[1].started.offset, 6);
  f.player.stop(false);
  assert.equal(f.player.currentTime, 6);
});

test('a pending resume keeps play intent cancellable and cannot start after pause', async () => {
  const gate = deferred();
  const f = fixture({ resumeGate: gate });
  const pending = f.player.play();
  assert.equal(f.player.paused, false);
  f.player.pause();
  assert.equal(f.player.paused, true);
  gate.resolve();
  await pending;
  assert.equal(f.nodes.length, 0);
});

test('a closed context is replaced without losing the source phase', async () => {
  const f = fixture();
  await f.player.play(2);
  f.contexts[0].advance(3);
  f.contexts[0].setState('closed');
  await f.player.play();
  assert.equal(f.contexts.length, 2);
  assert.equal(f.nodes[0].stopped, true);
  assert.equal(f.nodes[1].started.offset, 5);
});

test('sample-rate rejection falls back; load failure rejects for the caller fallback', async () => {
  const f = fixture({ rejectPreferred: true, fetchFailure: true });
  await assert.rejects(f.player.play(), /could not be loaded/);
  assert.equal(f.calls.filter(([name]) => name === 'construct').length, 2);
  assert.equal(f.player.paused, true);
  assert.match(f.player.error.message, /could not be loaded/);
  assert.equal(f.nodes.length, 0);
});

test('an unexpected stop updates state but never schedules another loop', async () => {
  const f = fixture();
  await f.player.play();
  f.contexts[0].advance(2);
  f.nodes[0].onended();
  assert.equal(f.player.paused, true);
  assert.equal(f.player.currentTime, 2);
  assert.equal(f.nodes.length, 1);
});
