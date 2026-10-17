-- Optional website accounts. Independent of MCP, x402 and the private console.
create table "site_user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);

create table "site_session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "site_user" ("id") on delete cascade);

create table "site_account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "site_user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

create table "site_verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

create table "site_rate_limit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "site_session_userId_idx" on "site_session" ("userId");

create index "site_account_userId_idx" on "site_account" ("userId");

create index "site_verification_identifier_idx" on "site_verification" ("identifier");