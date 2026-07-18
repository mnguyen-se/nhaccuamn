import { NextRequest, NextResponse } from 'next/server';
import { getArtistFolders, createArtistFolder } from '@/lib/cloudinary';

// GET: liệt kê các thư mục (nghệ sĩ) đã có trong Cloudinary, để hiện danh sách cuộn chọn
export async function GET() {
  try {
    const folders = await getArtistFolders();
    return NextResponse.json({ folders });
  } catch (error) {
    console.error('Error listing folders:', error);
    return NextResponse.json({ error: 'Failed to list folders' }, { status: 500 });
  }
}

// POST: tạo thư mục (nghệ sĩ) mới, dùng khi bấm nút "+"
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const name = typeof body?.name === 'string' ? body.name : '';
    if (!name.trim()) {
      return NextResponse.json({ error: 'Tên thư mục không được để trống' }, { status: 400 });
    }
    const folder = await createArtistFolder(name);
    return NextResponse.json({ folder });
  } catch (error) {
    console.error('Error creating folder:', error);
    return NextResponse.json({ error: 'Failed to create folder' }, { status: 500 });
  }
}