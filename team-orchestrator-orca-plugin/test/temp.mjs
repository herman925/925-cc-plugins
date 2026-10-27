// A temporary folder a test made, removed the way each platform allows.
//
// On Windows an open handle blocks unlink even when the owner has just called close (EBUSY, or EPERM for a folder that
// still holds one), so the removal is retried briefly. What is still held after that is left in the system temp folder:
// nothing is lost, and a teardown must not be the thing that fails a test that passed.
import { rm } from 'node:fs/promises';

const BUSY = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']);

export async function rmTemp(path, tries = 40, waitMs = 25) {
  for (let i = 0; i < tries; i++) {
    try {
      return await rm(path, { recursive: true, force: true });
    } catch (error) {
      if (!BUSY.has(error?.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }
  try {
    await rm(path, { recursive: true, force: true });
  } catch {
    // still held: the folder stays under the system temp
  }
}
