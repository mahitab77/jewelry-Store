import type { MetadataRoute } from 'next';
import { connection } from 'next/server';
import { publicSitemap } from '../lib/catalogue/sitemap.ts';
export default async function sitemap():Promise<MetadataRoute.Sitemap>{await connection();return publicSitemap();}
