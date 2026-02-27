// prerender.js
import puppeteer from 'puppeteer';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// 1. Configuration
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const BASE_DIR = path.join(currentDir, '..');
const DIST_DIR = path.join(BASE_DIR, 'dist');
const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;


const [, , catalogsDir, catalogId] = process.argv;

if (!catalogsDir || !catalogId) {
  console.error('Usage: node prerender.js <catalogsDir> <catalogId>');
  process.exit(1);
}





// load products.json from public
const productsJsonPath = path.join(DIST_DIR, catalogsDir, catalogId ,'catalog.json');
let productIds  = [];
try {
  const raw = fs.readFileSync(productsJsonPath, 'utf8');
  const parsed = JSON.parse(raw);
  // handle either { products: [...] } or a flat array
  const items = Array.isArray(parsed) ? parsed : parsed.templates ?? [];
  productIds = items.map((p) => String(p.id)).filter(Boolean);
} catch (e) {
  console.error('Failed to load product ids from', productsJsonPath, e);
  productIds = [];
}

const routes = productIds.map(id => `/catalogs/${catalogId}/templates/${id}`);
// routes.push(`/catalogs/${catalogId}`)

// const crop_widgets = ["square","rect","circle","ellipse","round-corners-2","cone","path"]
// for(let widget of crop_widgets) routes.push(`/crop/${widget}`)


async function main() {
  console.log('🚀 Starting Pre-rendering process...');

  // 2. Start a local server to serve the built assets
  const app = express();
  
  // Serve static assets
  app.use(express.static(DIST_DIR, { index: false }));
  
  // SPA Fallback: Return index.html for non-file requests
  app.use((req, res, next) => {
    if (path.extname(req.path)) return next();
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });

  const server = app.listen(PORT, () => {
    console.log(`✅ Server running at ${BASE_URL}`);
  });

  try {
    // 3. Launch Puppeteer
    const browser = await puppeteer.launch({
      headless: true,
      defaultViewport: null, 
      timeout: 60000,
      args: ['--no-sandbox','--start-maximized']
    });

    console.log(`📦 Prerendering ${routes.length} routes...`);

    for (const route of routes) {
      const page = await browser.newPage();
      
      
      // Set viewport to ensure responsive elements render if needed
     // await page.setViewport({ width: 1280, height: 800 });

      const url = `${BASE_URL}${route}`;
      console.log(`   - Processing: ${route}`);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        // 4. Wait for your custom event 'prerender-ready'
        // We add a timeout of 10s to prevent hanging
        await page.evaluate(() => {
            
           

          try { 
            const currentDate = new Date().toISOString();
            localStorage.setItem('tosAcceptedDate',currentDate); 
          } catch(e) {}

          return new Promise((resolve, reject) => {
            // If the app is already ready (in case we missed the event), resolve immediately
            // You might need to set window.prerenderReady = true in your App when dispatching the event
            // Otherwise, we simply listen:
            const timeout = setTimeout(() => reject('Timeout waiting for prerender-ready'), 10000);
            
            document.addEventListener('prerender-ready', () => {
              clearTimeout(timeout);
              resolve();
            }, { once: true });
          });
        });

        // 5. Capture HTML
        let content = await page.content();
         
        if (content.match(/<body[^>]*class=["']/)) {
          // If <body class="something"> exists, change it to <body class="unhydrated something">
          content = content.replace(/(<body[^>]*class=["'])/, '$1unhydrated ');
        } else {
          // If no class attribute exists, just add it
          content = content.replace('<body', '<body class="unhydrated"');
        }

        // 6. Write to file system
        // We transform /products/1 -> dist/products/1/index.html
        // This ensures clean URLs work on standard web servers
        const filePath = path.join(DIST_DIR, route.substring(1), 'index.html');
        const dirPath = path.dirname(filePath);

        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }

        fs.writeFileSync(filePath, content);
        console.log(`     ✓ Saved to ${filePath}`);

      } catch (err) {
        console.error(`     ❌ Failed to render ${route}:`, err.message);
      } finally {
        await page.close();
      }
    }

    console.log('🎉 All routes prerendered!');
    await browser.close();

  } catch (error) {
    console.error('Fatal Error:', error);
    process.exit(1);
  } finally {
    // 7. Cleanup: Stop the local server
    server.close();
    process.exit(0);
  }
}

main();