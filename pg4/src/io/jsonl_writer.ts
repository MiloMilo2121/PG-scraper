import fs from 'fs';
import path from 'path';

/**
 * Append-only JSONL writer for full debug payloads (one JSON object per line).
 */
export class JsonlWriter {
  private stream: fs.WriteStream;
  private rowsWritten = 0;

  constructor(filePath: string, opts: { append?: boolean } = {}) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const append = !!opts.append && fs.existsSync(filePath);
    this.stream = fs.createWriteStream(filePath, { flags: append ? 'a' : 'w' });
  }

  async write(obj: unknown): Promise<void> {
    const line = JSON.stringify(obj) + '\n';
    if (!this.stream.write(line)) {
      await new Promise<void>((resolve) => this.stream.once('drain', () => resolve()));
    }
    this.rowsWritten += 1;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
  }

  count(): number {
    return this.rowsWritten;
  }
}
