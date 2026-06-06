import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(req: Request) {
  try {
    const { text } = await req.json();

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Server Gemini API key not configured.' }, { status: 500 });
    }

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json(
        { error: 'No text provided for redaction.' },
        { status: 400 }
      );
    }

    // Truncate to avoid token limits
    const truncated = text.length > 8000 ? text.slice(0, 8000) : text;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });

    const prompt = `You are AegisShield's intelligent redaction engine. Your job is to sanitize text that will be injected into an LLM's context window.

Analyze the following text and redact ALL sensitive information by replacing it with [REDACTED]. Be thorough but precise:

**What to redact:**
- API keys, tokens, secrets, passwords (even if obfuscated, encoded in base64, hex, or split across lines)
- Private keys, certificates, JWTs
- Database connection strings with credentials
- PII: email addresses, phone numbers, SSNs, credit card numbers, physical addresses
- IP addresses of internal/private networks (10.x, 172.16-31.x, 192.168.x)
- Wallet private keys, seed phrases
- Session IDs, OAuth tokens, bearer tokens
- URLs with embedded credentials (user:pass@host)

**What to preserve:**
- General code structure and logic
- Non-sensitive variable names
- Public URLs without credentials
- Generic log messages
- Stack traces (but redact file paths that reveal internal structure)

**Input text:**
${truncated}

**Rules:**
- Return ONLY the redacted text. No explanations, no formatting.
- Preserve the exact formatting, newlines, and whitespace of the original.
- Replace each secret with exactly: [REDACTED]
- If nothing needs redaction, return the original text unchanged.`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const redactedText = response.text();

    // Count redactions
    const redactions = (redactedText.match(/\[REDACTED\]/g) || []).length;

    return NextResponse.json({
      output: redactedText,
      redactions,
      input_chars: text.length,
      output_chars: redactedText.length,
      mode: 'ai',
    });
  } catch (error: unknown) {
    console.error('[aegisshield ai-redact] error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown AI Error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
