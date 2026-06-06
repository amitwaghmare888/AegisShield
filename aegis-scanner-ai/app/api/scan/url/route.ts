import { NextResponse } from 'next/server';
import { scanMultipleFiles } from '@/lib/engine';

interface GitHubFile {
  name: string;
  path: string;
  type: string;
  download_url: string | null;
  size: number;
}

const SCANNABLE_EXTENSIONS = ['.py', '.js', '.ts', '.jsx', '.tsx', '.json', '.yaml', '.yml', '.env', '.cfg', '.ini', '.toml', '.sh', '.bash'];

function isScannable(filename: string): boolean {
  return SCANNABLE_EXTENSIONS.some(ext => filename.toLowerCase().endsWith(ext));
}

function parseGitHubUrl(url: string): { owner: string; repo: string; path: string } | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('github.com')) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1];
    // If there's a tree/blob path, extract the file path
    let path = '';
    if (parts.length > 3 && (parts[2] === 'tree' || parts[2] === 'blob')) {
      path = parts.slice(4).join('/');
    }
    return { owner, repo, path };
  } catch {
    return null;
  }
}

async function fetchGitHubContents(owner: string, repo: string, path: string = ''): Promise<GitHubFile[]> {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const res = await fetch(apiUrl, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'AegisShield-Scanner/1.0',
    },
  });
  
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }
  
  const data = await res.json();
  return Array.isArray(data) ? data : [data];
}

async function collectFiles(
  owner: string,
  repo: string,
  path: string = '',
  maxFiles: number = 50,
  maxDepth: number = 3,
  depth: number = 0
): Promise<{ name: string; content: string }[]> {
  if (depth > maxDepth) return [];
  
  const entries = await fetchGitHubContents(owner, repo, path);
  const files: { name: string; content: string }[] = [];

  for (const entry of entries) {
    if (files.length >= maxFiles) break;

    if (entry.type === 'file' && isScannable(entry.name) && entry.download_url) {
      if (entry.size > 500_000) continue; // skip files > 500KB
      try {
        const res = await fetch(entry.download_url);
        if (res.ok) {
          const content = await res.text();
          files.push({ name: entry.path, content });
        }
      } catch {
        // Skip files that can't be fetched
      }
    } else if (entry.type === 'dir' && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== '__pycache__' && entry.name !== 'venv') {
      const subFiles = await collectFiles(owner, repo, entry.path, maxFiles - files.length, maxDepth, depth + 1);
      files.push(...subFiles);
    }
  }

  return files;
}

export async function POST(req: Request) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'No URL provided' }, { status: 400 });
    }

    const parsed = parseGitHubUrl(url.trim());
    if (!parsed) {
      return NextResponse.json({ error: 'Invalid GitHub URL. Please provide a valid GitHub repository URL.' }, { status: 400 });
    }

    const { owner, repo, path } = parsed;
    const label = `${owner}/${repo}${path ? '/' + path : ''}`;

    const files = await collectFiles(owner, repo, path);

    if (files.length === 0) {
      return NextResponse.json({
        scan_id: `scan_${Date.now()}`,
        risk_score: 0,
        severity: 'Safe',
        findings: [],
        counts: { critical: 0, high: 0, warning: 0, info: 0 },
        files_scanned: 0,
        duration_ms: 0,
        label,
        can_download: false,
      });
    }

    const result = scanMultipleFiles(files, label);
    result.can_download = false;

    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error('[aegisshield] url scan error:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
