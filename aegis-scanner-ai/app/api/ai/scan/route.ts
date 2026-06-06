import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface AIFinding {
  id: string;
  category: string;
  severity: 'critical' | 'high' | 'warning' | 'info';
  file: string;
  line: number;
  snippet: string;
  message: string;
  suggested_fix: string;
  confidence: number; // 0-100
}

export async function POST(req: Request) {
  try {
    const { code, filename } = await req.json();

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Server Gemini API key not configured.' }, { status: 500 });
    }

    if (!code || typeof code !== 'string' || code.trim().length === 0) {
      return NextResponse.json(
        { error: 'No code provided for AI analysis.' },
        { status: 400 }
      );
    }

    // Truncate very large files to avoid token limits
    const truncated = code.length > 15000 ? code.slice(0, 15000) + '\n\n// ... truncated ...' : code;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });

    const prompt = `You are AegisShield, an expert AI security auditor for agentic AI tool supply chains.
Analyze the following source code for security vulnerabilities that a REGEX-based scanner would MISS.

Focus specifically on:
1. **Prompt Injection** — Code that could allow an attacker to manipulate LLM prompts or inject instructions
2. **Obfuscated Secrets** — Secrets encoded in base64, hex, rot13, or split across variables
3. **Unsafe Data Flows** — Sensitive data flowing from environment/config to stdout, logs, HTTP responses, or return values that an agent would capture
4. **Deserialization Attacks** — yaml.load, pickle, eval of user input, JSON.parse of untrusted data without validation
5. **Supply Chain Risks** — Dynamic imports, remote code execution patterns, fetching and executing remote scripts
6. **Privilege Escalation** — Code that requests unnecessary permissions, accesses filesystem broadly, or modifies system state
7. **Data Exfiltration** — Patterns where sensitive data could be sent to external endpoints

File: ${filename || 'unknown'}

\`\`\`
${truncated}
\`\`\`

Return ONLY a valid JSON array of findings. Each finding must have this exact structure:
{
  "id": "AI_<SHORT_RULE_ID>",
  "category": "<category name>",
  "severity": "critical" | "high" | "warning" | "info",
  "line": <line number or 0 if uncertain>,
  "snippet": "<the relevant code snippet, max 120 chars>",
  "message": "<detailed explanation of the vulnerability>",
  "suggested_fix": "<how to fix it>",
  "confidence": <0-100>
}

Rules:
- Return an empty array [] if no issues are found. DO NOT fabricate findings.
- Only report issues with confidence >= 40.
- Do NOT report issues that a simple regex scanner would already catch (like plaintext API keys matching patterns like sk-*, AKIA*, etc).
- Focus on SEMANTIC and CONTEXTUAL vulnerabilities.
- Return ONLY the JSON array, no markdown formatting, no code fences, no explanation.`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    let text = response.text().trim();

    // Strip markdown code fences if the model adds them despite instructions
    if (text.startsWith('```')) {
      const lines = text.split('\n');
      // Remove first line (```json or ```) and last line (```)
      text = lines.slice(1, lines.length - (lines[lines.length - 1].trim() === '```' ? 1 : 0)).join('\n').trim();
    }

    let findings: AIFinding[];
    try {
      findings = JSON.parse(text);
      if (!Array.isArray(findings)) {
        findings = [];
      }
      // Validate and sanitize each finding
      findings = findings
        .filter((f): f is AIFinding =>
          f && typeof f.id === 'string' && typeof f.message === 'string'
        )
        .map(f => ({
          id: String(f.id || 'AI_UNKNOWN').slice(0, 50),
          category: String(f.category || 'AI Analysis').slice(0, 50),
          severity: (['critical', 'high', 'warning', 'info'].includes(f.severity) ? f.severity : 'warning') as AIFinding['severity'],
          file: filename || 'unknown',
          line: typeof f.line === 'number' ? f.line : 0,
          snippet: String(f.snippet || '').slice(0, 200),
          message: String(f.message || '').slice(0, 500),
          suggested_fix: String(f.suggested_fix || '').slice(0, 500),
          confidence: typeof f.confidence === 'number' ? Math.min(100, Math.max(0, f.confidence)) : 50,
        }));
    } catch {
      // If parsing fails, return empty findings rather than error
      findings = [];
    }

    return NextResponse.json({
      findings,
      model: 'gemini-3.5-flash',
      scanned_chars: truncated.length,
    });
  } catch (error: unknown) {
    console.error('[aegisshield ai-scan] error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown AI Error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
