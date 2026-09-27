-- Core schema for the subscription platform.

CREATE TABLE users (
  id                 BIGSERIAL PRIMARY KEY,
  email              TEXT NOT NULL,
  name               TEXT,
  stripe_customer_id TEXT UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Emails are matched case-insensitively.
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

CREATE TABLE plans (
  id           BIGSERIAL PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency     CHAR(3) NOT NULL DEFAULT 'usd',
  interval     TEXT NOT NULL CHECK (interval IN ('month', 'year')),
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id                     BIGSERIAL PRIMARY KEY,
  user_id                BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  plan_id                BIGINT NOT NULL REFERENCES plans (id),
  -- NULL for subscriptions created through the simulated (dev) payment flow.
  stripe_subscription_id TEXT UNIQUE,
  status                 TEXT NOT NULL CHECK (status IN
                           ('active', 'trialing', 'past_due', 'canceled', 'expired', 'incomplete')),
  current_period_start   TIMESTAMPTZ NOT NULL,
  current_period_end     TIMESTAMPTZ NOT NULL,
  cancel_at_period_end   BOOLEAN NOT NULL DEFAULT false,
  canceled_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_user_idx ON subscriptions (user_id);
-- Serves the expiry scan: active subscriptions ordered by period end.
CREATE INDEX subscriptions_expiry_idx ON subscriptions (current_period_end)
  WHERE status IN ('active', 'trialing');

CREATE TABLE payments (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  subscription_id BIGINT REFERENCES subscriptions (id) ON DELETE SET NULL,
  provider        TEXT NOT NULL CHECK (provider IN ('stripe', 'simulated', 'seed')),
  -- Stripe invoice/checkout-session id (or a simulated id). Unique so a
  -- redelivered webhook can never record the same payment twice.
  external_ref    TEXT NOT NULL UNIQUE,
  amount_cents    INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency        CHAR(3) NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('succeeded', 'refunded', 'failed')),
  paid_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payments_paid_at_idx ON payments (paid_at);

CREATE SEQUENCE invoice_number_seq;

CREATE TABLE invoices (
  id              BIGSERIAL PRIMARY KEY,
  invoice_number  TEXT NOT NULL UNIQUE,
  payment_id      BIGINT NOT NULL UNIQUE REFERENCES payments (id) ON DELETE CASCADE,
  user_id         BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  subscription_id BIGINT REFERENCES subscriptions (id) ON DELETE SET NULL,
  amount_cents    INTEGER NOT NULL,
  currency        CHAR(3) NOT NULL,
  format          TEXT NOT NULL CHECK (format IN ('pdf', 'txt')),
  storage_key     TEXT NOT NULL,
  -- Unguessable token that authorizes the download link sent by email.
  access_token    TEXT NOT NULL,
  emailed_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stripe delivers webhooks at least once; storing event ids makes handling idempotent.
CREATE TABLE webhook_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

-- One reminder per subscription per billing period.
CREATE TABLE renewal_reminders (
  id              BIGSERIAL PRIMARY KEY,
  subscription_id BIGINT NOT NULL REFERENCES subscriptions (id) ON DELETE CASCADE,
  period_end      TIMESTAMPTZ NOT NULL,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, period_end)
);
