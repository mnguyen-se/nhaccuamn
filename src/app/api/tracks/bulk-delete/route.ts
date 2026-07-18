import { NextRequest, NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const publicIds: string[] = Array.isArray(body?.publicIds) ? body.publicIds : [];

    if (!publicIds.length) {
      return NextResponse.json({ error: 'Danh sách trống' }, { status: 400 });
    }

    // Cloudinary cho phép xoá tối đa 100 resource/lần gọi
    const chunks: string[][] = [];
    for (let i = 0; i < publicIds.length; i += 100) {
      chunks.push(publicIds.slice(i, i + 100));
    }

    let deletedCount = 0;
    const failed: string[] = [];

    for (const chunk of chunks) {
      const result = await cloudinary.api.delete_resources(chunk, {
        resource_type: 'video',
      });
      for (const [publicId, status] of Object.entries(result.deleted || {})) {
        if (status === 'deleted') {
          deletedCount++;
        } else {
          failed.push(publicId);
        }
      }
    }

    return NextResponse.json({ success: true, deletedCount, failed });
  } catch (error) {
    console.error('Bulk delete error:', error);
    return NextResponse.json({ error: 'Xoá thất bại' }, { status: 500 });
  }
}