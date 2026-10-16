import { api, apiFetchBlob } from "./core";

export interface DisputeEvidenceDto {
  id: string;
  disputeId: string;
  submitterId: string;
  fileName: string;
  fileMimeType: string;
  fileSize: number;
  createdAt: string;
}

export interface DisputeDto {
  id: string;
  orderId: string;
  reason: string;
  shopResponse: string | null;
  respondedAt: string | null;
  closedAt: string | null;
  verdict: "BUYER_WINS" | "SHOP_WINS" | null;
  rulingReason: string | null;
  ruledAt: string | null;
  evidence: DisputeEvidenceDto[];
  createdAt: string;
  updatedAt: string;
}

export interface DisputeAdminDto extends DisputeDto {
  shopId: string;
  communityId: string;
  chatRoomId: string | null;
}

export interface DisputeRevealedOrderDto {
  id: string;
  buyerId: string;
  shopId: string;
  status: string;
  displayStatus: string;
  totalAmountMinor: number | null;
  shippingAmountMinor: number | null;
  currency: string;
  recipientName: string;
  phone: string;
  houseNumber: string;
  villageNumber: string | null;
  alley: string | null;
  road: string | null;
  subdistrictName: string;
  districtName: string;
  provinceName: string;
  postalCode: string;
  items: { id: string; productNameAtPurchase: string; variantNameAtPurchase: string; priceAtPurchase: number; currency: string; quantity: number }[];
  shippedAt: string | null;
  shippingCarrierName: string | null;
  trackingNumber: string | null;
  refundOrderedAt: string | null;
  refundAccountType: "BANK_TRANSFER" | "PROMPTPAY" | null;
  refundBankName: string | null;
  refundBankAccountNumber: string | null;
  refundBankAccountName: string | null;
  refundPromptPayId: string | null;
  createdAt: string;
}

export interface DisputePaymentSlipDto {
  id: string;
  orderId: string;
  rejectedAt: string | null;
  rejectionReason: string | null;
  supersededAt: string | null;
  createdAt: string;
}

export interface DisputeBreakGlassDto {
  order: DisputeRevealedOrderDto;
  paymentSlips: DisputePaymentSlipDto[];
}

export const disputeAdminApi = {
  getOpen: (cursor?: string) => api.get<{ items: DisputeAdminDto[]; nextCursor?: string }>(`/disputes/open?limit=50${cursor ? `&cursor=${cursor}` : ''}`),
  getAdminView: (id: string) => api.get<DisputeAdminDto>(`/disputes/${id}/admin`),
  rule: (id: string, verdict: "BUYER_WINS" | "SHOP_WINS", reason: string) => api.post<DisputeDto>(`/disputes/${id}/ruling`, { verdict, reason }),
  /** Super admin only (I9b) — overwrites an already-ruled dispute. */
  override: (id: string, verdict: "BUYER_WINS" | "SHOP_WINS", reason: string) => api.post<DisputeDto>(`/disputes/${id}/override`, { verdict, reason }),
  /** I5 break-glass: logs DISPUTE_IDENTITY_REVEALED with this reason. */
  breakGlass: (id: string, reason: string) => api.post<DisputeBreakGlassDto>(`/disputes/${id}/break-glass`, { reason }),
  /** Raw bytes of one slip under break-glass — audited with its own reason. */
  readSlip: (id: string, slipId: string, reason: string) =>
    apiFetchBlob(`/disputes/${id}/break-glass/payment-slips/${slipId}`, { method: "POST", body: JSON.stringify({ reason }) }),
  /** Each look is audited as DISPUTE_EVIDENCE_VIEWED. */
  readEvidence: (id: string, evidenceId: string) => apiFetchBlob(`/disputes/${id}/admin-evidence/${evidenceId}`),
};

export interface AdminChatMessageDto {
  id: string;
  roomId: string;
  senderId: string;
  orderId: string | null;
  fileId: string | null;
  content: string;
  createdAt: string;
  editedAt: string | null;
  unsentAt: string | null;
}

export const adminChatApi = {
  /** Read-only, only while a dispute between the room's two parties is open. Audited as DISPUTE_CHAT_VIEWED. */
  listMessages: (roomId: string, cursor?: string) =>
    api.get<{ items: AdminChatMessageDto[]; nextCursor?: string }>(`/chat-rooms/${roomId}/admin/messages?limit=50${cursor ? `&cursor=${cursor}` : ''}`),
  readAttachment: (roomId: string, fileId: string) => apiFetchBlob(`/chat-rooms/${roomId}/admin/attachments/${fileId}`),
};

export const buyerDisputeApi = {
  list: (orderId: string) => api.get<DisputeDto[]>(`/orders/${orderId}/dispute`),
  open: (orderId: string, formData: FormData) => api.post<DisputeDto>(`/orders/${orderId}/dispute`, formData),
};

export const shopDisputeApi = {
  list: (orderId: string) => api.get<DisputeDto[]>(`/shops/me/orders/${orderId}/dispute`),
  respond: (orderId: string, formData: FormData) => api.post<DisputeDto>(`/shops/me/orders/${orderId}/dispute/respond`, formData),
};
