import { NextResponse } from 'next/server';
import { scanCode } from '@/lib/engine';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Check file size (25MB max)
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large. Maximum 25 MB.' }, { status: 413 });
    }

    const text = await file.text();
    const result = scanCode(text, file.name, file.name);
    result.can_download = true;

    return NextResponse.json(result);
  } catch (error) {
    console.error('[aegisshield] file scan error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
