import * as fs from 'fs';
import * as path from 'path';

export interface DownloadOptions {
    manifestUrl: string;
    filesBaseUrl: string;
    headers?: Record<string, string>;
}

async function fetchJson(url: string, headers?: Record<string, string>) {
    const res = await fetch(url, { headers });
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`failed to fetch ${url}: ${res.status} ${txt}`);
    }
    return res.json();
}

async function downloadFile(srcUrl: string, destPath: string, headers?: Record<string, string>) {
    const res = await fetch(srcUrl, { headers });
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`failed to download ${srcUrl}: ${res.status} ${txt}`);
    }
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.promises.writeFile(destPath, buf);
}

export async function downloadModules(opts: DownloadOptions): Promise<string> {
    const manifest = await fetchJson(opts.manifestUrl, opts.headers);
    if (!manifest || !Array.isArray(manifest.files)) {
        throw new Error('Invalid module manifest');
    }
    const baseDir = path.join(process.cwd(), 'tmp', 'area-modules', `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);
    for (const file of manifest.files) {
        if (typeof file !== 'string' || file.includes('..') || path.isAbsolute(file)) {
            throw new Error(`Invalid module file path in manifest: ${file}`);
        }
        const src = new URL(`files/${file}`, opts.filesBaseUrl).toString();
        const dest = path.join(baseDir, file);
        await downloadFile(src, dest, opts.headers);
    }
    return baseDir;
}
