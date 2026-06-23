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
  duration: number;
  format: string;
  size: number;
  created_at: string;
  cover?: string;
}

export async function getAllTracks(): Promise<Track[]> {
  try {
    // Dùng resources API thay vì search — ổn định hơn
    const ping = await cloudinary.api.ping();
    console.log('PING:', ping);
    console.log("Cloud name:", process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME);
    const usage = await cloudinary.api.usage();
console.log(JSON.stringify(usage, null, 2));

    const result = await cloudinary.api.resources({
      resource_type: 'video',
      type: 'upload',
      prefix: 'music/',      // match folder music/
      max_results: 100,
      context: true,         // lấy title từ context
      tags: true,
    });

    console.log('Total resources:', result.resources.length);
    console.log('Sample:', JSON.stringify(result.resources[0], null, 2));

    // Test tạm — paste vào API route hoặc getAllTracks
const [videoRes, rawRes, imageRes] = await Promise.all([
  cloudinary.api.resources({ resource_type: 'video', type: 'upload', max_results: 5 }),
  cloudinary.api.resources({ resource_type: 'raw', type: 'upload', max_results: 5 }),
  cloudinary.api.resources({ resource_type: 'image', type: 'upload', max_results: 5 }),
]);

console.log('video count:', videoRes.resources.length);
console.log('raw count:', rawRes.resources.length);
console.log('image count:', imageRes.resources.length);

// In ra public_id của resource đầu tiên tìm thấy
const first = [...videoRes.resources, ...rawRes.resources, ...imageRes.resources][0];
console.log('First resource:', JSON.stringify(first, null, 2));

    return result.resources.map((r: any) => ({
      id: r.asset_id,
      public_id: r.public_id,
      url: r.secure_url,
      title: r.context?.custom?.title || extractTitle(r.public_id),
      duration: r.duration || 0,
      format: r.format,
      size: r.bytes,
      created_at: r.created_at,
      cover: r.context?.custom?.cover || null,
    }));
  } catch (error) {
    console.error('Error fetching tracks:', error);
    return [];
  }
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

export async function generateUploadSignature(folder: string = 'music', title?: string) {
  const timestamp = Math.round(new Date().getTime() / 1000);

  // Chỉ include params được sign
  const params: Record<string, any> = {
    folder,
    timestamp,
    ...(title && { context: `title=${title}` }),
  };

  const signature = cloudinary.utils.api_sign_request(
    params,
    process.env.CLOUDINARY_API_SECRET!
  );

  return {
    timestamp,
    signature,
    api_key: process.env.CLOUDINARY_API_KEY!,
    cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME!,
    folder,
    ...(title && { context: `title=${title}` }),
  };
}