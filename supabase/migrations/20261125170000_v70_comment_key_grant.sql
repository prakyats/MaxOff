-- v7.0 unit 2, a fix to migration v70_request_keys (expand-only): task_comments grants INSERT column by
-- column (tasks_schema: task_id, body, on_behalf_of), so the new request_key column was refused to
-- members and every keyed comment failed (CI 45625411243: the chat specs). The member may now send it;
-- RLS and the comment's own checks are unchanged. clients and client_contacts grant INSERT on the whole
-- table, so their request_key needed nothing.
grant insert (request_key) on public.task_comments to authenticated;
