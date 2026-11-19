// Animee.space API: Anikoto is the sole anime catalog and episode source.
import * as anikoto from '../_lib/providers/anikoto.js';
import { handleAccount } from '../_lib/account.js';
const json=(data,status=200,ttl=0)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':ttl?'public, max-age='+ttl:'no-store'}});
async function cached(ctx,ttl,fn){const cache=globalThis.caches?.default;const key=new Request(new URL(ctx.request.url).toString(),{method:'GET'});if(cache){const hit=await cache.match(key).catch(()=>null);if(hit)return hit;}const res=json(await fn(),200,ttl);if(cache){const p=cache.put(key,res.clone()).catch(()=>{});ctx.waitUntil?ctx.waitUntil(p):await p;}return res;}
const validId=v=>{if(!/^\d+$/.test(String(v)))throw Object.assign(new Error('Invalid Anikoto ID'),{status:400});return String(v);};
export async function onRequest(ctx){
 const {request,params}=ctx;const url=new URL(request.url);const parts=Array.isArray(params.path)?params.path:String(params.path||'').split('/').filter(Boolean);
 if(parts[0]==='auth'||parts[0]==='me')return handleAccount(ctx,parts);
 if(request.method!=='GET')return json({error:'Method not allowed'},405);
 try{
  const [a,b,c]=parts;
  if(a==='provider'&&!b)return json({name:'anikoto',label:'Anikoto / MegaPlay'});
  if(a==='home'&&!b)return cached(ctx,300,async()=>{const d=await anikoto.getRecentAnime({page:1,perPage:30});return {spotlight:[],trending:d.results,season:[],airing:[],popular:d.results,top:[],seasonInfo:{season:'',year:''},pagination:d.pagination};});
  if(a==='search'&&!b)return cached(ctx,180,async()=>{const page=Math.min(Math.max(Number(url.searchParams.get('page'))||1,1),500);const q=(url.searchParams.get('q')||'').trim().toLowerCase();const genre=(url.searchParams.get('genre')||'').toLowerCase();const d=await anikoto.getRecentAnime({page,perPage:50});const results=d.results.filter(x=>(!q||x.title.toLowerCase().includes(q)||String(x.titleRomaji||'').toLowerCase().includes(q))&&(!genre||x.genres.some(g=>g.toLowerCase()===genre)));const p=d.pagination||{};return {results,pageInfo:{currentPage:page,lastPage:Number(p.total_pages||p.totalPages)||null,hasNextPage:p.has_next??p.hasNext??(results.length>=50)}};});
  if(a==='anime'&&b&&!c)return cached(ctx,600,async()=>(await anikoto.getSeries(validId(b))).anime);
  if(a==='anime'&&b&&c==='episodes')return cached(ctx,300,async()=>{const s=await anikoto.getSeries(validId(b));return {animeId:s.anime.id,total:s.episodes.length,episodes:s.episodes};});
  if(a==='episode'&&b&&c==='servers'){const [animeId,ep]=decodeURIComponent(b).split(':');if(!animeId||!ep)throw Object.assign(new Error('Invalid episode reference'),{status:400});return json({episodeId:b,servers:await anikoto.getServers(validId(animeId),ep)});}
  if(a==='episode'&&b&&c==='sources'){const [animeId,ep]=decodeURIComponent(b).split(':');if(!animeId||!ep)throw Object.assign(new Error('Invalid episode reference'),{status:400});const lang=url.searchParams.get('category')==='dub'?'dub':'sub';return json({episodeId:b,...await anikoto.getSources(validId(animeId),ep,lang)});}
  if(a==='batch'&&!b){const ids=[...new Set((url.searchParams.get('ids')||'').split(',').filter(x=>/^\d+$/.test(x)))].slice(0,10);const results=await Promise.all(ids.map(async x=>{try{return (await anikoto.getSeries(x)).anime;}catch{return null;}}));return json({results:results.filter(Boolean)});}
  if(a==='schedule')return json({items:[],unsupported:true});
  return json({error:'Not found'},404);
 }catch(err){const status=err.status||500;if(status===500)console.error(err);return json({error:status===500?'Internal error':err.message},status);}
}
