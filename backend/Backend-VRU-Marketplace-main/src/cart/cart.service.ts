import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../common/errors/app-exception.js';
import { isUniqueViolation } from '../common/errors/prisma-errors.js';
import { newId } from '../common/id.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PRODUCT_OWN_VISIBILITY_FILTER } from '../product/common/product-visibility.js';
import { LIVE_SHOP_FILTER } from '../shop/common/shop-visibility.js';
import { Clock } from '../time/clock.js';
import { reservedStockOf } from '../order/reserved-stock.js';
import { MAX_CART_ITEM_QUANTITY, MAX_CART_LINES } from './cart-policy.js';
import { AddCartItemDto } from './dto/add-cart-item.dto.js';
import { CartDto, CartItemDto, CartLineUnavailableReason } from './dto/cart.dto.js';
import { UpdateCartItemDto } from './dto/update-cart-item.dto.js';

const CART_ITEM_INCLUDE = {
  variant: {
    include: { product: { select: { id: true, name: true, shopId: true } } },
  },
} satisfies Prisma.CartItemInclude;

type CartItemRow = Prisma.CartItemGetPayload<{ include: typeof CART_ITEM_INCLUDE }>;

/** Which of a set of products pass each half of invariant 6's visibility — see `availabilityOf`. */
interface Availability {
  readonly visibleProductIds: ReadonlySet<string>;
  readonly liveShopProductIds: ReadonlySet<string>;
}

/** §111: what the buyer sees on a line — refreshed on every add and quantity change, never at checkout. */
function seenNow(variant: { name: string; priceAmountMinor: number; product: { name: string } }) {
  return { priceAmountMinorWhenAdded: variant.priceAmountMinor, productNameWhenAdded: variant.product.name, variantNameWhenAdded: variant.name };
}

/**
 * `Cart` + `CartItem` (#48, K4): one server-side cart per person, never freezing a price. No cart
 * exists for a signed-out visitor and there is no merge-on-login step — invariant 1 requires a
 * session to reach any of this, so "whose cart was this" cannot come up.
 *
 * `orderable` on each item is decided by feeding the item's own product id through the exact
 * `PRODUCT_OWN_VISIBILITY_FILTER` + `LIVE_SHOP_FILTER` composition `ProductService.list` uses
 * (#42) — never a second copy of invariant 6's rule here, per this ticket's own AC.
 */
@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /**
   * Adds a quantity to the item, or starts it at this quantity if it wasn't in the cart yet
   * (`@@unique([cartId, variantId])` makes the upsert atomic against a concurrent add of the same
   * variant).
   *
   * §111 (the owner's decisions): only something orderable right now can be added — the same two
   * filters `getCart` asks, not a second copy of invariant 6 — and never from the
   * caller's own shop (a self-order has no use on a platform that holds no money, except to write
   * the shop a review). The names and the "orderable" verdict come from one statement
   * (`orderableVariant`), so a rename landing between two reads can never be recorded as seen.
   *
   * §81: `MAX_CART_ITEM_QUANTITY` caps the line's *total*, not just this one request — the DTO's
   * `@Max` only sees the amount being added. §111: `MAX_CART_LINES` caps the distinct lines — a new
   * line only, so an existing one can always grow. Both are checked inside a transaction that first
   * locks the cart row (`cart` → `cart_item`; checkout never locks `cart`), so two adds racing at the
   * edge wait for each other instead of both slipping under a cap.
   */
  async addItem(userId: string, dto: AddCartItemDto): Promise<CartDto> {
    const variant = await this.orderableVariant(dto.variantId);
    if (variant === null) {
      const exists = (await this.prisma.productVariant.count({ where: { id: dto.variantId, deletedAt: null } })) > 0;
      throw exists
        ? new AppException('CONFLICT', { message: 'สินค้านี้ยังสั่งซื้อไม่ได้ในตอนนี้' })
        : new AppException('NOT_FOUND', { message: 'ไม่พบตัวเลือกสินค้านี้ หรือถูกลบไปแล้ว' });
    }
    if (variant.product.shop.ownerId === userId) {
      throw new AppException('FORBIDDEN', { message: 'สั่งซื้อสินค้าจากร้านของตัวเองไม่ได้' });
    }

    const cart = await this.getOrCreateCart(userId);
    const now = this.clock.now();
    const seen = seenNow(variant);
    const line = { cartId_variantId: { cartId: cart.id, variantId: dto.variantId } };
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM cart WHERE id = ${cart.id}::uuid FOR NO KEY UPDATE`;
      const isNewLine = (await tx.cartItem.findUnique({ where: line, select: { id: true } })) === null;
      if (isNewLine && (await tx.cartItem.count({ where: { cartId: cart.id } })) >= MAX_CART_LINES) {
        throw new AppException('CONFLICT', { message: `ตะกร้าใส่ได้สูงสุด ${MAX_CART_LINES} รายการ กรุณาลบรายการที่ไม่ใช้ออกก่อน` });
      }
      const item = await tx.cartItem.upsert({
        where: line,
        create: { id: newId(), cartId: cart.id, variantId: dto.variantId, quantity: dto.quantity, ...seen, createdAt: now, updatedAt: now },
        update: { quantity: { increment: dto.quantity }, ...seen, updatedAt: now },
        select: { quantity: true },
      });
      if (item.quantity > MAX_CART_ITEM_QUANTITY) {
        throw new AppException('VALIDATION_FAILED', {
          fieldErrors: { quantity: `รวมกับที่มีในตะกร้าแล้วต้องไม่เกิน ${MAX_CART_ITEM_QUANTITY} ชิ้น` },
        });
      }
    });

    return this.getCart(userId);
  }

  /**
   * §111: only a line that can still be ordered — changing the quantity of one that cannot is
   * pointless, and refreshing its `*WhenAdded` names from a product under review would record text
   * moderation has not passed. Changing the quantity counts as seeing the current price.
   */
  async updateQuantity(userId: string, cartItemId: string, dto: UpdateCartItemDto): Promise<CartDto> {
    const item = await this.requireOwnedCartItem(userId, cartItemId);
    const variant = await this.orderableVariant(item.variantId);
    if (variant === null) {
      throw new AppException('CONFLICT', { message: 'สินค้านี้สั่งซื้อไม่ได้แล้ว ลบออกจากตะกร้าได้อย่างเดียว' });
    }
    // §91: a line checked out in another tab meanwhile is gone — a 404, where an update of a
    // missing row used to be a 500.
    const changed = await this.prisma.cartItem.updateMany({
      where: { id: item.id, cart: { userId } },
      data: { quantity: dto.quantity, ...seenNow(variant), updatedAt: this.clock.now() },
    });
    if (changed.count === 0) {
      throw new AppException('NOT_FOUND');
    }

    return this.getCart(userId);
  }

  async removeItem(userId: string, cartItemId: string): Promise<CartDto> {
    const item = await this.requireOwnedCartItem(userId, cartItemId);
    const removed = await this.prisma.cartItem.deleteMany({ where: { id: item.id, cart: { userId } } });
    if (removed.count === 0) {
      throw new AppException('NOT_FOUND');
    }

    return this.getCart(userId);
  }

  /** Empties the cart. A no-op, not a 404, when the caller has no cart row yet. */
  async clear(userId: string): Promise<CartDto> {
    const cart = await this.prisma.cart.findUnique({ where: { userId }, select: { id: true } });
    if (cart !== null) {
      await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    }

    return this.getCart(userId);
  }

  /**
   * Never creates a cart row just to answer "what's in it" — a user who has added nothing yet
   * gets an empty `CartDto`, the same shape as one whose cart row exists and is empty.
   */
  async getCart(userId: string): Promise<CartDto> {
    const cart = await this.prisma.cart.findUnique({ where: { userId }, select: { id: true } });
    if (cart === null) {
      return CartDto.from([]);
    }

    const rows = await this.prisma.cartItem.findMany({
      where: { cartId: cart.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: CART_ITEM_INCLUDE,
    });
    if (rows.length === 0) {
      return CartDto.from([]);
    }

    const availability = await this.availabilityOf(rows.map((row: CartItemRow) => row.variant.product.id));
    const reserved = await reservedStockOf(this.prisma, rows.map((row: CartItemRow) => row.variant.id));

    return CartDto.from(
      rows.map((row: CartItemRow) =>
        CartItemDto.from(row, unavailableReason({ deletedAt: row.variant.deletedAt, productId: row.variant.product.id }, availability), reserved),
      ),
    );
  }

  /**
   * §111: the variant and what a buyer would see of it — or null unless it is orderable right now.
   * One statement, so the names and the verdict come from the same instant.
   */
  private async orderableVariant(variantId: string) {
    return this.prisma.productVariant.findFirst({
      where: { id: variantId, deletedAt: null, product: { ...PRODUCT_OWN_VISIBILITY_FILTER, shop: LIVE_SHOP_FILTER } },
      select: { name: true, priceAmountMinor: true, product: { select: { name: true, shop: { select: { ownerId: true } } } } },
    });
  }

  /**
   * The single point (#42) this whole ticket's AC insists on reusing rather than re-deriving —
   * `PRODUCT_OWN_VISIBILITY_FILTER` and `LIVE_SHOP_FILTER`, the two halves `ProductService.list`
   * composes, asked separately (§111) so a line can say which half it fails.
   */
  private async availabilityOf(productIds: string[]): Promise<Availability> {
    const ids = [...new Set(productIds)];
    const [visible, liveShop] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: ids }, ...PRODUCT_OWN_VISIBILITY_FILTER }, select: { id: true } }),
      this.prisma.product.findMany({ where: { id: { in: ids }, shop: LIVE_SHOP_FILTER }, select: { id: true } }),
    ]);

    return { visibleProductIds: new Set(visible.map((row) => row.id)), liveShopProductIds: new Set(liveShop.map((row) => row.id)) };
  }

  private async requireOwnedCartItem(userId: string, cartItemId: string): Promise<{ id: string; variantId: string }> {
    const item = await this.prisma.cartItem.findFirst({
      where: { id: cartItemId, cart: { userId } },
      select: { id: true, variantId: true },
    });
    if (item === null) {
      throw new AppException('NOT_FOUND');
    }

    return item;
  }

  /**
   * Lazily creates the one-per-person row (K4) on the first item ever added. The
   * check-then-create has the same shape as `ShopService.apply`'s race with its own partial
   * unique index — `cart_user_id_key` catches a concurrent first add at the database, mapped
   * back to the row the loser's own request should have gotten rather than a 500.
   */
  private async getOrCreateCart(userId: string): Promise<{ id: string }> {
    const existing = await this.prisma.cart.findUnique({ where: { userId }, select: { id: true } });
    if (existing !== null) {
      return existing;
    }

    try {
      const now = this.clock.now();
      return await this.prisma.cart.create({
        data: { id: newId(), userId, createdAt: now, updatedAt: now },
        select: { id: true },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return this.prisma.cart.findUniqueOrThrow({ where: { userId }, select: { id: true } });
      }
      throw error;
    }
  }
}

/** §111: the first reason, in the order a buyer can act on it — a gone option, a shop not selling, a product not on sale. */
function unavailableReason(variant: { deletedAt: Date | null; productId: string }, availability: Availability): CartLineUnavailableReason | null {
  if (variant.deletedAt !== null) {
    return 'VARIANT_DELETED';
  }
  if (!availability.liveShopProductIds.has(variant.productId)) {
    return 'SHOP_UNAVAILABLE';
  }
  if (!availability.visibleProductIds.has(variant.productId)) {
    return 'PRODUCT_UNAVAILABLE';
  }

  return null;
}
