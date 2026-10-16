-- §117: "how much of this variant is reserved" starts from the open orders (a small set) instead
-- of walking every reservation the variant ever had.
CREATE INDEX "order_status_idx" ON "order"("status");
