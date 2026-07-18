import { NextRequest, NextResponse } from 'next/server';
import { setTrackTitle } from '@/lib/cloudinary';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { publicId, title } = body;

    if (!publicId || !title) {
      return NextResponse.json({ error: 'Missing publicId or title' }, { status: 400 });
    }

    const success = await setTrackTitle(publicId, title);
    return success
      ? NextResponse.json({ success: true })
      : NextResponse.json({ error: 'Failed to set title' }, { status: 500 });
  } catch (error) {
    console.error('Set title error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}