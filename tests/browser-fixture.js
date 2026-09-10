// Loaded ONLY by scripts/dev-server.js --fixtures. No remote data access.
(() => {
  const fail=new URL(location.href).searchParams.has('fail');
  const records=[{id:'c1',owner:'아리',name:'테스트바드',class_name:'바드',item_level:1750,order_idx:0,completed_raids:[],api_synced_at:null},
    {id:'c2',owner:'아리',name:'테스트워로드',class_name:'워로드',item_level:1700,order_idx:1,completed_raids:['normal'],api_synced_at:'2026-09-10T12:00:00Z'}];
  const raids=[{id:'normal',raid_group:'테스트 레이드',name:'테스트 노말',req_level:1600},{id:'hard',raid_group:'테스트 레이드',name:'테스트 하드',req_level:1700},{id:'other',raid_group:'다른 레이드',name:'다른 레이드',req_level:1600}];
  window.supabase={createClient(){return {
    rpc(name,args){return {async abortSignal(){
      await new Promise(r=>setTimeout(r,60));
      if(name==='loa_dashboard') return {data:{characters:structuredClone(records),raids,current_week:'2026-09-09',selected_week:args.p_week||'2026-09-09',weeks:['2026-09-09','2026-09-02']}};
      if(fail) return {error:{message:'테스트 저장 실패'}};
      if(name==='loa_set_raid') {
        const c=records.find(c=>c.id===args.p_character_id);
        if(args.p_done){if(['normal','hard'].includes(args.p_raid_id))c.completed_raids=c.completed_raids.filter(x=>!['normal','hard'].includes(x));c.completed_raids=[...new Set([...c.completed_raids,args.p_raid_id])];}
        else c.completed_raids=c.completed_raids.filter(x=>x!==args.p_raid_id);
        return {data:structuredClone(c)};
      }
      if(name==='loa_reorder'){args.p_ids.forEach((id,i)=>records.find(c=>c.id===id).order_idx=i);records.sort((a,b)=>a.order_idx-b.order_idx);return {data:null};}
      return {data:null};
    }};},
    channel(){return {on(){return this;},subscribe(callback){callback('SUBSCRIBED');return this;}};},
    removeChannel:async()=>{}
  };}};
  const original=window.fetch.bind(window);
  window.fetch=async(url,options)=>{
    if(url!=='/api/lostark-sync') return original(url,options);
    const body=JSON.parse(options.body);
    if(fail) return new Response(JSON.stringify({status:'ERROR',message:'테스트 API 실패'}),{status:502});
    const profile={name:body.characterName,class_name:'바드',item_level:1750,gem_summary:'8레벨 11개',api_synced_at:new Date().toISOString()};
    if(body.action==='preview')return new Response(JSON.stringify({status:'OK',profile}));
    const c=records.find(c=>c.id===body.characterId);Object.assign(c,profile);
    return new Response(JSON.stringify({status:'OK',character:c}));
  };
})();
