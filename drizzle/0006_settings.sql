CREATE TABLE user_settings (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  about_you text NOT NULL DEFAULT '' CHECK (length(about_you) <= 2000),
  response_instructions text NOT NULL DEFAULT '' CHECK (length(response_instructions) <= 2000)
);
