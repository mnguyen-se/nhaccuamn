import { NextRequest, NextResponse } from 'next/server';
import { getArtistFolders, createArtistFolder, getAlbumFolders, createAlbumFolder, deleteAlbum } from '@/lib/cloudinary';

// GET: liệt kê thư mục
// - Không có query "parent"  -> liệt kê danh sách nghệ sĩ (như cũ)
// - Có query "parent=music/MCK" -> liệt kê album bên trong nghệ sĩ đó
export async function GET(request: NextRequest) {
  try {
    const parent = request.nextUrl.searchParams.get('parent');

    if (parent) {
      // parent có dạng "music/{artist}" -> tách lấy tên nghệ sĩ
      const match = /^music\/([^/]+)$/.exec(parent.trim());
      if (!match) {
        return NextResponse.json({ error: 'parent không hợp lệ' }, { status: 400 });
      }
      const artist = match[1];
      const folders = await getAlbumFolders(artist);
      return NextResponse.json({ folders });
    }

    const folders = await getArtistFolders();
    return NextResponse.json({ folders });
  } catch (error) {
    console.error('Error listing folders:', error);
    return NextResponse.json({ error: 'Failed to list folders' }, { status: 500 });
  }
}

// POST: tạo thư mục mới
// - Không có "parent" trong body -> tạo nghệ sĩ mới (như cũ)
// - Có "parent": "MCK" trong body -> tạo album mới bên trong nghệ sĩ "MCK"
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const name = typeof body?.name === 'string' ? body.name : '';
    const parent = typeof body?.parent === 'string' ? body.parent.trim() : '';

    if (!name.trim()) {
      return NextResponse.json(
        { error: parent ? 'Tên album không được để trống' : 'Tên thư mục không được để trống' },
        { status: 400 }
      );
    }

    if (parent) {
      // Tạo album mới bên trong 1 nghệ sĩ đã có sẵn
      const folder = await createAlbumFolder(parent, name);
      return NextResponse.json({ folder, parent });
    }

    const folder = await createArtistFolder(name);
    return NextResponse.json({ folder });
  } catch (error: any) {
    console.error('Error creating folder:', error);
    const message = error?.message || 'Failed to create folder';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE: xoá 1 album cụ thể (và toàn bộ bài hát bên trong)
// Body: { artist: "MCK", album: "RPT Vol.1" }
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const artist = typeof body?.artist === 'string' ? body.artist.trim() : '';
    const album = typeof body?.album === 'string' ? body.album.trim() : '';

    if (!artist || !album) {
      return NextResponse.json({ error: 'Thiếu artist hoặc album' }, { status: 400 });
    }

    const deletedCount = await deleteAlbum(artist, album);
    return NextResponse.json({ success: true, deletedCount });
  } catch (error) {
    console.error('Error deleting album:', error);
    return NextResponse.json({ error: 'Failed to delete album' }, { status: 500 });
  }
}