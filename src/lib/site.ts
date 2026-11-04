// Public configuration only. Never derive a canonical origin from request headers.
export function siteOrigin(value=process.env.SITE_URL):string|null {
  try{const url=new URL(value??'');if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(url.hostname)||!url.hostname.includes('.')||url.hostname.includes('..')||/YOUR|PLACEHOLDER/i.test(url.hostname)||url.hostname.endsWith('.invalid'))return null;return url.origin;}
  catch{return null;}
}
export function siteIndexingAllowed(){return process.env.SITE_INDEXING_ALLOWED==='true'&&siteOrigin()!==null;}
