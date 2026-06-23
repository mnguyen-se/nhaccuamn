import { NextResponse } from 'next/server';
import { getAllTracks } from '@/lib/cloudinary';

export async function GET() {
  try {
    const tracks = await getAllTracks();
    return NextResponse.json({ tracks });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Failed to fetch tracks' }, { status: 500 });
  }
}
