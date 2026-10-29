/** Refresh the unmodified, version-pinned MP3 dependency using built-in Node APIs. */
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const output = new URL('../dist/vendor/', import.meta.url);
await mkdir(output, { recursive: true });
const files = [
  ['lame.min.js', 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js', '15d285e2587b3bdbfd18a68de6ce07cc074f7480a82c3815da2dc1c348ec6df4'],
  ['LICENSE.lamejs', 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/LICENSE'],
  ['package.lamejs.json', 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/package.json'],
  ['LGPL-3.0.txt', 'https://www.gnu.org/licenses/lgpl-3.0.txt'],
  ['GPL-3.0.txt', 'https://www.gnu.org/licenses/gpl-3.0.txt'],
];
for (const [name, url, expectedHash] of files) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (expectedHash && createHash('sha256').update(data).digest('hex') !== expectedHash) {
    throw new Error(`Unexpected encoder checksum: ${name}`);
  }
  await writeFile(new URL(name, output), data);
  console.log(`${name}: ${data.length} bytes`);
}
