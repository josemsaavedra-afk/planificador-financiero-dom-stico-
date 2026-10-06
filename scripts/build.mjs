import { mkdir, copyFile, readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist', 'domus-3');
await mkdir(output, { recursive: true });
const files = ['config.js', 'index.html', 'manifest.webmanifest', 'version.json', 'sw.js', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
for (const name of await readdir(path.join(root, 'src', 'treasury'))) if (name.endsWith('.js')) files.push('src/treasury/' + name);
for (const file of files) {
  await mkdir(path.dirname(path.join(output, file)), { recursive: true });
  await copyFile(path.join(root, file), path.join(output, file));
}
await mkdir(path.join(output, 'vendor'), { recursive: true });
await copyFile(path.join(root, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'), path.join(output, 'vendor/supabase.js'));
files.push('vendor/supabase.js');
const version = JSON.parse(await readFile(path.join(root, 'version.json'), 'utf8'));
await writeFile(path.join(output, 'asset-manifest.js'), `self.DOMUS3_BUILD=${JSON.stringify(version.build)};\nself.DOMUS3_ASSETS=${JSON.stringify(files.filter(file => file !== 'sw.js'))};\n`);
console.log(`Built ${version.version}: dist/domus-3/ (${files.length + 1} files). No deployment performed.`);
