import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EmailTransport, EnvVars, validateEnv } from './env.validation.js';

/**
 * Typed access to the validated environment.
 *
 * Nest's ConfigService is stringly-typed, which is how a typo in a variable name becomes
 * `undefined` at runtime instead of a compile error. Everything else in the codebase reads
 * configuration through the properties below, so the variable names appear exactly once.
 *
 * The values are already validated: AppConfigModule hands `validateEnv` to ConfigModule,
 * and ConfigModule uses that function's return value as the config it serves. A value that
 * reaches here has been through class-validator.
 */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<EnvVars, true>) {}

  private get<K extends keyof EnvVars>(key: K): EnvVars[K] {
    return this.config.get(key, { infer: true });
  }

  get nodeEnv(): EnvVars['NODE_ENV'] {
    return this.get('NODE_ENV');
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get port(): number {
    return this.get('PORT');
  }

  get databaseUrl(): string {
    return this.get('DATABASE_URL');
  }

  get superAdminEmail(): string {
    return this.get('SUPER_ADMIN_EMAIL');
  }

  get accountMarkerPepper(): string {
    return this.get('ACCOUNT_MARKER_PEPPER');
  }

  get accessTokenSecret(): string {
    return this.get('ACCESS_TOKEN_SECRET');
  }

  get refreshTokenSecret(): string {
    return this.get('REFRESH_TOKEN_SECRET');
  }

  get csrfSecret(): string {
    return this.get('CSRF_SECRET');
  }

  get verificationTokenSecret(): string {
    return this.get('VERIFICATION_TOKEN_SECRET');
  }

  get uploadDir(): string {
    return this.get('UPLOAD_DIR');
  }

  get maxImageUploadBytes(): number {
    return this.get('MAX_IMAGE_UPLOAD_BYTES');
  }

  get emailTransport(): EmailTransport {
    return this.get('EMAIL_TRANSPORT');
  }

  get brevoApiKey(): string {
    return this.get('BREVO_API_KEY');
  }

  get smtpHost(): string {
    return this.get('SMTP_HOST');
  }

  get smtpPort(): number {
    return this.get('SMTP_PORT');
  }

  get smtpUser(): string {
    return this.get('SMTP_USER');
  }

  get smtpPassword(): string {
    return this.get('SMTP_PASSWORD');
  }

  get mailFromAddress(): string {
    return this.get('MAIL_FROM_ADDRESS');
  }

  get mailFromName(): string {
    return this.get('MAIL_FROM_NAME');
  }

  get frontendBaseUrl(): string {
    return this.get('FRONTEND_BASE_URL');
  }

  /** §128: both halves of the client were set. Validation refuses one without the other. */
  get googleSignInEnabled(): boolean {
    return this.googleClientId !== '' && this.googleClientSecret !== '';
  }

  get googleClientId(): string {
    return this.get('GOOGLE_CLIENT_ID');
  }

  get googleClientSecret(): string {
    return this.get('GOOGLE_CLIENT_SECRET');
  }

  get googleRedirectUri(): string {
    return this.get('GOOGLE_REDIRECT_URI');
  }

  get trustProxyHops(): number {
    return this.get('TRUST_PROXY_HOPS');
  }

  get rateLimitLoginPer15Min(): number {
    return this.get('RATE_LIMIT_LOGIN_PER_15_MIN');
  }

  get rateLimitLoginPerIpPerHour(): number {
    return this.get('RATE_LIMIT_LOGIN_PER_IP_PER_HOUR');
  }

  get rateLimitRegisterPerHour(): number {
    return this.get('RATE_LIMIT_REGISTER_PER_HOUR');
  }

  get rateLimitRegisterPerIpPerHour(): number {
    return this.get('RATE_LIMIT_REGISTER_PER_IP_PER_HOUR');
  }

  get rateLimitEmailLinkPerHour(): number {
    return this.get('RATE_LIMIT_EMAIL_LINK_PER_HOUR');
  }

  get rateLimitPasswordResetPerIpPerHour(): number {
    return this.get('RATE_LIMIT_PASSWORD_RESET_PER_IP_PER_HOUR');
  }

  get rateLimitChatMessagePerMinute(): number {
    return this.get('RATE_LIMIT_CHAT_MESSAGE_PER_MINUTE');
  }

  get rateLimitUploadPerHour(): number {
    return this.get('RATE_LIMIT_UPLOAD_PER_HOUR');
  }

  get uploadTmpDir(): string {
    return this.get('UPLOAD_TMP_DIR');
  }

  get imageProcessingConcurrency(): number {
    return this.get('IMAGE_PROCESSING_CONCURRENCY');
  }

  get imageProcessingQueueTimeoutMs(): number {
    return this.get('IMAGE_PROCESSING_QUEUE_TIMEOUT_MS');
  }
}

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Runs before anything is injected, so a bad environment stops the boot rather than
      // surfacing later as a confusing runtime failure.
      validate: validateEnv,
      // `.env` is for local development. In a container the values come from the
      // environment itself, so a missing file here is not an error.
      envFilePath: ['.env'],
    }),
  ],
  providers: [AppConfig],
  exports: [AppConfig],
})
export class AppConfigModule {}
