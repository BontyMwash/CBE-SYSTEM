-- ============================================================
-- Migration 032 — Multi-level access checkboxes for Admin/Teacher
-- ============================================================
-- Super Admin can assign any combination of Primary, Junior Secondary,
-- and Senior School to an Admin or Teacher. Admin can assign any
-- combination to Teachers. Empty = unrestricted.
-- ============================================================

alter table profiles add column if not exists section_scopes text[];

update profiles
set section_scopes = array[section_scope]
where section_scopes is null and section_scope is not null;

alter table profiles drop constraint if exists profiles_section_scopes_check;
alter table profiles add constraint profiles_section_scopes_check
  check (section_scopes is null or section_scopes <@ array['primary','junior-secondary','senior-school']::text[]);

comment on column profiles.section_scopes is
  'Level access assigned to an Admin/Teacher. NULL or empty = unrestricted. Values: primary, junior-secondary, senior-school.';

create or replace function public.profile_section_access()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(nullif(section_scopes, '{}'::text[]),
    case when section_scope is null then null else array[section_scope] end)
  from profiles where id = auth.uid();
$$;

create or replace function public.profile_has_section(band text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    coalesce(array_length(profile_section_access(), 1), 0) = 0
    or band = any(profile_section_access())
    or (band in ('lower-primary','upper-primary') and 'primary' = any(profile_section_access()));
$$;

create or replace function public.admin_class_allowed(klass text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    app_current_role() <> 'admin'
    or coalesce(array_length(profile_section_access(), 1), 0) = 0
    or class_section(klass) is null
    or profile_has_section(class_section(klass));
$$;

create or replace function public.teacher_has_subject(subj uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists(select 1 from teacher_subjects where teacher_id = auth.uid() and subject_id = subj)
    or exists(
      select 1 from subjects s
      where s.id = subj
        and exists (
          select 1 from unnest(coalesce(profile_section_access(), array[]::text[])) scope
          where section_scope_overlaps(coalesce(s.section, ''), scope)
        )
    );
$$;

create or replace function public.teacher_has_class(cls uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists(select 1 from teacher_classes where teacher_id = auth.uid() and class_id = cls)
    or exists(
      select 1 from classes c
      where c.id = cls
        and class_section(c.name) is not null
        and exists (
          select 1 from unnest(coalesce(profile_section_access(), array[]::text[])) scope
          where section_scope_covers(scope, class_section(c.name))
        )
    );
$$;

create or replace function public.admin_section_scope()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(section_scopes[1], section_scope)
  from profiles where id = auth.uid();
$$;

create or replace function public.teacher_is_class_teacher(cls uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    exists(select 1 from classes where id = cls and class_teacher_id = auth.uid())
    or (
      coalesce(array_length(profile_section_access(), 1), 0) > 0
      and exists(
        select 1 from classes c
        where c.id = cls
          and class_section(c.name) is not null
          and profile_has_section(class_section(c.name))
      )
    );
$$;

create or replace function public.teacher_teaches_subject_in_klass(subj uuid, klass_label text, sch uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    exists (
      select 1 from teacher_subject_classes tsc
      join classes c on c.id = tsc.class_id
      where tsc.teacher_id = auth.uid()
        and tsc.subject_id = subj
        and c.school_id = sch
        and (case when c.stream <> '' then c.name || ' ' || c.stream else c.name end) = klass_label
    )
    or (
      coalesce(array_length(profile_section_access(), 1), 0) > 0
      and class_section(klass_label) is not null
      and profile_has_section(class_section(klass_label))
      and exists (
        select 1 from subjects s
        where s.id = subj and s.school_id = sch
          and exists (
            select 1 from unnest(profile_section_access()) scope
            where section_scope_overlaps(coalesce(s.section, ''), scope)
          )
      )
    );
$$;

create or replace function public.teacher_teaches_subject_for_student(subj uuid, stud uuid, sch uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from students st
    where st.id = stud and st.school_id = sch
      and teacher_teaches_subject_in_klass(subj, st.klass, sch)
  );
$$;
