/** Reproduce only Ambience.water(), as a deterministic, seamless PCM loop. */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const sampleRate = 16000;
const renderSampleRate = 48000;
const decimation = renderSampleRate / sampleRate;
// 4 s brown noise, 3 s white noise and the 0.23 Hz filter LFO all return
// to their original phase after 300 s. A shorter recording would reset the
// moving filter at its loop boundary, unlike the game's continuous graph.
export const seconds = 300;
const continuationSeconds = 1;
const warmupSeconds = 12;
const masterGain = 0.6;
function makeRandom() {
  let seed = 0x4c656166;
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}

function makeNoise(seconds, brown, random) {
  const result = new Float64Array(renderSampleRate * seconds);
  let last = 0;
  for (let i = 0; i < result.length; i++) {
    const white = random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    result[i] = brown ? last * 3.5 : white;
  }
  return result;
}

// RBJ biquads, matching Web Audio's lowpass Q in dB and bandpass Q.
class Biquad {
  constructor(type, frequency, q) {
    this.type = type;
    this.q = q;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.setFrequency(frequency);
  }
  setFrequency(frequency) {
    const omega = 2 * Math.PI * frequency / renderSampleRate;
    const sin = Math.sin(omega);
    const cos = Math.cos(omega);
    const alpha = sin / (2 * (this.type === 'lowpass' ? 10 ** (this.q / 20) : this.q));
    const a0 = 1 + alpha;
    if (this.type === 'lowpass') {
      this.b0 = (1 - cos) / (2 * a0);
      this.b1 = (1 - cos) / a0;
      this.b2 = this.b0;
    } else {
      this.b0 = alpha / a0;
      this.b1 = 0;
      this.b2 = -alpha / a0;
    }
    this.a1 = -2 * cos / a0;
    this.a2 = (1 - alpha) / a0;
  }
  sample(input) {
    const output = this.b0 * input + this.b1 * this.x1 + this.b2 * this.x2
      - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = input;
    this.y2 = this.y1;
    this.y1 = output;
    return output;
  }
}

/** Include an uninterrupted next second so tests can verify the full state. */
export function renderWaterSamples() {
  const random = makeRandom();
  const brown = makeNoise(4, true, random);
  const white = makeNoise(3, false, random);
  const lowpass = new Biquad('lowpass', 900, 1);
  const bandpass = new Biquad('bandpass', 2400, 0.8);
  const count = seconds * sampleRate;
  const continuation = continuationSeconds * sampleRate;
  const warmup = warmupSeconds * renderSampleRate;
  // Render the sample-rate-dependent brown-noise recurrence at the reference
  // AudioContext rate. A 127-tap Blackman-windowed sinc suppresses >8 kHz before
  // decimating, while retaining all of the water's main 0–3.1 kHz components.
  const firLength = 127;
  const halfFir = (firLength - 1) / 2;
  const cutoff = 6500 / renderSampleRate;
  const fir = Float64Array.from({ length: firLength }, (_, index) => {
    const x = index - halfFir;
    const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
    const window = 0.42 - 0.5 * Math.cos(2 * Math.PI * index / (firLength - 1))
      + 0.08 * Math.cos(4 * Math.PI * index / (firLength - 1));
    return sinc * window;
  });
  const firGain = fir.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < fir.length; i++) fir[i] /= firGain;
  const highRate = new Float64Array((count + continuation) * decimation + firLength - 1);
  const storeFrom = warmup - halfFir;
  for (let i = 0; i < storeFrom + highRate.length; i++) {
    bandpass.setFrequency(2400 + 700 * Math.sin(2 * Math.PI * 0.23 * i / renderSampleRate));
    const value = masterGain * (0.5 * lowpass.sample(brown[i % brown.length])
      + 0.025 * bandpass.sample(white[i % white.length]));
    if (i >= storeFrom) highRate[i - storeFrom] = value;
  }
  const raw = new Float64Array(count + continuation);
  for (let i = 0; i < raw.length; i++) {
    let value = 0;
    for (let tap = 0; tap < fir.length; tap++) value += highRate[i * decimation + tap] * fir[tap];
    raw[i] = value;
  }
  return { samples: raw.subarray(0, count), continuation: raw.subarray(count) };
}

export function encodeWaterWav(samples) {
  const count = samples.length;
  const wav = Buffer.alloc(44 + count * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(count * 2, 40);
  let peak = 0;
  let squares = 0;
  let maximumStep = 0;
  let previous;
  let first;
  let last;
  for (let i = 0; i < count; i++) {
    const value = samples[i];
    const pcm = Math.round(Math.max(-1, Math.min(1, value)) * 32767);
    wav.writeInt16LE(pcm, 44 + i * 2);
    peak = Math.max(peak, Math.abs(pcm / 32768));
    squares += (pcm / 32768) ** 2;
    if (previous !== undefined) maximumStep = Math.max(maximumStep, Math.abs(pcm - previous) / 32768);
    else first = pcm;
    previous = last = pcm;
  }
  return { wav, peak, rms: Math.sqrt(squares / count), maximumStep,
    boundaryStep: Math.abs(last - first) / 32768 };
}

export async function generateAudio() {
  const { samples, continuation } = renderWaterSamples();
  const { wav, ...metrics } = encodeWaterWav(samples);
  let maximumContinuationError = 0;
  for (let i = 0; i < continuation.length; i++) {
    maximumContinuationError = Math.max(maximumContinuationError, Math.abs(samples[i] - continuation[i]));
  }
  const output = fileURLToPath(new URL('../dist/audio/water.wav', import.meta.url));
  await mkdir(fileURLToPath(new URL('../dist/audio/', import.meta.url)), { recursive: true });
  await writeFile(output, wav);
  console.log(JSON.stringify({
    output, sampleRate, renderSampleRate, channels: 1, bitsPerSample: 16, seconds,
    bytes: wav.length, ...metrics, maximumContinuationError,
    sha256: createHash('sha256').update(wav).digest('hex'),
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await generateAudio();
}
