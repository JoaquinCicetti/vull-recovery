-- Public reviews (ADR 0018): the survey ends with an optional rating (1–5 stars)
-- and a public comment. A comment is shown on the home page only after an admin
-- approves it, with the client's first name and nothing else about them.

alter table public.session_surveys
  add column rating              smallint check (rating between 1 and 5),
  add column public_comment      text check (char_length(public_comment) between 1 and 600),
  -- null: no comment. pending → approved | hidden (admin, either way, any time).
  add column review_status       text check (review_status in ('pending', 'approved', 'hidden')),
  -- First approval. Kept when hidden and approved again, so the order is stable.
  add column review_published_at timestamptz,
  add constraint session_surveys_review check (
    (public_comment is null or rating is not null)
    and ((review_status is null) = (public_comment is null))
    and (review_status is distinct from 'approved' or review_published_at is not null)
  );

-- The home page reads approved reviews newest first, by keyset.
create index session_surveys_reviews_idx
  on public.session_surveys (review_published_at desc, id desc)
  where review_status = 'approved';

-- ─── client: submit (once), now with the optional review ────────────────────
create or replace function public.submit_session_survey(p_booking uuid, p_answers jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  b         record;
  v_id      uuid;
  v_name    text;
  v_starts  timestamptz;
  a         jsonb := coalesce(p_answers, '{}'::jsonb);
  v_best    text[];
  v_comment text := nullif(btrim(a->>'public_comment'), '');
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
    valued, improve, nps,
    rating, public_comment, review_status
  ) values (
    p_booking, b.user_id, b.sector_id, b.service_id, now(),
    (a->>'age')::smallint, nullif(btrim(a->>'sport'), ''), a->>'level', (a->>'training_days')::smallint,
    (a->>'pre_fatigue')::smallint, (a->>'pre_soreness')::smallint, (a->>'pre_tiredness')::smallint,
    (a->>'pre_recovery')::smallint, (a->>'pre_sleep')::smallint,
    (a->>'post_overall')::smallint, a->>'tension_relief', a->>'mobility_gain',
    v_best, nullif(btrim(a->>'best_station_other'), ''), (a->>'experience')::smallint,
    nullif(btrim(a->>'valued'), ''), nullif(btrim(a->>'improve'), ''), (a->>'nps')::smallint,
    (a->>'rating')::smallint, v_comment, case when v_comment is not null then 'pending' end
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
    valued = excluded.valued, improve = excluded.improve, nps = excluded.nps,
    rating = excluded.rating, public_comment = excluded.public_comment,
    review_status = excluded.review_status
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
      'starts_at', v_starts,
      'review_pending', v_comment is not null
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

-- ─── admin: approve / hide a public comment ─────────────────────────────────
create or replace function public.admin_set_review_status(p_survey uuid, p_status text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('approved', 'hidden') then
    raise exception 'Estado inválido.' using errcode = 'P0001';
  end if;
  update public.session_surveys
     set review_status = p_status,
         review_published_at = case when p_status = 'approved'
                                    then coalesce(review_published_at, now())
                                    else review_published_at end
   where id = p_survey and public_comment is not null;
  if not found then
    raise exception 'Esta encuesta no tiene un comentario público.' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function public.admin_set_review_status(uuid, text) from public, anon;
grant execute on function public.admin_set_review_status(uuid, text) to authenticated;

-- ─── public: approved reviews, newest first ─────────────────────────────────
-- The only way anyone but the author and the admins reads a survey. It exposes
-- the first name, the rating, the comment and the plan; avatar_seed is the
-- profile id, which draws the same generated avatar the client sees in their
-- account. Keyset: pass the last row's (published_at, id) to get the next page.
create or replace function public.public_reviews(
  p_limit     int default 5,
  p_before    timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid, first_name text, avatar_seed uuid, rating smallint,
  comment text, service text, published_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select s.id,
         nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), ''),
         s.user_id, s.rating, s.public_comment, sv.name, s.review_published_at
    from public.session_surveys s
    join public.profiles p on p.id = s.user_id
    left join public.services sv on sv.id = s.service_id
   where s.review_status = 'approved'
     and (p_before is null
          or (s.review_published_at, s.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by s.review_published_at desc, s.id desc
   limit least(greatest(coalesce(p_limit, 5), 1), 20);
$$;
revoke execute on function public.public_reviews(int, timestamptz, uuid) from public;
grant execute on function public.public_reviews(int, timestamptz, uuid) to anon, authenticated;
