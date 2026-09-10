-- Run inside BEGIN / ROLLBACK; all IDs are temporary and no user rows are changed.
do $$
declare id1 text:=gen_random_uuid()::text; id2 text:=gen_random_uuid()::text;
  raid1 text:=gen_random_uuid()::text; raid2 text:=gen_random_uuid()::text; raid3 text:=gen_random_uuid()::text;
  test_owner text:='test-'||gen_random_uuid(); c public.characters; w date:=public.loa_week(); failed boolean;
begin
  if public.loa_week('2026-09-08 20:59:59+00') <> date '2026-09-02' or public.loa_week('2026-09-08 21:00:00+00') <> date '2026-09-09' then raise exception 'week boundary failed'; end if;
  insert into public.raid_master(id,raid_group,name,req_level) values(raid1,test_owner,'normal',1),(raid2,test_owner,'hard',2),(raid3,test_owner||'2','other',1);
  insert into public.characters(id,owner,name,item_level,order_idx) values(id1,test_owner,left(id1,32),3,0),(id2,test_owner,left(id2,32),3,1);
  perform public.loa_set_raid(id1,raid1,true,w);
  c:=public.loa_set_raid(id1,raid3,true,w);
  if not (c.completed_raids @> array[raid1,raid3]) then raise exception 'independent changes lost'; end if;
  c:=public.loa_set_raid(id1,raid2,true,w);
  if raid1=any(c.completed_raids) or not (c.completed_raids @> array[raid2,raid3]) then raise exception 'group replacement failed'; end if;
  c:=public.loa_set_raid(id1,raid2,true,w);
  if cardinality(c.completed_raids) <> 2 then raise exception 'retry not idempotent'; end if;
  failed:=false;
  begin perform public.loa_set_raid(id1,raid1,true,w-7); exception when others then failed:=true; end;
  if not failed then raise exception 'stale week was accepted'; end if;
  perform public.loa_reorder(test_owner,array[id1,id2],array[id2,id1]);
  failed:=false;
  begin perform public.loa_reorder(test_owner,array[id1,id2],array[id2,id1]); exception when others then failed:=true; end;
  if not failed then raise exception 'stale order was accepted'; end if;
  -- Simulate an old week; changing the week snapshots the previous state.
  update public.characters set raid_week=w-7 where id=id1;
  perform public.loa_dashboard();
  select * into strict c from public.characters where id=id1;
  if c.raid_week<>w or cardinality(c.completed_raids)<>0 then raise exception 'rollover failed'; end if;
  if not exists(select 1 from public.character_raid_weeks where character_id=id1 and week_start=w-7 and character_snapshot->'completed_raids' @> to_jsonb(array[raid2,raid3])) then raise exception 'history lost'; end if;
  perform public.loa_set_raid(id2,raid1,true,w);
  perform public.loa_delete_raid(raid1);
  if exists(select 1 from public.characters where id=id2 and raid1=any(completed_raids)) then raise exception 'dangling raid'; end if;
  delete from public.characters where id in(id1,id2);
  if not exists(select 1 from public.character_raid_weeks where character_id=id2 and week_start=w) then raise exception 'deleted character history lost'; end if;
end;
$$;
