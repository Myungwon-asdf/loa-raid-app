import { mkdir, copyFile, readdir } from 'node:fs/promises';
await mkdir('public/lib', { recursive: true });
await mkdir('public/tessdata', { recursive: true });
for (const file of ['index.html', 'app.js', 'config.js', 'logo.png', 'clear-detector.js', 'party-ocr.js', 'ladder-ui.js', 'lib/ladder.js', 'lib/domain.js']) {
  await copyFile(file, `public/${file}`);
}
for (const file of await readdir('tessdata')) {
  if (file.endsWith('.traineddata.gz')) await copyFile(`tessdata/${file}`, `public/tessdata/${file}`);
}
