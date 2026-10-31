CREATE INDEX chat_title_search_idx ON chat USING gin (to_tsvector('english', coalesce(title, '')));
-- Store the vector once per write, rather than parsing JSON for every search match.
ALTER TABLE message ADD COLUMN search_document tsvector GENERATED ALWAYS AS
  (jsonb_to_tsvector('english', jsonb_path_query_array(parts, '$[*] ? (@.type == "text").text'), '["string"]')) STORED;
CREATE INDEX message_text_search_idx ON message USING gin (search_document);
