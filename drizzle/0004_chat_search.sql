CREATE INDEX chat_title_search_idx ON chat USING gin (to_tsvector('english', coalesce(title, '')));
CREATE INDEX message_text_search_idx ON message USING gin (jsonb_to_tsvector('english', jsonb_path_query_array(parts, '$[*] ? (@.type == "text").text'), '["string"]'));
