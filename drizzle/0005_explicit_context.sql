-- Explicit memory and project context. Temporary chat has no content table.
CREATE TABLE public.project (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  instructions text NOT NULL CHECK (length(instructions) <= 2000 AND octet_length(instructions) <= 3000),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(id,user_id)
);
CREATE TABLE public.memory (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  project_id text,
  content text NOT NULL CHECK (length(content) BETWEEN 1 AND 1000 AND octet_length(content) <= 1800),
  updated_at timestamp NOT NULL DEFAULT now(),
  FOREIGN KEY(project_id,user_id) REFERENCES public.project(id,user_id) ON DELETE CASCADE
);
ALTER TABLE public.chat ADD COLUMN project_id text;
ALTER TABLE public.chat ADD CONSTRAINT chat_owned_project_fk
  FOREIGN KEY(project_id,user_id) REFERENCES public.project(id,user_id);
-- Clear grouping before deleting a project; delete project-scoped memories.
CREATE FUNCTION public.ungroup_deleted_project() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.chat SET project_id=NULL WHERE project_id=OLD.id AND user_id=OLD.user_id;
  RETURN OLD;
END $$;
CREATE TRIGGER project_ungroup BEFORE DELETE ON public.project
FOR EACH ROW EXECUTE FUNCTION public.ungroup_deleted_project();
CREATE INDEX project_owner_idx ON public.project(user_id);
CREATE INDEX memory_owner_idx ON public.memory(user_id,project_id);
CREATE INDEX chat_project_idx ON public.chat(user_id,project_id);
DO $$
DECLARE table_name text; role_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['project','memory'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',table_name);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',table_name,role_name);
      END IF;
    END LOOP;
  END LOOP;
END $$;
