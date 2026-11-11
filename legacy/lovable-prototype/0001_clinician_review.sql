CREATE TYPE public.app_role AS ENUM ('admin', 'reviewer');
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE TABLE public.mission_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id text NOT NULL,
  content_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('approved', 'changes_requested')),
  reviewer_id uuid NOT NULL,
  reviewer_name text NOT NULL,
  reviewer_credentials text NOT NULL,
  scenario_ok boolean NOT NULL DEFAULT false,
  treatment_ok boolean NOT NULL DEFAULT false,
  references_ok boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.mission_reviews (mission_id, created_at DESC);
GRANT SELECT ON public.mission_reviews TO anon;
GRANT SELECT, INSERT ON public.mission_reviews TO authenticated;
GRANT ALL ON public.mission_reviews TO service_role;
ALTER TABLE public.mission_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public reads approved" ON public.mission_reviews FOR SELECT TO anon, authenticated USING (status = 'approved');
CREATE POLICY "reviewers read all" ON public.mission_reviews FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'reviewer') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "reviewers submit" ON public.mission_reviews FOR INSERT TO authenticated
  WITH CHECK (reviewer_id = auth.uid() AND (public.has_role(auth.uid(), 'reviewer') OR public.has_role(auth.uid(), 'admin'))
    AND (status <> 'approved' OR (scenario_ok AND treatment_ok AND references_ok AND jsonb_array_length(refs) > 0)));