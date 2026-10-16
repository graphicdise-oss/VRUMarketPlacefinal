import { EmailField } from './email-field.decorator.js';

export class ResendVerificationDto {
  @EmailField()
  email!: string;
}
