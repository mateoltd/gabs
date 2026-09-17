-- Identifies the last accepted device lifecycle change without trusting client clocks.
ALTER TABLE suite.module_installations ADD COLUMN receipt_id uuid;
