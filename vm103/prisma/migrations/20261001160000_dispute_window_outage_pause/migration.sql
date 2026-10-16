-- §116 (owner's decision): platform outages pause the dispute window too. Every existing order
-- starts at zero — no outage has been paid out yet.
ALTER TABLE "order" ADD COLUMN "dispute_window_paused_seconds" INTEGER NOT NULL DEFAULT 0;
