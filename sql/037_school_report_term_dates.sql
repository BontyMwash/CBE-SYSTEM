-- Run once in Supabase SQL Editor before saving term dates in Settings.
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS closing_date date,
  ADD COLUMN IF NOT EXISTS opening_date date;
