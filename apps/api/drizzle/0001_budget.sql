CREATE TABLE "spendings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"category_id" uuid,
	"date" date NOT NULL,
	"amount_kop" bigint NOT NULL,
	"note" text,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "living_expenses" ADD COLUMN "essential" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "living_expenses" ADD COLUMN "group" text;--> statement-breakpoint
ALTER TABLE "living_expenses" ADD COLUMN "catalog_key" text;--> statement-breakpoint
ALTER TABLE "living_expenses" ADD COLUMN "sort" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ui_mode" text DEFAULT 'simple' NOT NULL;--> statement-breakpoint
ALTER TABLE "spendings" ADD CONSTRAINT "spendings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spendings" ADD CONSTRAINT "spendings_category_id_living_expenses_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."living_expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spendings" ADD CONSTRAINT "spendings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spendings_household_date" ON "spendings" USING btree ("household_id","date");