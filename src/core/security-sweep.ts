import type { SecuritySweepConfig } from "../types/memory.js";

export interface SecuritySweepMatch {
  type: string;
  text: string;
}

export interface SecuritySweepResult {
  hasMatches: boolean;
  matches: SecuritySweepMatch[];
  redactedContent: string;
}

interface StandardPattern {
  name: string;
  regex: RegExp;
  category: "privateKeys" | "apiKeys" | "databaseUris" | "pii";
}

const DEFAULT_PATTERNS: StandardPattern[] = [
  // ── Private Keys ─────────────────────────────────────────────────────────
  {
    name: "Private Key",
    regex: /-----BEGIN[ A-Z0-9_-]+PRIVATE KEY-----[\s\S]+?-----END[ A-Z0-9_-]+PRIVATE KEY-----/gi,
    category: "privateKeys",
  },
  // ── API Keys ──────────────────────────────────────────────────────────────
  {
    // AWS Access Key ID — starts with well-known AWS prefixes, exactly 20 chars total
    name: "AWS Access Key ID",
    regex: /\b(AKIA|AGPA|AIPA|ANPA|ANVA|AROA|ASCA|ASIA)[A-Z0-9]{16}\b/g,
    category: "apiKeys",
  },
  {
    // AWS Secret Access Key — requires variable name context to avoid bare 40-char false positives
    name: "AWS Secret Access Key",
    regex: /(?:aws_secret_access_key|SecretAccessKey|AWS_SECRET_ACCESS_KEY|aws_secret)\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi,
    category: "apiKeys",
  },
  {
    name: "Google API Key",
    regex: /\bAIzaSy[A-Za-z0-9_-]{35}\b/g,
    category: "apiKeys",
  },
  {
    name: "OpenAI API Key",
    regex: /\bsk-(?:proj-)?[A-Za-z0-9]{40,}\b/g,
    category: "apiKeys",
  },
  {
    // Anthropic: covers both workspace (sid01) and standard API (api03) key formats
    name: "Anthropic API Key",
    regex: /\bsk-ant-(?:sid01|api03)-[A-Za-z0-9_-]{93,}\b/g,
    category: "apiKeys",
  },
  {
    name: "Stripe API Key",
    regex: /\bsk_(?:live|test)_[0-9a-zA-Z]{24}\b/g,
    category: "apiKeys",
  },
  {
    name: "Slack Token",
    regex: /\bxox[bapr]-[0-9]{12}-[0-9]{12}-[0-9a-zA-Z]{24}\b/g,
    category: "apiKeys",
  },
  {
    // GitHub Personal Access Token — classic and fine-grained
    name: "GitHub Token",
    regex: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{36,}\b/g,
    category: "apiKeys",
  },
  // ── PII ───────────────────────────────────────────────────────────────────
  {
    name: "Email Address",
    regex: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
    category: "pii",
  },
  {
    name: "Social Security Number (SSN)",
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    category: "pii",
  },
  {
    // Credit Card — only matches cards with standard separator formatting (spaces or dashes)
    // to avoid hitting timestamps, build IDs, and other numeric strings
    name: "Credit Card Number (PAN)",
    regex: /\b(?:4[0-9]{3}|5[1-5][0-9]{2}|3[47][0-9]{2}|6(?:011|5[0-9]{2})|3(?:0[0-5]|[68][0-9])\d)[ -]?(?:\d{4}[ -]?){2}\d{4,7}\b/g,
    category: "pii",
  },
];

export class SecuritySweepEngine {
  private readonly config: SecuritySweepConfig;

  constructor(config?: SecuritySweepConfig) {
    this.config = config ?? {
      enabled: true,
      level: "warn",
      rules: {
        privateKeys: true,
        apiKeys: true,
        databaseUris: true,
        pii: false,
      },
    };
  }

  public sweep(content: string): SecuritySweepResult {
    if (!this.config.enabled) {
      return {
        hasMatches: false,
        matches: [],
        redactedContent: content,
      };
    }

    const matches: SecuritySweepMatch[] = [];
    let redactedContent = content;

    // 1. DB URI sweep first — masks password before any email/PII rules run
    // so that `user:pass@host` doesn't trigger the email pattern
    if (this.config.rules?.databaseUris !== false) {
      const dbRegex = /((?:mongodb(?:\+srv)?|postgres|postgresql|mysql|sqlite):\/\/[a-zA-Z0-9_.-]+:)([^@\s]+)(@[a-zA-Z0-9_.\-/:]+)/gi;
      dbRegex.lastIndex = 0;

      const matchedPasswords: string[] = [];
      let dbMatch: RegExpExecArray | null;
      while ((dbMatch = dbRegex.exec(redactedContent)) !== null) {
        const password = dbMatch[2];
        if (password && password !== "[REDACTED_PASSWORD]" && !matchedPasswords.includes(password)) {
          matchedPasswords.push(password);
          matches.push({ type: "Database Password", text: password });
        }
      }

      redactedContent = redactedContent.replace(dbRegex, "$1[REDACTED_PASSWORD]$3");
    }

    // 2. Standard patterns (run on progressively-redacted content)
    for (const pattern of DEFAULT_PATTERNS) {
      const isRuleEnabled = this.config.rules?.[pattern.category] !== false;
      if (!isRuleEnabled) {
        continue;
      }

      pattern.regex.lastIndex = 0;
      let match: RegExpExecArray | null;

      const localMatches: string[] = [];
      while ((match = pattern.regex.exec(redactedContent)) !== null) {
        const matchText = match[0];
        if (!localMatches.includes(matchText)) {
          localMatches.push(matchText);
          matches.push({ type: pattern.name, text: matchText });
        }
      }

      for (const m of localMatches) {
        const replacement = `[REDACTED_${pattern.name.toUpperCase().replace(/\s+/g, "_")}]`;
        redactedContent = redactedContent.replaceAll(m, replacement);
      }
    }

    // 3. Custom user-defined patterns
    if (Array.isArray(this.config.customPatterns)) {
      for (const custom of this.config.customPatterns) {
        try {
          const regex = new RegExp(custom.regex, "g");
          regex.lastIndex = 0;
          let customMatch: RegExpExecArray | null;

          const localMatches: string[] = [];
          while ((customMatch = regex.exec(redactedContent)) !== null) {
            const matchText = customMatch[0];
            if (!localMatches.includes(matchText)) {
              localMatches.push(matchText);
              matches.push({ type: custom.name, text: matchText });
            }
          }

          for (const m of localMatches) {
            const replacement = `[REDACTED_${custom.name.toUpperCase().replace(/\s+/g, "_")}]`;
            redactedContent = redactedContent.replaceAll(m, replacement);
          }
        } catch (err) {
          console.error(`[SecuritySweepEngine] Invalid custom pattern regex "${custom.regex}":`, err);
        }
      }
    }

    return {
      hasMatches: matches.length > 0,
      matches,
      redactedContent,
    };
  }
}
