ALTER TABLE "living_expenses" ADD COLUMN "auto_pay_day" integer;--> statement-breakpoint
ALTER TABLE "living_expenses" ADD COLUMN "auto_pay_last_month" text;--> statement-breakpoint
ALTER TABLE "spendings" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;