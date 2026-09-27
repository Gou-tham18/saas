import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function isMain(fileUrl) {
  const startedScript = process.argv[1];
  if (!startedScript) {
    return false;
  }
  return path.resolve(startedScript) === fileURLToPath(fileUrl);
}
