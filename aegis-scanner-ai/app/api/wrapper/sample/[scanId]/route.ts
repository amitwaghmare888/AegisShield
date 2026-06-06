import { NextResponse } from 'next/server';
import { getScan } from '@/lib/engine';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ scanId: string }> }
) {
  try {
    const { scanId } = await params;
    const scan = getScan(scanId);

    if (!scan) {
      return NextResponse.json({ text: '', from_scan: false });
    }

    // Build a sample from the raw content or findings
    if (scan.raw_content) {
      // Return a chunk of the raw content that contains findings
      const lines = scan.raw_content.split('\n');
      const findingLines = scan.findings.map(f => f.line).filter(Boolean);
      
      if (findingLines.length > 0) {
        const start = Math.max(0, Math.min(...findingLines) - 3);
        const end = Math.min(lines.length, Math.max(...findingLines) + 3);
        const text = lines.slice(start, end).join('\n');
        return NextResponse.json({ text, from_scan: true });
      }

      // Return first 20 lines
      return NextResponse.json({
        text: lines.slice(0, 20).join('\n'),
        from_scan: true,
      });
    }

    // Build from findings snippets
    if (scan.findings.length > 0) {
      const text = scan.findings
        .slice(0, 5)
        .map(f => `# ${f.file}:${f.line}\n${f.snippet}`)
        .join('\n\n');
      return NextResponse.json({ text, from_scan: true });
    }

    return NextResponse.json({ text: '', from_scan: false });
  } catch (error) {
    console.error('[aegisshield] sample error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
