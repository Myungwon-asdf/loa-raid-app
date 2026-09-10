-- Additive upgrade for the existing login-free collaborative dashboard.
-- No authorization is introduced here. All RPCs retain caller privileges.
create function public.loa_week(at_time timestamptz default now()) returns date
language sql stable security invoker set search_path = '' as $$
  select (date_trunc('week', (at_time at time zone 'Asia/Seoul') - interval '2 days 6 hours') + interval '2 days')::date;
$$;

alter table public.characters
  add column api_synced_at timestamptz,
  add column raid_week date not null default public.loa_week();

create unique index characters_name_normalized_key on public.characters (lower(btrim(name))) where name is not null;
alter table public.characters add constraint characters_valid_profile
  check (name is not null and length(btrim(name)) between 1 and 32 and (item_level is null or item_level >= 0)) not valid;
alter table public.characters validate constraint characters_valid_profile;
alter table public.raid_master add constraint raid_master_valid_fields
  check (name is not null and length(btrim(name)) > 0 and req_level > 0) not valid;
alter table public.raid_master validate constraint raid_master_valid_fields;

-- Snapshot includes names/levels/raid definitions so later edits/deletions do not rewrite history.
create table public.character_raid_weeks (
  character_id text not null,
  week_start date not null,
  character_snapshot jsonb not null,
  raid_snapshot jsonb not null,
  saved_at timestamptz not null default now(),
  primary key (week_start, character_id)
);
alter table public.character_raid_weeks enable row level security;
-- Explicitly preserve the requested login-free collaboration model.
create policy shared_history_read on public.character_raid_weeks for select to anon, authenticated using (true);
create policy shared_history_insert on public.character_raid_weeks for insert to anon, authenticated with check (true);
create policy shared_history_update on public.character_raid_weeks for update to anon, authenticated using (true) with check (true);
grant select, insert, update on public.character_raid_weeks to anon, authenticated;
grant all on public.character_raid_weeks to service_role;

create function public.loa_archive_character() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare c public.characters; raids jsonb;
begin
  c := old;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb) into raids from public.raid_master r;
  insert into public.character_raid_weeks(character_id,week_start,character_snapshot,raid_snapshot)
    values(c.id,c.raid_week,to_jsonb(c),raids)
    on conflict(week_start,character_id) do update
      set character_snapshot=excluded.character_snapshot, raid_snapshot=excluded.raid_snapshot, saved_at=now();
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
-- Archive only when leaving a week or deleting a character, avoiding writes on every profile update.
create trigger loa_archive_week before update of raid_week on public.characters
  for each row when(old.raid_week is distinct from new.raid_week) execute function public.loa_archive_character();
create trigger loa_archive_deleted_character before delete on public.characters
  for each row execute function public.loa_archive_character();

-- Preserve the undated legacy records as the migration week's initial snapshot.
insert into public.character_raid_weeks(character_id,week_start,character_snapshot,raid_snapshot)
select c.id,c.raid_week,to_jsonb(c),
  (select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.raid_master r)
from public.characters c;

create function public.loa_dashboard(p_week date default null) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare w date := public.loa_week(); chars jsonb; raids jsonb; weeks jsonb;
begin
  if p_week is not null and p_week > w then raise exception '미래 주차는 조회할 수 없습니다.'; end if;
  -- Lock consistently so parallel reconnects/rollovers cannot archive the same row out of order.
  perform id from public.characters where raid_week < w order by id for update;
  update public.characters set completed_raids='{}',raid_week=w where raid_week < w;
  if p_week is null or p_week = w then
    select coalesce(jsonb_agg(to_jsonb(c) order by c.order_idx,c.id),'[]'::jsonb) into chars from public.characters c;
    select coalesce(jsonb_agg(to_jsonb(r) order by r.req_level desc,r.id),'[]'::jsonb) into raids from public.raid_master r;
  else
    select coalesce(jsonb_agg(character_snapshot order by (character_snapshot->>'order_idx')::int,character_id),'[]'::jsonb)
      into chars from public.character_raid_weeks where week_start=p_week;
    select coalesce(jsonb_agg(x.r),'[]'::jsonb) into raids from (
      select distinct on (r->>'id') r from public.character_raid_weeks h
      cross join lateral jsonb_array_elements(h.raid_snapshot) r where h.week_start=p_week
      order by r->>'id',h.saved_at desc
    ) x;
  end if;
  select jsonb_agg(x.week_start order by x.week_start desc) into weeks from (
    select distinct week_start from public.character_raid_weeks union select w
  ) x;
  return jsonb_build_object('current_week',w,'selected_week',coalesce(p_week,w),'weeks',weeks,'characters',chars,'raids',raids);
end;
$$;

create function public.loa_set_raid(p_character_id text,p_raid_id text,p_done boolean,p_week date) returns public.characters
language plpgsql security invoker set search_path = '' as $$
declare c public.characters; r public.raid_master; ids text[];
begin
  if p_week is distinct from public.loa_week() or p_done is null then raise exception '주차가 변경되었습니다. 새로고침 후 다시 시도해주세요.'; end if;
  select * into strict c from public.characters where id=p_character_id for update;
  select * into strict r from public.raid_master where id=p_raid_id;
  if coalesce(c.item_level,0) < r.req_level then raise exception '입장 레벨이 부족합니다.'; end if;
  if c.raid_week <> p_week then
    update public.characters set raid_week=p_week,completed_raids='{}' where id=c.id returning * into c;
  end if;
  ids := coalesce(c.completed_raids,'{}');
  if p_done then
    select coalesce(array_agg(u.raid_id),'{}') into ids from unnest(ids) u(raid_id)
      where not exists (select 1 from public.raid_master m where m.id=u.raid_id and coalesce(m.raid_group,m.name)=coalesce(r.raid_group,r.name));
    ids := array_append(ids,p_raid_id);
  else ids := array_remove(ids,p_raid_id);
  end if;
  update public.characters set completed_raids=ids where id=c.id returning * into c;
  return c;
end;
$$;

create function public.loa_reorder(p_owner text,p_expected text[],p_ids text[]) returns void
language plpgsql security invoker set search_path = '' as $$
declare actual text[];
begin
  perform id from public.characters where owner=p_owner order by id for update;
  select array_agg(id order by order_idx,id) into actual from public.characters where owner=p_owner;
  if actual is distinct from p_expected or p_ids is null or cardinality(p_ids) <> cardinality(actual)
    or (select count(distinct x) from unnest(p_ids) x) <> cardinality(actual)
    or not (p_ids @> actual and actual @> p_ids) then
    raise exception '캐릭터 목록 또는 순서가 변경되었습니다. 다시 시도해주세요.';
  end if;
  update public.characters c set order_idx=x.pos-1 from unnest(p_ids) with ordinality x(id,pos)
    where c.id=x.id and c.order_idx is distinct from x.pos-1;
end;
$$;

create function public.loa_reset_week(p_owner text,p_week date) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if p_week is distinct from public.loa_week() then raise exception '주차가 변경되었습니다. 새로고침해주세요.'; end if;
  perform id from public.characters where owner=p_owner order by id for update;
  update public.characters set completed_raids='{}',raid_week=p_week where owner=p_owner;
end;
$$;

-- Delete a raid and remove its current references atomically. Historical snapshots are retained.
create function public.loa_delete_raid(p_id text) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  perform id from public.characters where p_id=any(completed_raids) order by id for update;
  update public.characters set completed_raids=array_remove(completed_raids,p_id) where p_id=any(completed_raids);
  delete from public.raid_master where id=p_id;
  if not found then raise exception '레이드가 이미 삭제되었습니다.'; end if;
end;
$$;

revoke all on function public.loa_week(timestamptz),public.loa_dashboard(date),public.loa_set_raid(text,text,boolean,date),
  public.loa_reorder(text,text[],text[]),public.loa_reset_week(text,date),public.loa_delete_raid(text),public.loa_archive_character() from public;
grant execute on function public.loa_week(timestamptz),public.loa_dashboard(date),public.loa_set_raid(text,text,boolean,date),
  public.loa_reorder(text,text[],text[]),public.loa_reset_week(text,date),public.loa_delete_raid(text) to anon,authenticated,service_role;
