import { NextRequest, NextResponse } from 'next/server';
import { generateUploadSignature } from '@/lib/cloudinary';

// POST: dùng khi client muốn upload vào 1 thư mục cụ thể (music/TenNgheSi)
// kèm context (title) — cả hai đều được ký đúng chuẩn tại server.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const folder = typeof body?.folder === 'string' ? body.folder : 'music';
    const context = typeof body?.context === 'string' ? body.context : undefined;
    const publicId = typeof body?.publicId === 'string' ? body.publicId : undefined; // <-- thêm dòng này
    const signature = await generateUploadSignature(folder, context, publicId); // <-- thêm publicId
    return NextResponse.json(signature);
  } catch (error) {
    console.error('Signature error:', error);
    return NextResponse.json({ error: 'Failed to generate signature' }, { status: 500 });
  }
}

// GET: giữ lại cho tương thích ngược (upload vào thư mục "music" gốc)
export async function GET() {
  try {
    const signature = await generateUploadSignature('music');
    return NextResponse.json(signature);
  } catch (error) {
    console.error('Signature error:', error);
    return NextResponse.json({ error: 'Failed to generate signature' }, { status: 500 });
  }
}