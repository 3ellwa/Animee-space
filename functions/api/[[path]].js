// Anikoto-only API. Search is built from Anikoto's paginated catalog (there is no search endpoint).
import * as anikoto from '../_lib/providers/anikoto.js';
import { handleAccount } from '../_lib/account.js';

const json=(data,status=200,ttl=0)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':ttl?'public, max-age='+ttl:'no-store'}});
async function cached(ctx,ttl,fn){
 const cache=globalThis.caches?.default;
 const cacheUrl=new URL(ctx.request.url);cacheUrl.searchParams.set('__cachev','4');const key=new Request(cacheUrl.toString(),{method:'GET'});
 if(cache){const hit=await cache.match(key).catch(()=>null);if(hit)return hit;}
 const response=json(await fn(),200,ttl);
 if(cache){const put=cache.put(key,response.clone()).catch(()=>{});ctx.waitUntil?ctx.waitUntil(put):await put;}
 return response;
}
async function catalogPage(ctx,page,perPage=20){
 const cache=globalThis.caches?.default;
 const key=new Request(new URL('/__anikoto_cache/recent/'+perPage+'/'+page,ctx.request.url).toString(),{method:'GET'});
 if(cache){const hit=await cache.match(key).catch(()=>null);if(hit){try{return await hit.json();}catch{}}}
 const result=await anikoto.getRecentAnime({page,perPage});
 if(cache){const response=new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=900'}});const put=cache.put(key,response).catch(()=>{});ctx.waitUntil?ctx.waitUntil(put):await put;}
 return result;
}
const validId=value=>{
 const id=String(value??'').trim();
 if(!id||id.length>180||! /^[a-zA-Z0-9_-]+$/.test(id))throw Object.assign(new Error('Invalid Anikoto series ID'),{status:400});
 return id;
};
function pageCount(meta){
 const total=Number(meta?.total_pages??meta?.totalPages??meta?.last_page??meta?.lastPage??meta?.pages);
 return Number.isFinite(total)&&total>0?total:null;
}
function hasNext(meta,page,rows,perPage=20){
 const explicit=meta?.has_next??meta?.hasNext??meta?.has_next_page??meta?.hasNextPage;
 if(typeof explicit==='boolean')return explicit;
 const last=pageCount(meta);
 if(last)return page<last;
 return rows.length>=perPage;
}
async function searchCatalog(ctx,query,genre){
 const perPage=100;
 const firstPage=await catalogPage(ctx,1,perPage);
 const meta=firstPage.pagination||{};
 const pageTotal=pageCount(meta);
 const pages=Math.max(1,Math.min(pageTotal||50,50));
 const all=[...firstPage.results];
 let stop=!hasNext(meta,1,firstPage.results,perPage);
 const batchSize=8;
 for(let start=2;start<=pages&&!stop;start+=batchSize){
  const pageNumbers=Array.from({length:Math.min(batchSize,pages-start+1)},(_,i)=>start+i);
  const batch=await Promise.all(pageNumbers.map(page=>catalogPage(ctx,page,perPage)));
  for(let i=0;i<batch.length;i++){
   const next=batch[i];
   all.push(...next.results);
   if(!hasNext(next.pagination||{},pageNumbers[i],next.results,perPage)){stop=true;break;}
  }
 }
 const seen=new Set();
 const catalog=all.filter(a=>{const key=String(a.id);if(seen.has(key))return false;seen.add(key);return true;});
 const q=query.toLowerCase();
 const g=genre.toLowerCase();
 return catalog.filter(a=>(!q||a.title.toLowerCase().includes(q)||String(a.titleRomaji||'').toLowerCase().includes(q))&&(!g||a.genres.some(x=>x.toLowerCase()===g)));
}
export async function onRequest(ctx){
 const {request,params}=ctx;
 const url=new URL(request.url);
 const parts=Array.isArray(params.path)?params.path:String(params.path||'').split('/').filter(Boolean);
 if(parts[0]==='auth'||parts[0]==='me')return handleAccount(ctx,parts);
 if(request.method!=='GET')return json({error:'Method not allowed'},405);
 try{
  const [a,b,c]=parts;
  if(a==='provider'&&!b)return json({name:'anikoto',label:'Anikoto / MegaPlay'});
  if(a==='home'&&!b)return await cached(ctx,300,async()=>{
   const recent=await catalogPage(ctx,1);
   return {recent:recent.results,pagination:recent.pagination};
  });
  if(a==='search'&&!b)return await cached(ctx,300,async()=>{
   const page=Math.min(Math.max(Number(url.searchParams.get('page'))||1,1),500);
   const query=(url.searchParams.get('q')||'').trim().slice(0,100);
   const genre=(url.searchParams.get('genre')||'').trim().slice(0,50);
   if(!query&&!genre){
    const result=await catalogPage(ctx,page);
    const meta=result.pagination||{};
    return {results:result.results,pageInfo:{currentPage:page,lastPage:pageCount(meta),hasNextPage:hasNext(meta,page,result.results),total:meta.total??null}};
   }
   const matches=await searchCatalog(ctx,query,genre);
   const perPage=24;
   const totalPages=Math.max(1,Math.ceil(matches.length/perPage));
   return {results:matches.slice((page-1)*perPage,page*perPage),pageInfo:{currentPage:page,lastPage:totalPages,hasNextPage:page<totalPages,total:matches.length,searchScope:'latest catalog pages'}};
  });
  if(a==='anime'&&b&&!c)return await cached(ctx,300,async()=>(await anikoto.getSeries(validId(b))).anime);
  if(a==='anime'&&b&&c==='episodes')return await cached(ctx,300,async()=>{
   const series=await anikoto.getSeries(validId(b));
   return {animeId:series.anime.id,total:series.episodes.length,episodes:series.episodes};
  });
  if(a==='episode'&&b&&c==='servers')return await cached(ctx,300,async()=>{
   const [animeId,episodeRef]=decodeURIComponent(b).split(':');
   if(!animeId||!episodeRef)throw Object.assign(new Error('Invalid episode reference'),{status:400});
   return {episodeId:b,servers:await anikoto.getServers(validId(animeId),episodeRef)};
  });
  if(a==='episode'&&b&&c==='sources')return await cached(ctx,300,async()=>{
   const [animeId,episodeRef]=decodeURIComponent(b).split(':');
   if(!animeId||!episodeRef)throw Object.assign(new Error('Invalid episode reference'),{status:400});
   const language=url.searchParams.get('category')==='dub'?'dub':'sub';
   return {episodeId:b,...await anikoto.getSources(validId(animeId),episodeRef,language)};
  });
  if(a==='batch'&&!b)return await cached(ctx,300,async()=>{const ids=[...new Set((url.searchParams.get('ids')||'').split(',').filter(x=>/^[a-zA-Z0-9_-]{1,180}$/.test(x)))].slice(0,8);const results=await Promise.all(ids.map(async id=>{try{return (await anikoto.getSeries(id)).anime;}catch{return null;}}));return {results:results.filter(Boolean)};});
  if(a==='schedule')return json({items:[],unsupported:true});
  return json({error:'Not found'},404);
 }catch(error){
  const status=error.status||500;
  if(status===500)console.error(error);
  return json({error:status===500?'Internal error':error.message},status);
 }
}
