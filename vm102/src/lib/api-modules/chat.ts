/** Types for the Socket.IO chat gateway — mirror backend `chat/dto/*` and `chat/ws-types.ts`. Dates are ISO strings over the wire. */

export interface ChatMessageDto {
  id: string;
  roomId: string;
  senderId: string;
  orderId: string | null;
  fileId: string | null;
  content: string;
  createdAt: string;
  editedAt: string | null;
  unsentAt: string | null;
  isRead?: boolean;
}

export interface ChatRoomSummaryDto {
  id: string;
  buyerId: string;
  shopOwnerUserId: string;
  shopName?: string;
  buyerName?: string;
  createdAt: string;
  lastMessage: ChatMessageDto | null;
  unreadCount: number;
}

export interface ChatPage<T> {
  items: T[];
  nextCursor?: string;
}

export interface AckErrorBody {
  statusCode?: number;
  error?: string;
  message: string;
}

/** Every gateway event replies through an ack with this shape. */
export type AckResponse<T> = { ok: true; data: T } | { ok: false; error: AckErrorBody };

import { apiFetch } from "./core";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

/**
 * Uploads an image attachment for a specific chat room.
 * Strict image only (jpg/png), re-encoded by backend to strip EXIF.
 */
export async function uploadChatAttachment(roomId: string, file: File): Promise<{ fileId: string }> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<{ fileId: string }>(`/chat-rooms/${roomId}/attachments`, {
    method: "POST",
    body: formData,
  });
}

/**
 * URL to retrieve private chat attachment image with credentials.
 */
export function getChatAttachmentUrl(roomId: string, fileId: string): string {
  return `${API_BASE_URL}/chat-rooms/${roomId}/attachments/${fileId}`;
}
