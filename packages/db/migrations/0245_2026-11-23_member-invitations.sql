CREATE TABLE "member_invitations" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"email_hash" text NOT NULL,
	"user_id" uuid,
	"membership_id" uuid,
	"role_code" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"invited_by" uuid NOT NULL,
	"state" text NOT NULL,
	"link_issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_invitations_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "member_invitations_company_id_email_hash_key" UNIQUE("company_id","email_hash"),
	CONSTRAINT "member_invitations_state" CHECK ("member_invitations"."state" IN ('PENDING', 'ACTIVE', 'CANCELLED')),
	CONSTRAINT "member_invitations_scope_type" CHECK ("member_invitations"."scope_type" IN ('COMPANY', 'BUSINESS', 'BRANCH')),
	CONSTRAINT "member_invitations_email_hash_length" CHECK (char_length("member_invitations"."email_hash") BETWEEN 40 AND 64)
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "invited_by_company_id" uuid;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "invitation_operation_id" uuid;--> statement-breakpoint
ALTER TABLE "member_invitations" ADD CONSTRAINT "member_invitations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_invitations" ADD CONSTRAINT "member_invitations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_invitations" ADD CONSTRAINT "member_invitations_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_invitations" ADD CONSTRAINT "member_invitations_membership_fk" FOREIGN KEY ("company_id","membership_id") REFERENCES "public"."memberships"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_invitations_company_id_state_idx" ON "member_invitations" USING btree ("company_id","state");--> statement-breakpoint
CREATE INDEX "member_invitations_company_id_user_id_idx" ON "member_invitations" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_invitation_operation_id_key" ON "user" USING btree ("invitation_operation_id");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_invitation_marker" CHECK (num_nonnulls("user"."invited_by_company_id", "user"."invitation_operation_id") <> 1);