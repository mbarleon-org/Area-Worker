import * as fs from 'fs';
import * as path from 'path';

export interface DownloadOptions {
    manifestUrl: string;
    filesBaseUrl: string;
    headers?: Record<string, string>;
}
/**
 * Fetch JSON from an URL and return the parsed body.
 * @param url - absolute URL to fetch
 * @param headers - optional headers to send with the request
 * @returns parsed JSON body
 * @throws when the response isn't ok or parsing fails
 */
async function fetchJson(url: string, headers?: Record<string, string>): Promise<any> {
    const res = await fetch(url, { headers });
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`failed to fetch ${url}: ${res.status} ${txt}`);
    }
    return res.json();
}

/**
 * Download a binary file from `srcUrl` and write it to `destPath`.
 * Creates parent directories as needed.
 * @param srcUrl - file URL to download
 * @param destPath - filesystem path to write the file to
 * @param headers - optional headers for the request
 * @returns void
 * @throws when the download fails
 */
async function downloadFile(srcUrl: string, destPath: string, headers?: Record<string, string>): Promise<void> {
    const res = await fetch(srcUrl, { headers });
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`failed to download ${srcUrl}: ${res.status} ${txt}`);
    }
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.promises.writeFile(destPath, buf);
}

/**
 * Validate a manifest file entry to ensure it does not escape the modules directory.
 * @param file - path entry from manifest
 * @returns true when the path is safe
 */
function isSafeManifestPath(file: any): boolean {
    return (typeof file === 'string') && !file.includes('..') && !path.isAbsolute(file);
}

/**
 * Download a set of module files described by a manifest.
 * The manifest is expected to be a JSON object with a `files` array
 * containing relative file paths. Files are downloaded under a
 * temporary directory inside the current working directory.
 *
 * @param opts - download options including manifest URL, base URL and headers
 * @returns path to the directory containing downloaded module files
 */
export async function downloadModules(opts: DownloadOptions): Promise<string> {
    const manifest = await fetchJson(opts.manifestUrl, opts.headers);
    if (!manifest || !Array.isArray(manifest.files)) {
        throw new Error('Invalid module manifest');
    }
    const baseDir = path.join(process.cwd(), 'tmp', 'area-modules', `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);
    for (const file of manifest.files) {
        if (!isSafeManifestPath(file)) {
            throw new Error(`Invalid module file path in manifest: ${file}`);
        }
        const src = new URL(`files/${file}`, opts.filesBaseUrl).toString();
        const dest = path.join(baseDir, file);
        await downloadFile(src, dest, opts.headers);
    }
    return baseDir;
}
