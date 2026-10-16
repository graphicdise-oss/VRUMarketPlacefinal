import { MAX_ORDER_ITEMS_SUBTOTAL_MINOR } from '../../order/common/order-policy.js';

/**
 * The numbers this module runs on. `MAX_VARIANTS_PER_PRODUCT` and `MAX_PRODUCT_IMAGES` are the
 * spec's own ceilings (L7 · C4); the length limits are ordinary engineering defaults, matched to
 * the schema's own `@db.VarChar`/`@db.Text` columns in prisma/schema.prisma.
 */

export const MAX_PRODUCT_NAME_LENGTH = 200;
export const MAX_PRODUCT_DESCRIPTION_LENGTH = 5000;

export const MIN_VARIANTS_PER_PRODUCT = 1;
export const MAX_VARIANTS_PER_PRODUCT = 50;

export const MAX_VARIANT_NAME_LENGTH = 100;

/** K3's money convention: an integer amount of satang. A price of zero is not a real listing. */
export const MIN_PRICE_AMOUNT_MINOR = 1;

/**
 * §110 (owner's decision): the most one option may cost — ฿20 million, the same as the order ceiling
 * (`MAX_ORDER_ITEMS_SUBTOTAL_MINOR`, §81), since an option dearer than that could never be ordered.
 * Before this, a price past the integer column's range reached the database and came back as a 500.
 */
export const MAX_PRICE_AMOUNT_MINOR = MAX_ORDER_ITEMS_SUBTOTAL_MINOR;

/** §110 (owner's decision): the most units one option may hold — ample for any community shop, far inside the column. */
export const MAX_VARIANT_STOCK = 1_000_000;

export const MAX_PRODUCT_IMAGES = 10;
