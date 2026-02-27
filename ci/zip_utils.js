import AdmZip from 'adm-zip';





export const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_SECOND_LEVEL_DIRS = new Set([
  "catalog",
  "templates",
  "category",
  "translations",
]);

const ALLOWED_SECOND_LEVEL_FILES = new Set([
  "config.json",
  "catalog.json",
]);


/**
 * List all contents of a zip file
 * @param {string} zipFilePath - Path to the zip file
 * @returns {Array} Array of zip entries
 */
export function listZipContents(zipFilePath) {
    try {
        const zip = new AdmZip(zipFilePath);
        const zipEntries = zip.getEntries();
        
        //console.log('Zip file contents:');
        zipEntries.forEach(entry => {
           // console.log(`- ${entry.entryName} (${entry.header.size} bytes)`);
        });
        
        return zipEntries;
    } catch (error) {
        console.error('✗ Error reading zip file:', error.message);
        throw error;
    }
}

export function validateZipStructure(zipEntries) {
  let rootUuid = null;

  for (const entryObj of zipEntries) {
    const entry = entryObj.entryName
    //console.log(`[validateZipStructure] processing entry: ${entry}`)
    // normalize (zip paths always use /)
    const parts = entry.split("/").filter(Boolean);

    if (parts.length < 2) {
      return { valid: false, reason: `Invalid path depth: ${entry}` };
    }

    const [topLevel, secondLevel] = parts;

    // 1. validate UUID v4 root
    if (!UUID_V4_REGEX.test(topLevel)) {
      return { valid: false, reason: `Invalid root UUID: ${topLevel}` };
    }

    if (!rootUuid) {
      rootUuid = topLevel;
    } else if (rootUuid !== topLevel) {
      return { valid: false, reason: `Multiple root UUIDs found` };
    }

    // 2. validate second level
    const isSecondLevelFile =
      parts.length === 2 && ALLOWED_SECOND_LEVEL_FILES.has(secondLevel);

    const isSecondLevelDir =
      parts.length >= 3 && ALLOWED_SECOND_LEVEL_DIRS.has(secondLevel);

    if (!isSecondLevelFile && !isSecondLevelDir) {
      return {
        valid: false,
        reason: `Invalid second-level entry: ${secondLevel}`,
      };
    }
  }

  return { valid: true, rootUuid };
}


export function unzipFile(zipFilePath, outputDir) {
    try {
        const zip = new AdmZip(zipFilePath);

        // Extract all contents to the output directory
        zip.extractAllTo(outputDir, true); // true = overwrite existing files

        console.log(`✓ Successfully extracted ${zipFilePath} to ${outputDir}`);
    } catch (error) {
        console.error(`✗ Error unzipping file: ${zipFilePath}`, error.message);
        throw error;
    }
}

export async function unzipFileAsync(zipFilePath, outputDir) {
    return new Promise((resolve, reject) => {
        try {
            unzipFile(zipFilePath, outputDir);
            resolve();
        } catch (error) {
            reject(error);
        }
    });
}



//console.log(`BASEDIR: ${BASE_DIR}`)

// const entries = await fs.readdir(BASE_DIR, { withFileTypes: true });
// const zip_files = entries.filter(d => d.isFile() && d.name.endsWith('.zip')).map(d => d.name);
// console.log(`zip_files: ${JSON.stringify(zip_files)}`)

// for (let zip_file of zip_files){
//     const zip_entries = listZipContents(zip_file)
//     const validation_results = validateZipStructure(zip_entries)
//     console.log(`validation_results: ${JSON.stringify(validation_results)}`)

// }

