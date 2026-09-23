CREATE TABLE "platform_roles" (
	"code" text PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_roles_code_format" CHECK ("platform_roles"."code" ~ '^[a-z][a-z_]{0,63}$'),
	CONSTRAINT "platform_roles_name_en_length" CHECK (char_length("platform_roles"."name_en") BETWEEN 1 AND 255)
);
