import 'server-only';
import type { MetadataRoute } from 'next';
import { siteIndexingAllowed,siteOrigin } from '../site.ts';
import { getPublicSitemapPaths } from './repository.ts';
const staticPaths=['/','/collections','/bespoke','/gemstones','/maison','/services','/appointment','/contact'];
export async function publicSitemap():Promise<MetadataRoute.Sitemap>{
  const origin=siteOrigin();if(!origin||!siteIndexingAllowed())return [];
  const rows=await getPublicSitemapPaths();
  if(rows.length>50000-staticPaths.length)throw new Error('Public sitemap requires sharding before this catalogue can be indexed.');
  return [...staticPaths,...rows.map(row=>row.path)].map(path=>({url:new URL(path,origin).toString()}));
}
