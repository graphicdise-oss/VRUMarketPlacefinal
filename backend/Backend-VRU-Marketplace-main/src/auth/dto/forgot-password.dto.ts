import { EmailField } from './email-field.decorator.js';

export class ForgotPasswordDto {
  @EmailField()
  email!: string;
}
