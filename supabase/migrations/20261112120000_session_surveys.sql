-- Post-session surveys (ADR 0017) and "what a plan includes" (stations).
--
-- An admin sends the survey link by hand from a past turno (a wa.me deep link:
-- free, no WhatsApp Business template, no push needed). The client logs in and
-- answers once. One survey per booking; answers are typed columns so the stats
-- are plain SQL. Every write goes through an RPC below.

-- ─── what each plan includes ────────────────────────────────────────────────
-- Shown as pills on the public plan pages (so descriptions can stop listing the
-- whole circuit) and offered as the options of "¿qué parte te resultó más
-- beneficiosa?". Plans differ, so the list is per plan.
alter table public.services
  add column stations      text[]  not null default '{}',
  add column show_stations boolean not null default true;

-- ─── which sectors ask ──────────────────────────────────────────────────────
alter table public.sectors
  add column survey_enabled boolean not null default false;
update public.sectors set survey_enabled = true where slug = 'recovery';

-- ─── the surveys ────────────────────────────────────────────────────────────
create table public.session_surveys (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid not null unique references public.bookings(id) on delete cascade,
  user_id            uuid not null references public.profiles(id) on delete cascade,
  sector_id          uuid references public.sectors(id),
  service_id         uuid references public.services(id) on delete set null,
  -- Sending (admin, by WhatsApp). No sent_by FK: bookings→profiles embeds are
  -- already ambiguous enough.
  sent_at            timestamptz,
  sent_count         int not null default 0,
  submitted_at       timestamptz,
  created_at         timestamptz not null default now(),
  -- 1. Sobre vos (asked every time, prefilled from the last answer)
  age                smallint check (age between 5 and 120),
  sport              text check (char_length(sport) <= 80),
  level              text check (level in ('amateur', 'competitivo', 'profesional')),
  training_days      smallint check (training_days between 0 and 7),
  -- 2. Antes de la sesión (0–10)
  pre_fatigue        smallint check (pre_fatigue   between 0 and 10),
  pre_soreness       smallint check (pre_soreness  between 0 and 10),
  pre_tiredness      smallint check (pre_tiredness between 0 and 10),
  pre_recovery       smallint check (pre_recovery  between 0 and 10),
  pre_sleep          smallint check (pre_sleep     between 0 and 10),
  -- 3. Después de la sesión
  post_overall       smallint check (post_overall between 0 and 10),
  tension_relief     text check (tension_relief in ('si', 'un_poco', 'no')),
  mobility_gain      text check (mobility_gain  in ('si', 'un_poco', 'no')),
  -- Snapshot of the labels picked: renaming a station never rewrites history.
  best_stations      text[] not null default '{}',
  best_station_other text check (char_length(best_station_other) <= 200),
  experience         smallint check (experience between 0 and 10),
  -- 4. Tu opinión
  valued             text check (char_length(valued)  <= 2000),
  improve            text check (char_length(improve) <= 2000),
  nps                smallint check (nps between 0 and 10),
  -- A submitted survey has every required answer.
  constraint session_surveys_complete check (
    submitted_at is null or (
      age is not null and level is not null and training_days is not null
      and pre_fatigue is not null and pre_soreness is not null and pre_tiredness is not null
      and pre_recovery is not null and pre_sleep is not null
      and post_overall is not null and tension_relief is not null and mobility_gain is not null
      and experience is not null and nps is not null
    )
  )
);
create index session_surveys_user_idx on public.session_surveys (user_id, submitted_at desc);
create index session_surveys_sector_idx on public.session_surveys (sector_id, submitted_at desc);

alter table public.session_surveys enable row level security;
create policy session_surveys_select on public.session_surveys
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
-- No insert/update/delete policies: admin_mark_survey_sent / submit_session_survey.

-- ─── eligibility (shared by both RPCs) ──────────────────────────────────────
-- A confirmed turno of a client, already started, in a sector that asks.
create or replace function public.survey_booking(p_booking uuid)
returns table (user_id uuid, sector_id uuid, service_id uuid)
language sql stable security definer set search_path = public
as $$
  select b.user_id, b.sector_id, b.service_id
    from public.bookings b
    join public.sectors s on s.id = b.sector_id
   where b.id = p_booking
     and b.user_id is not null
     and b.status = 'confirmed'
     and b.starts_at <= now()
     and s.survey_enabled;
$$;
revoke execute on function public.survey_booking(uuid) from public, anon, authenticated;

-- ─── admin: "Enviar encuesta por WhatsApp" ──────────────────────────────────
create or replace function public.admin_mark_survey_sent(p_booking uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  b record;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into b from public.survey_booking(p_booking);
  if not found then
    raise exception 'Este turno no admite encuesta.' using errcode = 'P0001';
  end if;
  insert into public.session_surveys (booking_id, user_id, sector_id, service_id, sent_at, sent_count)
  values (p_booking, b.user_id, b.sector_id, b.service_id, now(), 1)
  on conflict (booking_id) do update
     set sent_at = now(), sent_count = public.session_surveys.sent_count + 1
   where public.session_surveys.submitted_at is null;
end;
$$;
revoke execute on function public.admin_mark_survey_sent(uuid) from public, anon;
grant execute on function public.admin_mark_survey_sent(uuid) to authenticated;

-- ─── client: submit (once) ──────────────────────────────────────────────────
create or replace function public.submit_session_survey(p_booking uuid, p_answers jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  b        record;
  v_id     uuid;
  v_name   text;
  v_starts timestamptz;
  a        jsonb := coalesce(p_answers, '{}'::jsonb);
  v_best   text[];
begin
  select * into b from public.survey_booking(p_booking);
  if not found or b.user_id is distinct from auth.uid() then
    raise exception 'Esta encuesta no está disponible.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.session_surveys
              where booking_id = p_booking and submitted_at is not null) then
    raise exception 'Ya respondiste esta encuesta. ¡Gracias!' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(left(btrim(x), 80)) filter (where btrim(x) <> ''), '{}')
    into v_best
    from jsonb_array_elements_text(coalesce(a->'best_stations', '[]'::jsonb)) x;

  insert into public.session_surveys as s (
    booking_id, user_id, sector_id, service_id, submitted_at,
    age, sport, level, training_days,
    pre_fatigue, pre_soreness, pre_tiredness, pre_recovery, pre_sleep,
    post_overall, tension_relief, mobility_gain, best_stations, best_station_other, experience,
    valued, improve, nps
  ) values (
    p_booking, b.user_id, b.sector_id, b.service_id, now(),
    (a->>'age')::smallint, nullif(btrim(a->>'sport'), ''), a->>'level', (a->>'training_days')::smallint,
    (a->>'pre_fatigue')::smallint, (a->>'pre_soreness')::smallint, (a->>'pre_tiredness')::smallint,
    (a->>'pre_recovery')::smallint, (a->>'pre_sleep')::smallint,
    (a->>'post_overall')::smallint, a->>'tension_relief', a->>'mobility_gain',
    v_best, nullif(btrim(a->>'best_station_other'), ''), (a->>'experience')::smallint,
    nullif(btrim(a->>'valued'), ''), nullif(btrim(a->>'improve'), ''), (a->>'nps')::smallint
  )
  on conflict (booking_id) do update set
    submitted_at = excluded.submitted_at,
    age = excluded.age, sport = excluded.sport, level = excluded.level,
    training_days = excluded.training_days,
    pre_fatigue = excluded.pre_fatigue, pre_soreness = excluded.pre_soreness,
    pre_tiredness = excluded.pre_tiredness, pre_recovery = excluded.pre_recovery,
    pre_sleep = excluded.pre_sleep,
    post_overall = excluded.post_overall, tension_relief = excluded.tension_relief,
    mobility_gain = excluded.mobility_gain, best_stations = excluded.best_stations,
    best_station_other = excluded.best_station_other, experience = excluded.experience,
    valued = excluded.valued, improve = excluded.improve, nps = excluded.nps
  where s.submitted_at is null
  returning s.id into v_id;

  if v_id is null then  -- a concurrent submit won
    raise exception 'Ya respondiste esta encuesta. ¡Gracias!' using errcode = 'P0001';
  end if;

  select p.full_name into v_name from public.profiles p where p.id = b.user_id;
  select bk.starts_at into v_starts from public.bookings bk where bk.id = p_booking;
  perform public.emit_notification(
    'survey_submitted', v_id, 'admins', 'client', b.user_id,
    jsonb_build_object(
      'client', v_name,
      'experience', (a->>'experience')::int,
      'nps', (a->>'nps')::int,
      'starts_at', v_starts
    )
  );
  return v_id;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Revisá las respuestas: hay un valor inválido.' using errcode = 'P0001';
  when check_violation then
    raise exception 'Faltan respuestas o hay un valor fuera de rango.' using errcode = 'P0001';
end;
$$;
revoke execute on function public.submit_session_survey(uuid, jsonb) from public, anon;
grant execute on function public.submit_session_survey(uuid, jsonb) to authenticated;

-- ─── admin: stats ───────────────────────────────────────────────────────────
-- Period is [p_from, p_to] on the session date in the sector's timezone.
create or replace function public.admin_survey_stats(p_sector uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_tz  text;
  v_out jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select timezone into v_tz from public.sectors where id = p_sector;

  with s as (
    select ss.*, sv.name as service_name
      from public.session_surveys ss
      join public.bookings b on b.id = ss.booking_id
      left join public.services sv on sv.id = ss.service_id
     where ss.sector_id = p_sector
       and (b.starts_at at time zone coalesce(v_tz, 'UTC'))::date between p_from and p_to
  ), done as (
    select * from s where submitted_at is not null
  )
  select jsonb_build_object(
    'sent',     (select count(*) from s where sent_at is not null),
    'answered', (select count(*) from done),
    'answered_after_send', (select count(*) from done where sent_at is not null),
    'avg', (select jsonb_build_object(
        'pre_fatigue',   round(avg(pre_fatigue), 1),
        'pre_soreness',  round(avg(pre_soreness), 1),
        'pre_tiredness', round(avg(pre_tiredness), 1),
        'pre_recovery',  round(avg(pre_recovery), 1),
        'pre_sleep',     round(avg(pre_sleep), 1),
        'post_overall',  round(avg(post_overall), 1),
        'experience',    round(avg(experience), 1),
        'nps',           round(avg(nps), 1)) from done),
    'nps_score', (select case when count(*) = 0 then null else
        round(100.0 * (count(*) filter (where nps >= 9) - count(*) filter (where nps <= 6)) / count(*))
        end from done),
    'tension', (select jsonb_build_object(
        'si', count(*) filter (where tension_relief = 'si'),
        'un_poco', count(*) filter (where tension_relief = 'un_poco'),
        'no', count(*) filter (where tension_relief = 'no')) from done),
    'mobility', (select jsonb_build_object(
        'si', count(*) filter (where mobility_gain = 'si'),
        'un_poco', count(*) filter (where mobility_gain = 'un_poco'),
        'no', count(*) filter (where mobility_gain = 'no')) from done),
    'stations', coalesce((select jsonb_agg(jsonb_build_object('plan', plan, 'station', station, 'count', n)
                                           order by plan, n desc)
        from (select coalesce(service_name, 'Sin plan') as plan, st as station, count(*) as n
                from done, unnest(best_stations) st
               group by 1, 2) t), '[]'::jsonb),
    'other_stations', (select count(*) from done where best_station_other is not null),
    'by_level', coalesce((select jsonb_agg(jsonb_build_object(
          'level', level, 'count', n, 'experience', exp, 'nps', nps_avg) order by n desc)
        from (select level, count(*) as n, round(avg(experience), 1) as exp, round(avg(nps), 1) as nps_avg
                from done group by level) t), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;
revoke execute on function public.admin_survey_stats(uuid, date, date) from public, anon;
grant execute on function public.admin_survey_stats(uuid, date, date) to authenticated;

-- ─── notifications: new kind ────────────────────────────────────────────────
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'booking_received', 'booking_confirmed', 'booking_cancelled',
  'booking_rescheduled', 'payment_to_verify', 'payment_rejected',
  'pack_purchased', 'membership_paid', 'membership_created_by_admin',
  'membership_cancelled', 'class_moved', 'swap_proposed', 'swap_resolved',
  'admin_alert', 'survey_submitted'));
