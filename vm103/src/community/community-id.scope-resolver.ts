import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { isUuid } from '../common/id.js';
import { ShopScopeResolver } from './shop-scope-resolver.js';

@Injectable()
export class CommunityIdScopeResolver implements ShopScopeResolver {
   
   
  async resolveCommunityId(request: Request): Promise<string | null> {
    const communityId = request.params.communityId;

    if (typeof communityId !== 'string' || !isUuid(communityId)) {
      return null;
    }

    return communityId;
  }
}
