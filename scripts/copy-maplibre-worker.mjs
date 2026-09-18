/**
 * MapLibre 6 грузит воркер по адресу рядом со своим модулем, а после сборки
 * Next.js модуль лежит в чанке, где воркера нет. Поэтому кладём воркер и
 * общий с ним модуль в public/ и указываем путь явно через setWorkerUrl.
 * Запускается перед dev и build, чтобы версия всегда совпадала с пакетом.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', 'maplibre-gl', 'dist');
const to = join(root, 'public', 'maplibre');

mkdirSync(to, { recursive: true });
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(join(from, file), join(to, file));
}
