import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(req: Request) {
  try {
    const { findingId, snippet, message, file, line } = await req.json();

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Server Gemini API key not configured.' }, { status: 500 });
    }

    if (!snippet) {
      return NextResponse.json({ error: 'No code snippet provided.' }, { status: 400 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });

    const prompt = `
You are an expert security engineer and code auditor working on AegisShield.
A security vulnerability was detected in a third-party AI agent skill.

File: ${file}:${line}
Vulnerability Type: ${findingId}
Scanner Message: ${message}

Original Code Snippet:
\`\`\`
${snippet}
\`\`\`

Your task is to fix this code snippet.
1. Remove the vulnerability (e.g., replace hardcoded secrets with environment variables, remove unsafe evals, remove debug prints of secrets).
2. Keep the surrounding context and syntax exactly the same (if it's Python, write Python; if TS, write TS).
3. Do NOT provide any markdown formatting like \`\`\`python around your answer. Provide ONLY the raw, fixed code snippet so it can be used as a drop-in replacement.
4. Do NOT explain your changes. Just provide the code.

Fixed Code Snippet:
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text().trim();

    // Sometimes the model still wraps in markdown despite instructions, strip it if so
    if (text.startsWith('```') && text.endsWith('```')) {
      const lines = text.split('\n');
      text = lines.slice(1, -1).join('\n').trim();
    }

    return NextResponse.json({ fix: text });
  } catch (error: unknown) {
    console.error('[aegisshield ai] error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown AI Error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
