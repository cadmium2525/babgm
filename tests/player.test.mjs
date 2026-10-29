import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const appUrl = 'https://example.test/player/app.js';
const source = (await readFile(new URL('../dist/app.js', import.meta.url), 'utf8'))
  .replaceAll('import.meta.url', JSON.stringify(appUrl));

// Exercise user-visible playback transitions without encoding audio or claiming
// that a simulated browser can establish real phone lock-screen behavior.
function createPlayer() {
  class Element {
    constructor() {
      this.listeners = new Map();
      this.attributes = new Map();
      this.hidden = false;
      this.disabled = false;
      this.value = '';
      this.textContent = '';
    }
    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }
    emit(type, detail = {}) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener({ type, target: this, preventDefault() {}, ...detail });
      }
    }
    setAttribute(name, value) { this.attributes.set(name, value); }
    reportValidity() { return true; }
    focus() {}
    showModal() {}
    close() {}
  }
  class Audio extends Element {
    constructor() {
      super();
      this.src = new URL('./audio/water.wav', appUrl).href;
      this.loop = true;
      this.paused = true;
      this.ended = false;
      this.currentTime = 0;
      this.duration = 60;
      this.volume = 0.5;
      this.loads = 0;
    }
    load() {
      this.loads++;
      this.currentTime = 0;
      this.paused = true;
      this.ended = false;
    }
    play() {
      this.paused = false;
      this.ended = false;
      this.emit('play');
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
      this.emit('pause');
    }
  }
  const audio = new Audio();
  const elements = new Map([['audio', audio]]);
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const document = new Element();
  document.hidden = false;
  document.getElementById = element;
  document.querySelector = element;
  const workers = [];
  class Worker {
    constructor() { workers.push(this); }
    postMessage(message) { this.message = message; }
    terminate() { this.terminated = true; }
    complete(duration = Number(element('minutes').value) * 60) {
      // Deliberately deliver even after terminate() to test late queued results.
      this.onmessage({ data: {
        id: this.message.id, type: 'done', duration,
        blob: new Blob(['rendered audio'], { type: 'audio/wav' }),
      } });
    }
  }
  let nextBlob = 0;
  const revoked = [];
  class BrowserURL extends URL {
    static createObjectURL() { return `blob:rendered-${++nextBlob}`; }
    static revokeObjectURL(url) { revoked.push(url); }
  }
  const settings = new Map();
  const mediaHandlers = new Map();
  const context = vm.createContext({
    document, window: new Element(), location: { href: appUrl }, Worker,
    URL: BrowserURL, Blob,
    localStorage: { getItem: (key) => settings.get(key) ?? null, setItem: (key, value) => settings.set(key, value) },
    navigator: { userAgent: 'test', platform: 'test', maxTouchPoints: 0,
      mediaSession: { setPositionState() {}, setActionHandler: (name, handler) => mediaHandlers.set(name, handler) },
    },
    MediaMetadata: class { constructor(data) { Object.assign(this, data); } },
  });
  new vm.Script(source, { filename: 'app.js' }).runInContext(context, { timeout: 1000 });
  return {
    audio, element, workers, revoked, mediaHandlers,
    submit(minutes = 10) {
      element('minutes').value = String(minutes);
      element('fade-form').emit('submit');
      return workers.at(-1);
    },
    click(id) { element(id).emit('click'); },
    setHidden(hidden) {
      document.hidden = hidden;
      document.emit('visibilitychange');
    },
  };
}

test('normal audio loops; a prepared fade is a finite native audio source', () => {
  const player = createPlayer();
  player.click('play');
  assert.equal(player.audio.loop, true);
  assert.equal(player.audio.paused, false);
  player.submit(10).complete(600);
  assert.equal(player.audio.loop, false);
  assert.equal(player.audio.paused, false);
  assert.match(player.audio.src, /^blob:/);
  assert.equal(player.element('status').textContent, 'フェード中');
  assert.equal(player.element('remaining').textContent, 'あと 10:00');
});

test('pause and resume keep the finite source and its elapsed fade position', () => {
  const player = createPlayer();
  player.submit(10).complete(600);
  const fadeSource = player.audio.src;
  player.audio.currentTime = 123;
  player.click('play');
  assert.equal(player.audio.paused, true);
  assert.equal(player.element('status').textContent, '一時停止');
  player.click('play');
  assert.equal(player.audio.paused, false);
  assert.equal(player.audio.loop, false);
  assert.equal(player.audio.src, fadeSource);
  assert.equal(player.audio.currentTime, 123);
  assert.equal(player.element('remaining').textContent, 'あと 7:57');
});

test('cancelling preparation ignores late worker results', () => {
  const player = createPlayer();
  const worker = player.submit();
  const originalSource = player.audio.src;
  player.click('cancel-fade');
  assert.equal(worker.terminated, true);
  worker.complete();
  assert.equal(player.audio.src, originalSource);
  assert.equal(player.audio.loop, true);
  assert.equal(player.audio.paused, false);
  assert.equal(player.element('progress').hidden, true);
  assert.equal(player.element('fade').disabled, false);
  assert.equal(player.element('cancel-fade').hidden, true);
});

test('hidden completion keeps the old loop; visibility commits the fade once', () => {
  const player = createPlayer();
  const worker = player.submit(2);
  const originalSource = player.audio.src;
  const previousLoads = player.audio.loads;
  player.setHidden(true);
  worker.complete(120);
  assert.equal(player.audio.src, originalSource);
  assert.equal(player.audio.loads, previousLoads);
  assert.equal(player.audio.loop, true);
  assert.equal(player.audio.paused, false);
  assert.equal(player.element('status').textContent, '画面を戻すと開始');
  player.setHidden(false);
  assert.match(player.audio.src, /^blob:/);
  assert.equal(player.audio.loads, previousLoads + 1);
  assert.equal(player.audio.loop, false);
  assert.equal(player.audio.paused, false);
  assert.equal(player.element('status').textContent, 'フェード中');
  player.setHidden(false);
  assert.equal(player.audio.loads, previousLoads + 1);
});

test('a paused deferred fade cannot replace the source when the page returns', () => {
  const player = createPlayer();
  const worker = player.submit();
  const originalSource = player.audio.src;
  player.setHidden(true);
  worker.complete();
  player.mediaHandlers.get('pause')();
  player.setHidden(false);
  assert.equal(player.audio.src, originalSource);
  assert.equal(player.audio.loop, true);
  assert.equal(player.audio.paused, true);
  assert.equal(player.element('cancel-fade').hidden, true);
});

test('replacing an almost finished fade loops during preparation; cancel restores its phase', () => {
  const player = createPlayer();
  player.submit(0.1).complete(6);
  player.audio.currentTime = 5.9;
  const worker = player.submit(1);
  assert.equal(player.audio.loop, true);
  assert.equal(player.audio.paused, false);
  assert.match(player.audio.src, /water\.wav$/);
  worker.complete(60);
  assert.equal(player.audio.loop, false);
  assert.equal(player.audio.paused, false);
  player.audio.currentTime = 8;
  player.click('cancel-fade');
  assert.equal(player.audio.loop, true);
  assert.equal(player.audio.currentTime, worker.message.offsetSeconds + 8);
  assert.equal(player.audio.paused, false);
  assert.equal(player.revoked.length, 2);
});
