// --- CONFIGURATION ---
const NEON_DB_URL = "postgresql://neondb_owner:npg_zOu3ifxHWF6J@ep-wild-term-a1x5g2w1-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
const WP_SITE_DOMAIN = "pranavcea.wordpress.com";

// In pages/paths ko worker ignore karega (as-it-is load hone dega)
const IGNORED_PATHS = ['/home', '/admin', '/login', '/signup', '/search', '/favicon.ico'];
const STATIC_EXTENSIONS = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.json', '.woff2'];

// Neon DB Driver Import (CDN se)
import { Client } from 'https://cdn.jsdelivr.net/npm/@neondatabase/serverless@0.9.0/+esm';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. CHECK: Kya ye ignored path hai? (Home, Admin, Login etc.)
    if (path === '/' || IGNORED_PATHS.some(p => path.startsWith(p))) {
      return fetch(request);
    }

    // 2. CHECK: Kya ye static file hai? (CSS, JS, Images)
    if (STATIC_EXTENSIONS.some(ext => path.endsWith(ext))) {
      return fetch(request);
    }

    // Agar hum yahan hain, matlab ye koi BLOG Link ho sakta hai (e.g. /ab12cd ya /solar-energy)
    try {
      // Step A: Slug nikalo (slashes hata ke)
      const cleanSlug = path.replace(/^\/|\/$/g, '');
      if (!cleanSlug) return fetch(request);

      let wpSlug = cleanSlug; // Default maan ke chalo ki URL hi WP slug hai

      // Step B: Neon DB check karo (Short Link -> Original URL Mapping)
      // Note: Browser Editor mein kabhi kabhi CDN import issue karta hai.
      // Agar DB connect fail hua, toh hum direct WP slug try karenge.
      try {
        const client = new Client(NEON_DB_URL);
        await client.connect();
        
        // Query: Check karo ki kya ye short slug DB mein hai?
        const { rows } = await client.query('SELECT original_url FROM url_mappings WHERE short_slug = $1', [cleanSlug]);
        ctx.waitUntil(client.end()); // Connection close background mein

        if (rows.length > 0) {
          // Agar DB mein mil gaya, toh original URL se WP Slug nikalo
          const originalUrl = rows[0].original_url;
          const matches = originalUrl.match(/\/([^/]+)\/?$/);
          if (matches) {
            wpSlug = matches[1]; // Asli WordPress Slug mil gaya
          }
        }
      } catch (dbErr) {
        console.log("DB Skip/Error (Using path as slug):", dbErr);
        // Agar DB connect nahi hua, toh path ko hi slug maan lenge
      }

      // Step C: WordPress API se Post Data fetch karo
      const wpApiUrl = `https://public-api.wordpress.com/rest/v1.1/sites/${WP_SITE_DOMAIN}/posts/slug:${wpSlug}`;
      const wpRes = await fetch(wpApiUrl);
      
      if (!wpRes.ok) {
        // Agar WP pe post nahi mili, toh normal page dikhao
        return fetch(request);
      }

      const post = await wpRes.json();

      // Step D: HTML Rewrite (Preview Tags Update karo)
      const originalResponse = await fetch(request);
      
      // Feature Image ya Default Image
      const previewImage = post.featured_image || 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?ixlib=rb-1.2.1&auto=format&fit=crop&w=1200&q=80';
      const cleanDesc = post.excerpt ? post.excerpt.replace(/<[^>]*>/g, '').substring(0, 160) : 'Read this article on To The Point.';

      return new HTMLRewriter()
        .on('title', { element(e) { e.setInnerContent(post.title); } })
        .on('meta[property="og:title"]', { element(e) { e.setAttribute('content', post.title); } })
        .on('meta[property="og:image"]', { element(e) { e.setAttribute('content', previewImage); } })
        .on('meta[property="og:description"]', { element(e) { e.setAttribute('content', cleanDesc); } })
        // Twitter Cards ke liye bhi same
        .on('meta[name="twitter:title"]', { element(e) { e.setAttribute('content', post.title); } })
        .on('meta[name="twitter:image"]', { element(e) { e.setAttribute('content', previewImage); } })
        .transform(originalResponse);

    } catch (e) {
      // Agar koi bhi error aaye, toh site band nahi honi chahiye. Original page dikha do.
      console.log("Worker Error:", e);
      return fetch(request);
    }
  }
};