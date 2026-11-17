const REQUEST_TIMEOUT_MS = 30_000;

export async function latestGithubReleaseTag(repository) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "safe-online-exam-supply-chain-monitor",
    "x-github-api-version": "2022-11-28"
  };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) {
    // A 403 alone does not identify rate limiting. Retain only diagnostic
    // headers, never authorization or arbitrary response bodies in reports.
    const diagnostics = ["x-ratelimit-remaining", "x-ratelimit-reset", "retry-after", "x-github-request-id"]
      .map((name) => [name, response.headers.get(name)])
      .filter(([, value]) => value !== null)
      .map(([name, value]) => `${name}=${value}`)
      .join(", ");
    throw new Error(
      `GitHub release API returned HTTP ${response.status} for ${repository}${diagnostics ? ` (${diagnostics})` : ""}`
    );
  }
  const release = await response.json();
  if (typeof release.tag_name !== "string" || !release.tag_name) {
    throw new Error(`GitHub release API returned no release tag for ${repository}`);
  }
  return release.tag_name;
}
