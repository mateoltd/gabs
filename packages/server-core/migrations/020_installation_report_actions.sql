-- Old clients continue to report installation attempts without an action field.
ALTER TABLE suite.installation_reports ADD COLUMN action text NOT NULL DEFAULT 'install' CHECK(action IN ('install','uninstall'));
ALTER TABLE suite.installation_reports ALTER COLUMN version DROP NOT NULL;
ALTER TABLE suite.installation_reports DROP CONSTRAINT installation_reports_phase_check;
ALTER TABLE suite.installation_reports ADD CONSTRAINT installation_reports_phase_check CHECK(phase IN ('planning','downloading','confirming','ready','removed','failed'));
