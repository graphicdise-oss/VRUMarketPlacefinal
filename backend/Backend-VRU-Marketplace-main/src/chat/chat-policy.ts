/**
 * Code review of topic 11 (§83, chosen by the project owner): how many chat pictures one person
 * may have uploaded into one room without sending yet. K17 allows one picture per message, so
 * five is room for a person to pick between a few shots before sending, and small enough that
 * the disk a room can hold unsent is bounded (5 × 10MB per party) rather than unlimited.
 */
export const MAX_PENDING_CHAT_ATTACHMENTS_PER_UPLOADER = 5;

/**
 * §83: how long an unsent chat picture waits before `ChatPendingAttachmentSweepTask` deletes it
 * along with its bytes. A day covers "uploaded, then got distracted", and matches the order
 * clocks' own 24-hour windows.
 */
export const PENDING_CHAT_ATTACHMENT_TTL_HOURS = 24;

/**
 * §89 (the project owner's choice, the way Messenger does it): how long after sending the sender
 * may still unsend a message. Editing has no such limit — every version stays readable to both
 * parties, so a late edit hides nothing — but an unsent message vanishes from both screens, and
 * a conversation whose past can be pulled back at any time is not evidence anyone can rely on (H8).
 */
export const CHAT_UNSEND_WINDOW_MINUTES = 15;
