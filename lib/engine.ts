// lib/engine.ts — AegisShield Security Scanning Engine

export interface Finding {
  id: string;
  category: string;
  severity: 'critical' | 'high' | 'warning' | 'info';
  source: 'static' | 'ast';
  file: string;
  line: number;
  snippet: string;
  message: string;
  suggested_fix: string;
  weight: number;
}

export interface ScanResult {
  scan_id: string;
  risk_score: number;
  severity: string;
  findings: Finding[];
  counts: { critical: number; high: number; warning: number; info: number };
  files_scanned: number;
  duration_ms: number;
  label: string;
  can_download: boolean;
  raw_content?: string;
}

interface Rule {
  id: string;
  category: string;
  severity: 'critical' | 'high' | 'warning' | 'info';
  source: 'static' | 'ast';
  pattern: RegExp;
  message: string;
  suggested_fix: string;
  weight: number;
}

const RULES: Rule[] = [
  // ── Critical: API Keys ──
  {
    id: 'OPENAI_API_KEY',
    category: 'Secret Leak',
    severity: 'critical',
    source: 'static',
    pattern: /sk-[a-zA-Z0-9]{20,}/g,
    message: 'OpenAI API key detected in source code. This key grants full access to the OpenAI API and will be billed to the key owner.',
    suggested_fix: 'Use environment variables: os.environ["OPENAI_API_KEY"] and never hardcode the key.',
    weight: 30,
  },
  {
    id: 'ANTHROPIC_KEY',
    category: 'Secret Leak',
    severity: 'critical',
    source: 'static',
    pattern: /sk-ant-api03-[a-zA-Z0-9\-_]{20,}/g,
    message: 'Anthropic API key detected. This key provides access to Claude models and will be billed to the owner.',
    suggested_fix: 'Store in environment variable ANTHROPIC_API_KEY and reference via os.environ.',
    weight: 30,
  },
  {
    id: 'AWS_ACCESS_KEY',
    category: 'Secret Leak',
    severity: 'critical',
    source: 'static',
    pattern: /AKIA[0-9A-Z]{16}/g,
    message: 'AWS Access Key ID detected. This could provide access to AWS services and infrastructure.',
    suggested_fix: 'Use IAM roles or AWS Secrets Manager instead of hardcoded credentials.',
    weight: 30,
  },
  {
    id: 'AWS_SECRET_KEY',
    category: 'Secret Leak',
    severity: 'critical',
    source: 'static',
    pattern: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/g,
    message: 'AWS Secret Access Key detected. Combined with an access key, this grants full AWS access.',
    suggested_fix: 'Remove hardcoded secret key and use AWS IAM roles or environment variables.',
    weight: 30,
  },
  {
    id: 'GITHUB_TOKEN',
    category: 'Secret Leak',
    severity: 'critical',
    source: 'static',
    pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g,
    message: 'GitHub personal access token detected. This can grant read/write access to repositories.',
    suggested_fix: 'Use GITHUB_TOKEN environment variable and never commit tokens to source.',
    weight: 28,
  },
  {
    id: 'STRIPE_SECRET',
    category: 'Secret Leak',
    severity: 'critical',
    source: 'static',
    pattern: /sk_live_[0-9a-zA-Z]{24,}/g,
    message: 'Stripe live secret key detected. This key can process real payments.',
    suggested_fix: 'Use environment variables and restrict to server-side only code.',
    weight: 30,
  },
  {
    id: 'PRIVATE_KEY',
    category: 'Secret Leak',
    severity: 'critical',
    source: 'static',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    message: 'Private key block detected in source. This key could be used for authentication or signing.',
    suggested_fix: 'Remove from source. Store private keys in a secure vault or secrets manager.',
    weight: 30,
  },
  {
    id: 'GCP_API_KEY',
    category: 'Secret Leak',
    severity: 'critical',
    source: 'static',
    pattern: /AIza[0-9A-Za-z\-_]{35}/g,
    message: 'Google Cloud Platform API key detected.',
    suggested_fix: 'Use GCP service accounts and restrict API key permissions in the GCP console.',
    weight: 28,
  },
  {
    id: 'SLACK_TOKEN',
    category: 'Secret Leak',
    severity: 'high',
    source: 'static',
    pattern: /xox[bpors]-[0-9a-zA-Z\-]{10,}/g,
    message: 'Slack token detected. This may grant access to workspace messages and channels.',
    suggested_fix: 'Use environment variables for Slack tokens and rotate immediately.',
    weight: 22,
  },
  {
    id: 'SENDGRID_KEY',
    category: 'Secret Leak',
    severity: 'high',
    source: 'static',
    pattern: /SG\.[a-zA-Z0-9\-_]{22,}\.[a-zA-Z0-9\-_]{22,}/g,
    message: 'SendGrid API key detected. This key can send emails on behalf of your domain.',
    suggested_fix: 'Store SendGrid key in environment variables. Rotate the compromised key.',
    weight: 22,
  },
  {
    id: 'TWILIO_KEY',
    category: 'Secret Leak',
    severity: 'high',
    source: 'static',
    pattern: /SK[a-f0-9]{32}/g,
    message: 'Twilio API key detected. This key can make calls and send SMS.',
    suggested_fix: 'Use environment variables and restrict Twilio key permissions.',
    weight: 22,
  },
  {
    id: 'JWT_TOKEN',
    category: 'Secret Leak',
    severity: 'high',
    source: 'static',
    pattern: /eyJ[a-zA-Z0-9\-_]{20,}\.eyJ[a-zA-Z0-9\-_]{20,}\.[a-zA-Z0-9\-_]{20,}/g,
    message: 'JSON Web Token (JWT) detected in source. JWTs often encode session data or auth claims.',
    suggested_fix: 'Never hardcode JWTs. Generate them dynamically at runtime.',
    weight: 20,
  },
  {
    id: 'WALLET_KEY',
    category: 'Secret Leak',
    severity: 'critical',
    source: 'static',
    pattern: /0x[a-fA-F0-9]{64}/g,
    message: 'Ethereum/blockchain private key or hash detected. This could control crypto assets.',
    suggested_fix: 'Never store wallet private keys in source code. Use hardware wallets or encrypted vaults.',
    weight: 30,
  },

  // ── High: Credential Patterns ──
  {
    id: 'GENERIC_API_KEY',
    category: 'Credential',
    severity: 'high',
    source: 'static',
    pattern: /(?:api_key|apikey|api_secret|apisecret)\s*[=:]\s*['"][a-zA-Z0-9\-_]{12,}['"]/gi,
    message: 'Generic API key/secret assignment detected. This may expose service credentials.',
    suggested_fix: 'Move credentials to environment variables or a secrets manager.',
    weight: 18,
  },
  {
    id: 'GENERIC_PASSWORD',
    category: 'Credential',
    severity: 'high',
    source: 'static',
    pattern: /(?:password|passwd|pwd)\s*[=:]\s*['"][^'"]{4,}['"]/gi,
    message: 'Hardcoded password detected. This is a common source of credential leakage.',
    suggested_fix: 'Use environment variables or a vault. Never hardcode passwords.',
    weight: 20,
  },
  {
    id: 'GENERIC_SECRET',
    category: 'Credential',
    severity: 'high',
    source: 'static',
    pattern: /(?:secret|token|auth_token|access_token)\s*[=:]\s*['"][a-zA-Z0-9\-_]{10,}['"]/gi,
    message: 'Hardcoded secret/token assignment detected.',
    suggested_fix: 'Reference secrets from environment variables at runtime.',
    weight: 18,
  },
  {
    id: 'CONNECTION_STRING',
    category: 'Credential',
    severity: 'high',
    source: 'static',
    pattern: /(?:mongodb\+srv|postgres|mysql|redis):\/\/[^\s'"]{10,}/gi,
    message: 'Database connection string with potential credentials detected.',
    suggested_fix: 'Use DATABASE_URL environment variable. Never commit connection strings.',
    weight: 22,
  },

  // ── Warning: Unsafe Patterns ──
  {
    id: 'DEBUG_PRINT',
    category: 'Debug Leak',
    severity: 'warning',
    source: 'ast',
    pattern: /print\s*\(.*(?:key|secret|token|password|api_key|credential|auth).*\)/gi,
    message: 'Debug print statement leaking sensitive variable names. Output flows directly into agent context.',
    suggested_fix: 'Remove debug prints before deployment, or use a logging framework with secret redaction.',
    weight: 12,
  },
  {
    id: 'CONSOLE_LOG_SENSITIVE',
    category: 'Debug Leak',
    severity: 'warning',
    source: 'ast',
    pattern: /console\.log\s*\(.*(?:key|secret|token|password|api_key|credential|auth).*\)/gi,
    message: 'console.log leaking sensitive data. This output may be captured by agent middleware.',
    suggested_fix: 'Remove console.log statements containing sensitive variables.',
    weight: 12,
  },
  {
    id: 'ENV_VAR_PRINT',
    category: 'Debug Leak',
    severity: 'warning',
    source: 'ast',
    pattern: /print\s*\(.*(?:os\.environ|process\.env).*\)/gi,
    message: 'Printing environment variables to stdout. These will be captured by the agent runtime.',
    suggested_fix: 'Never print environment variables. Use structured logging with secret filtering.',
    weight: 14,
  },
  {
    id: 'SUBPROCESS_CALL',
    category: 'Unsafe Call',
    severity: 'warning',
    source: 'ast',
    pattern: /(?:subprocess\.(?:call|run|Popen)|os\.system|os\.popen)\s*\(/g,
    message: 'Subprocess or system call detected. This could execute arbitrary commands.',
    suggested_fix: 'Validate and sanitize all inputs to subprocess calls. Use allowlists for commands.',
    weight: 14,
  },
  {
    id: 'EVAL_EXEC',
    category: 'Unsafe Call',
    severity: 'high',
    source: 'ast',
    pattern: /(?:eval|exec)\s*\(/g,
    message: 'eval() or exec() call detected. This executes arbitrary code and is a critical security risk.',
    suggested_fix: 'Replace eval/exec with safe alternatives. Parse JSON with json.loads(), use AST for code analysis.',
    weight: 22,
  },
  {
    id: 'PICKLE_LOAD',
    category: 'Unsafe Call',
    severity: 'high',
    source: 'ast',
    pattern: /pickle\.(?:load|loads)\s*\(/g,
    message: 'pickle.load detected. Untrusted pickle data can execute arbitrary code during deserialization.',
    suggested_fix: 'Use JSON or a safe serialization format. Never unpickle untrusted data.',
    weight: 20,
  },

  // ── Info: PII & Misc ──
  {
    id: 'EMAIL_ADDRESS',
    category: 'PII',
    severity: 'info',
    source: 'static',
    pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    message: 'Email address detected. This may constitute PII depending on context.',
    suggested_fix: 'Ensure email addresses are not logged or sent to external model contexts.',
    weight: 4,
  },
  {
    id: 'IP_ADDRESS',
    category: 'PII',
    severity: 'info',
    source: 'static',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    message: 'IP address detected. May reveal infrastructure or user information.',
    suggested_fix: 'Mask or redact IP addresses in tool outputs before forwarding to models.',
    weight: 4,
  },
  {
    id: 'PHONE_NUMBER',
    category: 'PII',
    severity: 'info',
    source: 'static',
    pattern: /(?:\+1[\-\s]?)?(?:\(\d{3}\)[\-\s]?|\d{3}[\-\s]?)\d{3}[\-\s]?\d{4}/g,
    message: 'Phone number pattern detected. This is PII that should be redacted.',
    suggested_fix: 'Redact phone numbers from tool outputs before they reach model context.',
    weight: 4,
  },
  {
    id: 'CREDIT_CARD',
    category: 'PII',
    severity: 'high',
    source: 'static',
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/g,
    message: 'Credit card number pattern detected. This is highly sensitive PII.',
    suggested_fix: 'Never log or transmit credit card numbers. Use tokenization.',
    weight: 24,
  },
  {
    id: 'SSN_PATTERN',
    category: 'PII',
    severity: 'high',
    source: 'static',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    message: 'Social Security Number pattern detected. Extremely sensitive PII.',
    suggested_fix: 'Never store or log SSNs. Mask all but the last 4 digits.',
    weight: 26,
  },
  {
    id: 'DOTENV_FILE',
    category: 'Config Leak',
    severity: 'warning',
    source: 'static',
    pattern: /dotenv\.(?:load|config)\s*\(/g,
    message: 'dotenv loading detected. Ensure .env files are not bundled with the skill.',
    suggested_fix: 'Add .env to .gitignore. Load environment from the host runtime, not bundled files.',
    weight: 8,
  },
  {
    id: 'HARDCODED_URL_WITH_CREDS',
    category: 'Credential',
    severity: 'high',
    source: 'static',
    pattern: /https?:\/\/[a-zA-Z0-9_]+:[a-zA-Z0-9_]+@[^\s'"]+/g,
    message: 'URL with embedded credentials detected (user:password@host pattern).',
    suggested_fix: 'Remove credentials from URLs. Use separate authentication configuration.',
    weight: 22,
  },
];

// Store scan results in memory for sample retrieval
const scanStore = new Map<string, ScanResult>();

export function generateScanId(): string {
  return `scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function storeScan(result: ScanResult): void {
  scanStore.set(result.scan_id, result);
  // Keep only last 100 scans in memory
  if (scanStore.size > 100) {
    const oldest = scanStore.keys().next().value;
    if (oldest) scanStore.delete(oldest);
  }
}

export function getScan(scanId: string): ScanResult | undefined {
  return scanStore.get(scanId);
}

export function scanCode(
  content: string,
  filename: string = 'input',
  label: string = 'direct input'
): ScanResult {
  const t0 = Date.now();
  const findings: Finding[] = [];
  const lines = content.split('\n');

  for (const rule of RULES) {
    // Reset regex lastIndex for global patterns
    rule.pattern.lastIndex = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      rule.pattern.lastIndex = 0;
      
      if (rule.pattern.test(line)) {
        findings.push({
          id: rule.id,
          category: rule.category,
          severity: rule.severity,
          source: rule.source,
          file: filename,
          line: i + 1,
          snippet: line.trim(),
          message: rule.message,
          suggested_fix: rule.suggested_fix,
          weight: rule.weight,
        });
      }
    }
  }

  // Deduplicate: same rule + same line
  const seen = new Set<string>();
  const deduped = findings.filter((f) => {
    const key = `${f.id}:${f.file}:${f.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const counts = { critical: 0, high: 0, warning: 0, info: 0 };
  let rawScore = 0;
  for (const f of deduped) {
    counts[f.severity]++;
    rawScore += f.weight;
  }

  const risk_score = Math.min(100, rawScore);
  let severity = 'Safe';
  if (risk_score >= 70) severity = 'High';
  else if (risk_score >= 40) severity = 'Warning';
  else if (risk_score > 0) severity = 'Info';

  const scan_id = generateScanId();
  const result: ScanResult = {
    scan_id,
    risk_score,
    severity,
    findings: deduped,
    counts,
    files_scanned: 1,
    duration_ms: Date.now() - t0,
    label,
    can_download: false,
    raw_content: content,
  };

  storeScan(result);
  return result;
}

export function scanMultipleFiles(
  files: { name: string; content: string }[],
  label: string
): ScanResult {
  const t0 = Date.now();
  const allFindings: Finding[] = [];

  for (const file of files) {
    const result = scanCode(file.content, file.name, label);
    allFindings.push(...result.findings);
  }

  // Deduplicate
  const seen = new Set<string>();
  const deduped = allFindings.filter((f) => {
    const key = `${f.id}:${f.file}:${f.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const counts = { critical: 0, high: 0, warning: 0, info: 0 };
  let rawScore = 0;
  for (const f of deduped) {
    counts[f.severity]++;
    rawScore += f.weight;
  }

  const risk_score = Math.min(100, rawScore);
  let severity = 'Safe';
  if (risk_score >= 70) severity = 'High';
  else if (risk_score >= 40) severity = 'Warning';
  else if (risk_score > 0) severity = 'Info';

  const scan_id = generateScanId();
  const result: ScanResult = {
    scan_id,
    risk_score,
    severity,
    findings: deduped,
    counts,
    files_scanned: files.length,
    duration_ms: Date.now() - t0,
    label,
    can_download: false,
  };

  storeScan(result);
  return result;
}

export function redactText(text: string): { output: string; redactions: number } {
  let output = text;
  let redactions = 0;

  for (const rule of RULES) {
    // Create a fresh regex to avoid lastIndex issues with global patterns
    const freshPattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    output = output.replace(freshPattern, () => {
      redactions++;
      return '[REDACTED by AegisShield]';
    });
  }

  return { output, redactions };
}
