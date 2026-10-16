import { Injectable, OnModuleInit } from '@nestjs/common';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import sharp from 'sharp';
import { AppException } from '../common/errors/app-exception.js';
import { newId } from '../common/id.js';
import { AppConfig } from '../config/app-config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Clock } from '../time/clock.js';
import { ImageProcessingGate } from './image-processing-gate.js';

export interface StoredImage {
  readonly id: string;
  readonly contentType: string;
  readonly sizeBytes: number;
}

/**
 * §100: an upload as multer leaves it — on disk in UPLOAD_TMP_DIR, not in memory. `Express.Multer.File`
 * satisfies it; the scratch file is deleted when the request's response closes (`upload-scratch.ts`).
 */
export interface UploadedTempFile {
  readonly path: string;
  readonly size: number;
}

export interface ReadImage {
  readonly buffer: Buffer;
  readonly contentType: string;
}

const CONTENT_TYPE_BY_FORMAT = { jpeg: 'image/jpeg', png: 'image/png' } as const;
const PDF_CONTENT_TYPE = 'application/pdf';

/**
 * §129: libvips may decode only JPEG and PNG from a buffer, in this whole process.
 *
 * Every upload is handed to `sharp(buffer)` to learn what it is, and libvips picks its decoder from
 * the bytes — so before this, an SVG, TIFF, HEIF/AVIF, GIF or WebP reached that format's decoder
 * before `sniffSupportedFormat` refused it. One of those decoders (librsvg) had a published advisory. An
 * allow-list rather than blocking the ones with known bugs: the next advisory will be in a decoder
 * nobody has thought about yet. Anything else now fails as "unsupported image format", which is
 * already the refusal callers get.
 *
 * Process-wide on purpose: every `sharp(...)` call made after boot inherits it, including one a later
 * feature adds. Only the *buffer* loaders come back, so reading a file by path (`sharp(path)`) is
 * refused too. Accepting another format, or reading from disk, means unblocking its loader here, in
 * a diff someone reviews, not quietly in a new code path.
 */
function restrictDecodersToJpegAndPng(): void {
  sharp.block({ operation: ['VipsForeignLoad'] });
  sharp.unblock({ operation: ['VipsForeignLoadJpegBuffer', 'VipsForeignLoadPngBuffer'] });
}

/**
 * #36 (N1): the one place in the system that touches the upload volume. Product images (topic
 * 5), payment slips (topic 8), dispute evidence (topic 10), and review/chat attachments
 * (topics 9/11) all store through this service instead of each growing its own file-handling
 * code — see `UploadedFile`'s own schema comment for why storage is shared but authorization is
 * not: this class has no idea what a file is *of*, and does not check who may read one. That
 * check belongs to whichever controller owns the file's meaning (`PaymentChannelController` for
 * QR codes, `PaymentSlipController` for slips, #54 — every caller since #36 shipped only ever
 * called `storeImage`/`readImage`, which is why those two stay jpg/png-only and untouched).
 *
 * ⚠️ **This is the fourth thing that ties the whole system to one instance**, alongside the
 * three CLAUDE.md already names (the three-clock cron, the in-memory Socket.io adapter, and the
 * in-memory rate-limit counters): the volume is local disk, so a second API instance would write
 * files a sibling instance's reads could never find. Scaling out means moving this to shared or
 * object storage, not adding a lock — there is nothing here for a lock to serialize.
 *
 * ⚠️ **Nothing backs this volume up.** A disk failure loses every QR code, slip, and piece of
 * dispute evidence ever uploaded. A backup plan is the project owner's to make (docs/DECISIONS.md
 * already tracks this as unanswered) — this class just writes what it is given.
 */
@Injectable()
export class FileStorageService implements OnModuleInit {
  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly gate: ImageProcessingGate,
  ) {}

  /**
   * The volume may not exist yet on a fresh deployment — created once, here, not on every write.
   * Likewise the scratch directory multer writes incoming uploads to (§100).
   */
  async onModuleInit(): Promise<void> {
    restrictDecodersToJpegAndPng();
    await mkdir(this.config.uploadDir, { recursive: true });
    await mkdir(this.config.uploadTmpDir, { recursive: true });
  }

  /**
   * Validates, re-encodes, and stores an image. Rejects anything that is not a real JPEG or PNG
   * — determined by asking `sharp` to parse the bytes, never by trusting a filename extension or
   * the `Content-Type` header a client sent, either of which a client can set to anything (K1's
   * "ตรวจชนิดไฟล์จากเนื้อไฟล์จริง").
   *
   * Re-encoding is also what strips EXIF: `sharp` does not carry a source image's metadata to
   * its output unless `withMetadata()` is called, and it never is here. A phone photo of a QR
   * code carries the GPS coordinates of wherever it was taken, and CLAUDE.md is explicit that
   * those must never reach the volume.
   */
  async storeImage(upload: UploadedTempFile): Promise<StoredImage> {
    const [stored] = await this.storeImages([upload]);
    return stored!;
  }

  /**
   * `storeImage` for several files — a dispute's evidence — under one processing slot (§100), so a
   * ten-photo upload waits for its turn once rather than ten times behind other people's. All or
   * nothing: when one file is refused, the ones stored before it are removed again.
   */
  async storeImages(uploads: readonly UploadedTempFile[]): Promise<StoredImage[]> {
    for (const upload of uploads) {
      requireWithinCeiling(upload, this.config.maxImageUploadBytes);
    }

    return this.gate.run(async () => {
      const stored: StoredImage[] = [];
      try {
        for (const upload of uploads) {
          stored.push(await this.storeOneImage(await readUpload(upload)));
        }
      } catch (error) {
        await Promise.all(stored.map((file) => this.discardUnattached(file.id)));
        throw error;
      }
      return stored;
    });
  }

  /** One file's bytes, read inside a processing slot — at most one such buffer per slot at a time. */
  private async storeOneImage(buffer: Buffer): Promise<StoredImage> {
    const format = await this.sniffSupportedFormat(buffer);
    const { bytes: reencoded, contentType } = await this.reencodeImage(buffer, format);

    // The id is generated here, server-side, and is the file's name on disk — never anything an
    // uploader supplied (K1's "ห้ามเอา input จาก user ไปประกอบ path ของไฟล์").
    const id = newId();
    await writeFile(this.pathFor(id), reencoded);

    await this.prisma.uploadedFile.create({
      data: { id, contentType, sizeBytes: reencoded.length, createdAt: this.clock.now() },
    });

    return { id, contentType, sizeBytes: reencoded.length };
  }

  /**
   * Bytes for a previously stored file, or null if the id does not correspond to one. The caller
   * is responsible for deciding whether the current request may have them — see the class
   * comment for why that check does not live here.
   */
  async readImage(id: string): Promise<ReadImage | null> {
    const row = await this.prisma.uploadedFile.findUnique({ where: { id } });
    if (row === null) {
      return null;
    }

    // #70: the row can outlive the bytes — PDPA erasure deletes a file's bytes on disk while
    // deliberately keeping the `UploadedFile` row (and whatever slip/QR row points at it) so
    // order/shop history still shows "a file was here". A stranger to that row asking for it
    // afterward gets the same answer as an id that never existed, not a 500.
    const buffer = await readFile(this.pathFor(id)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    });
    if (buffer === null) {
      return null;
    }

    return { buffer, contentType: row.contentType };
  }

  /**
   * #54 (K1): validates, sanitizes, and stores an upload that may be a jpg/png image *or* a PDF
   * — the one caller so far is a payment slip, the only document in this system a buyer can
   * legitimately hand over as a bank app's own PDF export rather than a photo. Never a second
   * file-writing path: this reuses `pathFor`, the same `uploaded_file` table, and the same
   * size limit as `storeImage` (there is nothing PDF-specific about "10MB is too big").
   *
   * "Sanitized" means two different things for the two shapes it accepts, matching K1's EXIF
   * rule extended to the one other format that can carry hidden metadata:
   * - an image is re-encoded through `sharp`, identically to `storeImage`
   * - a PDF is re-saved through `pdf-lib` with its Info dictionary (title/author/subject/
   *   keywords/producer/creator/dates) cleared and its XMP metadata stream, if any, removed
   *   from the catalog — the PDF equivalent of an image's EXIF block, and the same reason it
   *   must go: a bank app's export can carry a device or account name in there.
   */
  async storeDocument(upload: UploadedTempFile): Promise<StoredImage> {
    requireWithinCeiling(upload, this.config.maxImageUploadBytes);

    return this.gate.run(async () => this.storeOneDocument(await readUpload(upload)));
  }

  private async storeOneDocument(buffer: Buffer): Promise<StoredImage> {
    const kind = await this.sniffDocumentKind(buffer);
    const { bytes, contentType } =
      kind === 'pdf' ? await this.sanitizePdf(buffer) : await this.reencodeImage(buffer, kind);

    const id = newId();
    await writeFile(this.pathFor(id), bytes);
    await this.prisma.uploadedFile.create({
      data: { id, contentType, sizeBytes: bytes.length, createdAt: this.clock.now() },
    });

    return { id, contentType, sizeBytes: bytes.length };
  }

  /**
   * The generic counterpart to `readImage` — same lookup, same "caller decides who may see it"
   * split (see the class comment), just not named after a format that isn't always accurate
   * once `storeDocument` exists. `readImage` is untouched and still used by the callers that
   * only ever handle images.
   */
  async readStoredFile(id: string): Promise<ReadImage | null> {
    return this.readImage(id);
  }

  /**
   * #70 (G3): deletes a stored file's bytes from disk, deliberately leaving the `uploaded_file`
   * row and every other row's `fileId` pointing at it untouched — `PaymentSlip`/`RefundSlip`/
   * `PaymentChannel` all reference this table with `onDelete: Restrict` (or `SetNull`, for the
   * QR image), and PDPA erasure's own AC is "ลบไฟล์จริง...เก็บไว้แค่ว่าเคยมีสลิป" (delete the real
   * file, keep only the fact that one existed) — never a row `DELETE`. Idempotent: a second call
   * on an id already gone finds nothing to unlink and succeeds anyway, the same "running it twice
   * is safe" discipline every sweep in this system already follows.
   */
  async deleteBytes(id: string): Promise<void> {
    await unlink(this.pathFor(id)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    });
  }

  /**
   * Code review of topic 8 (§82): undoes a `storeImage`/`storeDocument` whose caller then failed
   * to attach the file to anything — bytes *and* the `uploaded_file` row, unlike `deleteBytes`
   * above, because nothing references the row yet and nothing ever will. Used when the
   * transaction that would have pointed a `PaymentSlip` at the file loses a race and rolls back;
   * before this, every such attempt left a file on the volume and a row nobody could reach.
   * Only ever called with an id the same request just stored — never one a client supplied.
   */
  async discardUnattached(id: string): Promise<void> {
    await this.prisma.uploadedFile.deleteMany({ where: { id } });
    await this.deleteBytes(id);
  }

  /**
   * `id` reaching here is always either freshly generated by `storeImage` above, or a path
   * parameter already validated as a UUID by `ParseUUIDPipe` before the controller ever calls
   * this — never a raw filename or extension a client supplied.
   */
  private pathFor(id: string): string {
    return join(this.config.uploadDir, id);
  }

  private async sniffSupportedFormat(buffer: Buffer): Promise<'jpeg' | 'png'> {
    const metadata = await sharp(buffer)
      .metadata()
      .catch(() => null);

    if (metadata?.format !== 'jpeg' && metadata?.format !== 'png') {
      throw new AppException('VALIDATION_FAILED', {
        message: 'รองรับเฉพาะไฟล์รูปภาพ jpg หรือ png เท่านั้น',
      });
    }

    return metadata.format;
  }

  /**
   * `sharp`'s own metadata parse (in `sniffSupportedFormat`/`sniffDocumentKind`) reads only the
   * header, so a truncated or otherwise corrupted file — a real thing an interrupted mobile
   * upload can produce — can pass that check and still fail here, on the full decode this needs
   * to re-encode. Caught and turned into the same `VALIDATION_FAILED` an unrecognized format
   * gets, rather than an unhandled 500: corrupt bytes are bad input, not a system fault.
   */
  private async reencodeImage(buffer: Buffer, format: 'jpeg' | 'png'): Promise<{ bytes: Buffer; contentType: string }> {
    const reencoded = await (format === 'jpeg' ? sharp(buffer).jpeg().toBuffer() : sharp(buffer).png().toBuffer()).catch(
      () => {
        throw new AppException('VALIDATION_FAILED', { message: 'ไฟล์รูปภาพเสียหายหรือเปิดไม่ได้' });
      },
    );

    return { bytes: reencoded, contentType: CONTENT_TYPE_BY_FORMAT[format] };
  }

  /** Content sniffed from the bytes themselves (K1) — jpg/png via `sharp`, PDF via its own magic number check. */
  private async sniffDocumentKind(buffer: Buffer): Promise<'jpeg' | 'png' | 'pdf'> {
    if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
      return 'pdf';
    }

    const metadata = await sharp(buffer)
      .metadata()
      .catch(() => null);

    if (metadata?.format !== 'jpeg' && metadata?.format !== 'png') {
      throw new AppException('VALIDATION_FAILED', {
        message: 'รองรับเฉพาะไฟล์ jpg, png หรือ pdf เท่านั้น',
      });
    }

    return metadata.format;
  }

  private async sanitizePdf(buffer: Buffer): Promise<{ bytes: Buffer; contentType: string }> {
    const doc = await PDFDocument.load(buffer, { updateMetadata: false }).catch(() => {
      throw new AppException('VALIDATION_FAILED', { message: 'ไฟล์ pdf เสียหายหรือเปิดไม่ได้' });
    });

    doc.setTitle('');
    doc.setAuthor('');
    doc.setSubject('');
    doc.setKeywords([]);
    doc.setProducer('');
    doc.setCreator('');
    doc.setCreationDate(this.clock.now());
    doc.setModificationDate(this.clock.now());
    doc.catalog.delete(PDFName.of('Metadata'));
    stripEmbeddedMetadata(doc);

    const saved = await doc.save();

    return { bytes: Buffer.from(saved), contentType: PDF_CONTENT_TYPE };
  }
}

/**
 * Code review of topic 8 (§82): clearing the document's own Info dictionary and catalog XMP is
 * not enough on its own. A "photo → PDF" export (the exact thing a phone produces when someone
 * shares a camera shot of their transfer as a PDF) embeds the original JPEG byte for byte as a
 * `/DCTDecode` image stream, EXIF block and GPS position included — confirmed by uploading such a
 * PDF and finding the EXIF marker intact in the file served back. K1's whole reason for
 * re-encoding images is that GPS block.
 *
 * So every indirect object is visited once:
 * - any `/Metadata` entry (a per-object XMP stream, which images can carry too) is dropped, the
 *   same as the catalog's;
 * - every stream whose only filter is `/DCTDecode` has its JPEG metadata segments cut out (see
 *   `stripJpegMetadataSegments`) and is written back as the same image, byte-identical pixels.
 *
 * Cutting segments rather than re-encoding through `sharp` is deliberate: the image dictionary
 * next to the stream fixes its width, colour space and bit depth, and `sharp` would convert a CMYK
 * JPEG to sRGB on the way out, leaving a stream that no longer matches its own dictionary.
 * Streams with a filter *chain* ending in DCT (`[/FlateDecode /DCTDecode]`) and JPEG 2000
 * (`/JPXDecode`) are left alone — neither is something a phone or bank app produces in practice,
 * and decoding the outer layer would mean a second codec path to maintain for a case nobody hits.
 */
function stripEmbeddedMetadata(doc: PDFDocument): void {
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFDict) {
      object.delete(PDFName.of('Metadata'));
      continue;
    }
    if (!(object instanceof PDFRawStream)) {
      continue;
    }

    object.dict.delete(PDFName.of('Metadata'));
    if (!isPlainDctStream(object.dict)) {
      continue;
    }

    const stripped = stripJpegMetadataSegments(object.getContents());
    doc.context.assign(ref, PDFRawStream.of(object.dict, stripped));
  }
}

function isPlainDctStream(dict: PDFDict): boolean {
  const filter = dict.get(PDFName.of('Filter'));
  if (filter instanceof PDFName) {
    return filter === PDFName.of('DCTDecode');
  }
  if (filter instanceof PDFArray && filter.size() === 1) {
    return filter.get(0) === PDFName.of('DCTDecode');
  }

  return false;
}

/** JPEG markers that stand alone, with no length field after them (TEM, RST0–RST7). */
const STANDALONE_JPEG_MARKERS = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7]);
const JPEG_START_OF_SCAN = 0xda;
const JPEG_APP2_ICC_PROFILE = 0xe2;
const JPEG_APP14_ADOBE = 0xee;
const JPEG_COMMENT = 0xfe;

/**
 * Walks a JPEG's header segments up to the start of scan and drops every metadata segment: APP1
 * (EXIF and XMP — where GPS lives), the other vendor APPn blocks (IPTC in APP13, maker data), and
 * COM comments. Kept, because the image does not decode correctly without them: APP0 (JFIF),
 * APP2 (the ICC colour profile) and APP14 (Adobe — it says whether the data is YCC or CMYK).
 * Everything from the start of scan onward (the compressed pixels) is copied unchanged.
 *
 * A header that doesn't parse as JPEG means the upload is refused, not stored as-is: storing it
 * untouched would be storing exactly the metadata this exists to remove.
 */
function stripJpegMetadataSegments(bytes: Uint8Array): Uint8Array {
  const corrupt = (): AppException => new AppException('VALIDATION_FAILED', { message: 'ไฟล์ pdf เสียหายหรือเปิดไม่ได้' });

  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw corrupt();
  }

  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let position = 2;
  while (position < bytes.length) {
    if (bytes[position] !== 0xff) {
      throw corrupt();
    }
    const marker = bytes[position + 1];
    if (marker === undefined) {
      throw corrupt();
    }
    if (marker === 0xff) {
      position += 1; // fill byte before the real marker
      continue;
    }
    if (marker === JPEG_START_OF_SCAN) {
      kept.push(bytes.subarray(position));
      break;
    }
    if (STANDALONE_JPEG_MARKERS.has(marker)) {
      kept.push(bytes.subarray(position, position + 2));
      position += 2;
      continue;
    }

    const high = bytes[position + 2];
    const low = bytes[position + 3];
    if (high === undefined || low === undefined) {
      throw corrupt();
    }
    const end = position + 2 + ((high << 8) | low);
    if (end > bytes.length) {
      throw corrupt();
    }

    const isMetadata =
      marker === JPEG_COMMENT ||
      (marker >= 0xe1 && marker <= 0xef && marker !== JPEG_APP2_ICC_PROFILE && marker !== JPEG_APP14_ADOBE);
    if (!isMetadata) {
      kept.push(bytes.subarray(position, end));
    }
    position = end;
  }

  return Buffer.concat(kept);
}

/**
 * The ceiling, checked from the size multer recorded — before the file is read or a processing slot
 * is taken. multer already stops at it (`FilesModule`); this is for a caller that got a file some
 * other way.
 */
function requireWithinCeiling(upload: UploadedTempFile, maxBytes: number): void {
  if (upload.size > maxBytes) {
    throw new AppException('PAYLOAD_TOO_LARGE');
  }
}

/**
 * The scratch file's bytes. Its path was chosen by multer (random, inside UPLOAD_TMP_DIR) — never
 * anything the uploader sent (K1).
 */
function readUpload(upload: UploadedTempFile): Promise<Buffer> {
  return readFile(upload.path);
}
