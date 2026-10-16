import { EmailField } from '../../auth/dto/email-field.decorator.js';

/** §112: the exact address — no partial match, so the lookup never becomes a way to browse accounts. */
export class FindUserQueryDto {
  @EmailField()
  email!: string;
}
