import type { Response } from 'express';
import type { ReadImage } from './file-storage.service.js';

/**
 * Sends a file that only its own parties (or an admin through a gated route) may see — a slip, a
 * piece of dispute evidence. §83's two headers, in one place (§85 found four such routes that had
 * neither): `private, no-store` so no shared cache or browser disk keeps a copy of someone's
 * slip after the session ends, and `nosniff` so the declared type is the only one a browser will
 * ever render it as.
 */
export function sendPrivateFile(response: Response, file: ReadImage): void {
  response.setHeader('Content-Type', file.contentType);
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.send(file.buffer);
}
