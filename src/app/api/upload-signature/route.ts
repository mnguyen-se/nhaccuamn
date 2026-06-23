import { NextResponse } from 'next/server';
import { generateUploadSignature } from '@/lib/cloudinary';

export async function GET() {
  try {
    const signature = await generateUploadSignature('music');
    return NextResponse.json(signature);
  } catch (error) {
    console.error('Signature error:', error);
    return NextResponse.json({ error: 'Failed to generate signature' }, { status: 500 });
  }
}
