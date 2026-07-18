import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export interface Track {
  id: string;
  public_id: string;
  url: string;
  title: string;
  artist: string;
  duration: number;
  format: string;
  size: number;
  created_at: string;
  cover?: string;
}

export async function getAllTracks(): Promise<Track[]> {
  try {
    const folders = await getArtistFolders();
    const prefixes = ['music', ...folders.map(f => `music/${f}`)];

    const resourceMap = new Map<string, any>();

    for (const prefix of prefixes) {
      const result = await cloudinary.api.resources({
        resource_type: 'video',
        type: 'upload',
        prefix,
        context: true,
        max_results: 100,
      });
      for (const r of result.resources) {
        resourceMap.set(r.public_id, r); // trùng public_id sẽ tự ghi đè, không nhân đôi
      }
    }

    const allResources = Array.from(resourceMap.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    return allResources.map((r: any) => {
      const rawTitle: string = r.context?.custom?.title || extractTitle(r.public_id);
      const contextArtist: string | undefined = r.context?.custom?.artist;
      const artist = deriveArtist(r.public_id, contextArtist);

      return {
        id: r.asset_id,
        public_id: r.public_id,
        url: r.secure_url,
        title: rawTitle.trim() || 'Untitled',
        artist,
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

// public_id có dạng "music/TenNgheSi/tenfile" khi upload vào 1 thư mục cụ thể.
// Nếu bài hát cũ nằm phẳng trong "music/tenfile" (không có thư mục), sẽ dùng
// context.artist (nếu có) hoặc gộp vào nhóm "Không rõ nghệ sĩ".
function deriveArtist(publicId: string, contextArtist?: string): string {
  const parts = publicId.split('/');
  // parts[0] = 'music', parts[1] = tên thư mục (nếu có thêm cấp), phần cuối = tên file
  if (parts.length >= 3) {
    const folderName = parts[1].replace(/[-_]/g, ' ').trim();
    if (folderName) return folderName;
  }
  if (contextArtist && contextArtist.trim()) return contextArtist.trim();
  return 'Không rõ nghệ sĩ';
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

// Tạo thư mục nghệ sĩ mới (rỗng) trong Cloudinary
export async function createArtistFolder(name: string): Promise<string> {
  const safeName = sanitizeFolderName(name);
  if (!safeName) throw new Error('Tên thư mục không hợp lệ');
  await cloudinary.api.create_folder(`music/${safeName}`);
  return safeName;
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

// Chỉ cho phép upload vào "music" hoặc "music/<1 cấp thư mục>", chặn path traversal
function validateUploadFolder(folder: string): string {
  const trimmed = (folder || 'music').trim().replace(/^\/+|\/+$/g, '');
  if (trimmed === 'music') return 'music';

  const match = /^music\/([^/]+)$/.exec(trimmed);
  if (!match) return 'music';

  const safeSub = sanitizeFolderName(match[1]);
  return safeSub ? `music/${safeSub}` : 'music';
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