// Anikoto catalog + MegaPlay embeds. Keep provider IDs separate from episode embed IDs.
const API='https://anikotoapi.site';
const EMBED='https://megaplay.buzz';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const first=(...values)=>values.find(v=>v!==undefined&&v!==null&&v!=='');
const asText=(v)=>typeof v==='string'?v:(v&&typeof v==='object'?first(v.english,v.romaji,v.userPreferred,v.name,v.title,''):'');
const stripHtml=(v)=>String(v||'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'').trim();
const unwrap=payload=>payload?.data??payload;
const validId=value=>{
 const id=String(value??'').trim();
 if(!id||id.length>180||! /^[a-zA-Z0-9_-]+$/.test(id))throw fail(400,'Invalid Anikoto series ID');
 return id;
};
function genreList(a){
 const t=a?.terms_by_type;
 const rows=Array.isArray(t?.genre)?t.genre:Array.isArray(a?.genres)?a.genres:Array.isArray(a?.genre)?a.genre:[];
 return rows.map(x=>typeof x==='string'?x:asText(x)).filter(Boolean);
}
function countEpisodes(value){
 if(typeof value==='number')return value;
 if(Array.isArray(value))return value.length;
 if(value&&typeof value==='object')return Number(first(value.eps,value.sub,value.dub,value.total,0))||0;
 return Number(value)||0;
}
export function normalizeAnime(raw){
 const a=raw?.anime?{...raw,...raw.anime}:(raw||{});
 const id=first(a.id,a.anime_id,a.animeId,a.series_id,a.seriesId,a.slug,a.url);
 const title=first(asText(a.title),asText(a.name),asText(a.english_title),asText(a.japanese_title),asText(a.jname),asText(a.slug),'Untitled');
 const episodes=countEpisodes(first(a.episodes_count,a.total_episodes,a.episode_count,a.episodes,a.episodeCount,0));
 const status=String(first(a.status,a.airing_status,'')).toLowerCase();
 const format=String(first(a.type,a.format,a.show_type,'')).toUpperCase();
 const poster=first(a.poster,a.poster_url,a.posterUrl,a.image,a.image_url,a.cover,a.cover_image,a.coverImage?.extraLarge,a.coverImage?.large,a.thumbnail,a.img,null);
 const year=Number(first(a.year,a.release_year,a.season_year,a.aired?.from?.slice?.(0,4),0))||null;
 return {
  id:id===undefined?null:String(id),title,titleRomaji:first(asText(a.japanese_title),asText(a.jname),null),titleNative:null,
  cover:poster,banner:first(a.banner,a.banner_image,a.bannerImage,poster,null),color:null,
  format:format||null,status:status==='ongoing'?'RELEASING':status==='completed'?'FINISHED':status.toUpperCase()||null,
  episodes,availableEpisodes:episodes,duration:Number(a.duration)||null,score:null,popularity:null,season:null,year,
  genres:genreList(a),nextAiring:null,description:stripHtml(first(a.synopsis,a.description,a.overview,'')),
  studios:[],characters:[],relations:[],recommendations:[],streamingLinks:[],source:null,synonyms:[],trailer:null,startDate:null,endDate:null
 };
}
export async function request(path){
 const response=await fetch(API+path,{headers:{Accept:'application/json'}});
 if(!response.ok)throw fail(response.status===404?404:response.status===429?429:502,'Anikoto API returned HTTP '+response.status);
 const payload=await response.json().catch(()=>null);
 if(!payload||payload.ok===false)throw fail(502,first(payload?.message,payload?.error,'Anikoto returned an invalid response'));
 return payload;
}
export async function getRecentAnime({page=1,perPage=20}={}){
 const payload=await request('/recent-anime?'+new URLSearchParams({page:String(page),per_page:String(perPage)}));
 const rows=unwrap(payload);
 const list=Array.isArray(rows)?rows:Array.isArray(rows?.anime)?rows.anime:Array.isArray(rows?.results)?rows.results:Array.isArray(rows?.items)?rows.items:[];
 return {results:list.map(normalizeAnime).filter(x=>x?.id),pagination:payload.pagination??rows?.pagination??payload.meta??{},ok:payload.ok??true};
}
const seriesCache=new Map();
export async function getSeries(rawId){
 const id=validId(rawId);
 const cached=seriesCache.get(id);
 if(cached&&cached.expires>Date.now())return cached.value;
 const pending=(async()=>{
  const payload=await request('/series/'+encodeURIComponent(id));
  const data=unwrap(payload);
  const animeRaw=data?.anime?{...data,...data.anime}:(data?.series??data?.meta??data);
  const anime=normalizeAnime(animeRaw);
  if(!anime?.id)anime.id=id;
  if(!anime.title||anime.title==='Untitled')anime.title=String(first(data?.title,animeRaw?.name,id));
  const rawEpisodes=Array.isArray(data?.episodes)?data.episodes:Array.isArray(data?.data?.episodes)?data.data.episodes:[];
  const episodes=rawEpisodes.map((e,i)=>{
   const embed=e?.embed_url??e?.embedUrl??{};
   const embedId=String(first(e?.episode_embed_id,e?.embed_id,e?.stream_id,''));
   const number=Number(first(e?.number,e?.episode,e?.episode_number,e?.episode_no,i+1))||i+1;
   const sub=first(embed?.sub,typeof embed==='string'?embed:null,e?.sub_url);
   const dub=first(embed?.dub,e?.dub_url);
   const embedIdFromUrl=raw=>{
    try{const u=new URL(raw);return u.hostname==='megaplay.buzz'?u.pathname.match(/\/stream\/s-2\/([^/]+)/)?.[1]||'':'';}catch{return '';}
   };
   const episodeEmbedId=embedId||embedIdFromUrl(sub)||embedIdFromUrl(dub);
   const safeUrl=raw=>{
    if(typeof raw!=='string')return null;
    try{const u=new URL(raw);return u.protocol==='https:'&&(u.hostname==='megaplay.buzz'||u.hostname.endsWith('.megaplay.buzz'))?u.toString():null;}catch{return null;}
   };
   return {id:id+':'+(episodeEmbedId||number),number,title:String(first(e?.title,e?.name,'Episode '+number)),isFiller:false,
    embedId:episodeEmbedId,embedSub:safeUrl(sub),embedDub:safeUrl(dub),
    hasSub:!!(safeUrl(sub)||episodeEmbedId),hasDub:!!safeUrl(dub)};
  }).sort((a,b)=>a.number-b.number);
  anime.episodes=episodes.length;
  anime.availableEpisodes=episodes.length;
  return {anime,episodes};
 })();
 seriesCache.set(id,{value:pending,expires:Date.now()+300000});
 try{const value=await pending;seriesCache.set(id,{value,expires:Date.now()+300000});return value;}
 catch(error){seriesCache.delete(id);throw error;}
}
export async function getEpisodes(anime){return (await getSeries(anime.id)).episodes;}
export async function getServers(animeId,episodeRef){
 const {episodes}=await getSeries(animeId);
 const ep=episodes.find(e=>e.embedId===String(episodeRef)||e.id===String(episodeRef));
 if(!ep)throw fail(404,'Episode not found in Anikoto');
 return [{id:'sub',name:'Sub',category:'sub',available:ep.hasSub},{id:'dub',name:'Dub',category:'dub',available:ep.hasDub}].filter(x=>x.available);
}
export async function getSources(animeId,episodeRef,language='sub'){
 const {episodes}=await getSeries(animeId);
 const ep=episodes.find(e=>e.embedId===String(episodeRef)||e.id===String(episodeRef));
 if(!ep)throw fail(404,'Episode not found in Anikoto');
 const lang=language==='dub'?'dub':'sub';
 const supplied=lang==='dub'?ep.embedDub:ep.embedSub;
 const url=supplied||(ep.embedId?EMBED+'/stream/s-2/'+encodeURIComponent(ep.embedId)+'/'+lang:null);
 if(!url)throw fail(404,'No '+lang+' embed is available for this episode');
 return {embedUrl:url,embedOrigin:new URL(url).origin,language:lang,events:['time','complete','error','watching-log']};
}
