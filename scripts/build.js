import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('public/lib', { recursive: true });
for (const file of ['index.html', 'app.js', 'config.js', 'logo.png', 'clear-detector.js', 'party-ocr.js', 'lib/domain.js']) {
  await copyFile(file, `public/${file}`);
}
