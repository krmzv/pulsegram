CREATE TABLE "heartbeats" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"monitor_id" text NOT NULL,
	"status" text NOT NULL,
	"status_code" integer,
	"response_ms" integer,
	"message" text,
	"created_at" bigint DEFAULT extract(epoch from now())::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"monitor_id" text NOT NULL,
	"started_at" bigint NOT NULL,
	"ended_at" bigint,
	"cause" text
);
--> statement-breakpoint
CREATE TABLE "monitors" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"url" text NOT NULL,
	"name" text,
	"method" text DEFAULT 'GET' NOT NULL,
	"interval_sec" integer DEFAULT 60 NOT NULL,
	"timeout_ms" integer DEFAULT 5000 NOT NULL,
	"retries" integer DEFAULT 2 NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"last_check_at" bigint,
	"last_response_ms" integer,
	"is_public" integer DEFAULT 1 NOT NULL,
	"is_paused" integer DEFAULT 0 NOT NULL,
	"muted_until" bigint,
	"created_at" bigint DEFAULT extract(epoch from now())::bigint NOT NULL,
	"updated_at" bigint DEFAULT extract(epoch from now())::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ssl_info" (
	"monitor_id" text PRIMARY KEY NOT NULL,
	"issuer" text,
	"valid_from" bigint,
	"valid_to" bigint,
	"days_remaining" integer,
	"checked_at" bigint
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"telegram_id" text,
	"email" text,
	"plan" text DEFAULT 'free' NOT NULL,
	"status_slug" text,
	"created_at" bigint DEFAULT extract(epoch from now())::bigint NOT NULL,
	"updated_at" bigint DEFAULT extract(epoch from now())::bigint NOT NULL,
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_status_slug_unique" UNIQUE("status_slug")
);
--> statement-breakpoint
ALTER TABLE "heartbeats" ADD CONSTRAINT "heartbeats_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssl_info" ADD CONSTRAINT "ssl_info_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_heartbeats_monitor_time" ON "heartbeats" USING btree ("monitor_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_incidents_monitor" ON "incidents" USING btree ("monitor_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_monitors_user" ON "monitors" USING btree ("user_id");