// GitHub REST access uses Node's built-in fetch; publication is separate from notes generation.
function createGitHub({ token, repository, apiUrl = "https://api.github.com", fetchImpl = fetch }) {
  if (!token) throw new Error("A GitHub token is required for release mode");
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository || "")) throw new Error("Expected a repository as owner/name");
  const baseUrl = `${apiUrl.replace(/\/$/, "")}/repos/${repository}`;
  return {
    async request(method, route, data, missingOk = false) {
      const response = await fetchImpl(baseUrl + route, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "DRelease",
        },
        body: data === undefined ? undefined : JSON.stringify(data),
        signal: AbortSignal.timeout(60000),
      });
      if (missingOk && response.status === 404) return null;
      if (!response.ok) throw new Error(`GitHub API ${method} ${route} failed (HTTP ${response.status})`);
      return response.status === 204 ? null : response.json();
    },
  };
}

async function publishRelease(api, options, sha, body) {
  const tag = encodeURIComponent(options.tag);
  const ref = await api.request("GET", `/git/ref/tags/${tag}`, undefined, true);
  if (ref) {
    await api.request("PATCH", `/git/refs/tags/${tag}`, { sha, force: true });
  } else {
    await api.request("POST", "/git/refs", { ref: `refs/tags/${options.tag}`, sha });
  }
  let release = await api.request("GET", `/releases/tags/${tag}`, undefined, true);
  if (release && options.recreateRelease) {
    await api.request("DELETE", `/releases/${release.id}`);
    release = null;
  }
  const data = {
    tag_name: options.tag, target_commitish: sha, name: options.title, body,
    draft: false, prerelease: true, make_latest: "false",
  };
  const result = release
    ? await api.request("PATCH", `/releases/${release.id}`, data)
    : await api.request("POST", "/releases", data);
  return result.html_url;
}

module.exports = { createGitHub, publishRelease };
