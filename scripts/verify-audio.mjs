/** Dependency-free checks for loop PCM and the actual browser worker source. */
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const root = new URL('../dist/', import.meta.url);
const wav = await readFile(new URL('audio/water.wav', root));
assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
assert.equal(wav.readUInt16LE(22), 1);
assert.equal(wav.readUInt32LE(24), 16000);
assert.equal(wav.readUInt16LE(34), 16);
assert.equal(wav.readUInt32LE(40), 300 * 16000 * 2);
const source = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.length - 44) / 2);
let peak = 0;
let maximumStep = 0;
for (let i = 0; i < source.length; i++) {
  peak = Math.max(peak, Math.abs(source[i]));
  if (i) maximumStep = Math.max(maximumStep, Math.abs(source[i] - source[i - 1]));
}
assert.ok(peak < 32767, 'No clipped samples');
assert.ok(Math.abs(source[0] - source.at(-1)) < maximumStep, 'Loop seam is within normal sample variation');

const workerSource = await readFile(new URL('fade-worker.js', root), 'utf8');
const encoderSource = await readFile(new URL('vendor/lame.min.js', root), 'utf8');
let pending;
let lastProgress;
let context;
const self = {
  location: { href: 'http://localhost/fade-worker.js' },
  postMessage(message) {
    if (message.type === 'progress') {
      assert.ok(message.value >= lastProgress && message.value <= 1);
      lastProgress = message.value;
    } else if (message.type === 'done' || message.type === 'error') {
      pending.resolve(message);
    }
  },
};
context = vm.createContext({
  self, Blob, URL, performance, setTimeout, console,
  fetch: async (url) => {
    assert.equal(new URL(url).pathname, '/audio/water.wav');
    return { ok: true, arrayBuffer: async () => wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) };
  },
  importScripts: (url) => {
    assert.equal(new URL(url).pathname, '/vendor/lame.min.js');
    vm.runInContext(encoderSource, context);
  },
});
vm.runInContext(workerSource, context, { filename: 'fade-worker.js' });
async function render(message) {
  lastProgress = -1;
  const result = new Promise((resolve) => { pending = { resolve }; });
  self.onmessage({ data: message });
  return result;
}

const invalid = await render({ id: 0, minutes: 0 });
assert.equal(invalid.type, 'error');
const offsetSeconds = 299.8;
const rendered = await render({ id: 1, minutes: 0.1, offsetSeconds });
assert.equal(rendered.type, 'done', rendered.message);
assert.equal(rendered.duration, 6);
assert.equal(rendered.blob.type, 'audio/wav');
const finite = Buffer.from(await rendered.blob.arrayBuffer());
assert.equal(finite.length, 44 + 6 * 16000 * 2);
assert.equal(finite.readInt16LE(44), 0, 'Click-free start');
assert.equal(finite.readInt16LE(finite.length - 2), 0, 'Silent last sample');
const count = (finite.length - 44) / 2;
for (let i = 0; i < count; i += 97) {
  const fade = Math.cos(Math.PI / 2 * i / (count - 1));
  const attack = i < 480 ? Math.sin(Math.PI / 2 * i / 480) : 1;
  const expected = Math.round(source[(Math.round(offsetSeconds * 16000) + i) % source.length] * fade * attack) || 0;
  assert.equal(finite.readInt16LE(44 + i * 2), expected, `Envelope at ${i}`);
}

function mp3Metrics(buffer) {
  let offset = 0;
  let frames = 0;
  let duration = 0;
  while (offset + 4 <= buffer.length) {
    assert.equal(buffer[offset], 0xff, `Frame sync at ${offset}`);
    assert.equal(buffer[offset + 1] & 0xe0, 0xe0, `Frame sync at ${offset}`);
    const version = (buffer[offset + 1] >> 3) & 3;
    const layer = (buffer[offset + 1] >> 1) & 3;
    assert.equal(layer, 1, 'Layer III');
    const lowRate = version !== 3;
    const bitrate = (lowRate ? [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160] : [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320])[(buffer[offset + 2] >> 4) & 15];
    const sampleRate = [44100, 48000, 32000][(buffer[offset + 2] >> 2) & 3] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const padding = (buffer[offset + 2] >> 1) & 1;
    assert.equal(sampleRate, 16000);
    assert.equal(bitrate, 48);
    duration += (lowRate ? 576 : 1152) / sampleRate;
    offset += Math.floor((lowRate ? 72 : 144) * bitrate * 1000 / sampleRate) + padding;
    frames++;
  }
  assert.equal(offset, buffer.length);
  return { frames, duration, bytes: buffer.length };
}

const start = performance.now();
const wavMinutesArgument = process.argv.find((argument) => argument.startsWith('--wav-minutes='));
const maximumWav = process.argv.includes('--max-wav') || Boolean(wavMinutesArgument);
const minutes = wavMinutesArgument ? Number(wavMinutesArgument.split('=')[1])
  : process.argv.includes('--long') || maximumWav ? 60 : 0.1;
const media = await render({ id: 2, minutes, offsetSeconds, format: maximumWav ? 'wav' : 'mp3' });
assert.equal(media.type, 'done', media.message);
assert.equal(media.duration, minutes * 60);
let metrics;
if (maximumWav) {
  assert.equal(media.format, 'wav');
  assert.equal(media.blob.size, 44 + minutes * 60 * 16000 * 2);
  const firstSample = new DataView(await media.blob.slice(44, 46).arrayBuffer()).getInt16(0, true);
  const lastSample = new DataView(await media.blob.slice(-2).arrayBuffer()).getInt16(0, true);
  assert.equal(firstSample, 0);
  assert.equal(lastSample, 0);
  metrics = { format: 'wav', duration: media.duration, bytes: media.blob.size };
} else {
  assert.equal(media.format, 'mp3', 'Vendored encoder must work, not silently fall back');
  assert.equal(media.blob.type, 'audio/mpeg');
  metrics = { format: 'mp3', ...mp3Metrics(Buffer.from(await media.blob.arrayBuffer())) };
  assert.ok(metrics.duration >= minutes * 60 && metrics.duration < minutes * 60 + 0.15);
}
assert.equal(lastProgress, 1);
console.log(JSON.stringify({
  status: 'passed', pcmSeconds: 300, peak: peak / 32768,
  seamStep: Math.abs(source[0] - source.at(-1)) / 32768,
  exactCosineEnvelope: true, media: metrics,
  encodingSeconds: (performance.now() - start) / 1000,
  processMemoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
  workerPath: fileURLToPath(new URL('fade-worker.js', root)),
}, null, 2));
