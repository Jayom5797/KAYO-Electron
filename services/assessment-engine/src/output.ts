import { writeFile } from 'node:fs/promises';

export async function writeOutput(content: string, filePath?: string): Promise<void> {
  if (filePath) {
    try {
      await writeFile(filePath, content, 'utf8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Cannot write to "${filePath}": ${msg}`);
    }
  } else {
    process.stdout.write(content);
  }
}
