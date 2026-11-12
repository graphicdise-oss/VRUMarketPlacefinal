import type { Prisma } from '@prisma/client';

/**
 * Ensures an `UploadedFile` row is NOT attached to any domain/private table (`PaymentSlip`,
 * `RefundSlip`, `ShippingSlip`, `DisputeEvidence`, `ChatMessage`, `PaymentChannel`, etc.).
 *
 * Because `Banner.imageUrl` and `Article.image` store a URL string rather than a foreign-key
 * column to `uploaded_file`, any route serving banner/article images by `:fileId` MUST apply
 * this filter so a private slip/evidence UUID can never be read through a banner/article image URL.
 */
export const UNATTACHED_UPLOADED_FILE_WHERE: Prisma.UploadedFileWhereInput = {
  paymentChannels: { none: {} },
  productImages: { none: {} },
  paymentSlips: { none: {} },
  refundSlips: { none: {} },
  reviewImages: { none: {} },
  disputeEvidence: { none: {} },
  chatAttachments: { none: {} },
  pendingInChat: null,
  shopAdminChatAttachments: { none: {} },
  pendingInShopAdminChat: null,
  shopLogos: { none: {} },
  shopPendingLogos: { none: {} },
  shopBanners: { none: {} },
  shippingSlips: { none: {} },
};

