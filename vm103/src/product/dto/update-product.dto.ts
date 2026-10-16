import { ProductDetailsDto } from './product-details.dto.js';

/**
 * Full replace of name/description/categoryId (#44) — same "send the whole thing back" shape as
 * `UpdateAddressDto`/`UpdateCategoryDto`/`UpdatePaymentChannelDto`, not a partial PATCH.
 *
 * Every field here is in invariant 6's first group (A3/I13): a successful call always resets the
 * product to PENDING. It disappears from the public list/page the moment `moderationStatus` stops
 * being `APPROVED` — `PRODUCT_OWN_VISIBILITY_FILTER` (#42) is the single point that decides that,
 * so this endpoint never touches `shopPublishStatus` itself to make the product "hide."
 */
export class UpdateProductDto extends ProductDetailsDto {}
