// Minimal GitHub REST client used by the app (fine-grained token stored on this device only).

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function friendly(status, msg) {
  if (status === 401) return 'GitHub token is invalid or expired. Create a new one in Settings.';
  if (status === 403) return `GitHub refused: the token needs "Contents" and "Actions" read & write on this repo. (${msg})`;
  if (status === 404) return 'Repo or file not found — check that the token has access to this repository.';
  if (status === 422) return `GitHub rejected the change: ${msg}`;
  return `GitHub error ${status}: ${msg}`;
}

export function b64EncodeUtf8(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function b64DecodeUtf8(b64) {
  const bin = atob(String(b64).replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function github({ owner, repo, token, branch = 'main' }) {
  async function req(method, path, body) {
    let res;
    try {
      res = await fetch(`${API}/repos/${owner}/${repo}${path}`, {
        method,
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2026-03-10',
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GitHubError('Could not reach GitHub — check your connection.', 0);
    }
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).message || msg; } catch { /* ignore */ }
      throw new GitHubError(friendly(res.status, msg), res.status);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  return {
    repoInfo: () => req('GET', ''),
    async getFile(path) {
      const j = await req('GET', `/contents/${path}?ref=${encodeURIComponent(branch)}`);
      return { sha: j.sha, text: b64DecodeUtf8(j.content || '') };
    },
    async fileSha(path) {
      try {
        return (await req('GET', `/contents/${path}?ref=${encodeURIComponent(branch)}`)).sha;
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    },
    putFile: (path, text, sha, message) =>
      req('PUT', `/contents/${path}`, { message, content: b64EncodeUtf8(text), branch, ...(sha ? { sha } : {}) }),
    deleteFile: (path, sha, message) => req('DELETE', `/contents/${path}`, { message, sha, branch }),
    dispatch: (workflow, inputs = {}) => req('POST', `/actions/workflows/${workflow}/dispatches`, { ref: branch, inputs }),
    runs: (n = 5) => req('GET', `/actions/runs?per_page=${n}`),
  };
}
