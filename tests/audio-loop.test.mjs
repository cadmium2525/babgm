import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { seconds, renderWaterSamples, encodeWaterWav } from '../scripts/generate-audio.mjs';

const sampleRate = 16000;
const { samples, continuation } = renderWaterSamples();
const pcm = (value) => Math.round(Math.max(-1, Math.min(1, value)) * 32767);

test('the complete loop returns the noise sources, filter states and LFO to their joint period', () => {
  assert.equal(seconds, 300);
  assert.equal(samples.length, 300 * sampleRate);
  assert.equal(continuation.length, sampleRate);
  let maximumError = 0;
  for (let i = 0; i < continuation.length; i++) {
    maximumError = Math.max(maximumError, Math.abs(samples[i] - continuation[i]));
    assert.equal(pcm(samples[i]), pcm(continuation[i]), `Uninterrupted PCM sample ${i}`);
  }
  assert.ok(maximumError < 1e-12, `State reset error: ${maximumError}`);
  assert.equal(
    pcm(samples[0]) - pcm(samples.at(-1)),
    pcm(continuation[0]) - pcm(samples.at(-1)),
    'The boundary has exactly the same step as uninterrupted synthesis',
  );
});

test('the next second keeps the original signal energy across the loop without a fade', () => {
  for (const windowSeconds of [0.01, 0.1, 1]) {
    const count = Math.round(sampleRate * windowSeconds);
    let loopSquares = 0;
    let continuousSquares = 0;
    for (let i = 0; i < count; i++) {
      loopSquares += samples[i] ** 2;
      continuousSquares += continuation[i] ** 2;
    }
    const ratioDB = 10 * Math.log10(loopSquares / continuousSquares);
    assert.ok(Math.abs(ratioDB) < 1e-10, `${windowSeconds} s energy change: ${ratioDB} dB`);
  }
});

test('the shipped PCM contains the entire validated cycle without crossfades or padding', async () => {
  const saved = await readFile(new URL('../dist/audio/water.wav', import.meta.url));
  const { wav, peak, rms } = encodeWaterWav(samples);
  assert.equal(saved.length, 44 + 300 * sampleRate * 2);
  assert.ok(saved.equals(wav), 'Regenerate water.wav after changing its synthesis');
  assert.ok(peak < 1, 'No clipped samples');
  assert.ok(rms > 0.05 && rms < 0.07, `Water level changed: ${rms}`);
});
