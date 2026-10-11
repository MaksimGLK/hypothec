ALTER TABLE "prepayments" ADD COLUMN "status" text DEFAULT 'planned' NOT NULL;--> statement-breakpoint
ALTER TABLE "prepayments" ADD COLUMN "fact_amount_kop" bigint;--> statement-breakpoint
ALTER TABLE "prepayments" ADD COLUMN "executed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prepayments" ADD COLUMN "confirmed" boolean DEFAULT false NOT NULL;