import { Global, Module } from '@nestjs/common';
import type { MulterModuleOptions } from '@nestjs/platform-express';
import { MULTER_MODULE_OPTIONS } from '@nestjs/platform-express/multer/files.constants.js';
import { AppConfig } from '../config/app-config.module.js';
import { FileStorageService } from './file-storage.service.js';
import { ImageProcessingGate } from './image-processing-gate.js';

const MAX_TEXT_FIELDS_PER_UPLOAD = 20;
const MAX_TEXT_FIELD_BYTES = 64 * 1024;

/**
 * #36 (N1): the one file-storage helper the whole system shares. See `FileStorageService`'s own
 * comment for what "shared" does and does not mean here.
 *
 * Global, matching every other cross-cutting service in this codebase (`PrismaModule`,
 * `TimeModule`, `EmailModule`, `AuditModule`) — five later topics each store a file, and an
 * explicit import at every one of those call sites is exactly the kind of thing one of them
 * eventually forgets.
 *
 * Code review of topic 8 (§82): also where the upload size cap reaches multer itself. Every
 * `FileInterceptor`/`FilesInterceptor` in the system injects `MULTER_MODULE_OPTIONS` optionally,
 * and a provider exported from this global module is what each of them finds — one place, not a
 * `limits` option each controller has to remember. Before this, no interceptor had a limit at all:
 * multer buffered the *whole* request body into memory and only then did `FileStorageService`
 * check it against `maxImageUploadBytes` — a 300MB upload by any signed-in user took the process
 * from 272MB to 838MB RSS and was answered with a 404 afterwards. With `fileSize` set, multer stops
 * buffering at the cap and the request fails with 413 (`PAYLOAD_TOO_LARGE`) straight away.
 * `FileStorageService`'s own length checks stay as the second line — they are what a caller
 * handing it a buffer from anywhere other than multer still relies on.
 *
 * Not `files`: the dispute evidence routes take up to ten files through `FilesInterceptor`, whose own
 * `maxCount` already caps them per route.
 *
 * §100 — to disk, not memory (`dest`). `fileSize` stopped one upload from being larger than a photo;
 * it did nothing about many photo-sized uploads at once, and twelve simultaneous dispute uploads
 * (10 × 10MB each, all held in memory before any handler ran) got the process killed. Written to
 * UPLOAD_TMP_DIR under a name multer picks at random, read back one file at a time inside
 * `ImageProcessingGate`, deleted when the response closes (`upload-scratch.ts`).
 *
 * Text fields stay in memory, so they get ceilings too — busboy's own default is 1MB per field and
 * no limit on how many. The longest text an upload route takes is a dispute's reason or answer, a
 * few thousand characters of Thai (three bytes each in UTF-8): 64KB leaves room many times over.
 */
@Global()
@Module({
  providers: [
    FileStorageService,
    ImageProcessingGate,
    {
      provide: MULTER_MODULE_OPTIONS,
      useFactory: (config: AppConfig): MulterModuleOptions => ({
        dest: config.uploadTmpDir,
        limits: {
          fileSize: config.maxImageUploadBytes,
          fields: MAX_TEXT_FIELDS_PER_UPLOAD,
          fieldSize: MAX_TEXT_FIELD_BYTES,
        },
      }),
      inject: [AppConfig],
    },
  ],
  exports: [FileStorageService, MULTER_MODULE_OPTIONS],
})
export class FilesModule {}
