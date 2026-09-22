// Return rule identifiers only: audit logs must never reproduce matched values.
export const MAX_SCANNED_FILE_BYTES = 2_000_000;

const forbiddenPathPatterns = [
  /(^|\/)\.env(?:\.|$)/u,
  /(^|\/)(?:\.dev\.vars|\.deployment|\.vercel|\.wrangler)(?:\/|$|\.)/u,
  /^\.openai\/hosting\.json$/u,
  /(^|\/).*\.(?:db|sqlite|sqlite3|har|log|pem|p12|key)$/iu,
  /(^|\/)stock-portfolio-backup-.*\.json$/iu,
  /(^|\/)portfolio-export-.*\.json$/iu,
  /(^|\/)broker-export-.*\.csv$/iu,
];

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /AKIA[0-9A-Z]{16}/u,
  /AIza[0-9A-Za-z_-]{30,}/u,
  /sk-[A-Za-z0-9_-]{20,}/u,
  /gh[pousr]_[A-Za-z0-9]{30,}/u,
  /xox[baprs]-[A-Za-z0-9-]{20,}/u,
];

function allowedEmailDomain(domain) {
  const normalized = domain.toLowerCase();
  return normalized === 'users.noreply.github.com' || normalized === 'noreply.github.com' ||
    /(?:^|\.)example\.(?:com|net|org)$/u.test(normalized) ||
    /(?:^|\.)(?:example|test|invalid|localhost)$/u.test(normalized);
}

// Deliberately restrict process rules to prose and commit/tag metadata. UI
// confirmation, supported broker names and synthetic fixtures are valid source.
const personalProcessPatterns = [
  /[产]品所有者/u,
  /[本]轮确认/u,
  /[用]户确认\s*\d{4}[-年]/u,
  /[私]人(?:组合|持仓|投资|资产)/u,
  /(?:[用]户|[本]人|[作]者)(?:已|曾|实际|本轮)?(?:提供|导入|提交|持有)[^\n。;；]{0,60}(?:持仓|组合|现金|账单)/u,
  /(?:[内]置|[预]置)(?:了|过|曾)?\s*\d+\s*(?:只|个)\s*(?:真实)?(?:股票|持仓)/u,
  /[真]实持仓(?:来自|由|曾|包含|包括|数量|明细)/u,
  /(?:[Pp]roduct owner confirmed|[Uu]ser confirmed|[Pp]ersonal (?:investment|portfolio|holdings))/u,
  /(?:[Tt]he|[Oo]ur|[Tt]his)\s+(?:product\s+owner|maintainer|author)[^\n.]{0,80}(?:holds|provided|brokerage|portfolio|cash)/u,
];

export function auditPath(path) {
  return path !== '.env.example' && forbiddenPathPatterns.some(pattern => pattern.test(path))
    ? ['private-data-path'] : [];
}

export function auditContent(content, { path = '', metadata = false } = {}) {
  const rules = [];
  if (secretPatterns.some(pattern => pattern.test(content))) rules.push('credential-format');
  if (/(?:NEXT_PUBLIC_|VITE_)[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD)/u.test(content)) rules.push('client-secret-prefix');
  if (/\/(?:Users|home)\/[^/\s"'`]+\//u.test(content) || /[A-Za-z]:\\Users\\[^\\\s]+\\/u.test(content)) rules.push('private-machine-path');
  if (/\bappg(?:prj|dep)_[a-f0-9]{28,32}\b/u.test(content) || /\b(?:prj|dpl)_[A-Za-z0-9]{20,}\b/u.test(content)) rules.push('deployment-identity');
  if (/\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:vercel\.app|chatgpt\.site)\b/iu.test(content)) rules.push('deployment-origin');

  const emails = content.matchAll(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@((?:[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?\.)+[A-Z]{2,})/giu);
  if ([...emails].some(match => {
    if (allowedEmailDomain(match[1])) return false;
    // These exact platform service identities are public bot metadata, not a general
    // exception for GitHub employee/personal addresses or author identities.
    const lineStart = content.lastIndexOf('\n', match.index - 1) + 1;
    const lineEnd = content.indexOf('\n', match.index);
    const line = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    return !(metadata && (
      /^Signed-off-by: dependabot\[bot\] <support@github\.com>$/u.test(line) ||
      /^committer GitHub <noreply@github\.com> \d+ [+-]\d{4}$/u.test(line)
    ));
  })) rules.push('non-example-email');
  if ((metadata || /\.(?:md|mdx|rst|txt)$/iu.test(path)) && personalProcessPatterns.some(pattern => pattern.test(content))) {
    rules.push('personal-process-record');
  }
  return rules;
}
