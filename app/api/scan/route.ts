import { NextResponse } from 'next/server';
import { scanCode } from '@/lib/engine';

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get('content-type') || '';
    
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      
      if (!file) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 });
      }

      const text = await file.text();
      const result = scanCode(text, file.name, file.name);
      result.can_download = true;

      return NextResponse.json(result);
    }
    
    // JSON body
    const body = await req.json();
    const code = body.codeSnippet || body.code || '';
    
    if (!code) {
      return NextResponse.json({ error: 'No code provided' }, { status: 400 });
    }

    const result = scanCode(code, 'input', 'direct input');
    return NextResponse.json(result);
  } catch (error) {
    console.error('[aegisshield] scan error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}