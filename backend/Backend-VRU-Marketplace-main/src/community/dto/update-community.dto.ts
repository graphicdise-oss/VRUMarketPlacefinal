import { CreateCommunityDto } from './create-community.dto.js';

/**
 * Same two fields as creation, both required.
 *
 * A partial PATCH (name only, or description only) was considered and left out: nothing in #30
 * asks for it, and a cross-field "at least one of these" rule is validation machinery this ticket
 * does not need yet. Editing means sending the whole thing back, same as the form a super admin
 * would fill in.
 */
export class UpdateCommunityDto extends CreateCommunityDto {}
