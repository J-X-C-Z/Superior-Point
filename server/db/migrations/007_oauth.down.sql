DELETE FROM api_tokens WHERE id IN (SELECT token_id FROM oauth_access_tokens);
DROP TABLE oauth_access_tokens;
DROP TABLE oauth_codes;
DROP TABLE oauth_requests;
DROP TABLE oauth_clients;
