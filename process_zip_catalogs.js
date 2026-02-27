// merge-configs.js
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

import { listZipContents, validateZipStructure ,  UUID_V4_REGEX, unzipFileAsync} from "./ci/zip_utils.js";


const CATALOGDIR = "democatalogs"
const BASE_DIR = path.dirname(fileURLToPath(import.meta.url)); 



function runPrerender(parentDir, catalogId) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath, // safer than "node"
      [
        path.resolve('ci/prerender.js'),
        parentDir,
        catalogId
      ],
      {
        stdio: 'inherit', // stream logs directly
        env: {
          ...process.env,
          NODE_ENV: 'production'
        }
      }
    );

    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`prerender failed (${catalogId})`));
    });
  });
}


function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


function walkAndReplace(obj, catalogId, ownerId, DIRNAME) {
    const uploadsRegex = new RegExp(
        // match https://<anything>/uploads/catalog/<ownerId>/<catalogId>/<rest>
        `^https?:\\/\\/[^\\/]+\\/uploads\\/catalog\\/${escapeRegExp(ownerId)}\\/${escapeRegExp(catalogId)}\\/(.+)$`,
        "i"
    );

    function recurse(value) {
        if (value === null || value === undefined) return value;

        if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) {
                value[i] = recurse(value[i]);
            }
            return value;
        }

        if (typeof value === "object") {
            for (const k of Object.keys(value)) {
                value[k] = recurse(value[k]);
            }
            return value;
        }

        if (typeof value === "string") {
            const m = value.match(uploadsRegex);
            if (m) {
                // m[1] is the ANY-FILE-PATH (rest). Preserve trailing query/hash if present in original? Regex captured rest after catalog-id
                // Build replacement: "/DIRNAME/{CATALOG-ID}/{ANY-FILE-PATH}"
                return `/${DIRNAME}/${catalogId}/${m[1]}`;
            }
            return value;
        }

        return value;
    }

    return recurse(obj);
}


function generateSwaConfig(catalogIds) {

    const catalogRoutes = catalogIds.map(catalogId => ({
            route: `/catalogs/${catalogId}/templates/*`,
            headers: {
                "cache-control": "public, max-age=3600"
            }
    }))

    const excludes  = catalogIds.map(catalogId => `/catalogs/${catalogId}/templates/*`)



    const routes = [
        {
            route: "/static/*",
            headers: {
                "cache-control": "public, max-age=31536000, immutable"
            }
        },
        {
            route: "/__config_info",
            headers: {
                "x-build-date": `${new Date().toISOString()}`,
                "x-config-owner": `swa-build-demo`
            }
        },
        ...catalogRoutes,
        {
            route: "/*",
            headers: {
                "cache-control": "no-cache, no-store, must-revalidate"
            }
        }
    ];

    const config = {
        trailingSlash: "never",
        routes,
        navigationFallback: {
            rewrite: "/index.html",
            exclude: [
                "/assets/*.{js,css,png,jpg,gif,svg,ico}",
                "/static_templates/*.{html}",
                ...excludes
            ]
        }
    };

    return config

}


async function main() {
    const parent = CATALOGDIR;

    const root_entries = await fs.readdir(BASE_DIR, { withFileTypes: true });
    const zip_files = root_entries.filter(d => d.isFile() && d.name.endsWith('.zip')).map(d => d.name);

    console.log(`✓ extracting zips ${zip_files}`);

    const validZips = zip_files.filter(
        filename => UUID_V4_REGEX.test(
            filename.slice(0, -4) // removing .zip from the end of a filenime
        )
    ); //validating for uuidv4
    
    console.log(`✓ valid zips ${validZips}`);



    

    for (let _file of validZips){
        console.log(`✓ validating: ${_file}`);
        const zipPath = `./${_file}`
        const zip_entries = listZipContents(_file)
        const validation_results = validateZipStructure(zip_entries)
        

        if(!validation_results.valid) {
            console.error(`validatioion failed: ${JSON.stringify(validation_results)}`)
            continue
        }


        await unzipFileAsync(zipPath, parent);
    }





    const entries = await fs.readdir(parent, { withFileTypes: true });

    // filter only top-level directories
    const dirs = entries.filter(d => d.isDirectory()).map(d => d.name);

    const results = [];
    
    for (const d of dirs) {
        const cfgPath = path.join(parent, d, "config.json");
        try {
            const raw = await fs.readFile(cfgPath, "utf8");
            const parsed = JSON.parse(raw);
            results.push(parsed);
        } catch (err) {
            console.error(`${err}`);
            // skip missing or invalid config files
            continue;
        }
    }

    const cfgDest = path.join(parent, "config.json");
    await fs.writeFile(cfgDest, JSON.stringify(results, null, 2), "utf8");
    console.log(`Wrote ${results.length} configs to ${cfgDest}`);


    

    // replacing remote image urls with local swa path
    for (const d of dirs) {
        const catalogPath = path.join(parent, d, "catalog.json");
        console.log(`processing  ${catalogPath}`);
        try {
            const raw = await fs.readFile(catalogPath, "utf8");
            const catalog = JSON.parse(raw);

            const result = walkAndReplace(catalog, catalog.id, catalog.owner, parent);
            //const fixedCatalogPath = path.join(parent, d, "catalog-fixed.json");
            fs.writeFile(catalogPath, JSON.stringify(result, null, 2));
            console.log(`fixed  ${catalogPath}`);

        } catch (err) {
            console.error(`${err}`);
            // skip missing or invalid config files
            continue;
        }
    }




    //generating dist/staticwebapp.config.json
    const catalogIds =  results.map(config=>config.id)
    const swaConfig = generateSwaConfig(catalogIds)
    const swaCfgDest = path.join('dist', "staticwebapp.config.json");
    await fs.writeFile(swaCfgDest, JSON.stringify(swaConfig, null, 2), "utf8");



    // moving CATALOGDIR to `dist` folder
    const src = path.resolve(CATALOGDIR);
    const dest = path.resolve('dist', CATALOGDIR);

    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(src, dest);
    console.log('Moved', src, '->', dest);





    for (const catalogId of catalogIds) {
        await runPrerender(CATALOGDIR, catalogId);
    }


}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
