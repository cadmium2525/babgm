/* Offline PCM rendering keeps the fade in the audio file when the page sleeps. */
'use strict';

let sourcePromise;
let activeToken = null;
let encoderLoaded = false;

async function loadSource() {
  if (!sourcePromise) {
    sourcePromise = fetch(new URL('audio/water.wav', self.location.href)).then(async (response) => {
      if (!response.ok) throw new Error('水音を読み込めませんでした。');
      const buffer = await response.arrayBuffer();
      const view = new DataView(buffer);
      const text = (offset, length) => String.fromCharCode(...new Uint8Array(buffer, offset, length));
      if (text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE') throw new Error('音声形式が不正です。');
      let sampleRate;
      let channels;
      let bits;
      let pcmFormat;
      let dataOffset;
      let dataLength;
      for (let offset = 12; offset + 8 <= buffer.byteLength;) {
        const length = view.getUint32(offset + 4, true);
        const type = text(offset, 4);
        if (offset + 8 + length > buffer.byteLength) throw new Error('音声が壊れています。');
        if (type === 'fmt ') {
          pcmFormat = view.getUint16(offset + 8, true);
          channels = view.getUint16(offset + 10, true);
          sampleRate = view.getUint32(offset + 12, true);
          bits = view.getUint16(offset + 22, true);
        } else if (type === 'data') {
          dataOffset = offset + 8;
          dataLength = length;
        }
        offset += 8 + length + (length % 2);
      }
      if (pcmFormat !== 1 || channels !== 1 || bits !== 16 || !sampleRate || !dataLength) {
        throw new Error('対応していない音声形式です。');
      }
      return { samples: new Int16Array(buffer, dataOffset, dataLength / 2), sampleRate };
    }).catch((error) => {
      sourcePromise = null;
      throw error;
    });
  }
  return sourcePromise;
}

function loadEncoder() {
  if (!encoderLoaded) {
    importScripts(new URL('vendor/lame.min.js', self.location.href).href);
    if (typeof lamejs?.Mp3Encoder !== 'function') throw new Error('MP3 encoder unavailable');
    encoderLoaded = true;
  }
}

function wavHeader(sampleRate, frames) {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const write = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  write(0, 'RIFF');
  view.setUint32(4, 36 + frames * 2, true);
  write(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, frames * 2, true);
  return buffer;
}

const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

async function render(message, token) {
  const { id, minutes, offsetSeconds = 0, format = 'wav' } = message;
  if (!Number.isFinite(minutes) || minutes < 0.1 || minutes > 60) {
    throw new Error('時間は 0.1〜60 分で指定してください。');
  }
  if (!Number.isFinite(offsetSeconds)) throw new Error('再生位置が不正です。');
  self.postMessage({ id, type: 'progress', value: 0 });
  const { samples, sampleRate } = await loadSource();
  if (activeToken !== token) return;
  const frames = Math.round(minutes * 60 * sampleRate);
  const duration = frames / sampleRate;
  let offset = ((Math.round(offsetSeconds * sampleRate) % samples.length) + samples.length) % samples.length;
  let encoder;
  let resultFormat = format === 'wav' ? 'wav' : 'mp3';
  if (resultFormat === 'mp3') {
    try {
      loadEncoder();
      encoder = new lamejs.Mp3Encoder(1, sampleRate, 48);
    } catch (error) {
      // A local PCM fallback also works offline if an encoder cannot be loaded.
      resultFormat = 'wav';
    }
  }
  const parts = resultFormat === 'wav' ? [wavHeader(sampleRate, frames)] : [];
  const chunkSize = encoder ? 1152 : 32768;
  const attackFrames = Math.max(1, Math.round(sampleRate * 0.03));
  const fadeStep = Math.PI / 2 / Math.max(1, frames - 1);
  const attackStep = Math.PI / 2 / attackFrames;
  const cosine = Math.cos;
  const sine = Math.sin;
  const round = Math.round;
  let lastProgress = 0;
  let lastYield = performance.now();
  for (let start = 0; start < frames; start += chunkSize) {
    if (activeToken !== token) return;
    const length = Math.min(chunkSize, frames - start);
    const pcm = new Int16Array(length);
    for (let i = 0; i < length; i++) {
      const index = start + i;
      const fade = cosine(index * fadeStep);
      const attack = index < attackFrames ? sine(index * attackStep) : 1;
      pcm[i] = round(samples[offset] * fade * attack);
      if (++offset === samples.length) offset = 0;
    }
    if (encoder) {
      const bytes = encoder.encodeBuffer(pcm);
      if (bytes.length) parts.push(new Uint8Array(bytes));
    } else {
      // Write explicit little endian PCM, independent of the device endianness.
      const bytes = new ArrayBuffer(length * 2);
      const view = new DataView(bytes);
      for (let i = 0; i < length; i++) view.setInt16(i * 2, pcm[i], true);
      // Immutable chunks can be concatenated by Blob without retaining a full
      // mutable PCM array alongside another full-size final file copy.
      parts.push(new Blob([bytes]));
    }
    const progress = (start + length) / frames;
    if (progress - lastProgress >= 0.01) {
      self.postMessage({ id, type: 'progress', value: progress });
      lastProgress = progress;
    }
    if (performance.now() - lastYield > 40) {
      await nextTurn();
      lastYield = performance.now();
    }
  }
  if (activeToken !== token) return;
  if (encoder) {
    const bytes = encoder.flush();
    if (bytes.length) parts.push(new Uint8Array(bytes));
  }
  const blob = new Blob(parts, { type: encoder ? 'audio/mpeg' : 'audio/wav' });
  self.postMessage({ id, type: 'progress', value: 1 });
  self.postMessage({ id, type: 'done', blob, duration, format: resultFormat });
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === 'cancel') {
    activeToken = null;
    return;
  }
  const token = {};
  activeToken = token;
  render(message, token).catch((error) => {
    if (activeToken === token) self.postMessage({ id: message.id, type: 'error', message: error.message, error: error.message });
  });
};
