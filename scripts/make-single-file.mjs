// Inlines the Vite build into self-contained HTML files:
//   dist/starwander.html  - a complete standalone page (open it directly or host it anywhere)
//   dist/artifact.html    - the same game as a page fragment for hosts that supply their own
//                           document skeleton (no doctype/html/head/body tags)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const html = readFileSync(join(dist, 'index.html'), 'utf8');

const scriptMatch = html.match(/<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/);
const cssMatch = html.match(/<link rel="stylesheet" crossorigin href="\.\/([^"]+)">/);
if (!scriptMatch) throw new Error('Could not find the module script in dist/index.html');

const js = readFileSync(join(dist, scriptMatch[1]), 'utf8').replace(/<\/script/gi, '<\\/script');
const css = cssMatch ? readFileSync(join(dist, cssMatch[1]), 'utf8') : '';

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
<style>${css}</style>
${body}
<script type="module">${js}</script>
`;

writeFileSync(join(dist, 'starwander.html'), standalone);
writeFileSync(join(dist, 'artifact.html'), fragment);
const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
console.log(`dist/starwander.html  ${kb(standalone)}`);
console.log(`dist/artifact.html    ${kb(fragment)}`);
