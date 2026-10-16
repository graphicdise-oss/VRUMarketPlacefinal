-- §116: when the scheduled sweep last ran, so the next run can tell the system was down in between
-- and pause every running deadline for that long.
CREATE TABLE "sweep_heartbeat" (
    "id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "last_run_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sweep_heartbeat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sweep_heartbeat_name_key" ON "sweep_heartbeat"("name");
