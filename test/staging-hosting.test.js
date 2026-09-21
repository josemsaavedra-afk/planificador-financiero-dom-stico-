import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const hosting=JSON.parse(read('vercel.json'));

test('staging: salida estática conserva subdirectorio, entrada canónica y despliegue Git desactivado',()=>{
 assert.equal(hosting.framework,null);assert.equal(hosting.outputDirectory,'dist');assert.equal(hosting.cleanUrls,false);assert.equal(hosting.git.deploymentEnabled,false);
 assert.equal(hosting.installCommand,'pnpm install --frozen-lockfile --ignore-scripts --prod=false');assert.equal(hosting.buildCommand,'pnpm run build && pnpm run check');
 assert.equal(hosting.rewrites,undefined);assert.equal(hosting.functions,undefined);
 for(const source of ['/','/domus-3','/domus-3/']){const rule=hosting.redirects.find(rule=>rule.source===source);assert.equal(rule?.destination,'/domus-3/index.html');assert.equal(rule.permanent,false);}
 const build=read('scripts/build.mjs');assert.match(build,/path.join\(root, 'dist', 'domus-3'\)/);assert.doesNotMatch(build,/copyFile\([^\n]*(?:server|database|index-258)/);
});
test('staging: headers revalidan HTML/config/SW y mantienen MIME y scope restringido',()=>{
 const headers=path=>Object.fromEntries(hosting.headers.filter(rule=>rule.source.endsWith('(.*)')?path.startsWith(rule.source.slice(0,-4)):rule.source===path).flatMap(rule=>rule.headers.map(({key,value})=>[key.toLowerCase(),value])));
 for(const file of ['index.html','config.js','sw.js','asset-manifest.js','manifest.webmanifest','src/treasury/ui.js']){const h=headers('/domus-3/'+file);assert.equal(h['cache-control'],'no-cache, max-age=0, must-revalidate');assert.equal(h['x-content-type-options'],'nosniff');assert.equal(h['service-worker-allowed'],undefined);}
 assert.match(headers('/domus-3/sw.js')['content-type'],/^application\/javascript/);assert.match(headers('/domus-3/manifest.webmanifest')['content-type'],/^application\/manifest\+json/);assert.deepEqual(headers('/index-258.html'),{});
});
test('staging: runtime portable, PWA y recuperación usan el origen HTTPS actual sin backend por defecto',()=>{
 const files=['index.html','config.js','sw.js','manifest.webmanifest',...readdirSync(new URL('../src/treasury/',import.meta.url)).filter(file=>file.endsWith('.js')).map(file=>'src/treasury/'+file)];
 for(const file of files)assert.doesNotMatch(read(file),/\blocalhost\b|127\.0\.0\.1|0\.0\.0\.0|\b[A-Za-z]:[\\/]|file:\/\/|https?:\/\/[^\s'"<>]*(?:\.vercel\.app|\.trycloudflare\.com)/,file);
 const base='https://future-staging.example.invalid/domus-3/',manifest=JSON.parse(read('manifest.webmanifest'));
 assert.match(manifest.name,/DOMUS 3/);assert.equal(new URL(manifest.scope,base).href,base);assert.equal(new URL(manifest.id,base).href,base);assert.equal(new URL(manifest.start_url,base).href,base+'index.html?source=pwa');
 for(const icon of manifest.icons)assert.ok(new URL(icon.src,base).href.startsWith(base));
 const sandbox={window:{},URL};runInNewContext(read('config.js'),sandbox);runInNewContext(read('src/treasury/runtime-config.js'),sandbox);
 assert.equal(sandbox.window.DOMUS_CONFIG.treasuryPersistence,false);assert.equal(sandbox.window.DOMUSRuntime.readConfig(sandbox.window.DOMUS_CONFIG).ready,false);
 assert.equal(sandbox.window.DOMUSRuntime.authRedirect(base+'index.html?next=https://untrusted.invalid#token=fake'),base+'index.html');
});
