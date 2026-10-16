import { Injectable } from '@nestjs/common';
import { OrderCancelledBy, OrderStatus, Prisma } from '@prisma/client';
import { AddressService } from '../../address/address.service.js';
import { CartService } from '../../cart/cart.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { newId } from '../../common/id.js';
import { keysetAfter, newestFirst } from '../../common/pagination/keyset.js';
import { Page, toPage } from '../../common/pagination/page.js';
import type { ReadImage } from '../../files/file-storage.service.js';
import { NotificationService } from '../../notification/notification.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PRODUCT_OWN_VISIBILITY_FILTER } from '../../product/common/product-visibility.js';
import { LIVE_SHOP_FILTER } from '../../shop/common/shop-visibility.js';
import { PaymentChannelDto } from '../../shop/dto/payment-channel.dto.js';
import { PaymentChannelService } from '../../shop/services/payment-channel.service.js';
import { ShopService } from '../../shop/services/shop.service.js';
import { Clock } from '../../time/clock.js';
import { MAX_ORDER_ITEMS_SUBTOTAL_MINOR } from '../common/order-policy.js';
import { CancelOrderAsShopDto } from '../dto/cancel-order-as-shop.dto.js';
import { CancelOrderDto } from '../dto/cancel-order.dto.js';
import { CheckoutDto } from '../dto/checkout.dto.js';
import { MAX_SLIP_REJECTIONS, OrderDto } from '../dto/order.dto.js';
import { RejectPaymentSlipDto } from '../dto/reject-payment-slip.dto.js';
import { RejectShippingFeeDto } from '../dto/reject-shipping-fee.dto.js';
import { SetShippingFeeDto } from '../dto/set-shipping-fee.dto.js';
import { OrderReceivedNotificationPort } from '../ports/order-received.port.js';
import { StockReservationService } from './stock-reservation.service.js';

/** Shared with `ShippingService` — one shape for "an order as its buyer or shop owner sees it". */
export const ORDER_INCLUDE = {
  items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  shop: { select: { id: true, name: true } },
  // #56 (I2): the single source of truth for "how many times has this order's slip been
  // rejected" — a filtered relation count, never a second counter column that could drift out
  // of sync with the `PaymentSlip` rows it's supposed to summarize (AC: "ตัวนับมีแหล่งเดียว").
  // Lives on the shared include so every `OrderDto` anywhere already carries it — the shop needs
  // to see "how many rejections are left" on a plain order fetch, not only right after rejecting.
  _count: { select: { paymentSlips: { where: { rejectedAt: { not: null } } } } },
  // #58: only the display name is needed (`OrderDto.shippingCarrierName`) — never the whole row.
  shippingCarrier: { select: { name: true } },
  // #58 (I15): every tracking-number edit, oldest first — the buyer sees this too (AC), so it
  // lives on the shared include the same reasoning `items` does.
  trackingNumberChanges: { orderBy: [{ changedAt: 'asc' }, { id: 'asc' }] },
  // #60: at most one, per `Review.orderId`'s unique constraint — both the buyer and the shop see
  // its own fate (including a community admin's deletion reason, per `ReviewDto`'s own comment),
  // never filtered here the way the public shop-review list filters `deletedAt`.
  review: { include: { images: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } },
  // #63: only whether an OPEN dispute exists is needed here (`OrderDto.displayStatus`'s
  // `'DISPUTED'` case, J3) — the partial unique index guarantees at most one row. The full
  // history lives behind `DisputeService.listForBuyer`/`listForShop`, not this shared include.
  disputes: { where: { closedAt: null }, select: { id: true } },
} satisfies Prisma.OrderInclude;

/**
 * §85: "an order of any shop this person owns" — every shop-side order route resolves the order
 * through its shop's *owner*, not through the owner's newest shop row. A shop may close with
 * orders still `SHIPPED` (I11), and after the owner reopens (H12) `findOwnShopRow` answers with the
 * new shop — before this, the old shop's orders vanished from the owner's list and every action on
 * them (tracking edits, dispute answers, refund slips) answered 404.
 */
export function ownedByShopOwner(ownerId: string): Prisma.OrderWhereInput {
  return { shop: { ownerId } };
}

const BUYER_LIST_NAME = 'ordersAsBuyer';
const SHOP_LIST_NAME = 'ordersAsShop';

/** L1: the two statuses in which a buyer may see their own shop's payment channels. */
const PAYMENT_CHANNELS_VISIBLE_STATUSES: readonly OrderStatus[] = ['AWAITING_PAYMENT', 'PAYMENT_SUBMITTED'];

/**
 * H5/#52: manual cancellation only exists before money starts moving. Written as a status
 * whitelist (not "no slip uploaded yet", per the ticket's own instruction) so the same check
 * keeps working once topic 8 adds `PaymentSlip` — an order that reached `PAYMENT_SUBMITTED` is
 * already excluded here regardless of how it got there. Topic 8 still owes its own end-to-end
 * test proving a real slip upload blocks cancellation, per this ticket's own AC — this whitelist
 * is what that test will exercise, not new logic it needs to add.
 */
const MANUALLY_CANCELLABLE_STATUSES: readonly OrderStatus[] = ['AWAITING_SHIPPING_QUOTE', 'AWAITING_PAYMENT'];

/**
 * `Order` + `OrderItem` (#49): checking out a cart splits it into one order per shop (invariant
 * 4) and snapshots everything invariant 5 says must never change afterward. Stock reservation
 * (#50) happens inside the same `checkout` transaction, through `StockReservationService` — never
 * a second copy of the reservation logic here. The shop setting a shipping fee (#51), manual
 * cancellation (#52), and the three-clock sweep (#53) are each their own ticket — this one only
 * creates the order rows (with their reservations) and lets a buyer or a shop owner read them back.
 */
@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cart: CartService,
    private readonly addresses: AddressService,
    private readonly shops: ShopService,
    private readonly clock: Clock,
    private readonly stockReservations: StockReservationService,
    private readonly paymentChannels: PaymentChannelService,
    private readonly receivedNotifications: OrderReceivedNotificationPort,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Splits the caller's cart into one order per shop, using **only the items `getCart()` already
   * marked `orderable`** — an item that failed invariant 6's visibility stays behind in the cart
   * rather than silently becoming an order or blocking checkout for everything else. The ordered
   * items are removed from the cart in the same transaction that creates the orders; anything
   * left behind (unorderable, or simply not gotten to) stays exactly where it was.
   *
   * `totalAmountMinor` is deliberately never set here (invariant 4) — the shop hasn't quoted
   * shipping yet (#51).
   *
   * Every item also gets a `StockReservation` (#50) inside this same transaction — if any one of
   * them can't be reserved (not enough left), the whole transaction rolls back and **no** orders
   * are created, rather than leaving some shops' orders placed and others silently missing an
   * item. The buyer sees one `CONFLICT` and can retry from an unchanged cart.
   *
   * §81: the cart is read *before* the transaction, so the first thing the transaction does is
   * claim exactly those cart rows — delete them, conditioned on each row's id *and* the quantity
   * that was read — and refuse (409, rolling everything back) unless every one of them was still
   * there. Without this, a double-click or a retried request read the same cart, queued behind
   * the first checkout's variant locks, then created a second full set of orders and
   * reservations from a cart that had already been ordered; the old trailing `deleteMany` just
   * deleted nothing and nobody noticed. The same check catches a quantity edited between the read
   * and the transaction, which would otherwise have been ordered at the old quantity. Claiming
   * first (before the variant locks) is safe from deadlock for the same reason those locks are:
   * every checkout takes the cart rows, then the variants, in that order.
   *
   * Also refuses an order whose items alone would exceed `MAX_ORDER_ITEMS_SUBTOTAL_MINOR` (§81) —
   * see that constant for why this has to be caught here rather than when the shop quotes shipping.
   */
  async checkout(buyerId: string, dto: CheckoutDto): Promise<OrderDto[]> {
    const address = await this.addresses.get(buyerId, dto.addressId);
    const cart = await this.cart.getCart(buyerId);
    const orderableItems = cart.items.filter((item) => item.orderable);
    if (orderableItems.length === 0) {
      throw new AppException('CONFLICT', {
        message: 'ตะกร้าว่างหรือไม่มีสินค้าที่สั่งได้เลย',
      });
    }
    refuseUnseenCart(orderableItems, dto.items);

    const itemsByShop = new Map<string, typeof orderableItems>();
    for (const item of orderableItems) {
      const existing = itemsByShop.get(item.shopId);
      if (existing === undefined) {
        itemsByShop.set(item.shopId, [item]);
      } else {
        existing.push(item);
      }
    }

    for (const items of itemsByShop.values()) {
      const subtotal = items.reduce((sum, item) => sum + item.priceAmountMinor * item.quantity, 0);
      if (subtotal > MAX_ORDER_ITEMS_SUBTOTAL_MINOR) {
        throw new AppException('CONFLICT', {
          message: 'ยอดสินค้าของร้านเดียวเกิน 20 ล้านบาทต่อออเดอร์ กรุณาลดจำนวนในตะกร้า',
        });
      }
    }

    const now = this.clock.now();
    const shopIds = [...itemsByShop.keys()].sort();
    // A shop's owner never changes, so this needs no lock of its own — the accounts are locked below.
    const sellerIds = (await this.prisma.shop.findMany({ where: { id: { in: shopIds } }, select: { ownerId: true } })).map((shop) => shop.ownerId);
    const accountIds = [...new Set([buyerId, ...sellerIds])].sort();
    const created = await this.prisma.$transaction(async (tx) => {
      // §84: shares a row lock with PDPA erasure (`AccountErasureService.performErasure` takes it
      // FOR UPDATE), so an order and an erasure of the same buyer can never interleave — either
      // this order commits first and the erasure sees it as a blocker and queues, or the erasure
      // commits first and this finds the account gone. Before, an order placed mid-erasure had its
      // address snapshot overwritten with placeholders the moment it was created.
      //
      // §92: the sellers' accounts too, in the same sorted statement (`user` first in the system's
      // lock order). A seller's ban writes that row, so it either commits before this and
      // `requireStillOrderable` below sees the owner banned, or waits for this order and then
      // freezes it — never an order its ban's freeze pass did not see.
      const accounts = await tx.$queryRaw<{ id: string; erased_at: Date | null; banned_at: Date | null }[]>`SELECT id, erased_at, banned_at FROM "user" WHERE id = ANY(${accountIds}::uuid[]) ORDER BY id FOR SHARE`;
      const buyer = accounts.find((account) => account.id === buyerId);
      if (buyer === undefined || buyer.erased_at !== null) {
        throw new AppException('UNAUTHENTICATED');
      }
      // §91: the guard read the ban when the request began; a ban committed since then is read
      // here, under the lock the ban's own write waits on. Before, a ban landing mid-checkout left
      // a new order from a banned buyer that the ban's freeze pass had never seen.
      if (buyer.banned_at !== null) {
        throw new AppException('ACCOUNT_BANNED');
      }

      const claimed = await tx.cartItem.deleteMany({
        where: { OR: orderableItems.map((item) => ({ id: item.id, quantity: item.quantity })) },
      });
      if (claimed.count !== orderableItems.length) {
        throw new AppException('CONFLICT', {
          message: 'ตะกร้าเปลี่ยนไประหว่างกดสั่ง หรือถูกสั่งไปแล้ว กรุณาตรวจสอบรายการออเดอร์และตะกร้าอีกครั้ง',
        });
      }

      // Lock every variant this checkout touches, in a fixed order, *before* creating any order
      // — see `StockReservationService.checkAndLock`'s own comment for why order matters (an
      // `OrderItem` insert's FK check takes an implicit lock on the variant row too, and locking
      // out of order — across either the two halves of one reservation or two different variants
      // in one multi-shop checkout — is how two concurrent checkouts deadlock instead of one
      // just waiting for the other).
      //
      // §91: shops and products first, `FOR SHARE`, in that order and sorted — the order every
      // other writer that touches them already follows (a suspension or a moderation ruling
      // writes the row; a variant edit locks the product before the variant). Their state is then
      // re-read below: the cart said "orderable" before this transaction began, and a suspension,
      // a ruling or a deleted variant committed in between used to become an order that its
      // shop's freeze pass had never seen.
      await tx.$queryRaw`SELECT id FROM shop WHERE id = ANY(${shopIds}::uuid[]) ORDER BY id FOR SHARE`;
      const productIds = [...new Set(orderableItems.map((item) => item.productId))].sort();
      await tx.$queryRaw`SELECT id FROM product WHERE id = ANY(${productIds}::uuid[]) ORDER BY id FOR SHARE`;
      const sortedVariantIds = [...orderableItems].map((item) => item.variantId).sort();
      for (const variantId of sortedVariantIds) {
        const item = orderableItems.find((candidate) => candidate.variantId === variantId)!;
        await this.stockReservations.checkAndLock(tx, variantId, item.quantity);
      }
      await requireStillOrderable(tx, orderableItems);

      const orders = [];
      for (const [shopId, items] of itemsByShop) {
        const selectedCouponId =
          dto.coupons?.find((c) => c.shopId === shopId)?.couponId ??
          (itemsByShop.size === 1 ? dto.couponId : undefined);

        let discountAmountMinor = 0;
        let couponId: string | null = null;
        let couponCode: string | null = null;
        let claimToUseId: string | null = null;

        if (selectedCouponId) {
          let claim = await tx.userCouponClaim.findUnique({
            where: { userId_couponId: { userId: buyerId, couponId: selectedCouponId } },
            include: { coupon: true },
          });

          if (!claim) {
            const coupon = await tx.shopCoupon.findFirst({
              where: {
                id: selectedCouponId,
                shopId,
                isActive: true,
                startDate: { lte: now },
                endDate: { gte: now },
              },
            });
            if (coupon && coupon.claimedCount < coupon.quota) {
              await tx.shopCoupon.update({
                where: { id: coupon.id },
                data: { claimedCount: { increment: 1 } },
              });
              claim = await tx.userCouponClaim.create({
                data: {
                  id: newId(),
                  userId: buyerId,
                  couponId: coupon.id,
                  claimedAt: now,
                },
                include: { coupon: true },
              });
            }
          }

          if (
            claim &&
            !claim.isUsed &&
            claim.coupon.shopId === shopId &&
            claim.coupon.isActive &&
            now >= claim.coupon.startDate &&
            now <= claim.coupon.endDate
          ) {
            const subtotal = items.reduce((s, it) => s + it.priceAmountMinor * it.quantity, 0);
            if (subtotal >= claim.coupon.minSpendAmountMinor) {
              if (claim.coupon.discountType === 'FIXED_AMOUNT') {
                discountAmountMinor = Math.min(subtotal, claim.coupon.discountValue);
              } else if (claim.coupon.discountType === 'PERCENTAGE') {
                let disc = Math.round(subtotal * (claim.coupon.discountValue / 100));
                if (claim.coupon.maxDiscountAmountMinor && claim.coupon.maxDiscountAmountMinor > 0) {
                  disc = Math.min(disc, claim.coupon.maxDiscountAmountMinor);
                }
                discountAmountMinor = Math.min(subtotal, disc);
              }
              couponId = claim.coupon.id;
              couponCode = claim.coupon.code;
              claimToUseId = claim.id;
            }
          }
        }

        const order = await tx.order.create({
          data: {
            id: newId(),
            buyerId,
            shopId,
            status: 'AWAITING_SHIPPING_QUOTE',
            recipientName: address.recipientName,
            phone: address.phone,
            houseNumber: address.houseNumber,
            villageNumber: address.villageNumber,
            alley: address.alley,
            road: address.road,
            subdistrictName: address.subdistrictNameTh,
            districtName: address.districtNameTh,
            provinceName: address.provinceNameTh,
            postalCode: address.postalCode,
            discountAmountMinor,
            couponId,
            couponCode,
            createdAt: now,
            updatedAt: now,
            // #61: clock 1's own window-start column, set to the same instant as createdAt — see
            // that column's own comment for why it exists separately.
            shippingQuoteWindowStartedAt: now,
            items: {
              create: items.map((item) => ({
                id: newId(),
                variantId: item.variantId,
                productNameAtPurchase: item.productName,
                variantNameAtPurchase: item.variantName,
                priceAtPurchase: item.priceAmountMinor,
                currency: item.currency,
                quantity: item.quantity,
                createdAt: now,
              })),
            },
          },
          include: ORDER_INCLUDE,
        });

        if (claimToUseId && couponId) {
          await tx.userCouponClaim.update({
            where: { id: claimToUseId },
            data: {
              isUsed: true,
              usedAt: now,
              orderId: order.id,
            },
          });
          await tx.shopCoupon.update({
            where: { id: couponId },
            data: {
              usedCount: { increment: 1 },
              updatedAt: now,
            },
          });
        }

        for (const orderItem of order.items) {
          await this.stockReservations.record(tx, orderItem.id, orderItem.variantId, orderItem.quantity);
        }

        orders.push(order);
      }

      return orders;
    });

    return created.map((order) => OrderDto.from(order));
  }

  async listForBuyer(buyerId: string, limit: number, cursor: string | undefined, statuses?: OrderStatus[]): Promise<Page<OrderDto>> {
    const rows = await this.prisma.order.findMany({
      where: { buyerId, ...statusFilter(statuses), ...keysetAfter(cursor, BUYER_LIST_NAME) },
      orderBy: newestFirst(),
      take: limit + 1,
      include: ORDER_INCLUDE,
    });

    const page = toPage(rows, limit, BUYER_LIST_NAME);

    return { ...page, items: page.items.map((row) => OrderDto.from(row)) };
  }

  /**
   * The caller's own shops' orders, across every buyer — every shop they have ever run, not only
   * the newest (§85, see `ownedByShopOwner`). `findOwnShopRow` is still asked first so a caller who
   * has never had a shop keeps getting its 404 rather than an empty list.
   */
  async listForShop(ownerId: string, limit: number, cursor: string | undefined, statuses?: OrderStatus[]): Promise<Page<OrderDto>> {
    await this.shops.findOwnShopRow(ownerId);
    const rows = await this.prisma.order.findMany({
      where: { ...ownedByShopOwner(ownerId), ...statusFilter(statuses), ...keysetAfter(cursor, SHOP_LIST_NAME) },
      orderBy: newestFirst(),
      take: limit + 1,
      include: ORDER_INCLUDE,
    });

    const page = toPage(rows, limit, SHOP_LIST_NAME);

    return { ...page, items: page.items.map((row) => OrderDto.from(row)) };
  }

  /**
   * One order, viewable by exactly two people: the buyer who placed it, or the owner of the shop
   * it was placed against (spec 7/12's own AC gives both, one endpoint). A community admin is
   * neither — masked admin visibility is topic 10's `#62` to build, through the freeze-then-decide
   * path, never this route (this ticket's own AC warns against a second entry point).
   */
  async getById(actorUserId: string, orderId: string): Promise<OrderDto> {
    const row = await this.prisma.order.findFirst({
      where: { id: orderId, OR: [{ buyerId: actorUserId }, { shop: { ownerId: actorUserId } }] },
      include: ORDER_INCLUDE,
    });
    if (row === null) {
      throw new AppException('NOT_FOUND');
    }

    return OrderDto.from(row);
  }

  /**
   * H1: the shop's one and only chance to name a shipping fee. Locked the instant it's set —
   * checked twice, cheaply first (a clear `CONFLICT` for the overwhelmingly common case) and then
   * again as the condition on the write itself (`updateMany`'s `where` also carries the status),
   * so a second call can never sneak through between the two checks and silently change an
   * already-agreed total. Setting it is also what moves the order into `AWAITING_PAYMENT` and
   * starts clock 2 (#53) — there is no separate "buyer accepts" step; not rejecting within the
   * window *is* accepting (#51's own AC: "ผู้ซื้อยอมรับ (หรือเพียงดำเนินต่อ)").
   */
  async setShippingFee(ownerId: string, orderId: string, dto: SetShippingFeeDto): Promise<OrderDto> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, ...ownedByShopOwner(ownerId) },
      include: ORDER_INCLUDE,
    });
    if (order === null) {
      throw new AppException('NOT_FOUND');
    }
    if (order.status !== 'AWAITING_SHIPPING_QUOTE') {
      throw new AppException('CONFLICT', { message: 'ออเดอร์นี้ถูกใส่ค่าส่งไปแล้ว แก้ไขไม่ได้อีก' });
    }

    const itemsSubtotal = order.items.reduce((sum, item) => sum + item.priceAtPurchase * item.quantity, 0);
    const discount = order.discountAmountMinor ?? 0;
    const finalTotal = Math.max(0, itemsSubtotal + dto.shippingAmountMinor - discount);
    const now = this.clock.now();
    const result = await this.prisma.order.updateMany({
      where: { id: order.id, status: 'AWAITING_SHIPPING_QUOTE' },
      data: {
        shippingAmountMinor: dto.shippingAmountMinor,
        totalAmountMinor: finalTotal,
        status: 'AWAITING_PAYMENT',
        paymentWindowStartedAt: now,
        updatedAt: now,
      },
    });
    if (result.count === 0) {
      throw new AppException('CONFLICT', { message: 'ออเดอร์นี้ถูกใส่ค่าส่งไปแล้ว แก้ไขไม่ได้อีก' });
    }

    // #69: in-app only (not one of I17's email-worthy events) — lets the buyer know there is
    // now a total to pay, without waiting for them to reopen the order page on their own.
    await this.notifications.notify({
      userId: order.buyerId,
      type: 'ORDER_SHIPPING_FEE_SET',
      message: 'ร้านใส่ค่าส่งแล้ว กรุณาตรวจสอบยอดรวมและโอนเงิน',
      targetType: 'ORDER',
      targetId: order.id,
    });

    const updated = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE });

    return OrderDto.from(updated);
  }

  /**
   * E2b: the buyer's other option besides paying — cancels the order right away and, because
   * `CANCELLED` falls outside `StockReservationService`'s `RESERVING_STATUSES`, releases its
   * reservation for free (#50) with no separate release call needed here. Only reachable from
   * `AWAITING_PAYMENT`, the one status a shipping fee that hasn't been paid for yet can be in —
   * once a slip is submitted the buyer has already transferred the total, so this stops applying.
   *
   * §81, two things this used to get wrong:
   *
   * - It is a cancellation by the buyer, so a frozen order refuses it exactly as `cancel` below
   *   does (#52's AC: "ออเดอร์ที่ถูกแช่แข็งยกเลิกด้วยมือไม่ได้ — แอดมินยังต้องตัดสิน"). Before this it
   *   was the one way left to end a frozen order without the admin's ruling.
   * - It records `cancelledBy: 'BUYER'` and the reason as `cancelReason`, the same two fields
   *   every other hand cancellation fills in, so the shop sees who ended the order and why (#52:
   *   "ผู้ซื้อเห็นเหตุผลของร้าน และกลับกัน"). Before, both stayed null, which `OrderDto` documents
   *   as "the sweep cancelled it" — the shop could not tell a rejected fee from a timeout.
   *   `ShippingFeeRejection` still gets its own row: that table is the statistic (E2b), this is
   *   what the other party reads.
   */
  async rejectShippingFee(buyerId: string, orderId: string, dto: RejectShippingFeeDto): Promise<OrderDto> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, buyerId }, include: { shop: { select: { ownerId: true } } } });
    if (order === null) {
      throw new AppException('NOT_FOUND');
    }
    if (order.frozenAt !== null) {
      throw new AppException('CONFLICT', { message: 'ออเดอร์นี้ถูกแช่แข็งอยู่ รอแอดมินตัดสินก่อนจึงจะปฏิเสธค่าส่งได้' });
    }
    if (order.status !== 'AWAITING_PAYMENT') {
      throw new AppException('CONFLICT', { message: 'ออเดอร์นี้ไม่ได้อยู่ระหว่างรอตัดสินใจเรื่องค่าส่ง' });
    }

    const now = this.clock.now();
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.order.updateMany({
        where: { id: order.id, status: 'AWAITING_PAYMENT', frozenAt: null },
        data: { status: 'CANCELLED', cancelledBy: 'BUYER', cancelReason: dto.reason, cancelledAt: now, updatedAt: now },
      });
      if (result.count === 0) {
        throw new AppException('CONFLICT', { message: 'ออเดอร์นี้ปฏิเสธค่าส่งไม่ได้แล้ว' });
      }

      await tx.shippingFeeRejection.create({
        data: { id: newId(), orderId: order.id, reason: dto.reason, createdAt: now },
      });

      // Restore coupon if used
      const claim = await tx.userCouponClaim.findFirst({
        where: { orderId: order.id },
      });
      if (claim) {
        await tx.userCouponClaim.update({
          where: { id: claim.id },
          data: { isUsed: false, usedAt: null, orderId: null },
        });
        await tx.shopCoupon.update({
          where: { id: claim.couponId },
          data: { usedCount: { decrement: 1 } },
        });
      }

      return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE });
    });

    // §85: in-app only — the shop quoted a fee and is the party left waiting on it; before this
    // nothing told it the buyer had walked away.
    await this.notifications.notify({
      userId: order.shop.ownerId,
      type: 'ORDER_SHIPPING_FEE_REJECTED',
      message: 'ผู้ซื้อปฏิเสธค่าส่งและยกเลิกออเดอร์นี้แล้ว ดูเหตุผลได้ที่หน้าออเดอร์',
      targetType: 'ORDER',
      targetId: order.id,
    });

    return OrderDto.from(updated);
  }

  /**
   * L1: a buyer may see their own shop's `paymentChannels` only for their own order, and only
   * while that order is `AWAITING_PAYMENT` or `PAYMENT_SUBMITTED` — before the shop has quoted
   * shipping there is nothing to pay yet, and after the order moves on there is no reason left to
   * keep showing bank details for it. #36 deliberately built no public or buyer-facing route;
   * this is that route, gated on a real order rather than open to anyone.
   */
  async paymentChannelsFor(buyerId: string, orderId: string): Promise<PaymentChannelDto[]> {
    const shopId = await this.requirePaymentChannelsVisible(buyerId, orderId);

    return this.paymentChannels.listForShop(shopId);
  }

  /**
   * The QR image bytes behind one of `paymentChannelsFor`'s own channels — code review of topic 4
   * (2026-09-22, §77): #36 built no buyer-facing way to fetch a QR image (only the shop owner's
   * own `GET /shops/me/payment-channels/:channelId/qr-image`), so `hasQrImage: true` on this
   * list was a dead end for the one buyer entitled to see it. Same gate as `paymentChannelsFor`
   * (same order, same L1 status window) plus `PaymentChannelService.readQrImageForShop`, which
   * confirms the channel actually belongs to *this* order's shop rather than trusting the id.
   */
  async paymentChannelQrImageFor(buyerId: string, orderId: string, channelId: string): Promise<ReadImage> {
    const shopId = await this.requirePaymentChannelsVisible(buyerId, orderId);

    return this.paymentChannels.readQrImageForShop(shopId, channelId);
  }

  /**
   * L1's gate, shared by `paymentChannelsFor` and `paymentChannelQrImageFor`: a buyer may see
   * their own shop's payment channels only for their own, unfrozen order, and only while it is
   * `AWAITING_PAYMENT` or `PAYMENT_SUBMITTED` — before the shop has quoted shipping there is
   * nothing to pay yet, and after the order moves on there is no reason left to keep showing bank
   * details for it. Returns the shop id so the caller can resolve the actual channel or image.
   */
  private async requirePaymentChannelsVisible(buyerId: string, orderId: string): Promise<string> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, buyerId } });
    // §105: not while frozen either. A frozen order refuses the slip upload, so showing where to
    // transfer would invite a payment — to a shop just suspended or banned — that the buyer then
    // has no way to attach proof of. Released, it is back in L1's window and shows them again.
    if (order === null || order.frozenAt !== null || !PAYMENT_CHANNELS_VISIBLE_STATUSES.includes(order.status)) {
      throw new AppException('NOT_FOUND');
    }

    return order.shopId;
  }

  /**
   * K8/#55: the only place in the system that ever cuts real stock — everywhere else only ever
   * reserves it (invariant 3). The order's own status change is the gate: a conditional
   * `updateMany` guarded on `status: 'PAYMENT_SUBMITTED'` runs *first*, inside the transaction, so
   * a second call for the same order (double-click, retried request) loses that race before it
   * ever touches a variant's stock — the AC's own idempotency requirement ("กดยืนยันซ้ำ...สต็อกไม่ลด
   * สองเท่า"). Only once that gate is won does each item's stock get cut, one conditional
   * `updateMany` per variant (`stock: { gte: quantity }` in the `where`, `decrement` in the
   * `data`) — never read-then-write, per invariant 3's own instruction. Items are visited in
   * `variantId` order, the same discipline `checkout`'s multi-variant lock already uses, so two
   * different orders racing over the same two variants can never deadlock by acquiring them in
   * opposite order.
   *
   * If any one item's stock is insufficient, the exception thrown here unwinds the whole
   * transaction — the order's status flip above rolls back with it, so the order lands back
   * exactly on `PAYMENT_SUBMITTED` (K8: "ปฏิเสธการยืนยันทั้งใบ...ออเดอร์ไม่ค้างครึ่งทาง"), never half
   * confirmed. Clock 3 is untouched by that rollback — `paymentConfirmationWindowStartedAt` isn't
   * written here, so a shop that stalls by leaving stock short doesn't buy itself extra time (K8's
   * own reasoning: the shortage is the shop's own doing, not the buyer's problem to wait out).
   *
   * Releasing the `StockReservation` for this order needs no code here at all: `PAID` already
   * falls outside `StockReservationService`'s `RESERVING_STATUSES`, so the moment this
   * transaction commits, every live "how much is reserved" query for these variants stops
   * counting it — the same "computed live from status" design #50 built for exactly this.
   *
   * Deliberately does **not** check `frozenAt` or `shop.suspendedAt`. Invariant 7 names this exact
   * action ("ร้านที่ถูกระงับ ยังกดส่งของ ยืนยันเงินเข้า...ได้ตามปกติ") as one a suspended shop keeps —
   * suspension blocks new sales, not finishing ones already placed (J2) — and the same reasoning
   * extends to a frozen order for the identical reason `setShippingFee` above needs no such check:
   * this is "finish what's already committed", not the kind of unilateral termination `cancel`
   * blocks while frozen. Locking this out would make I4's "ปล่อยเดินต่อ" ("let it continue")
   * meaningless and leave a shop ordered to refund with no way to have confirmed the money in the
   * first place.
   */
  async confirmPayment(ownerId: string, orderId: string): Promise<OrderDto> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, ...ownedByShopOwner(ownerId) },
      include: ORDER_INCLUDE,
    });
    if (order === null) {
      throw new AppException('NOT_FOUND');
    }
    if (order.status !== 'PAYMENT_SUBMITTED') {
      throw new AppException('CONFLICT', { message: 'ออเดอร์นี้ไม่ได้อยู่ระหว่างรอยืนยันเงินเข้า' });
    }

    const now = this.clock.now();
    const updated = await this.prisma.$transaction(async (tx) => {
      const gated = await tx.order.updateMany({
        where: { id: order.id, status: 'PAYMENT_SUBMITTED' },
        data: { status: 'PAID', sellerConfirmedAt: now, sellerConfirmedBy: ownerId, updatedAt: now },
      });
      if (gated.count === 0) {
        throw new AppException('CONFLICT', { message: 'ออเดอร์นี้ไม่ได้อยู่ระหว่างรอยืนยันเงินเข้า' });
      }

      // §82: every item is tried before refusing, so the message names *all* the short ones at
      // once, each by product and option name — the variant name alone ("แบบเดียว", "ปกติ") is
      // routinely the same across products, and #55's AC asks for the one the shop must go fix.
      // A short item's failed conditional update changes nothing; any cuts that did succeed are
      // rolled back with the whole transaction when this throws, so K8's "never half confirmed"
      // still holds.
      const sortedItems = [...order.items].sort((a, b) => a.variantId.localeCompare(b.variantId));
      const shortItems: string[] = [];
      for (const item of sortedItems) {
        const cut = await tx.productVariant.updateMany({
          where: { id: item.variantId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity }, updatedAt: now },
        });
        if (cut.count === 0) {
          shortItems.push(`"${item.productNameAtPurchase} — ${item.variantNameAtPurchase}"`);
        }
      }
      if (shortItems.length > 0) {
        throw new AppException('CONFLICT', {
          message: `สต็อกไม่พอให้ตัด: ${shortItems.join(', ')} กรุณาแก้ไขสต็อกก่อนกดยืนยันอีกครั้ง`,
        });
      }

      return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE });
    });

    // #69: in-app only, after commit — the same "the durable part already happened" placement
    // every notification hook in this system uses, and not one of I17's email-worthy events.
    await this.notifications.notify({
      userId: order.buyerId,
      type: 'ORDER_PAYMENT_CONFIRMED',
      message: 'ร้านยืนยันว่าได้รับเงินแล้ว กำลังเตรียมจัดส่งสินค้า',
      targetType: 'ORDER',
      targetId: order.id,
    });

    return OrderDto.from(updated);
  }

  /**
   * #56 (I2): the shop's other option besides confirming — the transfer looked wrong (short,
   * wrong account, unreadable) but both sides still want the sale to go through, so this is not
   * a cancellation. `dto.reason` is required (missing/empty rejected by the DTO itself) — it's
   * what the buyer reads to know what to fix before re-uploading.
   *
   * Capped at `MAX_SLIP_REJECTIONS` per order: this button also restarts clock 3 (every slip
   * upload after a rejection starts a fresh `PAYMENT_SUBMITTED` round, and #57 will make that
   * round own clock 3's own start time) — an unbounded cap would let a shop reject forever to
   * dodge `REFUND_ORDERED`. The count is read fresh from `PaymentSlip` rows inside the same
   * transaction as the write, not the possibly-stale value on `order` fetched before it — the
   * only way a third rejection could slip through this check is a second call landing between
   * the read and the write, and the order-status gate below already closes that window, but the
   * re-read costs one query and removes the need to reason about whether that's airtight.
   *
   * Order of writes matters the same way it does in `confirmPayment`: the slip itself is marked
   * rejected first, then the order's conditional `updateMany` (guarded on
   * `status: 'PAYMENT_SUBMITTED'`) is what actually regresses the order and restarts clock 2 —
   * **to its full 24h window, not whatever time was left**, because the buyer isn't the one who
   * made the mistake here. `paymentWarningSentAt` is nulled out in the same write, exactly as
   * `order-sweep.tasks.ts`'s own comment on that field already anticipated this ticket would need
   * to. If that conditional update finds the order already moved on, the whole transaction rolls
   * back — including the slip's own `rejectedAt` write — so a lost race never leaves an orphaned
   * rejection on a slip whose order didn't actually regress.
   *
   * Deliberately does not check `frozenAt` or `shop.suspendedAt`, the same reasoning
   * `confirmPayment` above already has in full: this keeps a live deal moving, it doesn't
   * terminate anything, so it belongs with "finish what's already committed" (J2), not with the
   * unilateral endings `cancel` blocks while frozen.
   */
  async rejectSlip(ownerId: string, orderId: string, slipId: string, dto: RejectPaymentSlipDto): Promise<OrderDto> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, ...ownedByShopOwner(ownerId) } });
    if (order === null) {
      throw new AppException('NOT_FOUND');
    }
    if (order.status !== 'PAYMENT_SUBMITTED') {
      throw new AppException('CONFLICT', { message: 'ออเดอร์นี้ไม่ได้อยู่ระหว่างรอตรวจสลิป ปฏิเสธไม่ได้' });
    }

    const now = this.clock.now();
    const updated = await this.prisma.$transaction(async (tx) => {
      const rejectionCount = await tx.paymentSlip.count({ where: { orderId: order.id, rejectedAt: { not: null } } });
      if (rejectionCount >= MAX_SLIP_REJECTIONS) {
        throw new AppException('CONFLICT', {
          message: `ปฏิเสธสลิปครบ ${MAX_SLIP_REJECTIONS} ครั้งแล้ว ปฏิเสธเพิ่มไม่ได้`,
        });
      }

      // §82: only a slip of the *current* round can be rejected — `supersededAt` null as well as
      // `rejectedAt`. A leftover from an earlier round (the buyer re-uploaded, then the shop
      // rejected a different slip of that round) used to be rejectable later, knocking back the
      // current round with a reason about the wrong transfer and spending a rejection on it.
      const slip = await tx.paymentSlip.findFirst({
        where: { id: slipId, orderId: order.id, rejectedAt: null },
        select: { supersededAt: true },
      });
      if (slip === null) {
        throw new AppException('NOT_FOUND');
      }
      if (slip.supersededAt !== null) {
        throw new AppException('CONFLICT', { message: 'สลิปใบนี้เป็นของรอบการโอนก่อนหน้า ปฏิเสธไม่ได้แล้ว' });
      }

      const rejected = await tx.paymentSlip.updateMany({
        where: { id: slipId, orderId: order.id, rejectedAt: null, supersededAt: null },
        data: { rejectedAt: now, rejectionReason: dto.reason, rejectedByUserId: ownerId },
      });
      if (rejected.count === 0) {
        throw new AppException('NOT_FOUND');
      }

      // Rejecting one slip ends the round, so the round's other slips end with it (§82).
      await tx.paymentSlip.updateMany({
        where: { orderId: order.id, rejectedAt: null, supersededAt: null },
        data: { supersededAt: now },
      });

      const result = await tx.order.updateMany({
        where: { id: order.id, status: 'PAYMENT_SUBMITTED' },
        data: { status: 'AWAITING_PAYMENT', paymentWindowStartedAt: now, paymentWarningSentAt: null, updatedAt: now },
      });
      if (result.count === 0) {
        throw new AppException('CONFLICT', { message: 'ออเดอร์นี้ไม่ได้อยู่ระหว่างรอตรวจสลิป ปฏิเสธไม่ได้' });
      }

      return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE });
    });

    // #69: in-app only — the buyer reads the shop's own reason on the order page (dto.reason is
    // not repeated here; this is just the "go look" nudge, the reason itself is not duplicated
    // into a second free-text field per CLAUDE.md's "log/store only what's needed").
    await this.notifications.notify({
      userId: order.buyerId,
      type: 'ORDER_SLIP_REJECTED',
      message: 'ร้านปฏิเสธสลิปที่อัปโหลดไป กรุณาตรวจสอบเหตุผลและอัปสลิปใหม่',
      targetType: 'ORDER',
      targetId: order.id,
    });

    return OrderDto.from(updated);
  }

  /**
   * D4: the buyer's own way out, before money starts moving (`MANUALLY_CANCELLABLE_STATUSES`) —
   * a frozen order (`frozenAt`, topic 10) is never cancellable this way even though nothing sets
   * that flag yet, per this ticket's own AC ("ใบนี้เช็คธงนั้นได้แม้ยังไม่มีใครตั้งค่ามัน").
   */
  async cancelAsBuyer(buyerId: string, orderId: string, dto: CancelOrderDto): Promise<OrderDto> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, buyerId }, include: { shop: { select: { ownerId: true } } } });
    if (order === null) {
      throw new AppException('NOT_FOUND');
    }

    const cancelled = await this.cancel(order, 'BUYER', dto.reason ?? null);

    // §85: in-app only — the shop may already be packing; before this nothing told it.
    await this.notifications.notify({
      userId: order.shop.ownerId,
      type: 'ORDER_CANCELLED_BY_BUYER',
      message: 'ผู้ซื้อยกเลิกออเดอร์นี้แล้ว',
      targetType: 'ORDER',
      targetId: cancelled.id,
    });

    return cancelled;
  }

  /**
   * H11: the shop's own way out — also the only way to walk back a shipping fee entered wrong,
   * since H1 forbids editing it directly. A reason is required (see `CancelOrderAsShopDto`),
   * unlike the buyer's.
   */
  async cancelAsShop(ownerId: string, orderId: string, dto: CancelOrderAsShopDto): Promise<OrderDto> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, ...ownedByShopOwner(ownerId) } });

    return this.cancel(order, 'SHOP', dto.reason);
  }

  /**
   * Shared by both sides: not found, already resolved (whitelist excludes it — covers "already
   * cancelled", "already completed", and, once topic 8 exists, "already past PAYMENT_SUBMITTED"
   * all at once), and frozen are each answered the same way regardless of who's asking. The
   * conditional `updateMany` repeats the same checks as the write's own condition, closing the
   * same race window #51's `setShippingFee` guards against.
   */
  private async cancel(
    order: { id: string; status: OrderStatus; frozenAt: Date | null } | null,
    cancelledBy: OrderCancelledBy,
    reason: string | null,
  ): Promise<OrderDto> {
    if (order === null) {
      throw new AppException('NOT_FOUND');
    }
    if (order.frozenAt !== null || !MANUALLY_CANCELLABLE_STATUSES.includes(order.status)) {
      throw new AppException('CONFLICT', { message: 'ออเดอร์นี้ยกเลิกเองไม่ได้แล้ว' });
    }

    const now = this.clock.now();
    const result = await this.prisma.order.updateMany({
      where: { id: order.id, status: { in: [...MANUALLY_CANCELLABLE_STATUSES] }, frozenAt: null },
      data: { status: 'CANCELLED', cancelledBy, cancelReason: reason, cancelledAt: now, updatedAt: now },
    });
    if (result.count === 0) {
      throw new AppException('CONFLICT', { message: 'ออเดอร์นี้ยกเลิกเองไม่ได้แล้ว' });
    }

    // Restore coupon if used
    const claim = await this.prisma.userCouponClaim.findFirst({
      where: { orderId: order.id },
    });
    if (claim) {
      await this.prisma.userCouponClaim.update({
        where: { id: claim.id },
        data: { isUsed: false, usedAt: null, orderId: null },
      });
      await this.prisma.shopCoupon.update({
        where: { id: claim.couponId },
        data: { usedCount: { decrement: 1 } },
      });
    }

    const updated = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE });

    return OrderDto.from(updated);
  }

  /**
   * D5: the one button in the system nobody can press on a buyer's behalf — not the shop, not a
   * community admin, not super admin (this ticket's own AC names all three, and there is simply
   * no route for any of them to call). `findFirst` scoped to `buyerId` is what makes that true by
   * construction: a shop or admin calling this with someone else's order id just gets `NOT_FOUND`,
   * the same as calling it on an order that does not exist.
   *
   * N3: refuses outright while `frozenAt` is set, checked *before* the status gate and with its
   * own message — `frozenAt` is a flag layered on top of `status` (I6), so an order frozen mid-flight
   * is still `SHIPPED` in every other respect, and a guard that only checked `status === 'SHIPPED'`
   * would let this through by accident. Unfreezing (topic 10) restores the ability to call this —
   * this is a temporary hold, never a permanent one, which is exactly the shape `MANUALLY_CANCELLABLE_STATUSES`
   * / `cancel` above already uses for the identical reason.
   *
   * Deliberately does **not** care whether the order's shop has since closed (H12) — J1's own AC:
   * a buyer's completed purchase, and their right to open a dispute on it, must not depend on
   * whether the shop that sold it to them still exists.
   *
   * No sweep task reads or writes anything here, on purpose — D5 chose no auto-close, so this
   * column stays null forever unless a human clicks the button. See this ticket's own AC: adding
   * one later is possible without a data migration, but it is not this ticket's decision to make.
   */
  async markReceived(buyerId: string, orderId: string): Promise<OrderDto> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, buyerId } });
    if (order === null) {
      throw new AppException('NOT_FOUND');
    }
    if (order.frozenAt !== null) {
      throw new AppException('CONFLICT', { message: 'ออเดอร์นี้ถูกแช่แข็งอยู่ รอแอดมินตัดสินก่อนจึงจะกดรับของได้' });
    }
    if (order.status !== 'SHIPPED') {
      throw new AppException('CONFLICT', { message: 'ออเดอร์นี้ยังไม่ถูกส่ง หรือกดรับของไปแล้ว' });
    }

    const now = this.clock.now();
    const result = await this.prisma.order.updateMany({
      where: { id: order.id, status: 'SHIPPED', frozenAt: null },
      data: { status: 'COMPLETED', completedAt: now, updatedAt: now },
    });
    if (result.count === 0) {
      throw new AppException('CONFLICT', { message: 'ออเดอร์นี้ยังไม่ถูกส่ง หรือกดรับของไปแล้ว' });
    }

    await this.receivedNotifications.notify(order.id);

    const updated = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE });

    return OrderDto.from(updated);
  }
}

/** §87: `?status=` on both order lists — absent or empty means every status. */
function statusFilter(statuses: OrderStatus[] | undefined): Prisma.OrderWhereInput {
  return statuses === undefined || statuses.length === 0 ? {} : { status: { in: statuses } };
}

/**
 * §111 (the owner's decision): the order is placed only for what the buyer's screen showed — each
 * orderable line with the same quantity and price, no more and no fewer. The cart is read live
 * (K4), so without this a price raised after the screen loaded became the order's price, unseen.
 * The re-check under the checkout's locks (`requireStillOrderable`) then compares against these
 * same values, so a change landing between here and there is caught too.
 */
function refuseUnseenCart(
  orderableItems: readonly { id: string; quantity: number; priceAmountMinor: number }[],
  shown: readonly { cartItemId: string; quantity: number; priceAmountMinor: number }[],
): void {
  const shownById = new Map(shown.map((line) => [line.cartItemId, line]));
  const matches =
    shownById.size === shown.length &&
    shown.length === orderableItems.length &&
    orderableItems.every((item) => {
      const line = shownById.get(item.id);
      return line !== undefined && line.quantity === item.quantity && line.priceAmountMinor === item.priceAmountMinor;
    });
  if (!matches) {
    throw new AppException('STALE_VIEW', { message: 'ตะกร้าเปลี่ยนไปจากที่คุณเห็น (ราคา จำนวน หรือรายการ) กรุณาตรวจตะกร้าอีกครั้งก่อนสั่ง' });
  }
}

/**
 * §91: every cart line is still what the cart showed, now that its shop, product and variant are
 * locked — the same visibility rule the cart applies (#42 · invariant 6; since §92 that includes the
 * owner not being banned, whose account row is locked too), and the same price. A
 * line that stopped being orderable refuses the whole checkout, as a short stock does (K8): no
 * half orders. A price that moved in the same instant does too — the buyer would otherwise be
 * charged a price they were never shown.
 *
 * §111: both answer STALE_VIEW, the same as `refuseUnseenCart` before the locks — to the buyer it is one
 * situation (the cart is not what the screen showed; reload it), whichever instant the change landed in.
 */
async function requireStillOrderable(
  tx: Prisma.TransactionClient,
  items: readonly { variantId: string; priceAmountMinor: number }[],
): Promise<void> {
  const live = await tx.productVariant.findMany({
    where: {
      id: { in: items.map((item) => item.variantId) },
      deletedAt: null,
      product: { ...PRODUCT_OWN_VISIBILITY_FILTER, shop: LIVE_SHOP_FILTER },
    },
    select: { id: true, priceAmountMinor: true },
  });
  const priceById = new Map(live.map((variant) => [variant.id, variant.priceAmountMinor]));

  if (items.some((item) => !priceById.has(item.variantId))) {
    throw new AppException('STALE_VIEW', {
      message: 'สินค้าบางรายการในตะกร้าสั่งซื้อไม่ได้แล้ว (ร้านถูกระงับหรือสินค้าถูกนำออก) กรุณาตรวจตะกร้าอีกครั้ง',
    });
  }
  if (items.some((item) => priceById.get(item.variantId) !== item.priceAmountMinor)) {
    throw new AppException('STALE_VIEW', { message: 'ราคาสินค้าบางรายการเพิ่งเปลี่ยน กรุณาตรวจตะกร้าอีกครั้ง' });
  }
}
