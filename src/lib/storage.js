import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { config } from '../config/env.js';

class LocalStorage {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  getFullPath(key) {
    const fullPath = path.resolve(this.rootDir, key);
    if (!fullPath.startsWith(this.rootDir + path.sep)) {
      throw new Error('Invalid storage key: ' + key);
    }
    return fullPath;
  }

  async save(key, data) {
    const fullPath = this.getFullPath(key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, data);
    return key;
  }

  async exists(key) {
    try {
      const fullPath = this.getFullPath(key);
      await fs.access(fullPath);
      return true;
    } catch (err) {
      return false;
    }
  }

  async read(key) {
    const fullPath = this.getFullPath(key);
    return await fs.readFile(fullPath);
  }

  createReadStream(key) {
    const fullPath = this.getFullPath(key);
    return createReadStream(fullPath);
  }
}

export const storage = new LocalStorage(config.invoiceDir);
