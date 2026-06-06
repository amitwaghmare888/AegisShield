import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(req: Request) {
  try {
    const { findings, riskScore, label, fileCount } = await req.json();

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Server Gemini API key not configured.' }, { status: 500 });
    }

    if (!findings || !Array.isArray(findings)) {
      return NextResponse.json(
        { error: 'No findings provided.' },
        { status: 400 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });

    // Build a condensed representation of findings for the prompt
    const findingsSummary = findings.slice(0, 30).map((f: {
      id?: string; severity?: string; category?: string; file?: string;
      line?: number; message?: string; snippet?: string;
    }, i: number) =>
      `${i + 1}. [${(f.severity || 'info').toUpperCase()}] ${f.id || 'UNKNOWN'} in ${f.file || 'unknown'}:${f.line || '?'} — ${f.message || ''}`
    ).join('\n');

    const prompt = `You are AegisShield, an enterprise AI security advisor.

A security scan has been completed on "${label || 'unknown source'}" (${fileCount || 1} files scanned).
Overall Risk Score: ${riskScore ?? 0}/100

Here are the findings:
${findingsSummary || 'No findings detected.'}

Generate a concise, professional **Executive Threat Summary** for a security team. Structure it as follows:

1. **Overview** (2-3 sentences): What was scanned and the overall risk posture.
2. **Critical Findings** (if any): The most dangerous issues requiring immediate action.
3. **Attack Scenarios**: 1-2 realistic attack scenarios showing how these vulnerabilities could be exploited in an agentic AI pipeline.
4. **Remediation Priority**: Ordered list of what to fix first.
5. **Risk Verdict**: A single sentence final verdict.

Keep the total response under 350 words. Use plain text, no markdown headers or formatting. Use line breaks between sections. Be specific — reference actual finding IDs and line numbers from the scan.`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const summary = response.text().trim();

    return NextResponse.json({ summary });
  } catch (error: unknown) {
    console.error('[aegisshield ai-summary] error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown AI Error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
