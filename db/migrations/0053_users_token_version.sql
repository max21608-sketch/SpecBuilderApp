-- ==========================================================================
-- 0053_users_token_version.sql -- a session can be ended.
--
-- WHAT WENT WRONG (audit A4 and H3, 2026-11-06). A session was a JWT holding
-- the user's role for seven days, read by the middleware and by
-- `getSessionUser` without either ever looking at `users`. So:
--
--   * deactivating somebody (`active = false`) changed nothing until their
--     token expired, up to a week later;
--   * demoting an editor to a viewer changed nothing for the same week, and
--     their writes went on passing the role check;
--   * signing out deleted the cookie in one browser and left any copy of it,
--     on another device or in somebody else's hands, working;
--   * and the token named no deployment, so where staging and pilot shared
--     AUTH_SECRET a staging token was a pilot session.
--
-- No test sent a write as a view-only account either, so none of it could
-- have been seen failing.
--
-- THE FIX. Every token now carries the user's `token_version` (claim `tv`),
-- and `getSessionUser` reads the row on every request and refuses a token
-- whose version is not the row's, or whose row is inactive. Signing out moves
-- the version on, which ends every session that user holds. The role is read
-- from the row too, so a demotion is the next request. The token also carries
-- `aud = APP_ENV` and `iss = 'spec-builder'`, and lives 24 hours, renewed
-- while in use (`src/lib/auth.ts`).
--
-- WHAT THIS FILE DOES TO EXISTING ROWS. Every user gets version 1 from the
-- default; nobody is signed out BY THIS FILE. It is the deployment of the code
-- that signs everybody out once, because a token minted before it carries no
-- version and no audience and is refused. Apply this before that code: the
-- code selects the column, and against a database without it every request
-- that reads a session fails.
--
-- `tools/create-user.mjs` moves the version on when it re-runs for an
-- existing email, because that is how a password is reset.
-- ==========================================================================
begin;

alter table users add column token_version integer not null default 1;

alter table users add constraint users_token_version_positive check (token_version > 0);

comment on column users.token_version is
  'Carried in every session token (claim tv). A token whose version is not this one is refused; '
  'signing out increments it, ending every session the user holds (0053).';

commit;
