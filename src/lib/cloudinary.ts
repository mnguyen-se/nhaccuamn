import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

interface Track {
  id: string;
  public_id: string;
  url: string;
  title: string;
  artist: string;
  album: string; // '' nếu bài hát nằm trực tiếp trong thư mục nghệ sĩ, không thuộc album nào
  duration: number;
  format: string;
  size: number;
  created_at: string;
}

export async function getAllTracks(): Promise<Track[]> {
  try {
    // 👇 THAY ĐỔI: lấy toàn bộ đường dẫn thư mục cần quét, bao gồm cả
    // cấp album bên trong mỗi nghệ sĩ (trước đây chỉ quét tới cấp nghệ sĩ,
    // nên các bài nằm trong album sẽ không được liệt kê).
    const folderPaths = await getAllFolderPaths();

    const resourceMap = new Map<string, any>();

    for (const folderPath of folderPaths) {
      try {
        const result = await cloudinary.api.resources_by_asset_folder(folderPath, {
          context: true,
          max_results: 100,
        });
        for (const r of result.resources) {
          resourceMap.set(r.asset_id, r);
        }
      } catch (err: any) {
        // Thư mục rỗng hoặc chưa tồn tại — bỏ qua, không làm hỏng cả danh sách
        if (err?.error?.http_code !== 404 && err?.http_code !== 404) {
          console.error(`Error fetching resources for folder "${folderPath}":`, err);
        }
      }
    }

    const allResources = Array.from(resourceMap.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    return allResources.map((r: any) => {
      const rawTitle: string = r.context?.custom?.title || extractTitle(r.public_id);
      const contextArtist: string | undefined = r.context?.custom?.artist;
      const { artist, album } = deriveArtistAndAlbum(r.public_id, contextArtist, r.asset_folder);

      return {
        id: r.asset_id,
        public_id: r.public_id,
        url: r.secure_url,
        title: rawTitle.trim() || 'Untitled',
        artist,
        album,
        duration: r.duration || 0,
        format: r.format,
        size: r.bytes,
        created_at: r.created_at,
        cover: r.context?.custom?.cover || null,
      };
    });
  } catch (error) {
    console.error('Error fetching tracks:', error);
    return [];
  }
}

// 👇 THÊM: liệt kê toàn bộ đường dẫn cần quét — "music", "music/{artist}",
// và "music/{artist}/{album}" cho từng album trong từng nghệ sĩ.
async function getAllFolderPaths(): Promise<string[]> {
  const artists = await getArtistFolders();
  const paths = ['music', ...artists.map(a => `music/${a}`)];

  for (const artist of artists) {
    const albums = await getAlbumFolders(artist);
    for (const album of albums) {
      paths.push(`music/${artist}/${album}`);
    }
  }

  return paths;
}

// 👇 THAY ĐỔI: tách artist/album từ asset_folder có thể có 2 hoặc 3 cấp:
//   "music/{artist}"          -> artist = parts[1], album = ''
//   "music/{artist}/{album}"  -> artist = parts[1], album = parts[2]
function deriveArtistAndAlbum(
  publicId: string,
  contextArtist?: string,
  assetFolder?: string
): { artist: string; album: string } {
  if (assetFolder) {
    const parts = assetFolder.split('/');
    if (parts.length >= 2 && parts[0] === 'music') {
      const artistName = parts[1].replace(/[-_]/g, ' ').trim();
      const albumName = parts.length >= 3 ? parts[2].replace(/[-_]/g, ' ').trim() : '';
      if (artistName) return { artist: artistName, album: albumName };
    }
  }
  if (contextArtist && contextArtist.trim()) return { artist: contextArtist.trim(), album: '' };
  return { artist: 'Không rõ nghệ sĩ', album: '' };
}

// Danh sách thư mục (nghệ sĩ) hiện có trong Cloudinary, dưới "music/"
export async function getArtistFolders(): Promise<string[]> {
  try {
    const result = await cloudinary.api.sub_folders('music');
    return (result.folders || []).map((f: any) => f.name).sort((a: string, b: string) => a.localeCompare(b, 'vi'));
  } catch (error: any) {
    // Nếu thư mục "music" chưa tồn tại (chưa upload gì bao giờ), Cloudinary trả lỗi 404 — coi như danh sách rỗng
    if (error?.error?.http_code === 404 || error?.http_code === 404) return [];
    console.error('Error fetching folders:', error);
    return [];
  }
}

// 👇 THÊM: danh sách album (thư mục con) bên trong 1 nghệ sĩ cụ thể
export async function getAlbumFolders(artist: string): Promise<string[]> {
  try {
    const result = await cloudinary.api.sub_folders(`music/${artist}`);
    return (result.folders || []).map((f: any) => f.name).sort((a: string, b: string) => a.localeCompare(b, 'vi'));
  } catch (error: any) {
    if (error?.error?.http_code === 404 || error?.http_code === 404) return [];
    console.error(`Error fetching albums for artist "${artist}":`, error);
    return [];
  }
}

// Tạo thư mục nghệ sĩ mới (rỗng) trong Cloudinary
export async function createArtistFolder(name: string): Promise<string> {
  const safeName = sanitizeFolderName(name);
  if (!safeName) throw new Error('Tên thư mục không hợp lệ');
  await cloudinary.api.create_folder(`music/${safeName}`);
  return safeName;
}

// 👇 THÊM: tạo album mới (thư mục con) bên trong 1 nghệ sĩ
export async function createAlbumFolder(artist: string, album: string): Promise<string> {
  const safeArtist = sanitizeFolderName(artist);
  const safeAlbum = sanitizeFolderName(album);
  if (!safeArtist) throw new Error('Tên nghệ sĩ không hợp lệ');
  if (!safeAlbum) throw new Error('Tên album không hợp lệ');
  await cloudinary.api.create_folder(`music/${safeArtist}/${safeAlbum}`);
  return safeAlbum;
}

export function sanitizeFolderName(name: string): string {
  return name
    .trim()
    .replace(/[\\/]/g, ' ') // không cho chứa dấu / \ để tránh tạo thư mục lồng ngoài ý muốn
    .replace(/\.\./g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim();
}

// 👇 THÊM: xoá toàn bộ bài hát trong 1 album, rồi xoá luôn thư mục album đó
export async function deleteAlbum(artist: string, album: string): Promise<number> {
  const folderPath = `music/${artist}/${album}`;
  let deletedCount = 0;

  try {
    const result = await cloudinary.api.resources_by_asset_folder(folderPath, { max_results: 500 });
    const publicIds: string[] = (result.resources || []).map((r: any) => r.public_id);

    for (const publicId of publicIds) {
      const res = await cloudinary.uploader.destroy(publicId, { resource_type: 'video' });
      if (res.result === 'ok') deletedCount++;
    }
  } catch (error: any) {
    if (error?.error?.http_code !== 404 && error?.http_code !== 404) {
      console.error(`Error fetching resources to delete for album "${folderPath}":`, error);
    }
  }

  try {
    await cloudinary.api.delete_folder(folderPath);
  } catch (error) {
    // Có thể folder chưa rỗng do 1 vài resource xoá lỗi, hoặc đã bị xoá — bỏ qua,
    // vì các bài hát đã xoá là phần quan trọng nhất.
    console.error(`Error deleting folder "${folderPath}":`, error);
  }

  return deletedCount;
}

export async function deleteTrack(publicId: string): Promise<boolean> {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'video',
    });
    return result.result === 'ok';
  } catch (error) {
    console.error('Error deleting track:', error);
    return false;
  }
}

function extractTitle(publicId: string): string {
  const parts = publicId.split('/');
  const filename = parts[parts.length - 1];
  return filename
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

export async function generateUploadSignature(
  folder: string = 'music',
  context?: string,
  publicId?: string
) {
  const timestamp = Math.round(new Date().getTime() / 1000);
  const safeFolder = validateUploadFolder(folder);

  const params: Record<string, string | number> = { timestamp, folder: safeFolder };
  if (context) params.context = context;
  if (publicId) params.public_id = publicId; // <-- thêm dòng này

  const signature = cloudinary.utils.api_sign_request(
    params,
    process.env.CLOUDINARY_API_SECRET!
  );

  return {
    timestamp,
    signature,
    api_key: process.env.CLOUDINARY_API_KEY!,
    cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME!,
    folder: safeFolder,
    context: context || '',
    public_id: publicId || null, // <-- và dòng này
  };
}

// 👇 THAY ĐỔI: giờ cho phép "music", "music/{artist}" HOẶC "music/{artist}/{album}"
// (trước đây chỉ cho tối đa 1 cấp con, chặn luôn cả cấp album).
function validateUploadFolder(folder: string): string {
  const trimmed = (folder || 'music').trim().replace(/^\/+|\/+$/g, '');
  if (trimmed === 'music') return 'music';

  const oneLevelMatch = /^music\/([^/]+)$/.exec(trimmed);
  if (oneLevelMatch) {
    const safeSub = sanitizeFolderName(oneLevelMatch[1]);
    return safeSub ? `music/${safeSub}` : 'music';
  }

  const twoLevelMatch = /^music\/([^/]+)\/([^/]+)$/.exec(trimmed);
  if (twoLevelMatch) {
    const safeArtist = sanitizeFolderName(twoLevelMatch[1]);
    const safeAlbum = sanitizeFolderName(twoLevelMatch[2]);
    if (safeArtist && safeAlbum) return `music/${safeArtist}/${safeAlbum}`;
    if (safeArtist) return `music/${safeArtist}`;
  }

  return 'music';
}

export async function setTrackTitle(publicId: string, title: string): Promise<boolean> {
  try {
    const safeTitle = (title || 'Untitled').replace(/[|=]/g, '').trim() || 'Untitled';
    await cloudinary.uploader.add_context(`title=${safeTitle}`, [publicId], {
      resource_type: 'video',
    });
    return true;
  } catch (error) {
    console.error('Error setting track title:', error);
    return false;
  }
}