ALTER TABLE suite.entitlements ADD COLUMN seat_limit integer CHECK(seat_limit IS NULL OR seat_limit >= 0);
