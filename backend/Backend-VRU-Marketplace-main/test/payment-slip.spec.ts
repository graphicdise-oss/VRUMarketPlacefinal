import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import type { Agent } from 'supertest';
import { CSRF_HEADER } from '../src/auth/csrf.service.js';
import { FileStorageService, UploadedTempFile } from '../src/files/file-storage.service.js';
import { approveShop, registerVerified } from './helpers/arrange.js';
import { API, csrfToken, registerAndLogin } from './helpers/auth.js';
import { approveProduct } from './helpers/review.js';
import { TestApp, newClient, setupTestApp } from './helpers/test-app.js';
import { checkoutAsShown } from './helpers/order.js';

/**
 * #54 (E1 · I3): the buyer's own evidence trail. Only the shape of `PaymentSlip` and the upload/
 * read/list endpoints — #55 (confirm), #56 (reject), #57 (clock 3) each build on top of this.
 * When this file was written, "after the shop confirmed" and "frozen" were written straight
 * through Prisma because #55 and topic 10 didn't exist yet; code review of topic 8 (§82) moved
 * both onto the real paths (the shop's own confirm-payment, a super admin suspending the shop).
 */
const getApp = setupTestApp();

const SUPER = 'superadmin@example.test';
const SELLER = 'seller@example.test';
const BUYER = 'buyer@example.test';
const OTHER_BUYER = 'other-buyer@example.test';
const OTHER_SELLER = 'other-seller@example.test';

interface ProductBody {
  id: string;
  variants: { id: string; priceAmountMinor: number; stock: number }[];
}
interface OrderBody {
  id: string;
  shopId: string;
  status: string;
}
interface SlipBody {
  id: string;
  orderId: string;
  rejectedAt: string | null;
  rejectionReason: string | null;
}

async function signInAsSuperAdmin(app: TestApp, client: Agent): Promise<void> {
  await registerAndLogin(client, SUPER);
  // SUPER_ADMIN has no endpoint by design (N29) — it is set in the database, here as in production.
  await app.prisma.user.update({ where: { email: SUPER }, data: { role: 'SUPER_ADMIN' } });
}

async function createCommunity(superAdmin: Agent, name: string): Promise<string> {
  const response = await superAdmin
    .post(`${API}/communities`)
    .set(CSRF_HEADER, await csrfToken(superAdmin))
    .send({ name, description: 'รายละเอียดสำหรับทดสอบ' });

  return (response.body as { id: string }).id;
}

async function createCategory(superAdmin: Agent, name: string): Promise<string> {
  const response = await superAdmin
    .post(`${API}/categories`)
    .set(CSRF_HEADER, await csrfToken(superAdmin))
    .send({ name });

  return (response.body as { id: string }).id;
}

async function sellerWithShop(app: TestApp, email: string, communityId: string): Promise<Agent> {
  const seller = newClient(app);
  await registerVerified(app, seller, email);
  const applied = await seller
    .post(`${API}/shops`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ communityId, name: 'ร้านทดสอบ' });
  const shopId = (applied.body as { id: string }).id;
  await approveShop(app, shopId);

  return seller;
}

async function approvedProduct(
  superAdmin: Agent,
  seller: Agent,
  categoryId: string,
  name: string,
  priceAmountMinor: number,
  stock: number,
): Promise<ProductBody> {
  const created = await seller
    .post(`${API}/products`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({
      name,
      description: 'คำอธิบายสินค้าสำหรับทดสอบ',
      categoryId,
      variants: [{ name: 'แบบเดียว', priceAmountMinor, stock }],
    });
  const productId = (created.body as { id: string }).id;
  await approveProduct(superAdmin, productId);

  const fetched = await seller.get(`${API}/products/${productId}`);

  return fetched.body as ProductBody;
}

async function aRealSubdistrictPostalCodeId(app: TestApp): Promise<string> {
  const row = await app.prisma.subdistrictPostalCode.findFirstOrThrow();
  return row.id;
}

async function createAddress(app: TestApp, client: Agent): Promise<string> {
  const subdistrictPostalCodeId = await aRealSubdistrictPostalCodeId(app);
  const response = await client
    .post(`${API}/addresses`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({
      recipientName: 'สมชาย ใจดี',
      phone: '0812345678',
      houseNumber: '99/9',
      subdistrictPostalCodeId,
    });

  return (response.body as { id: string }).id;
}

async function placeOrder(app: TestApp, buyer: Agent, variantId: string, quantity = 1): Promise<OrderBody> {
  const addressId = await createAddress(app, buyer);
  await buyer
    .post(`${API}/cart/items`)
    .set(CSRF_HEADER, await csrfToken(buyer))
    .send({ variantId, quantity });
  const response = await checkoutAsShown(buyer, addressId);

  return (response.body as OrderBody[])[0]!;
}

async function setShippingFee(seller: Agent, orderId: string, shippingAmountMinor: number) {
  return seller
    .post(`${API}/shops/me/orders/${orderId}/shipping-fee`)
    .set(CSRF_HEADER, await csrfToken(seller))
    .send({ shippingAmountMinor });
}

/** Order placed and quoted, ready for a slip — status AWAITING_PAYMENT. */
async function orderAwaitingPayment(app: TestApp): Promise<{ seller: Agent; buyer: Agent; order: OrderBody; variantId: string; productId: string }> {
  const superAdmin = app.client;
  await signInAsSuperAdmin(app, superAdmin);
  const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
  const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
  const seller = await sellerWithShop(app, SELLER, communityId);
  const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบสลิป', 10000, 5);
  const variantId = product.variants[0]!.id;
  const buyer = newClient(app);
  await registerVerified(app, buyer, BUYER);
  const order = await placeOrder(app, buyer, variantId, 1);
  await setShippingFee(seller, order.id, 2000);

  return { seller, buyer, order, variantId, productId: product.id };
}

async function uploadSlip(client: Agent, orderId: string, buffer: Buffer, filename: string) {
  return client
    .post(`${API}/orders/${orderId}/payment-slips`)
    .set(CSRF_HEADER, await csrfToken(client))
    .attach('file', buffer, filename);
}

async function aJpegBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 200, b: 0 } } }).jpeg().toBuffer();
}

async function aPdfBuffer(withMetadata = false): Promise<Buffer> {
  const doc = await PDFDocument.create();
  if (withMetadata) {
    doc.setAuthor('somchai-device-42');
    doc.setTitle('สลิปโอนเงิน');
  }
  doc.addPage([200, 200]);
  return Buffer.from(await doc.save());
}

describe('uploading a slip (#54, E1 · I3)', () => {
  it('moves the order to PAYMENT_SUBMITTED on the first upload', async () => {
    const app = getApp();
    const { buyer, order } = await orderAwaitingPayment(app);

    const response = await uploadSlip(buyer, order.id, await aJpegBuffer(), 'slip.jpg');

    expect(response.status).toBe(201);
    const body = response.body as SlipBody;
    expect(body.orderId).toBe(order.id);
    expect(body.rejectedAt).toBeNull();
    const row = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe('PAYMENT_SUBMITTED');
  });

  it('keeps every slip on a re-upload — two rows, the first one still there', async () => {
    const app = getApp();
    const { buyer, order } = await orderAwaitingPayment(app);
    const first = await uploadSlip(buyer, order.id, await aJpegBuffer(), 'slip-1.jpg');

    const second = await uploadSlip(buyer, order.id, await aPdfBuffer(), 'slip-2.pdf');

    expect(second.status).toBe(201);
    const rows = await app.prisma.paymentSlip.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).toBe((first.body as SlipBody).id);
    expect(rows[1]!.id).toBe((second.body as SlipBody).id);
    // Still PAYMENT_SUBMITTED, not touched a second time.
    const row = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe('PAYMENT_SUBMITTED');
  });

  it('accepts jpg, png, and pdf; rejects anything else', async () => {
    const app = getApp();
    const { buyer, order } = await orderAwaitingPayment(app);

    const bad = await uploadSlip(buyer, order.id, Buffer.from('not a real file'), 'slip.jpg');
    expect(bad.status).toBe(400);

    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const pngResponse = await uploadSlip(buyer, order.id, png, 'slip.png');
    expect(pngResponse.status).toBe(201);
  });

  it('answers 400, not a crash, for a truncated file whose header alone still looks valid', async () => {
    // A header-intact-but-truncated JPEG (e.g. an interrupted mobile upload) passes sharp's own
    // lenient metadata sniff but fails the full decode `reencodeImage` needs — found for real
    // while verifying this ticket against a booted server, where it came back as an unhandled
    // 500 before `reencodeImage` caught it. `.subarray` to 99% keeps the header readable while
    // corrupting the entropy-coded scan data enough that the full decode fails.
    const app = getApp();
    const { buyer, order } = await orderAwaitingPayment(app);
    const full = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 10, g: 20, b: 30 } } })
      .jpeg({ quality: 90 })
      .toBuffer();
    const truncated = full.subarray(0, Math.floor(full.length * 0.99));

    const response = await uploadSlip(buyer, order.id, truncated, 'slip-truncated.jpg');

    expect(response.status).toBe(400);
  });

  it('strips a PDF’s metadata (Author/Title) before storing it', async () => {
    const app = getApp();
    const { buyer, order } = await orderAwaitingPayment(app);

    const response = await uploadSlip(buyer, order.id, await aPdfBuffer(true), 'slip.pdf');
    expect(response.status).toBe(201);

    const fileResponse = await buyer.get(`${API}/orders/${order.id}/payment-slips/${(response.body as SlipBody).id}/file`);
    const reloaded = await PDFDocument.load(fileResponse.body as Buffer);
    expect(reloaded.getAuthor()).not.toBe('somchai-device-42');
    expect(reloaded.getTitle()).not.toBe('สลิปโอนเงิน');
  });

  it('rejects a file over the size limit with 413', async () => {
    const app = getApp();
    const { buyer, order } = await orderAwaitingPayment(app);
    const tooLarge = Buffer.alloc(1024 * 1024 + 1, 0);

    const response = await uploadSlip(buyer, order.id, tooLarge, 'slip.jpg');

    expect(response.status).toBe(413);
  });

  it('refuses an upload once the shop has confirmed the payment (PAID)', async () => {
    const app = getApp();
    const { seller, buyer, order } = await orderAwaitingPayment(app);
    await uploadSlip(buyer, order.id, await aJpegBuffer(), 'slip.jpg');
    const confirmed = await seller
      .post(`${API}/shops/me/orders/${order.id}/confirm-payment`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .send({});
    expect(confirmed.status).toBe(200);

    const response = await uploadSlip(buyer, order.id, await aJpegBuffer(), 'slip-late.jpg');

    expect(response.status).toBe(409);
  });

  it('refuses an upload while the order is frozen (its shop suspended — invariant 7)', async () => {
    const app = getApp();
    const { buyer, order } = await orderAwaitingPayment(app);
    const suspended = await app.client
      .post(`${API}/shops/${order.shopId}/suspend`)
      .set(CSRF_HEADER, await csrfToken(app.client))
      .send({ reason: 'เหตุผลสำหรับทดสอบการระงับร้าน' });
    expect(suspended.status).toBe(200);

    const response = await uploadSlip(buyer, order.id, await aJpegBuffer(), 'slip.jpg');

    expect(response.status).toBe(409);
  });

  it('refuses an upload before the shop has quoted shipping (AWAITING_SHIPPING_QUOTE)', async () => {
    const app = getApp();
    const superAdmin = app.client;
    await signInAsSuperAdmin(app, superAdmin);
    const communityId = await createCommunity(superAdmin, 'ชุมชนบางแสน');
    const categoryId = await createCategory(superAdmin, 'เสื้อผ้า');
    const seller = await sellerWithShop(app, SELLER, communityId);
    const product = await approvedProduct(superAdmin, seller, categoryId, 'ของทดสอบยังไม่ใส่ค่าส่ง', 10000, 5);
    const buyer = newClient(app);
    await registerVerified(app, buyer, BUYER);
    const order = await placeOrder(app, buyer, product.variants[0]!.id, 1);

    const response = await uploadSlip(buyer, order.id, await aJpegBuffer(), 'slip.jpg');

    expect(response.status).toBe(409);
  });

  it('refuses an upload from anyone but the order’s own buyer', async () => {
    const app = getApp();
    const { order } = await orderAwaitingPayment(app);
    const otherBuyer = newClient(app);
    await registerVerified(app, otherBuyer, OTHER_BUYER);

    const response = await uploadSlip(otherBuyer, order.id, await aJpegBuffer(), 'slip.jpg');

    expect(response.status).toBe(404);
  });
});

describe('code review of topic 8 (§82)', () => {
  it('cuts an oversized upload off at multer (413) before any handler runs', async () => {
    const app = getApp();
    const { buyer, order } = await orderAwaitingPayment(app);
    // The test env caps uploads at 1MB. Before §82 multer buffered the whole body with no limit
    // and the service found it too large only after the server had held all of it.
    //
    // A real order since §100: for an order that does not exist the answer is now 404 before a
    // byte of the body is read (upload-limits.spec.ts) — the cap is what stops a large body for an
    // order that *can* take a slip.
    const tooLarge = Buffer.alloc(2 * 1024 * 1024, 0);

    const response = await uploadSlip(buyer, order.id, tooLarge, 'slip.jpg');

    expect(response.status).toBe(413);
    expect((response.body as { code: string }).code).toBe('PAYLOAD_TOO_LARGE');
    expect(await app.prisma.paymentSlip.count({ where: { orderId: order.id } })).toBe(0); // nothing was stored — no endpoint lists a refused slip
  });

  it('applies the same cap to every upload route, not just slips (one limit in FilesModule)', async () => {
    const app = getApp();
    const { seller, productId } = await orderAwaitingPayment(app);
    const tooLarge = Buffer.alloc(2 * 1024 * 1024, 0);
    // The seller's own product (§100: a product that is not theirs is refused as 404 before the
    // body is read, so it would no longer show the cap).

    const response = await seller
      .post(`${API}/products/${productId}/images`)
      .set(CSRF_HEADER, await csrfToken(seller))
      .attach('file', tooLarge, 'photo.jpg');

    expect(response.status).toBe(413);
  });

  it('refuses a re-upload that lands while the shop is confirming payment, and leaves no orphaned file behind', async () => {
    const app = getApp();
    const { seller, buyer, order } = await orderAwaitingPayment(app);
    await uploadSlip(buyer, order.id, await aJpegBuffer(), 'slip.jpg');
    const filesBefore = await app.prisma.uploadedFile.count();

    // Seam-1 tests can't time two requests to interleave on their own. The spy lets the file be
    // stored for real, then has the shop confirm payment over HTTP *before* the upload's
    // transaction runs — the window a slow re-encode leaves open in production.
    const storage = app.app.get(FileStorageService);
    const realStoreDocument = storage.storeDocument.bind(storage);
    vi.spyOn(storage, 'storeDocument').mockImplementationOnce(async (upload: UploadedTempFile) => {
      const stored = await realStoreDocument(upload);
      const confirmed = await seller
        .post(`${API}/shops/me/orders/${order.id}/confirm-payment`)
        .set(CSRF_HEADER, await csrfToken(seller))
        .send({});
      expect(confirmed.status).toBe(200);
      return stored;
    });

    const lateUpload = await uploadSlip(buyer, order.id, await aJpegBuffer(), 'slip-late.jpg');

    expect(lateUpload.status).toBe(409);
    const slips = await buyer.get(`${API}/orders/${order.id}/payment-slips`);
    expect(slips.body as SlipBody[]).toHaveLength(1);
    expect(await app.prisma.uploadedFile.count()).toBe(filesBefore);
  });

  it('strips EXIF from a photo embedded inside a PDF, and the image still decodes', async () => {
    const app = getApp();
    const { buyer, order } = await orderAwaitingPayment(app);
    // What a phone produces when a camera shot is shared "as PDF": the original JPEG, EXIF and
    // all, embedded byte for byte. The EXIF here carries a marker instead of real GPS.
    const photo = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 200, g: 0, b: 0 } } })
      .jpeg()
      .withExif({ IFD0: { Make: 'SOMCHAI-PHONE', Model: 'GPS-13.7563-100.5018' } })
      .toBuffer();
    const doc = await PDFDocument.create();
    const image = await doc.embedJpg(photo);
    doc.addPage([100, 100]).drawImage(image, { x: 0, y: 0, width: 40, height: 30 });
    const pdf = Buffer.from(await doc.save({ useObjectStreams: false }));
    expect(pdf.includes('SOMCHAI-PHONE')).toBe(true);

    const upload = await uploadSlip(buyer, order.id, pdf, 'slip.pdf');
    expect(upload.status).toBe(201);
    const served = await buyer.get(`${API}/orders/${order.id}/payment-slips/${(upload.body as SlipBody).id}/file`);

    const bytes = served.body as Buffer;
    expect(bytes.includes('SOMCHAI-PHONE')).toBe(false);
    expect(bytes.includes('GPS-13.7563')).toBe(false);
    // Still a readable PDF whose embedded image is still a valid 40×30 JPEG.
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(1);
    const jpegStart = bytes.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
    const jpegEnd = bytes.indexOf(Buffer.from([0xff, 0xd9]), jpegStart) + 2;
    const metadata = await sharp(bytes.subarray(jpegStart, jpegEnd)).metadata();
    expect([metadata.width, metadata.height]).toEqual([40, 30]);
  });

  it('serves a slip file with no-store caching and nosniff', async () => {
    const app = getApp();
    const { buyer, order } = await orderAwaitingPayment(app);
    const upload = await uploadSlip(buyer, order.id, await aJpegBuffer(), 'slip.jpg');

    const read = await buyer.get(`${API}/orders/${order.id}/payment-slips/${(upload.body as SlipBody).id}/file`);

    expect(read.headers['cache-control']).toBe('private, no-store');
    expect(read.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('listing and reading slips (#54)', () => {
  it('lets both the buyer and the shop owner list every slip, oldest first', async () => {
    const app = getApp();
    const { seller, buyer, order } = await orderAwaitingPayment(app);
    await uploadSlip(buyer, order.id, await aJpegBuffer(), 'slip-1.jpg');
    await uploadSlip(buyer, order.id, await aPdfBuffer(), 'slip-2.pdf');

    const buyerView = await buyer.get(`${API}/orders/${order.id}/payment-slips`);
    const sellerView = await seller.get(`${API}/orders/${order.id}/payment-slips`);

    expect(buyerView.status).toBe(200);
    expect(sellerView.status).toBe(200);
    const buyerSlips = buyerView.body as SlipBody[];
    const sellerSlips = sellerView.body as SlipBody[];
    expect(buyerSlips).toHaveLength(2);
    expect(sellerSlips.map((s) => s.id)).toEqual(buyerSlips.map((s) => s.id));
  });

  it('refuses listing for anyone who is neither the buyer nor the shop owner', async () => {
    const app = getApp();
    const { order } = await orderAwaitingPayment(app);
    const otherBuyer = newClient(app);
    await registerVerified(app, otherBuyer, OTHER_BUYER);

    const response = await otherBuyer.get(`${API}/orders/${order.id}/payment-slips`);

    expect(response.status).toBe(404);
  });

  it('lets the buyer and the shop read the actual file bytes', async () => {
    const app = getApp();
    const { seller, buyer, order } = await orderAwaitingPayment(app);
    const upload = await uploadSlip(buyer, order.id, await aJpegBuffer(), 'slip.jpg');
    const slipId = (upload.body as SlipBody).id;

    const buyerRead = await buyer.get(`${API}/orders/${order.id}/payment-slips/${slipId}/file`);
    const sellerRead = await seller.get(`${API}/orders/${order.id}/payment-slips/${slipId}/file`);

    expect(buyerRead.status).toBe(200);
    expect(buyerRead.headers['content-type']).toBe('image/jpeg');
    expect(sellerRead.status).toBe(200);
  });

  it('refuses reading the file for a different shop’s owner', async () => {
    const app = getApp();
    const { buyer, order } = await orderAwaitingPayment(app);
    const upload = await uploadSlip(buyer, order.id, await aJpegBuffer(), 'slip.jpg');
    const slipId = (upload.body as SlipBody).id;
    const superAdmin = app.client;
    const communityId = await createCommunity(superAdmin, 'ชุมชนอื่น');
    const otherSeller = await sellerWithShop(app, OTHER_SELLER, communityId);

    const response = await otherSeller.get(`${API}/orders/${order.id}/payment-slips/${slipId}/file`);

    expect(response.status).toBe(404);
  });

  it('never exposes the underlying file id — only the slip’s own id', async () => {
    const app = getApp();
    const { buyer, order } = await orderAwaitingPayment(app);
    const upload = await uploadSlip(buyer, order.id, await aJpegBuffer(), 'slip.jpg');

    expect(Object.keys(upload.body as object)).not.toContain('fileId');
  });
});
