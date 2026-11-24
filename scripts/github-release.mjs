const REQUEST_TIMEOUT_MS = 30_000;
const RELEASE_REPOSITORIES = new Set(["aquasecurity/trivy", "cli/cli"]);
const RELEASE_TOKEN = process.env.GITHUB_RELEASE_TOKEN;
// Never let Docker or npm inherit the lookup credential.
delete process.env.GITHUB_RELEASE_TOKEN;

export async function latestGithubReleaseTag(repository) {
  if (!RELEASE_REPOSITORIES.has(repository)) throw new Error("Unexpected release repository");
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "safe-online-exam-supply-chain-monitor",
    "x-github-api-version": "2022-11-28"
  };
  if (RELEASE_TOKEN) headers.authorization = `Bearer ${RELEASE_TOKEN}`;
  const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) {
    // A 403 alone does not identify rate limiting. Retain only diagnostic
    // headers, never authorization or arbitrary response bodies in reports.
    const diagnostics = ["x-ratelimit-remaining", "x-ratelimit-reset", "retry-after", "x-github-request-id"]
      .map((name) => [name, response.headers.get(name)])
      .filter(([name, value]) =>
        name === "x-github-request-id" ? /^[0-9a-z:-]{1,64}$/iu.test(value || "") : /^\d{1,16}$/u.test(value || "")
      )
      .filter(([, value]) => !RELEASE_TOKEN || !value.includes(RELEASE_TOKEN))
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
