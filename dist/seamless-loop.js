// One renderer-owned loop: no media-element seeks or page timers at its seam.
export class SeamlessLoop {
  constructor({ url, onchange = () => {} }) {
    this.url = url;
    this.onchange = onchange;
    this.error = null;
    this._context = null;
    this._gain = null;
    this._buffer = null;
    this._bufferPromise = null;
    this._source = null;
    this._offset = 0;
    this._startedAt = 0;
    this._requested = false;
    this._pendingPlay = false;
    this._generation = 0;
    this._volume = 1;
  }

  get duration() { return this._buffer?.duration || 300; }
  get paused() { return !this._requested || (!this._pendingPlay && this._context?.state !== 'running'); }
  get volume() { return this._volume; }
  set volume(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    this._volume = Math.max(0, Math.min(1, number));
    if (this._gain) this._gain.gain.value = this._volume;
  }
  get currentTime() {
    const elapsed = this._source ? this._context.currentTime - this._startedAt : 0;
    return this._wrap(this._offset + elapsed);
  }
  set currentTime(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    this._offset = this._buffer ? this._wrap(number) : number;
    if (this._source) {
      this._removeSource();
      this._startSource();
    }
    this.onchange();
  }

  _wrap(seconds) { return ((seconds % this.duration) + this.duration) % this.duration; }

  _createContext() {
    if (this._context && this._context.state !== 'closed') return;
    if (this._source) {
      this._offset = this.currentTime;
      this._removeSource();
    }
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) throw new Error('Web Audio is unavailable.');
    try { this._context = new Context({ sampleRate: 16000, latencyHint: 'playback' }); }
    catch { this._context = new Context({ latencyHint: 'playback' }); }
    this._gain = this._context.createGain();
    this._gain.gain.value = this._volume;
    this._gain.connect(this._context.destination);
    this._context.addEventListener('statechange', () => this.onchange());
  }

  _loadBuffer() {
    if (!this._bufferPromise) {
      const context = this._context;
      const promise = (async () => {
        const response = await fetch(this.url);
        if (!response.ok) throw new Error('The loop audio could not be loaded.');
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        if (!buffer?.length || !Number.isFinite(buffer.duration) || buffer.duration <= 0) {
          throw new Error('The loop audio is empty.');
        }
        this._buffer = buffer;
        this._offset = this._wrap(this._offset);
        return buffer;
      })().catch((error) => {
        if (this._bufferPromise === promise) this._bufferPromise = null;
        throw error;
      });
      this._bufferPromise = promise;
    }
    return this._bufferPromise;
  }

  _removeSource() {
    const source = this._source;
    this._source = null;
    if (!source) return;
    source.onended = null;
    try { source.stop(); } catch { /* It may already have stopped after an interruption. */ }
    source.disconnect();
  }

  _startSource() {
    const source = this._context.createBufferSource();
    source.buffer = this._buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = this.duration;
    source.connect(this._gain);
    source.onended = () => {
      if (this._source !== source) return;
      this._offset = this.currentTime;
      this._source = null;
      this._requested = false;
      this._pendingPlay = false;
      source.disconnect();
      this.onchange();
    };
    this._startedAt = this._context.currentTime;
    this._source = source;
    try { source.start(0, this._offset); }
    catch (error) { this._removeSource(); throw error; }
  }

  async play(offset) {
    if (offset !== undefined) this.currentTime = offset;
    const generation = ++this._generation;
    this._requested = true;
    this._pendingPlay = true;
    this.error = null;
    try {
      try {
        if ('audioSession' in navigator) navigator.audioSession.type = 'playback';
      } catch { /* Optional API, including browsers that expose it read-only. */ }
      this._createContext();
      // Run before the first await, while the initiating tap is still active.
      const resumed = this._context.resume();
      this.onchange();
      await Promise.all([resumed, this._loadBuffer()]);
      if (generation !== this._generation || !this._requested) return;
      if (!this._source) this._startSource();
      this._pendingPlay = false;
      this.onchange();
    } catch (error) {
      if (generation !== this._generation) return;
      this._offset = this.currentTime;
      this._requested = false;
      this._pendingPlay = false;
      this._removeSource();
      this.error = error;
      this.onchange();
      throw error;
    }
  }

  pause() {
    if (this._buffer) this._offset = this.currentTime;
    ++this._generation;
    this._requested = false;
    this._pendingPlay = false;
    this._removeSource();
    this.onchange();
  }

  stop(reset = true) {
    this.pause();
    if (reset) this._offset = 0;
    this.onchange();
  }
}
