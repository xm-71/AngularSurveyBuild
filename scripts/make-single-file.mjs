// Packs the Vite builds into single HTML files:
//   dist/starwander.html  - complete standalone page with three.js bundled (works offline)
//   dist/artifact.html    - page fragment for hosts that supply their own document skeleton
//                           (no doctype/html/head/body); loads three.js from jsDelivr through
//                           an import map and inlines only the game code
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const THREE_VERSION = JSON.parse(readFileSync(join(root, 'node_modules/three/package.json'), 'utf8')).version;

function readBuild(dir) {
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const scriptMatch = html.match(/<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/);
  const cssMatch = html.match(/<link rel="stylesheet" crossorigin href="\.\/([^"]+)">/);
  if (!scriptMatch) throw new Error(`Could not find the module script in ${dir}/index.html`);
  const js = readFileSync(join(dir, scriptMatch[1]), 'utf8').replace(/<\/script/gi, '<\\/script');
  const css = cssMatch ? readFileSync(join(dir, cssMatch[1]), 'utf8') : '';
  return { js, css };
}

const { js, css } = readBuild(dist);
const art = readBuild(join(root, 'dist-artifact'));
const cdn = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`;
const importMap = `<script type="importmap">${JSON.stringify({
  imports: { three: `${cdn}/build/three.module.js`, 'three/examples/jsm/': `${cdn}/examples/jsm/` },
})}</script>`;
// If the engine cannot load (offline, blocked CDN), say so instead of showing a blank page.
const watchdog = `<script>setTimeout(function(){if(window.__swBooted)return;var ui=document.getElementById('ui');if(!ui)return;var d=document.createElement('div');d.id='boot-wait';d.className='screen';d.innerHTML='<div class="panel" style="width:min(480px,100%)"><div class="eyebrow">Starwander</div><h2 class="panel-title" style="margin:8px 0">Still loading the 3D engine</h2><p style="color:var(--muted);margin:0">The game loads three.js from cdn.jsdelivr.net. If this message stays, check your connection and reload the page.</p></div>';ui.appendChild(d);},15000);</script>`;

const fonts =
  '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=Saira+Semi+Condensed:wght@300;400;500;600&family=Share+Tech+Mono&display=swap">';
const body = '<div id="app">\n  <canvas id="game"></canvas>\n  <div id="ui"></div>\n</div>';
const description =
  'A procedural space exploration game: fly seamlessly between generated planets, walk alien worlds, mine, scan and warp across an endless galaxy.';

const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<title>Starwander</title>
<meta name="description" content="${description}">
${fonts}
<style>${css}</style>
</head>
<body>
${body}
<script type="module">${js}</script>
</body>
</html>
`;

const fragment = `<title>Starwander</title>
${fonts}
<style>${art.css}</style>
${body}
${importMap}
${watchdog}
<script type="module">${art.js}</script>
`;

writeFileSync(join(dist, 'starwander.html'), standalone);
writeFileSync(join(dist, 'artifact.html'), fragment);
const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
console.log(`dist/starwander.html  ${kb(standalone)}`);
console.log(`dist/artifact.html    ${kb(fragment)}`);
