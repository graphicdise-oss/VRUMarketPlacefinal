import { Controller, Get, HttpStatus, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { noteSignedInAccount } from '../access-log/access-log-account.js';
import { AppConfig } from '../config/app-config.module.js';
import { readSession } from './authenticated-request.js';
import { FrontendLinks } from '../email/frontend-links.js';
import { REFRESH_TOKEN_COOKIE, readCookie, setSessionCookies } from './cookies.js';
import { GoogleSignInStatusDto } from './dto/google-sign-in-status.dto.js';
import { Public } from './decorators/public.decorator.js';
import { GoogleAuthService, GoogleSignInRefusal } from './google-auth.service.js';
import { MAX_POLICY_VERSION_LENGTH } from '../legal/policy-version.js';
import {
  clearOAuthAgeCookie,
  clearOAuthPolicyCookie,
  clearOAuthStateCookie,
  clearOAuthTermsCookie,
  newOAuthState,
  oAuthStateMatches,
  readOAuthAgeConfirmed,
  readOAuthPolicyVersion,
  readOAuthTermsVersion,
  setOAuthAgeCookie,
  setOAuthPolicyCookie,
  setOAuthStateCookie,
  setOAuthTermsCookie,
} from './oauth-state.js';
import { SessionService } from './session.service.js';

/**
 * The two hops of signing in with Google (#26).
 *
 * The flow is deliberately the redirect one, not the popular "the frontend gets a token from
 * Google and posts it to the backend" shape:
 *
 *   1. the browser asks this server for `GET /auth/google` and is redirected to Google;
 *   2. Google redirects it back to `GET /auth/google/callback?code=…`;
 *   3. this server — not the browser — trades the code with Google, sets the same two cookies
 *      `POST /auth/login` sets, and redirects to the frontend.
 *
 * B3 forces it: the client secret never reaches a browser, no token appears in any response body,
 * and the session that comes out is the same session everything else in the system already
 * understands. There is no second login mechanism to revoke, sweep or ban separately.
 *
 * Both routes are `GET`, so `CsrfGuard` lets them through — which is why the `state` parameter
 * exists and is checked here instead. See oauth-state.ts.
 */
@ApiTags('auth')
@Controller('auth/google')
export class GoogleAuthController {
  constructor(
    private readonly google: GoogleAuthService,
    private readonly sessions: SessionService,
    private readonly links: FrontendLinks,
    private readonly config: AppConfig,
  ) {}

  /**
   * §128: whether the buttons should be shown at all. Configuration, not a secret — the client id
   * is public by design — so it is public, like the legal versions the same page reads.
   */
  @Public()
  @Get('status')
  @ApiOperation({ summary: 'Whether signing in with Google is available on this deployment' })
  @ApiResponse({ status: 200, type: GoogleSignInStatusDto })
  status(): GoogleSignInStatusDto {
    return { enabled: this.config.googleSignInEnabled };
  }

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Start signing in with Google',
    description:
      'Answers 302 to accounts.google.com and sets a short-lived state cookie. The frontend sends ' +
      'the browser here with a normal link or a full-page navigation — not with fetch(), which ' +
      'cannot follow a redirect to another origin and cannot set the cookie. ' +
      '§128: with Google sign-in off (GET /auth/google/status), answers 302 straight back to the ' +
      'frontend with `error=GOOGLE_SIGN_IN_DISABLED` instead. ' +
      '§87: pass `policyVersion` — the privacy policy version shown beside the button. A new ' +
      'account is created only when it is the current one; otherwise the callback redirects with ' +
      '`error=POLICY_VERSION_OUTDATED`. An existing account signs in without it. ' +
      '§90: pass `termsVersion` the same way — the terms of service version behind the same ' +
      'checkbox, which must be ticked before the button can be pressed.',
  })
  @ApiQuery({ name: 'policyVersion', required: false, description: 'The privacy policy version the page showed (§87).' })
  @ApiQuery({ name: 'termsVersion', required: false, description: 'The terms of service version the page showed (§90).' })
  @ApiQuery({ name: 'ageConfirmed', required: false, description: '§98: `true` when the page’s age box was ticked. A new account is refused without it.' })
  start(
    @Query('policyVersion') rawPolicyVersion: unknown,
    @Query('termsVersion') rawTermsVersion: unknown,
    @Query('ageConfirmed') rawAgeConfirmed: unknown,
    @Res() response: Response,
  ): void {
    if (!this.config.googleSignInEnabled) {
      // Sent back rather than on to Google, which would show its own English error page for a
      // client that does not exist — a dead end that looks like this site is broken.
      this.redirectToFrontend(response, 'GOOGLE_SIGN_IN_DISABLED');
      return;
    }

    const state = newOAuthState();

    setOAuthStateCookie(response, state, this.config.isProduction);
    // Anything but one short string is left off, and a new account is then refused at the callback.
    const policyVersion = singleQueryValue(rawPolicyVersion);
    if (policyVersion !== undefined && policyVersion.length <= MAX_POLICY_VERSION_LENGTH) {
      setOAuthPolicyCookie(response, policyVersion, this.config.isProduction);
    } else {
      clearOAuthPolicyCookie(response, this.config.isProduction);
    }
    const termsVersion = singleQueryValue(rawTermsVersion);
    if (termsVersion !== undefined && termsVersion.length <= MAX_POLICY_VERSION_LENGTH) {
      setOAuthTermsCookie(response, termsVersion, this.config.isProduction);
    } else {
      clearOAuthTermsCookie(response, this.config.isProduction);
    }
    if (singleQueryValue(rawAgeConfirmed) === 'true') {
      setOAuthAgeCookie(response, this.config.isProduction);
    } else {
      clearOAuthAgeCookie(response, this.config.isProduction);
    }

    response.redirect(HttpStatus.FOUND, this.google.authorisationUrl(state));
  }

  /**
   * The browser lands here from Google after the user finishes the Google sign-in consent screen.
   * We trade the `code` parameter with Google for the account's details, issue a session, set the
   * cookies, and send the browser back to the frontend.
   */
  @Public()
  @Get('callback')
  @ApiExcludeEndpoint()
  @ApiQuery({ name: 'code', required: false })
  @ApiQuery({ name: 'state', required: false })
  @ApiQuery({ name: 'error', required: false })
  async callback(
    @Query('code') rawCode: unknown,
    @Query('state') rawState: unknown,
    @Query('error') rawGoogleError: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    // Spent on arrival, whatever happens next: a state that can be presented twice is a flow that
    // can be replayed for the rest of its ten minutes.
    clearOAuthStateCookie(response, this.config.isProduction);
    const acceptedPolicyVersion = readOAuthPolicyVersion(request);
    clearOAuthPolicyCookie(response, this.config.isProduction);
    const acceptedTermsVersion = readOAuthTermsVersion(request);
    clearOAuthTermsCookie(response, this.config.isProduction);
    const ageConfirmed = readOAuthAgeConfirmed(request);
    clearOAuthAgeCookie(response, this.config.isProduction);

    if (!this.config.googleSignInEnabled) {
      // A flow started before the client was removed, or a hand-made request. Nothing is traded
      // with Google: there is no client to trade with.
      this.redirectToFrontend(response, 'GOOGLE_SIGN_IN_DISABLED');
      return;
    }

    const code = singleQueryValue(rawCode);
    const state = singleQueryValue(rawState);

    if (!oAuthStateMatches(request, state)) {
      // Also what an ordinary stale tab looks like, so the person is sent back to try again rather
      // than shown an accusation.
      this.redirectToFrontend(response, 'GOOGLE_SIGN_IN_FAILED');
      return;
    }

    if (singleQueryValue(rawGoogleError) !== undefined || code === undefined) {
      // The person pressed "cancel" on Google's consent screen, most likely. Google's own error
      // string is not passed on: it is Google's vocabulary, and the frontend has one of its own.
      this.redirectToFrontend(response, 'GOOGLE_SIGN_IN_FAILED');
      return;
    }

    // §101: the account this browser is already signed in to, if any — the proof of password Google
    // needs before connecting to a verified account that has one. AuthGuard resolved the access
    // token (this route is public, and the cookie's path covers it); when that ran out on Google's
    // screens, a live refresh token is the same sign-in, so it counts too.
    const refreshToken = readCookie(request, REFRESH_TOKEN_COOKIE);
    const signedInUserId =
      readSession(request)?.user.id ??
      (refreshToken === undefined ? null : await this.sessions.userIdForRefreshToken(refreshToken));
    const result = await this.google.signInWithCode(code, acceptedPolicyVersion, acceptedTermsVersion, ageConfirmed, signedInUserId);

    if (result.status === 'refused') {
      this.redirectToFrontend(response, result.reason);
      return;
    }

    // §98: the callback's access-log row names the account it signed into, like `login` does.
    noteSignedInAccount(request, result.userId);
    setSessionCookies(response, result.tokens, this.config.isProduction);

    this.redirectToFrontend(response);
  }

  private redirectToFrontend(response: Response, error?: GoogleSignInRefusal): void {
    response.redirect(HttpStatus.FOUND, this.links.afterGoogleSignIn(error));
  }
}

/**
 * One string from a query parameter, or undefined.
 *
 * Express parses `?code=a&code=b` into an array and `?code[x]=y` into an object. Taking the first
 * element of an array would let a caller append their own value to somebody else's link, so both
 * shapes are refused outright.
 */
function singleQueryValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
