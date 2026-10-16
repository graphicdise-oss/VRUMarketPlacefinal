import { Module } from '@nestjs/common';
import { AccessLogModule } from '../access-log/access-log.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CommunityModule } from '../community/community.module.js';
import { DisputeModule } from '../dispute/dispute.module.js';
import { ChatAdminController } from './chat-admin.controller.js';
import { ChatAttachmentController } from './chat-attachment.controller.js';
import { ChatRoomIdScopeResolver } from './chat-room-id.scope-resolver.js';
import { ChatPendingAttachmentSweepTask } from './chat-sweep.tasks.js';
import { ChatGateway } from './chat.gateway.js';
import { ChatService } from './chat.service.js';
import { ShopAdminChatAttachmentController } from './shop-admin-chat-attachment.controller.js';
import { ShopAdminChatGateway } from './shop-admin-chat.gateway.js';
import { ShopAdminChatService } from './shop-admin-chat.service.js';

/**
 * `ChatRoom` + `ChatMessage` (#66) + attachments/unread/rate-limit (#67) + the admin break-glass
 * read (#68). F4/#12 make the conversation itself the one WebSocket-only feature in this system,
 * but not every part of this module is a socket event — `ChatAttachmentController` and
 * `ChatAdminController` are both plain-HTTP, each for its own reason explained in its own file.
 * `AuthModule` for `SessionService` (which that module's own comment already names as the thing a
 * handshake authenticates against, instead of growing a second notion of what a valid session is
 * — invariant 8) and, since #67, `RateLimitService` for the 30-messages-a-minute ceiling (L7,
 * per sender per room since §83) — see `ChatService`'s own comment for why that reuses the raw
 * counter rather than `RateLimitGuard`. Since §83 also `SessionRevocations`, which is how
 * `ChatGateway` learns that a session ended and closes its sockets. `FileStorageService` needs no
 * import: `FilesModule` is `@Global()`, the same way `ReviewModule` already reaches it.
 * `DisputeModule` (exporting `DisputeService`, one-way only — that module does not import this
 * one) is #68's own dependency: `ChatService.openDisputeCommunityId` (which
 * `ChatRoomIdScopeResolver` delegates to since §83) is the one place this module calls into #64's
 * `isOrderUnderOpenDisputeBreakGlass` rather than reimplementing the open/closed rule.
 *
 * `ChatIoAdapter` (registered in `bootstrap.ts`, not here — it has to run before `app.init()`,
 * which is earlier than any module's providers exist) is what gives `ChatGateway`'s underlying
 * `Server` its CORS origin from `AppConfig`.
 */
@Module({
  // §106: `CommunityModule` for `CommunityAdminRevocations` — an admin removed from a community
  // leaves its admin↔shop rooms (`ShopAdminChatGateway`).
  imports: [AuthModule, DisputeModule, AccessLogModule, CommunityModule],
  controllers: [ChatAttachmentController, ChatAdminController, ShopAdminChatAttachmentController],
  providers: [ChatGateway, ChatService, ChatRoomIdScopeResolver, ChatPendingAttachmentSweepTask, ShopAdminChatGateway, ShopAdminChatService],
})
export class ChatModule {}
