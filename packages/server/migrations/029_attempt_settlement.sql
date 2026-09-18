-- Keep accepted receipts intact. A cancelled key is a durable execution fence.
ALTER TABLE suite.idempotency
  ADD COLUMN outcome text NOT NULL DEFAULT 'accepted'
  CHECK (outcome IN ('accepted', 'cancelled'));
