// Official Anikoto catalog and MegaPlay embed integration.
const API = 'https://anikotoapi.site';
const EMBED = 'https://megaplay.buzz';
const fail = (status, message) => Object.assign(new Error(message), { status });
const first = (...v) => v.find(x => x !== undefined && x !== null && x !== '');
const clean = v => typeof v === 'string' ? v.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').trim() : '';
function genresOf(a) {
  const t=a?.terms_by_type;
  const rows=Array.isArray(t?.genre)?t.genre:Array.isArray(a?.genres)?a.genres:Array.isArray(a?.genre)?a.genre:[];
  return rows.map(x=>typeof x==='string'?x:first(x?.name,x?.term)).filter(Boolean);
}
export function normalizeAnime(raw) {
  const a=raw?.anime||raw||{};
  const id=String(first(a.id,a.anime_id,a.series_id,a.slug,''));
  if(!id) return null;
  const title=first(a.title,a.name,a.english_title,a.japanese_title,a.slug,'Untitled');
  const episodes=Number(first(a.episodes_count,a.total_episodes,a.episode_count,a.episodes?.length,0))||0;
  const status=String(first(a.status,a.airing_status,'')).toLowerCase();
  return {id,title,titleRomaji:first(a.japanese_title,a.title_japanese,null),titleNative:null,cover:first(a.poster,a.image,a.cover,a.cover_image,a.thumbnail,a.poster_url,null),banner:first(a.banner,a.banner_image,a.poster,a.image,a.cover,null),color:null,format:String(first(a.type,a.format,'')).toUpperCase()||null,status:status==='ongoing'?'RELEASING':status==='completed'?'FINISHED':status.toUpperCase()||null,episodes,availableEpisodes:episodes,duration:null,score:null,popularity:null,season:null,year:Number(first(a.year,a.release_year,a.season_year,0))||null,genres:genresOf(a),nextAiring:null,description:clean(first(a.synopsis,a.description,a.overview,'')),studios:[],characters:[],relations:[],recommendations:[],streamingLinks:[],source:null,synonyms:[],trailer:null,startDate:null,endDate:null};
}
export async function request(path) {
  const r=await fetch(API+path,{headers:{Accept:'application/json'}});
  if(!r.ok) throw fail(r.status===404?404:r.status===429?429:502,'Anikoto API returned HTTP '+r.status);
  const d=await r.json().catch(()=>null);
  if(!d) throw fail(502,'Anikoto returned invalid JSON');
  return d;
}
export async function getRecentAnime({page=1,perPage=30}={}) {
  const d=await request('/recent-anime?'+new URLSearchParams({page:String(page),per_page:String(perPage)}));
  const rows=Array.isArray(d.anime)?d.anime:Array.isArray(d.results)?d.results:Array.isArray(d.data)?d.data:Array.isArray(d)?d:[];
  return {results:rows.map(normalizeAnime).filter(Boolean),pagination:d.pagination||d.meta||{page,perPage}};
}
export async function getSeries(id) {
  if(!/^\\d+$/.test(String(id))) throw fail(400,'Invalid Anikoto series id');
  const d=await request('/series/'+encodeURIComponent(id));
  const anime=normalizeAnime(d?.anime||d);
  if(!anime) throw fail(404,'Anime not found in Anikoto');
  const rows=Array.isArray(d.episodes)?d.episodes:Array.isArray(d.data?.episodes)?d.data.episodes:[];
  const episodes=rows.map((e,i)=>{
    const embed=e.embed_url||e.embedUrl||{};
    const embedId=String(first(e.episode_embed_id,e.embed_id,e.stream_id,e.id,''));
    const sub=first(embed.sub,typeof embed==='string'?embed:null);
    const dub=first(embed.dub,null);
    return {id:anime.id+':'+(embedId||String(i+1)),number:Number(first(e.episode_no,e.number,e.episode,i+1))||i+1,title:first(e.title,e.name,'Episode '+(i+1)),isFiller:false,hasSub:!!(sub||embedId),hasDub:!!(dub||embedId),embedSub:typeof sub==='string'?sub:null,embedDub:typeof dub==='string'?dub:null,embedId};
  });
  anime.episodes=episodes.length;anime.availableEpisodes=episodes.length;
  return {anime,episodes};
}
export async function getEpisodes(anime) { return (await getSeries(anime.id)).episodes; }
export async function getServers(animeId,episodeRef) {
  const {episodes}=await getSeries(animeId);
  const ep=episodes.find(e=>e.id===animeId+':'+episodeRef);
  if(!ep) throw fail(404,'Episode not found');
  return [{id:'sub',name:'Sub',category:'sub',available:ep.hasSub},{id:'dub',name:'Dub',category:'dub',available:ep.hasDub}].filter(x=>x.available);
}
export async function getSources(animeId,episodeRef,language='sub') {
  const {episodes}=await getSeries(animeId);
  const ep=episodes.find(e=>e.id===animeId+':'+episodeRef);
  if(!ep) throw fail(404,'Episode not found');
  const lang=language==='dub'?'dub':'sub';
  const supplied=lang==='dub'?ep.embedDub:ep.embedSub;
  const url=supplied||(ep.embedId?EMBED+'/stream/s-2/'+encodeURIComponent(ep.embedId)+'/'+lang:null);
  if(!url) throw fail(404,'No '+lang+' embed is available for this episode');
  return {embedUrl:url,embedOrigin:new URL(url).origin,language:lang,events:['time','complete','error','watching-log']};
}
