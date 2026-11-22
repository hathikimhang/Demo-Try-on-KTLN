import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Tìm cả test lồng trong feature; không đưa fixture thành test độc lập.
async function collect(directory) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, item.name);
    if (item.isDirectory()) files.push(...await collect(file));
    else if (file.endsWith('.test.ts')) files.push(file);
  }
  return files;
}
const files = (await collect('src/features')).sort();
if (!files.length) throw new Error('Không tìm thấy unit test.');
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
