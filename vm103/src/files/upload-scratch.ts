import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { unlink } from 'node:fs/promises';

const logger = new Logger('UploadScratch');

/**
 * §100: removes the scratch files multer wrote for a request once its response has closed —
 * however it ended: stored, refused by validation or by a service, failed, or abandoned by the
 * client halfway through the answer.
 *
 * Mounted on Express itself in bootstrap.ts, ahead of every route, rather than left to each
 * upload handler: a handler is the one place that does not run when validation refuses the request
 * first, and a scratch directory that fills up one refused upload at a time is a disk-full outage
 * with no error pointing at it. (An upload abandoned while it is still arriving never gets this
 * far; multer removes its partial file itself.)
 */
export function discardUploadScratch(request: Request, response: Response, next: NextFunction): void {
  response.on('close', () => {
    for (const path of scratchPathsOf(request)) {
      unlink(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') {
          // The code only — a path under the scratch directory says nothing about whose file it was.
          logger.warn(`Could not remove an upload's scratch file (${error.code ?? 'unknown error'})`);
        }
      });
    }
  });
  next();
}

/** `request.file` for one upload, `request.files` (an array here — no route uses named fields) for several. */
function scratchPathsOf(request: Request): string[] {
  const single = request.file === undefined ? [] : [request.file];
  const several = Array.isArray(request.files) ? request.files : [];
  return [...single, ...several].map((file) => file.path).filter((path): path is string => typeof path === 'string');
}
