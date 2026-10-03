-- Custom SQL migration file, put your code below! --
INSERT INTO permissions (code) VALUES ('manage:discounts:company') ON CONFLICT DO NOTHING;
