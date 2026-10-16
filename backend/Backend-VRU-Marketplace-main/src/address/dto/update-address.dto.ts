import { CreateAddressDto } from './create-address.dto.js';

/**
 * Same fields as creation, all required — same reasoning as `UpdateCommunityDto` and
 * `UpdateCategoryDto`: editing means sending the whole thing back, not a partial PATCH.
 *
 * `isDefault` is deliberately not here: it has its own endpoint (`POST /addresses/:id/default`)
 * because becoming the default is a transaction that touches *other* rows too (unsetting the
 * previous default), which is a different shape of operation from editing this one row's own
 * fields — the same reason suspending a shop is its own route rather than a field on a shop PATCH.
 */
export class UpdateAddressDto extends CreateAddressDto {}
