CREATE TABLE "pending_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"monitor_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" bigint DEFAULT extract(epoch from now())::bigint NOT NULL,
	"delivered_at" bigint
);
--> statement-breakpoint
ALTER TABLE "pending_events" ADD CONSTRAINT "pending_events_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_pending_events_status" ON "pending_events" USING btree ("status");