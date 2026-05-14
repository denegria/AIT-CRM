ALTER TABLE "work_orders" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "estimated_cost" numeric(12, 2);