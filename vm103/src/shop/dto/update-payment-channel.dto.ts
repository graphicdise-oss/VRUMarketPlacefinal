import { CreatePaymentChannelDto } from './create-payment-channel.dto.js';

/**
 * Same shape as creation, full replace — same reasoning as `UpdateCommunityDto`/
 * `UpdateCategoryDto`/`UpdateAddressDto`: editing means sending the whole thing back. Includes
 * `type`, unlike `UpdateAddressDto` excluding `isDefault` — switching a misconfigured channel
 * from BANK_TRANSFER to PROMPTPAY (or back) is an ordinary edit here, not a separate action with
 * its own transaction the way Address's default-swap is.
 */
export class UpdatePaymentChannelDto extends CreatePaymentChannelDto {}
