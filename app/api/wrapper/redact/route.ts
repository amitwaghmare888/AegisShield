import { NextResponse } from 'next/server';
import { redactText } from '@/lib/engine';

export async function POST(req: Request) {
  try {
    const { text } = await req.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'No text provided' }, { status: 400 });
    }

    const { output, redactions } = redactText(text);

    return NextResponse.json({
      output,
      redactions,
      output_chars: output.length,
      input_chars: text.length,
    });
  } catch (error) {
    console.error('[aegisshield] wrapper error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
