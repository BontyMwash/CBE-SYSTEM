-- 014_lock_published_sittings.sql
-- B~CBE Analytics (c) — see /LICENSE and Terms & Copyright in-app.
--
-- Server-side enforcement of "once published, an exam sitting is
-- locked": the client (js/views.js -> Views.results) already disables
-- the marks-entry UI for a published klass/type/term/year, but that's
-- only a UI nicety. This trigger is the real guard — it rejects any
-- insert/update/delete on `results`, and any update/delete on `exams`
-- (including changing total_marks), for a sitting that currently has
-- a matching row in `published_results`. An admin must unpublish the
-- sitting first (Analysis page) before further changes are possible.

create or replace function reject_if_sitting_published() returns trigger as $$
declare
  v_exam record;
  v_locked boolean;
begin
  -- Figure out which exam row is in play, and thus which klass/type/term/year
  if tg_table_name = 'results' then
    select * into v_exam from exams where id = coalesce(new.exam_id, old.exam_id);
  else
    v_exam := coalesce(new, old);
  end if;

  if v_exam is null then
    return coalesce(new, old);
  end if;

  select exists (
    select 1 from published_results pr
    where pr.school_id = v_exam.school_id
      and pr.klass = v_exam.klass
      and pr.type = v_exam.type
      and pr.term = v_exam.term
      and pr.year = v_exam.year
  ) into v_locked;

  if v_locked then
    raise exception 'This sitting (% % % %) is published and locked. Unpublish it first to make changes.', v_exam.klass, v_exam.type, v_exam.term, v_exam.year
      using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$$ language plpgsql security definer;

drop trigger if exists trg_results_lock_published on results;
create trigger trg_results_lock_published
  before insert or update or delete on results
  for each row execute function reject_if_sitting_published();

drop trigger if exists trg_exams_lock_published on exams;
create trigger trg_exams_lock_published
  before update or delete on exams
  for each row execute function reject_if_sitting_published();
