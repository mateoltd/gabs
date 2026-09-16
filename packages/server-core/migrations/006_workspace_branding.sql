ALTER TABLE suite.workspaces ADD COLUMN accent text NOT NULL DEFAULT 'forest' CHECK(accent IN ('forest','blue','plum'));
ALTER TABLE suite.workspaces ADD COLUMN logo_data_url text NOT NULL DEFAULT '' CHECK(length(logo_data_url)<=50000);
