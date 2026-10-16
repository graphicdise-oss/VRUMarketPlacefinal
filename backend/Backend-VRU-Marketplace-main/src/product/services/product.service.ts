import { Injectable, Logger } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { AppException } from '../../common/errors/app-exception.js';
import { newId } from '../../common/id.js';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor.js';
import { keysetAfter, newestFirst } from '../../common/pagination/keyset.js';
import { emptyPage, Page, toPage } from '../../common/pagination/page.js';
import { isAdminOfCommunity } from '../../community/community-admin-scope.js';
import { FileStorageService, ReadImage, UploadedTempFile } from '../../files/file-storage.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MAX_PRODUCT_IMAGES, MAX_VARIANTS_PER_PRODUCT, MIN_VARIANTS_PER_PRODUCT } from '../common/product-policy.js';
import { PRODUCT_OWN_VISIBILITY_FILTER } from '../common/product-visibility.js';
import { LIVE_SHOP_FILTER } from '../../shop/common/shop-visibility.js';
import { ShopService } from '../../shop/services/shop.service.js';
import { Clock } from '../../time/clock.js';
import { reservedStockOf } from '../../order/reserved-stock.js';
import { soldQuantityOf } from '../../order/sold-quantity.js';
import { CreateProductDto } from '../dto/create-product.dto.js';
import { CreateProductVariantDto } from '../dto/create-product-variant.dto.js';
import { ListProductsQueryDto } from '../dto/list-products-query.dto.js';
import { ProductDto, PublicProductDto } from '../dto/product.dto.js';
import { SearchProductsQueryDto } from '../dto/search-products-query.dto.js';
import { UpdateProductDto } from '../dto/update-product.dto.js';
import { UpdateProductVariantDto } from '../dto/update-product-variant.dto.js';

/** What every owner-facing read query includes — the shape `ProductDto.from` needs. */
const PRODUCT_INCLUDE = {
  category: { select: { name: true } },
  variants: { where: { deletedAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  images: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;

/** What every public read query includes — adds the shop's own badge fields (I14). */
const PUBLIC_PRODUCT_INCLUDE = {
  ...PRODUCT_INCLUDE,
  // §92: the owner's ban reads as a suspension on the public view — see `publicSuspendedAt`.
  shop: { select: { name: true, communityId: true, closedAt: true, suspendedAt: true, owner: { select: { bannedAt: true } } } },
} satisfies Prisma.ProductInclude;

const LIST_NAME = 'products';
/** A search result is its own cursor namespace too — a search cursor is meaningless against `list()`. */
const SEARCH_LIST_NAME = 'productsSearch';
/** The caller's own products (§78) — its own cursor namespace, same reasoning as the other two. */
const MINE_LIST_NAME = 'productsMine';



/**
 * How many matching ids one search page may scan (§79).
 *
 * The match query used to be unbounded: every id matching `q` came back into Node and went out
 * again as `IN (...)`, so a one-character query on a large catalogue round-tripped most of the
 * table on an anonymous, un-rate-limited request, and past ~65k matches it exceeded PostgreSQL's
 * bind-parameter ceiling and answered 500. This cap bounds both. It sits far above `MAX_PAGE_SIZE`
 * so an ordinary page fills from a single batch; a query broad enough to scan a whole batch
 * without filling one simply pages on — see the cursor handling in `search` for how that stays
 * correct rather than silently truncating.
 *
 * Exported so the test that covers that paging-on branch cannot drift from the real number.
 */
export const SEARCH_MATCH_SCAN_LIMIT = 500;

/**
 * `Product` + `ProductVariant` (#41): a shop owner adding what they sell, and attaching photos to
 * it through #36's shared file-storage helper. Everything owner-facing here acts on the caller's
 * own shop, resolved through `ShopService.findOwnShopRow` — the same "1 คน = 1 ร้าน" reasoning
 * `PaymentChannelService` already uses. `publish`/`unpublish`, `list`, and `findPublic` are #42's
 * addition: the shop's own visibility toggle, and the only place a stranger ever sees a product.
 * `approve`/`reject`/`pending` are #43's: the two-tier guard's (#32) next real user after `Shop`,
 * through `ProductIdScopeResolver`.
 *
 * `updateDetails`/`addVariant`/`updateVariant`/`removeVariant`, plus the reset added to `addImage`/
 * `removeImage` below, are #44's: invariant 6's two-group edit split (A3/I13). Every one of them
 * shares `resetToPending()` for "goes back to PENDING" — never a second copy of those
 * fields — and `requireOwnedProduct` for "must be the caller's own shop, which must not be
 * suspended" (J2/#38), the same guard every other owner-facing method here already uses.
 *
 * `search` is #45's: Thai-language trigram matching (N5) feeding into the exact same visibility
 * composition `list` uses, never a second copy of it.
 */
@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shops: ShopService,
    private readonly files: FileStorageService,
    private readonly clock: Clock
  ) {}

  /**
   * §117: every product view carries stock figures that depend on open orders, so each is built
   * here — one reservation read for a whole page, never one per product.
   */
  private async ownerDto(row: Parameters<typeof ProductDto.from>[0]): Promise<ProductDto> {
    return ProductDto.from(row, await reservedStockOf(this.prisma, row.variants.map((variant) => variant.id)));
  }

  private async ownerDtos(rows: readonly Parameters<typeof ProductDto.from>[0][]): Promise<ProductDto[]> {
    const reserved = await reservedStockOf(this.prisma, rows.flatMap((row) => row.variants.map((variant) => variant.id)));

    return rows.map((row) => ProductDto.from(row, reserved));
  }

  private async publicDto(row: Parameters<typeof PublicProductDto.from>[0]): Promise<PublicProductDto> {
    const variantIds = row.variants.map((variant) => variant.id);

    return PublicProductDto.from(row, await reservedStockOf(this.prisma, variantIds), await soldQuantityOf(this.prisma, variantIds));
  }

  private async publicDtos(rows: readonly Parameters<typeof PublicProductDto.from>[0][]): Promise<PublicProductDto[]> {
    const variantIds = rows.flatMap((row) => row.variants.map((variant) => variant.id));
    const [reserved, sold] = await Promise.all([reservedStockOf(this.prisma, variantIds), soldQuantityOf(this.prisma, variantIds)]);

    return rows.map((row) => PublicProductDto.from(row, reserved, sold));
  }

  /**
   * Only an approved, non-suspended shop's owner may list something — an unapproved shop has
   * never been reviewed at all, and J2/#38's suspension is "no new sales", which a new product
   * listing plainly is.
   */
  async create(ownerId: string, dto: CreateProductDto): Promise<ProductDto> {
    const shop = await this.shops.findOwnShopRow(ownerId);
    this.requireShopMaySell(shop);
    await this.requireActiveCategory(dto.categoryId);
    refuseDuplicateVariantNames(dto.variants.map((variant: { name: string }) => variant.name), 'variants');

    const now = this.clock.now();
    const product = await this.prisma.product.create({
      data: {
        id: newId(),
        shopId: shop.id,
        name: dto.name,
        description: dto.description,
        categoryId: dto.categoryId,
        createdAt: now,
        updatedAt: now,
        variants: {
          create: dto.variants.map((variant: { name: string; priceAmountMinor: number; stock: number }) => ({
            id: newId(),
            name: variant.name,
            priceAmountMinor: variant.priceAmountMinor,
            stock: variant.stock,
            createdAt: now,
            updatedAt: now,
          })),
        },
      },
      include: PRODUCT_INCLUDE,
    });

    return this.ownerDto(product);
  }

  /**
   * Name/description/category (#44, invariant 6's first edit group — A3/I13). Always resets to
   * PENDING: there is no field on `UpdateProductDto` that is *not* in this group, unlike a
   * variant edit where name and price/stock share a row but not a group.
   */
  async updateDetails(ownerId: string, productId: string, dto: UpdateProductDto): Promise<ProductDto> {
    await this.requireOwnedProduct(ownerId, productId);
    await this.requireActiveCategory(dto.categoryId);

    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: { name: dto.name, description: dto.description, categoryId: dto.categoryId },
      });
      await resetToPending(tx, productId, now);
    });

    return this.findOrThrow(productId);
  }

  /**
   * A brand-new option on an existing product (#44) — its own AC line, distinct from editing one
   * that already exists. Always resets to PENDING, same reasoning L7's creation-time cap gives:
   * a new variant is exactly as free-form a name as the one #41 already lets a reviewer see, so a
   * reviewer who approved the product before this variant existed has never seen it.
   */
  async addVariant(ownerId: string, productId: string, dto: CreateProductVariantDto): Promise<ProductDto> {
    const product = await this.requireOwnedProduct(ownerId, productId);
    requireBelowVariantCap(product.variants.length);

    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      // §91: counted again under the product's lock — two adds at once used to both pass the
      // count above and overshoot the cap.
      await lockProduct(tx, productId);
      requireBelowVariantCap(await tx.productVariant.count({ where: { productId, deletedAt: null } }));
      await refuseVariantNameTaken(tx, productId, dto.name, null);
      await tx.productVariant.create({
        data: {
          id: newId(),
          productId,
          name: dto.name,
          priceAmountMinor: dto.priceAmountMinor,
          stock: dto.stock,
          createdAt: now,
          updatedAt: now,
        },
      });
      await resetToPending(tx, productId, now);
    });

    return this.findOrThrow(productId);
  }

  /**
   * ⚠️ The point of this whole ticket: `name` and `priceAmountMinor`/`stock` sit on the same
   * `ProductVariant` row but belong to different invariant-6 groups (I13). A changed `name` resets
   * the product to PENDING; a price/stock-only change never does, even in the same request that
   * also changes them — the two are independent per this method, not "any change resets."
   */
  async updateVariant(
    ownerId: string,
    productId: string,
    variantId: string,
    dto: UpdateProductVariantDto,
  ): Promise<ProductDto> {
    await this.requireOwnedProduct(ownerId, productId);

    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      // §91: product first, then the variant — the order checkout locks them in, so the two can
      // never wait on each other. Under the variant's lock, the stock the seller's form showed is
      // compared with what is there: a payment confirmed after the form loaded has already cut
      // stock, and a full replace from that form would put the sold units back on sale.
      await lockProduct(tx, productId);
      const [variant] = await tx.$queryRaw<{ name: string; stock: number }[]>`
        SELECT name, stock FROM product_variant WHERE id = ${variantId}::uuid AND product_id = ${productId}::uuid AND deleted_at IS NULL FOR UPDATE
      `;
      if (variant === undefined) {
        throw new AppException('NOT_FOUND');
      }
      if (variant.stock !== dto.expectedStock) {
        throw new AppException('STALE_VIEW', {
          message: `สต็อกของตัวเลือกนี้เปลี่ยนเป็น ${variant.stock} ชิ้นระหว่างที่คุณแก้ไข (เช่น มีการยืนยันเงินเข้า) กรุณาโหลดหน้าใหม่แล้วบันทึกอีกครั้ง`,
        });
      }

      const nameChanged = variant.name !== dto.name;
      if (nameChanged) {
        await refuseVariantNameTaken(tx, productId, dto.name, variantId);
      }
      await tx.productVariant.update({
        where: { id: variantId },
        data: {
          name: dto.name,
          priceAmountMinor: dto.priceAmountMinor,
          stock: dto.stock,
          updatedAt: now,
        },
      });
      if (nameChanged) {
        await resetToPending(tx, productId, now);
      }
    });

    return this.findOrThrow(productId);
  }

  /**
   * Soft delete (L6) — invariant 6's second group, takes effect immediately, no re-review.
   *
   * ⚠️ Refuses to delete a product's last live variant. `DECISIONS.md` doesn't say what happens
   * here and this ticket's own AC calls that gap out by name — a product with zero live variants
   * has no price and no stock, so its public page would have nothing to show and nothing to buy.
   * `MIN_VARIANTS_PER_PRODUCT` already draws this line at creation time (L7); this is the same
   * line enforced for the lifetime of the product, not a new number.
   */
  async removeVariant(ownerId: string, productId: string, variantId: string): Promise<ProductDto> {
    const product = await this.requireOwnedProduct(ownerId, productId);

    const variant = product.variants.find((row) => row.id === variantId);
    if (variant === undefined) {
      throw new AppException('NOT_FOUND');
    }
    requireAboveVariantFloor(product.variants.length);

    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      // §91: re-counted under the product's lock — two deletes of the last two variants at once
      // used to both see two and leave the product with none.
      await lockProduct(tx, productId);
      requireAboveVariantFloor(await tx.productVariant.count({ where: { productId, deletedAt: null } }));
      const removed = await tx.productVariant.updateMany({
        where: { id: variantId, productId, deletedAt: null },
        data: { deletedAt: now, updatedAt: now },
      });
      if (removed.count === 0) {
        throw new AppException('NOT_FOUND');
      }
    });

    return this.findOrThrow(productId);
  }

  /**
   * Soft delete of the whole product (§78 — L6, previously undone: nothing in this file ever set
   * `Product.deletedAt` before this). L6 is explicit that this cascades to every live variant too
   * — a deleted product's variants must not keep showing up in `product.variants` on some other
   * query that only checks the variant's own `deletedAt`. Row and variants both stay for reviews,
   * stats, and dispute evidence to keep resolving (L6's own reasoning) — this only ever writes
   * `deletedAt`, never `DELETE`s a row. Same `requireOwnedProduct` gate as every other mutation
   * here, so a suspended or closed shop cannot delete a product either, consistent with
   * `removeVariant`'s existing behaviour.
   */
  async remove(ownerId: string, productId: string): Promise<void> {
    await this.requireOwnedProduct(ownerId, productId);

    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id: productId }, data: { deletedAt: now, updatedAt: now } });
      await tx.productVariant.updateMany({
        where: { productId, deletedAt: null },
        data: { deletedAt: now, updatedAt: now },
      });
    });
  }

  /**
   * Adds one photo (#36's helper does the EXIF strip and content-sniffed validation — nothing
   * here touches a file directly). Rejects past `MAX_PRODUCT_IMAGES`, same shape as every other
   * server-side ceiling in this project.
   *
   * Resets to PENDING (#44): invariant 6 puts a photo change in the group that must send an
   * already-approved product back for review (the same reasoning I13 gives for a variant *name*
   * — a photo is exactly as free-form a smuggling route as one).
   */
  /**
   * A product of the caller's shop, with room for another photo. Also asked by the upload route
   * before the file is read (§100, `@AcceptsUpload`).
   */
  async requireImageSlot(ownerId: string, productId: string): Promise<void> {
    const product = await this.requireOwnedProduct(ownerId, productId);
    requireBelowImageCap(product.images.length);
  }

  async addImage(ownerId: string, productId: string, upload: UploadedTempFile): Promise<ProductDto> {
    await this.requireImageSlot(ownerId, productId);

    const stored = await this.files.storeImage(upload);
    const now = this.clock.now();
    try {
      await this.prisma.$transaction(async (tx) => {
        // §91: re-counted under the product's lock — the re-encode above takes long enough for
        // another upload to land, and two used to both pass the count and reach 11.
        await lockProduct(tx, productId);
        requireBelowImageCap(await tx.productImage.count({ where: { productId } }));
        await tx.productImage.create({
          data: { id: newId(), productId, fileId: stored.id, createdAt: now },
        });
        await resetToPending(tx, productId, now);
      });
    } catch (error) {
      // Nothing points at the stored file once the transaction has rolled back.
      await this.files.discardUnattached(stored.id);
      throw error;
    }

    return this.findOrThrow(productId);
  }

  /** Resets to PENDING (#44) — same reasoning as `addImage`, a removed photo is still a photo change. */
  async removeImage(ownerId: string, productId: string, imageId: string): Promise<ProductDto> {
    await this.requireOwnedProduct(ownerId, productId);

    const image = await this.prisma.productImage.findFirst({ where: { id: imageId, productId } });
    if (image === null) {
      throw new AppException('NOT_FOUND');
    }

    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.productImage.delete({ where: { id: imageId } });
      await resetToPending(tx, productId, now);
    });
    // §109 (owner's decision): nothing points at the file any more. Before, every removed photo
    // stayed on the server's disk for good, and upload-then-remove repeated could fill it (K1).
    await this.files.discardUnattached(image.fileId).catch(() => {
      this.logger.warn(`Could not delete removed product photo file ${image.fileId}; remove it by hand`);
    });

    return this.findOrThrow(productId);
  }

  /**
   * #42 (invariant 6's first layer): the shop's own choice to hide or re-show a listing it
   * already owns, independent of moderation. Idempotent-style rejection with `CONFLICT` when the
   * state is already what was asked for — same shape as `ShopService.suspend`/`unsuspend`, a
   * decision one account makes about a thing it owns.
   */
  async publish(ownerId: string, productId: string): Promise<ProductDto> {
    const product = await this.requireOwnedProduct(ownerId, productId);
    if (product.shopPublishStatus === 'PUBLISHED') {
      throw new AppException('CONFLICT', { message: 'สินค้านี้เผยแพร่อยู่แล้ว' });
    }

    return this.setPublishStatus(productId, 'PUBLISHED');
  }

  async unpublish(ownerId: string, productId: string): Promise<ProductDto> {
    const product = await this.requireOwnedProduct(ownerId, productId);
    if (product.shopPublishStatus === 'UNPUBLISHED') {
      throw new AppException('CONFLICT', { message: 'สินค้านี้ถูกซ่อนอยู่แล้ว' });
    }

    return this.setPublishStatus(productId, 'UNPUBLISHED');
  }

  /**
   * The public list (invariant 1): no session, optionally filtered by `communityId` (L8) and
   * `categoryId` (§110), and
   * only products that pass every one of invariant 6's three layers — `PRODUCT_OWN_VISIBILITY_FILTER`
   * for the product's own two, `LIVE_SHOP_FILTER` (spread into this query's own `shop` relation
   * filter, not re-derived — see that constant's comment) for the owning shop's.
   */
  async list(query: ListProductsQueryDto): Promise<Page<PublicProductDto>> {
    const rows = await this.prisma.product.findMany({
      where: {
        ...keysetAfter(query.cursor, LIST_NAME),
        ...catalogueWhere(query),
      },
      orderBy: newestFirst(),
      take: query.limit + 1,
      include: PUBLIC_PRODUCT_INCLUDE,
    });

    const page = toPage(rows, query.limit, LIST_NAME);

    return { ...page, items: await this.publicDtos(page.items) };
  }

  /**
   * The public single-product view. Gated by `PRODUCT_OWN_VISIBILITY_FILTER` only — **not**
   * `LIVE_SHOP_FILTER`: a product whose own two layers pass but whose shop is closed or
   * suspended still answers `200` with `shopClosedAt`/`shopSuspendedAt` set, because invariant 6
   * and this ticket's own AC require an old order's link to this product to keep working rather
   * than 404 the moment the shop stops selling (I14) — `list()` above is what filters shop
   * liveness; a direct link is a different question, the same split `ShopService.findPublic`
   * already makes for the identical reason.
   */
  async findPublic(id: string): Promise<PublicProductDto> {
    const product = await this.prisma.product.findFirst({
      where: { id, ...PRODUCT_OWN_VISIBILITY_FILTER },
      include: PUBLIC_PRODUCT_INCLUDE,
    });
    if (product === null) {
      throw new AppException('NOT_FOUND');
    }

    return this.publicDto(product);
  }

  /**
   * Thai-language search (#45 · N5). PostgreSQL has no Thai text-search configuration and
   * `to_tsvector` tokenises on whitespace, which Thai names do not have — so this matches at the
   * trigram level instead, via the `pg_trgm` GIN index the migration creates on `product.name`:
   * `ILIKE '%q%'` for an ordinary substring match, `<%` (`word_similarity`, **never** `%`/
   * `similarity` — see that operator's own trap in DECISIONS.md N5) for one typo's worth of
   * tolerance.
   *
   * Matching and paging happen in raw SQL; **visibility is still decided in exactly one place**:
   * matching ids are fed into the same `PRODUCT_OWN_VISIBILITY_FILTER` + `LIVE_SHOP_FILTER`
   * composition `list()` uses, rather than re-deriving "approved, published, live shop" inside the
   * raw query — the AC calls this out by name as the easiest place to accidentally grow a second
   * copy of invariant 6's rule.
   *
   * Paging moved into the SQL in §79 (it used to be a `keysetAfter` spread on the Prisma query,
   * where it overwrote the match set), which is also what bounds the batch — see
   * `SEARCH_MATCH_SCAN_LIMIT`.
   */
  async search(query: SearchProductsQueryDto): Promise<Page<PublicProductDto>> {
    const likePattern = `%${this.escapeLikePattern(query.q)}%`;
    // ⚠️ The cursor is applied *here*, in the match query, not in the Prisma query below (§79).
    // Spreading `keysetAfter` into that `where` alongside `id: { in: matchedIds }` overwrote the
    // `id` key outright — page 2 of a search silently dropped the match set and answered with
    // whatever products happened to be older than the cursor, `q` ignored entirely.
    const resumeAfterId = query.cursor === undefined ? null : decodeCursor(query.cursor, SEARCH_LIST_NAME).id;
    const resumeAt = resumeAfterId === null ? Prisma.empty : Prisma.sql`WHERE id < ${resumeAfterId}::uuid`;

    // UNION, not OR: `WHERE name ILIKE $1 OR $2 <% name` measures as a full Seq Scan on this
    // environment's Postgres even though each condition alone hits `product_name_trgm_idx` — the
    // planner won't split a single OR clause into two bitmap scans of the same index. UNION plans
    // each branch independently (confirmed via EXPLAIN ANALYZE against a 20,000-row seed: both
    // branches show Bitmap Heap Scan on product_name_trgm_idx, ~30x faster than the OR form) and
    // de-duplicates ids that match both, which a caller could otherwise see twice.
    //
    // §79 re-measured this after moving paging into the query, to make sure the subquery wrapper
    // below does not cost the index: at 200,000 rows both branches still plan as Bitmap Index Scan
    // on product_name_trgm_idx *through* the wrapper, so it does not. Which plan gets chosen is
    // selectivity-dependent, though — on a synthetic 20,000-row seed of low-cardinality names
    // (20% of the table matching one term) the planner picked a Seq Scan for this shape and for
    // the bare UNION alike. Different seed data from the measurement above, so it neither confirms
    // nor refutes those numbers; treat both as data points, not as a guarantee about any one plan.
    //
    // Only matching and paging happen in SQL. **Visibility is still decided in exactly one place**
    // — the Prisma query below — rather than re-derived here, which is what #45's AC rules out.
    //
    // §110 (owner's decision): the same match reaches a product's live options' names and its shop's
    // name (both short, so typo tolerance stays precise), and its description by exact substring
    // only — `<%` on up to 5,000 characters finds a "similar" word in nearly anything. Each branch has
    // its own trigram index (see the §110 migration), and each is still just a set of product ids fed
    // into the one visibility filter below. `deleted_at IS NULL` on an option is not visibility — it
    // only says a deleted option's name is no longer the product's text to match on.
    const matches = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM (
        SELECT id FROM product WHERE name ILIKE ${likePattern}
        UNION
        SELECT id FROM product WHERE ${query.q} <% name
        UNION
        SELECT product_id AS id FROM product_variant WHERE deleted_at IS NULL AND name ILIKE ${likePattern}
        UNION
        SELECT product_id AS id FROM product_variant WHERE deleted_at IS NULL AND ${query.q} <% name
        UNION
        SELECT id FROM product WHERE shop_id IN (
          SELECT id FROM shop WHERE name ILIKE ${likePattern}
          UNION
          SELECT id FROM shop WHERE ${query.q} <% name
        )
        UNION
        SELECT id FROM product WHERE description ILIKE ${likePattern}
      ) AS matched
      ${resumeAt}
      ORDER BY id DESC
      LIMIT ${SEARCH_MATCH_SCAN_LIMIT}
    `;
    if (matches.length === 0) {
      return emptyPage();
    }

    const rows = await this.prisma.product.findMany({
      where: {
        id: { in: matches.map((row) => row.id) },
        ...catalogueWhere(query),
      },
      orderBy: newestFirst(),
      take: query.limit + 1,
      include: PUBLIC_PRODUCT_INCLUDE,
    });

    const page = toPage(rows, query.limit, SEARCH_LIST_NAME);
    const items = await this.publicDtos(page.items);
    const lastScanned = matches.at(-1);

    // A batch that filled the cap without filling a page means the visible matches may continue
    // past it, so the next cursor has to resume from the last id *scanned* rather than the last id
    // shown — otherwise the caller is told the search ended when only this batch did.
    if (!page.hasMore && matches.length === SEARCH_MATCH_SCAN_LIMIT && lastScanned !== undefined) {
      return {
        items,
        nextCursor: encodeCursor({ list: SEARCH_LIST_NAME, id: lastScanned.id }),
        hasMore: true,
      };
    }

    return { ...page, items };
  }

  /**
   * The caller's own products across every moderation status (§78) — `findPublic`/`list` only ever
   * show what a stranger may see, so before this the only way a seller could learn *why* a product
   * was rejected was a 404 on the public route. Same shop resolution as every other owner-facing
   * method here; no `requireShopMaySell` gate because reading your own catalogue is not "selling".
   */
  async listMine(ownerId: string, limit: number, cursor: string | undefined): Promise<Page<ProductDto>> {
    const shop = await this.shops.findOwnShopRow(ownerId);

    const rows = await this.prisma.product.findMany({
      where: { shopId: shop.id, deletedAt: null, ...keysetAfter(cursor, MINE_LIST_NAME) },
      orderBy: newestFirst(),
      take: limit + 1,
      include: PRODUCT_INCLUDE,
    });

    const page = toPage(rows, limit, MINE_LIST_NAME);

    return { ...page, items: await this.ownerDtos(page.items) };
  }

  /**
   * Public — product photos are not access-controlled the way a payment QR or a payment slip is
   * (this ticket's own AC calls that distinction out by name). No ownership check, and no
   * moderation-status gate either: an old direct link staying reachable is the same reasoning
   * `Shop.findPublic` already applies to a closed or suspended shop's page.
   *
   * §103 (owner's decision), the one exception: a product ruled PROHIBITED. A photo of something
   * the marketplace refused to sell is not served to the public from this server any more — only
   * to the shop's owner and the admins who may review the product (its community's, or a super
   * admin). Everyone else gets NOT_FOUND, the same as a photo that never existed. `restricted` tells
   * the caller to send it as a private file. A NEEDS_FIX rejection changes nothing.
   */
  async readImage(productId: string, imageId: string, viewer: ImageViewer | null): Promise<{ file: ReadImage; restricted: boolean }> {
    const image = await this.prisma.productImage.findFirst({
      where: { id: imageId, productId },
      select: { fileId: true, approvedAt: true, product: { select: { rejectionCategory: true, shop: { select: { ownerId: true, communityId: true } } } } },
    });
    if (image === null) {
      throw new AppException('NOT_FOUND');
    }
    // §109: a photo no approval has covered yet is held back the same way — nobody has reviewed it.
    const restricted = image.product.rejectionCategory === 'PROHIBITED' || image.approvedAt === null;
    if (restricted && !(await this.mayReview(viewer, image.product.shop))) {
      throw new AppException('NOT_FOUND');
    }

    const file = await this.files.readImage(image.fileId);
    if (file === null) {
      throw new AppException('NOT_FOUND');
    }

    return { file, restricted };
  }

  /**
   * Shared by every mutation in this file: the product must exist, not be soft-deleted, belong
   * to the caller's shop, and that shop must not be suspended — J2/#38's "ระงับ = ห้ามขายใหม่"
   * covers adding or changing a listing's photos just as much as creating the listing itself, so
   * this is the entry #38 left for that rule to be added to, not a new blanket guard.
   */
  private async requireOwnedProduct(ownerId: string, productId: string): Promise<ProductRow> {
    const shop = await this.shops.findOwnShopRow(ownerId);
    this.requireShopMaySell(shop);

    const product = await this.prisma.product.findFirst({
      where: { id: productId, shopId: shop.id, deletedAt: null },
      include: PRODUCT_INCLUDE,
    });
    if (product === null) {
      throw new AppException('NOT_FOUND');
    }

    return product;
  }

  /**
   * Escapes `ILIKE`'s own wildcard characters in a search term before it is wrapped in `%...%` —
   * without this, a product name containing a literal `%` or `_` would make that character act as
   * a wildcard in someone else's search instead of the literal text a user typed. Not an injection
   * concern (`$queryRaw` already parameterises the value); this is a correctness fix only.
   */
  private escapeLikePattern(term: string): string {
    return term.replace(/[\\%_]/g, (char) => `\\${char}`);
  }

  /** Shared by `create` and `updateDetails` — a category must exist and still be active (#40). */
  private async requireActiveCategory(categoryId: string): Promise<void> {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, isActive: true },
      select: { id: true },
    });
    if (category === null) {
      throw new AppException('NOT_FOUND', { message: 'ไม่พบหมวดหมู่นี้ หรือหมวดหมู่นี้เลิกใช้แล้ว' });
    }
  }

  private requireShopMaySell(shop: {
    approvalStatus: string;
    suspendedAt: Date | null;
    closedAt: Date | null;
  }): void {
    if (shop.approvalStatus !== 'APPROVED') {
      throw new AppException('FORBIDDEN', { message: 'ร้านต้องได้รับการอนุมัติก่อนจึงลงขายสินค้าได้' });
    }
    if (shop.suspendedAt !== null) {
      throw new AppException('FORBIDDEN', { message: 'ร้านที่ถูกระงับเพิ่มหรือแก้ไขสินค้าไม่ได้' });
    }
    // Code review (2026-09-22, §78 — deferred from topic 4's §77): #37's AC says a closed shop
    // "เพิ่มสินค้าไม่ได้"
    // and this check is the one place both create() and every edit method (via
    // requireOwnedProduct) share, so a closed shop loses edit access too, not only creation — a
    // soft-deleted shop has no business changing the products it left behind, the same reasoning
    // invariant 6 gives for treating "closed" as terminal everywhere else it appears.
    if (shop.closedAt !== null) {
      throw new AppException('FORBIDDEN', { message: 'ร้านที่ปิดไปแล้วเพิ่มหรือแก้ไขสินค้าไม่ได้' });
    }
  }

  private async findOrThrow(productId: string): Promise<ProductDto> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: PRODUCT_INCLUDE,
    });
    if (product === null) {
      throw new AppException('NOT_FOUND');
    }

    return this.ownerDto(product);
  }

  private async setPublishStatus(productId: string, shopPublishStatus: 'PUBLISHED' | 'UNPUBLISHED'): Promise<ProductDto> {
    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: { shopPublishStatus, updatedAt: this.clock.now() },
      include: PRODUCT_INCLUDE,
    });
    return this.ownerDto(updated);
  }

    /** §103 · §109: the shop's owner, a super admin, or an admin of the shop's community. */
    private async mayReview(viewer: ImageViewer | null, shop: { ownerId: string; communityId: string }): Promise<boolean> {
        if (viewer === null) {
          return false;
        }

        return viewer.id === shop.ownerId || (await isAdminOfCommunity(this.prisma, viewer, shop.communityId));
    }
}

/**
 * What the public list and search both show (invariant 6's three layers, #42) narrowed by the two
 * filters a buyer can pick — one place, so a filter added later cannot reach one and miss the other.
 */
function catalogueWhere(query: { communityId?: string; categoryId?: string }): Prisma.ProductWhereInput {
  return {
    ...PRODUCT_OWN_VISIBILITY_FILTER,
    ...(query.categoryId !== undefined ? { categoryId: query.categoryId } : {}),
    shop: { ...LIVE_SHOP_FILTER, ...(query.communityId !== undefined ? { communityId: query.communityId } : {}) },
  };
}

/** §91: the product row `FOR UPDATE` — what every edit that counts against a cap queues behind. */
async function lockProduct(tx: Prisma.TransactionClient, productId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM product WHERE id = ${productId}::uuid FOR UPDATE`;
}

/**
 * §110 (owner's decision, as Shopee/Lazada do): one product's live options each have their own name
 * — two called "สีแดง" at different prices leave a buyer guessing which they are paying for. Compared
 * trimmed and case-folded (the DTO already trims; Latin names like "Red"/"red" read as the same).
 * Other products may reuse a name, and a deleted option's name is free again. Rows that already
 * repeat a name from before §110 are left as they are.
 */
function variantNameKey(name: string): string {
  return name.trim().toLocaleLowerCase('th');
}

function duplicateVariantName(field: string): AppException {
  return new AppException('VALIDATION_FAILED', { fieldErrors: { [field]: 'มีตัวเลือกชื่อนี้อยู่แล้วในสินค้านี้ ตั้งชื่อตัวเลือกไม่ให้ซ้ำกัน' } });
}

function refuseDuplicateVariantNames(names: readonly string[], field: string): void {
  if (new Set(names.map(variantNameKey)).size !== names.length) {
    throw duplicateVariantName(field);
  }
}

/** Under the product's lock (`lockProduct`), so two adds or renames at once cannot both take the same name. */
async function refuseVariantNameTaken(tx: Prisma.TransactionClient, productId: string, name: string, exceptVariantId: string | null): Promise<void> {
  const live = await tx.productVariant.findMany({
    where: { productId, deletedAt: null, ...(exceptVariantId === null ? {} : { id: { not: exceptVariantId } }) },
    select: { name: true },
  });
  if (live.some((variant: { name: string }) => variantNameKey(variant.name) === variantNameKey(name))) {
    throw duplicateVariantName('name');
  }
}

function requireBelowVariantCap(liveVariants: number): void {
  if (liveVariants >= MAX_VARIANTS_PER_PRODUCT) {
    throw new AppException('CONFLICT', {
      message: `สินค้าหนึ่งชิ้นมีตัวเลือกได้สูงสุด ${MAX_VARIANTS_PER_PRODUCT} ตัว`,
    });
  }
}

function requireAboveVariantFloor(liveVariants: number): void {
  if (liveVariants <= MIN_VARIANTS_PER_PRODUCT) {
    throw new AppException('CONFLICT', {
      message: 'ลบไม่ได้เพราะเป็นตัวเลือกสุดท้ายของสินค้า ต้องมีอย่างน้อย 1 ตัวเลือกเสมอ',
    });
  }
}

function requireBelowImageCap(images: number): void {
  if (images >= MAX_PRODUCT_IMAGES) {
    throw new AppException('CONFLICT', {
      message: `รูปสินค้าได้สูงสุด ${MAX_PRODUCT_IMAGES} รูป`,
    });
  }
}


/** §103: who is asking for a product photo, when a session came with the request. */
export interface ImageViewer {
  readonly id: string;
  readonly role: UserRole;
}

/**
 * The one place invariant 6's "back to PENDING" write is spelled out (#44) — every group-A edit
 * (`updateDetails`, `addVariant`, a name-changing `updateVariant`, `addImage`, `removeImage`)
 * calls this instead of writing its own fields, so the reset can never drift between call sites.
 * §91: the revision goes up with every edit a reviewer has to see, so a decision taken on an
 * earlier screen cannot land on this one.
 *
 * A NEEDS_FIX ruling is cleared, mirroring `approve()`'s reasoning — a resubmitted product should
 * not carry a stale reason from the cycle before it. A PROHIBITED ruling is kept (§103, owner's
 * decision after its code review): it is what hides the product's photos, and the seller re-saving
 * the product must not be what makes them public again — only an admin approving it does (and a
 * reviewer seeing it still marked PROHIBITED in the queue is told why it was refused before).
 */
async function resetToPending(tx: Prisma.TransactionClient, productId: string, now: Date): Promise<void> {
  await tx.product.update({
    where: { id: productId },
    data: { moderationStatus: 'PENDING', reviewRevision: { increment: 1 }, updatedAt: now },
  });
  await tx.product.updateMany({
    where: { id: productId, rejectionCategory: { not: 'PROHIBITED' } },
    data: { rejectionCategory: null, rejectionReason: null },
  });
}

