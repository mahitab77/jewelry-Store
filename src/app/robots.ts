import type { MetadataRoute } from 'next';
import { siteIndexingAllowed,siteOrigin } from '../lib/site.ts';
export default function robots():MetadataRoute.Robots {
  if(!siteIndexingAllowed())return {rules:{userAgent:'*',disallow:'/'}};
  return {rules:{userAgent:'*',allow:'/',disallow:['/admin','/account','/api/','/cart','/checkout','/orders/','/jewels/dev-','/collections/dev-','/collections/edit/dev-']},sitemap:siteOrigin()+'/sitemap.xml'};
}
