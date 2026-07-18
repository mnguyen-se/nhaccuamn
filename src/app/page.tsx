'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  Upload, Trash2, Music, Search, Shuffle, Repeat, Repeat1,
  ChevronUp, X, Loader2, RefreshCw, Users, Plus, Folder, FolderOpen
} from 'lucide-react';

interface Track {
  id: string;
  public_id: string;
  url: string;
  title: string;
  artist: string;
  duration: number;
  format: string;
  size: number;
  created_at: string;
}

const UNKNOWN_ARTIST = 'Không rõ nghệ sĩ';
const ALL_ARTISTS = '__all__';

// Cloudinary context dùng định dạng key=value|key=value nên phải loại bỏ ký tự "|" và "="
function sanitizeContextValue(value: string): string {
  return value.replace(/[|=]/g, '').trim() || 'Untitled';
}

type RepeatMode = 'none' | 'all' | 'one';

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });
}
// Chuẩn hoá tên để so sánh (bỏ khoảng trắng thừa, không phân biệt hoa/thường)
function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

export default function MusicApp() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [filteredTracks, setFilteredTracks] = useState<Track[]>([]);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [search, setSearch] = useState('');
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('none');
  const [isShuffle, setIsShuffle] = useState(false);
  const [playerExpanded, setPlayerExpanded] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [uploadQueue, setUploadQueue] = useState<string[]>([]);
  const [uploadDone, setUploadDone] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<string>(ALL_ARTISTS);

  // Chọn thư mục (nghệ sĩ) trước khi upload
  const [folders, setFolders] = useState<string[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const chosenFolderRef = useRef<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressRef = useRef<HTMLInputElement>(null);

  // Fetch tracks
  const fetchTracks = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tracks');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setTracks(data.tracks || []);
    } catch (err) {
      setError('Không thể tải danh sách nhạc. Kiểm tra cấu hình Cloudinary.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Danh sách thư mục (nghệ sĩ) đã có trên Cloudinary — dùng cho ô chọn khi upload
  const fetchFolders = useCallback(async () => {
    setFoldersLoading(true);
    try {
      const res = await fetch('/api/folders');
      const data = await res.json();
      setFolders((data.folders || []).sort((a: string, b: string) => a.localeCompare(b, 'vi')));
    } catch (err) {
      console.error('Error fetching folders:', err);
    } finally {
      setFoldersLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTracks();
    fetchFolders();
  }, [fetchTracks, fetchFolders]);

  // Đăng ký service worker để app có thể cài lên màn hình chính và
  // hỗ trợ chạy ổn định hơn khi thu nhỏ / khoá màn hình điện thoại.
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(err => {
        console.error('Service worker registration failed:', err);
      });
    }
  }, []);

  // Chốt thư mục sẽ upload vào, đóng dropdown, rồi mở hộp thoại chọn file
  const startUploadToFolder = (folder: string | null) => {
    chosenFolderRef.current = folder;
    setShowFolderPicker(false);
    fileInputRef.current?.click();
  };

  // Tạo thư mục (nghệ sĩ) mới, sau đó tự động chọn luôn thư mục vừa tạo để upload
  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;

    setIsCreatingFolder(true);
    setFolderError(null);
    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Không thể tạo thư mục');

      setFolders(prev => Array.from(new Set([...prev, data.folder])).sort((a, b) => a.localeCompare(b, 'vi')));
      setNewFolderName('');
      startUploadToFolder(data.folder);
    } catch (err: any) {
      setFolderError(err?.message || 'Không thể tạo thư mục');
    } finally {
      setIsCreatingFolder(false);
    }
  };

  // Danh sách nghệ sĩ (duy nhất, có sắp xếp) để render tab
  const artists = useMemo(() => {
    const set = new Set(tracks.map(t => t.artist || UNKNOWN_ARTIST));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [tracks]);

  // Nếu nghệ sĩ đang chọn không còn tồn tại (bị xoá hết bài) thì quay lại "Tất cả"
  useEffect(() => {
    if (selectedArtist !== ALL_ARTISTS && !artists.includes(selectedArtist)) {
      setSelectedArtist(ALL_ARTISTS);
    }
  }, [artists, selectedArtist]);

  // Filter tracks theo tab nghệ sĩ + ô tìm kiếm
  useEffect(() => {
    let base = tracks;
    if (selectedArtist !== ALL_ARTISTS) {
      base = base.filter(t => (t.artist || UNKNOWN_ARTIST) === selectedArtist);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      base = base.filter(
        t => t.title.toLowerCase().includes(q) || (t.artist || '').toLowerCase().includes(q)
      );
    }
    setFilteredTracks(base);
  }, [search, tracks, selectedArtist]);

  // Audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration);
    const onEnded = () => handleTrackEnd();
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, [currentTrack, repeatMode, isShuffle]);

  // Media Session API: cho phép điều khiển nhạc (play/pause/next/prev) từ màn hình
  // khoá / thông báo hệ thống, và là điều kiện để trình duyệt cho phát nhạc khi
  // app bị đưa xuống nền hoặc màn hình điện thoại tắt.
  useEffect(() => {
    if (typeof window === 'undefined' || !('mediaSession' in navigator) || !currentTrack) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist || UNKNOWN_ARTIST,
      album: 'Music Library',
    });

    navigator.mediaSession.setActionHandler('play', () => audioRef.current?.play());
    navigator.mediaSession.setActionHandler('pause', () => audioRef.current?.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => playPrev());
    navigator.mediaSession.setActionHandler('nexttrack', () => playNext());
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (audioRef.current && details.seekTime != null) {
        audioRef.current.currentTime = details.seekTime;
        setCurrentTime(details.seekTime);
      }
    });

    return () => {
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('previoustrack', null);
      navigator.mediaSession.setActionHandler('nexttrack', null);
      navigator.mediaSession.setActionHandler('seekto', null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack]);

  // Cập nhật trạng thái play/pause cho hệ thống + vị trí phát (để hiện đúng
  // trên thanh điều khiển ở màn hình khoá)
  useEffect(() => {
    if (typeof window === 'undefined' || !('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [isPlaying]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('mediaSession' in navigator)) return;
    if (!duration || isNaN(duration)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: 1,
        position: Math.min(currentTime, duration),
      });
    } catch {
      // Một số trình duyệt cũ không hỗ trợ setPositionState — bỏ qua an toàn
    }
  }, [duration, currentTime]);

  const handleTrackEnd = useCallback(() => {
    if (repeatMode === 'one') {
      audioRef.current?.play();
      return;
    }
    playNext();
  }, [repeatMode, isShuffle, tracks, currentTrack]);

  const playTrack = useCallback((track: Track) => {
    setCurrentTrack(track);
    setCurrentTime(0);
    setTimeout(() => {
      const audio = audioRef.current;
      if (audio) {
        audio.src = track.url;
        audio.volume = isMuted ? 0 : volume;
        audio.play().catch(console.error);
      }
    }, 50);
  }, [volume, isMuted]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!currentTrack && tracks.length > 0) {
      playTrack(tracks[0]);
      return;
    }
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(console.error);
    }
  }, [isPlaying, currentTrack, tracks, playTrack]);

  const playNext = useCallback(() => {
    if (!tracks.length) return;
    if (isShuffle) {
      const idx = Math.floor(Math.random() * tracks.length);
      playTrack(tracks[idx]);
    } else {
      const idx = currentTrack ? tracks.findIndex(t => t.id === currentTrack.id) : -1;
      const next = tracks[(idx + 1) % tracks.length];
      if (next) playTrack(next);
    }
  }, [tracks, currentTrack, isShuffle, playTrack]);

  const playPrev = useCallback(() => {
    if (!tracks.length) return;
    if (currentTime > 3) {
      audioRef.current!.currentTime = 0;
      return;
    }
    const idx = currentTrack ? tracks.findIndex(t => t.id === currentTrack.id) : 0;
    const prev = tracks[(idx - 1 + tracks.length) % tracks.length];
    if (prev) playTrack(prev);
  }, [tracks, currentTrack, currentTime, playTrack]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
      setCurrentTime(val);
    }
  };

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setVolume(val);
    if (audioRef.current) audioRef.current.volume = val;
    setIsMuted(val === 0);
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isMuted) {
      audio.volume = volume || 0.5;
      setIsMuted(false);
    } else {
      audio.volume = 0;
      setIsMuted(true);
    }
  };

  const cycleRepeat = () => {
    setRepeatMode(prev =>
      prev === 'none' ? 'all' : prev === 'all' ? 'one' : 'none'
    );
  };

  // Upload
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  const audioFiles = files.filter(f => f.type.startsWith('audio/'));
  if (!audioFiles.length) {
    alert('Vui lòng chọn file âm thanh (MP3, WAV, FLAC, AAC...)');
    return;
  }

  // Tập hợp tên bài hát hiện có (đã chuẩn hoá) để đối chiếu trùng lặp
  const existingTitles = new Set(tracks.map(t => normalizeTitle(t.title)));

  const duplicates: string[] = [];
  const toUpload: File[] = [];

  for (const file of audioFiles) {
    const suggestedTitle = file.name.replace(/\.[^.]+$/, '').trim() || 'Untitled';
    if (existingTitles.has(normalizeTitle(suggestedTitle))) {
      duplicates.push(file.name);
    } else {
      toUpload.push(file);
      // Thêm luôn vào set để tránh trùng giữa các file chọn cùng lúc
      existingTitles.add(normalizeTitle(suggestedTitle));
    }
  }

  if (duplicates.length) {
    alert(
      `${duplicates.length} file đã tồn tại nên không được thêm:\n` +
      duplicates.map(name => `• ${name}`).join('\n')
    );
  }

  if (!toUpload.length) {
    if (fileInputRef.current) fileInputRef.current.value = '';
    return;
  }

  const targetFolder = chosenFolderRef.current ? `music/${chosenFolderRef.current}` : 'music';

  setIsUploading(true);
  setUploadProgress(0);
  setUploadDone(0);
  setUploadTotal(toUpload.length);

  for (let i = 0; i < toUpload.length; i++) {
    const file = toUpload[i];
    setUploadQueue([file.name]);
    setUploadProgress(Math.round((i / toUpload.length) * 100));

    try {
      const suggestedTitle = file.name.replace(/\.[^.]+$/, '').trim();
      const title = suggestedTitle || 'Untitled';

      const sigRes = await fetch('/api/upload-signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: targetFolder }),
      });
      const sig = await sigRes.json();

      const formData = new FormData();
      formData.append('file', file);
      formData.append('api_key', sig.api_key);
      formData.append('timestamp', sig.timestamp);
      formData.append('signature', sig.signature);
      formData.append('folder', sig.folder);

      const uploadRes = await fetch(
        `https://api.cloudinary.com/v1_1/${sig.cloud_name}/video/upload`,
        { method: 'POST', body: formData }
      );
      const uploadData = await uploadRes.json();

      if (uploadData?.public_id) {
        const setTitleRes = await fetch('/api/tracks/set-title', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicId: uploadData.public_id, title }),
        });
        if (!setTitleRes.ok) {
          console.error('Set title failed:', await setTitleRes.text());
        }
      }
    } catch (err) {
      console.error('Upload error:', err);
    } finally {
      setUploadDone(i + 1);
    }
  }

  setUploadProgress(100);
  setUploadQueue([]);
  setIsUploading(false);
  chosenFolderRef.current = null;
  if (fileInputRef.current) fileInputRef.current.value = '';
  fetchTracks();
  fetchFolders();
};

  const handleDelete = async (track: Track, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Xóa "${track.title}"?`)) return;

    setDeletingId(track.id);
    try {
      const res = await fetch(`/api/tracks/${track.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicId: track.public_id }),
      });

      if (res.ok) {
        setTracks(prev => prev.filter(t => t.id !== track.id));
        if (currentTrack?.id === track.id) {
          setCurrentTrack(null);
          setIsPlaying(false);
        }
      }
    } catch (err) {
      console.error('Delete error:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const currentIndex = currentTrack
    ? tracks.findIndex(t => t.id === currentTrack.id)
    : -1;

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col">
      <audio ref={audioRef} />

      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0a0a0f]/95 backdrop-blur border-b border-white/5 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center">
              <Music size={16} />
            </div>
            <span className="font-semibold text-sm hidden sm:block">Music Library</span>
          </div>

          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" size={15} />
            <input
              type="text"
              placeholder="Tìm kiếm bài hát..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-violet-500/50 placeholder-white/25 transition-colors"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">
                <X size={14} />
              </button>
            )}
          </div>

          {/* Upload button + dropdown chọn thư mục */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setShowFolderPicker(v => !v)}
              disabled={isUploading}
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 disabled:cursor-not-allowed px-3 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              {isUploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              <span className="hidden sm:block">{isUploading ? 'Đang tải...' : 'Upload'}</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />

            {showFolderPicker && (
              <>
                {/* Lớp nền trong suốt để bấm ra ngoài là đóng dropdown */}
                <div className="fixed inset-0 z-40" onClick={() => setShowFolderPicker(false)} />

                <div className="absolute right-0 top-full mt-2 w-72 bg-[#15151d] border border-white/10 rounded-2xl shadow-2xl z-50 p-3">
                  <p className="text-xs text-white/40 mb-2 px-1">Upload vào thư mục nào?</p>

                  {/* Tạo thư mục mới */}
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="text"
                      value={newFolderName}
                      onChange={e => setNewFolderName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleCreateFolder();
                        }
                      }}
                      placeholder="Tên thư mục mới..."
                      className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-violet-500/50 placeholder-white/25"
                    />
                    <button
                      onClick={handleCreateFolder}
                      disabled={isCreatingFolder || !newFolderName.trim()}
                      title="Tạo thư mục mới"
                      className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 disabled:cursor-not-allowed transition-colors"
                    >
                      {isCreatingFolder ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    </button>
                  </div>
                  {folderError && <p className="text-xs text-red-400 mb-2 px-1">{folderError}</p>}

                  <div className="h-px bg-white/5 my-2" />

                  {/* Danh sách thư mục có sẵn — cuộn để chọn */}
                  <div className="max-h-56 overflow-y-auto space-y-1 pr-0.5">
                    <button
                      onClick={() => startUploadToFolder(null)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left text-white/55 hover:bg-white/5 transition-colors"
                    >
                      <FolderOpen size={14} className="text-white/30 flex-shrink-0" />
                      Không phân loại (gốc)
                    </button>

                    {foldersLoading ? (
                      <div className="flex items-center justify-center py-4 text-white/30">
                        <Loader2 size={16} className="animate-spin" />
                      </div>
                    ) : folders.length === 0 ? (
                      <p className="text-xs text-white/25 px-3 py-2">Chưa có thư mục nào — tạo mới ở trên nhé.</p>
                    ) : (
                      folders.map(f => (
                        <button
                          key={f}
                          onClick={() => startUploadToFolder(f)}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left text-white/85 hover:bg-violet-600/15 transition-colors"
                        >
                          <Folder size={14} className="text-violet-400 flex-shrink-0" />
                          <span className="truncate">{f}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <button
            onClick={fetchTracks}
            className="p-2 text-white/40 hover:text-white/70 transition-colors"
            title="Làm mới"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </header>

      {/* Upload progress */}
      {isUploading && (
        <div className="bg-violet-900/20 border-b border-violet-500/20 px-4 py-2">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center gap-3 text-sm text-violet-300 mb-1">
              <Loader2 size={14} className="animate-spin" />
              <span className="truncate">
                Đang upload ({uploadDone}/{uploadTotal}): {uploadQueue[0]}
              </span>
              <span className="ml-auto flex-shrink-0">{uploadProgress}%</span>
            </div>
            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-violet-500 rounded-full transition-all"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-4 pb-32">
        {/* Tabs theo nghệ sĩ */}
        {artists.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto mb-3 pb-1 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              onClick={() => setSelectedArtist(ALL_ARTISTS)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                selectedArtist === ALL_ARTISTS
                  ? 'bg-violet-600 text-white'
                  : 'bg-white/5 text-white/50 hover:bg-white/10'
              }`}
            >
              <Users size={12} />
              Tất cả
            </button>
            {artists.map(a => (
              <button
                key={a}
                onClick={() => setSelectedArtist(a)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                  selectedArtist === a
                    ? 'bg-violet-600 text-white'
                    : 'bg-white/5 text-white/50 hover:bg-white/10'
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        )}

        {/* Stats bar */}
        {tracks.length > 0 && (
          <div className="text-xs text-white/30 mb-3">
            {filteredTracks.length === tracks.length
              ? `${tracks.length} bài hát`
              : `${filteredTracks.length} / ${tracks.length} bài hát`}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-900/20 border border-red-500/20 rounded-xl p-4 mb-4 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Loading */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="animate-spin text-violet-400" size={32} />
            <p className="text-white/40 text-sm">Đang tải nhạc...</p>
          </div>
        ) : filteredTracks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center">
              <Music size={28} className="text-white/20" />
            </div>
            <div className="text-center">
              <p className="text-white/50 font-medium">
                {search ? 'Không tìm thấy bài hát' : 'Chưa có bài hát nào'}
              </p>
              {!search && (
                <p className="text-white/25 text-sm mt-1">Nhấn Upload để thêm nhạc</p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredTracks.map((track, idx) => {
              const isActive = currentTrack?.id === track.id;
              const isCurrentPlaying = isActive && isPlaying;

              return (
                <div
                  key={track.id}
                  onClick={() => isActive ? togglePlay() : playTrack(track)}
                  className={`group flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer transition-all ${
                    isActive
                      ? 'bg-violet-600/15 border border-violet-500/20'
                      : 'hover:bg-white/5 border border-transparent'
                  }`}
                >
                  {/* Index / Play indicator */}
                  <div className="w-8 text-center flex-shrink-0">
                    {isCurrentPlaying ? (
                      <div className="flex items-end justify-center gap-0.5 h-4">
                        {[1,2,3,4,5].map(i => (
                          <div
                            key={i}
                            className="w-1 bg-violet-400 rounded-full wave-bar"
                            style={{ animationDelay: `${(i-1)*0.1}s` }}
                          />
                        ))}
                      </div>
                    ) : (
                      <span className={`text-xs ${isActive ? 'text-violet-400' : 'text-white/25 group-hover:hidden'}`}>
                        {idx + 1}
                      </span>
                    )}
                    {!isActive && (
                      <Play size={14} className="hidden group-hover:block mx-auto text-white/60" />
                    )}
                    {isActive && !isCurrentPlaying && (
                      <Play size={14} className="mx-auto text-violet-400" />
                    )}
                  </div>

                  {/* Track icon */}
                  <div className={`w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center ${
                    isActive ? 'bg-violet-600/30' : 'bg-white/5'
                  }`}>
                    <Music size={16} className={isActive ? 'text-violet-400' : 'text-white/30'} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium text-sm truncate ${isActive ? 'text-violet-300' : 'text-white/85'}`}>
                      {track.title}
                    </p>
                    <p className="text-xs text-white/25 mt-0.5 truncate">
                      {track.artist || UNKNOWN_ARTIST} · {track.format.toUpperCase()} · {formatSize(track.size)} · {formatDate(track.created_at)}
                    </p>
                  </div>

                  {/* Duration */}
                  <span className="text-xs text-white/35 flex-shrink-0">
                    {formatTime(track.duration)}
                  </span>

                  {/* Delete */}
                  <button
                    onClick={(e) => handleDelete(track, e)}
                    disabled={deletingId === track.id}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-500/10 text-white/20 hover:text-red-400 transition-all flex-shrink-0"
                  >
                    {deletingId === track.id
                      ? <Loader2 size={13} className="animate-spin" />
                      : <Trash2 size={13} />
                    }
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Bottom Player */}
      {currentTrack && (
        <div className={`fixed bottom-0 left-0 right-0 z-50 transition-all duration-300 ${
          playerExpanded ? 'h-auto' : 'h-auto'
        }`}>
          <div className="bg-[#111118]/95 backdrop-blur-xl border-t border-white/8">
            {/* Progress bar (thin, always visible) */}
            <div className="h-0.5 bg-white/5 relative">
              <div
                className="absolute left-0 top-0 h-full bg-violet-500 transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="max-w-3xl mx-auto px-4 py-3">
              {/* Expanded controls */}
              {playerExpanded && (
                <div className="mb-4 space-y-3">
                  {/* Seekbar */}
                  <div className="space-y-1">
                    <input
                      type="range"
                      min={0}
                      max={duration || 0}
                      value={currentTime}
                      onChange={handleSeek}
                      className="w-full accent-violet-500"
                    />
                    <div className="flex justify-between text-xs text-white/30">
                      <span>{formatTime(currentTime)}</span>
                      <span>{formatTime(duration)}</span>
                    </div>
                  </div>

                  {/* Volume */}
                  <div className="flex items-center gap-2">
                    <button onClick={toggleMute} className="text-white/40 hover:text-white/70">
                      {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={isMuted ? 0 : volume}
                      onChange={handleVolume}
                      className="w-28 accent-violet-500"
                    />
                  </div>
                </div>
              )}

              {/* Main player row */}
              <div className="flex items-center gap-3">
                {/* Track info */}
                <div
                  className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                  onClick={() => setPlayerExpanded(!playerExpanded)}
                >
                  <div className="w-10 h-10 rounded-lg bg-violet-600/20 flex items-center justify-center flex-shrink-0">
                    <Music size={16} className="text-violet-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate text-violet-300">
                      {currentTrack.title}
                    </p>
                    <p className="text-xs text-white/30 truncate">
                      {currentTrack.artist || UNKNOWN_ARTIST} · {currentIndex + 1} / {tracks.length}
                    </p>
                  </div>
                  <ChevronUp
                    size={16}
                    className={`text-white/30 flex-shrink-0 transition-transform ${playerExpanded ? 'rotate-180' : ''}`}
                  />
                </div>

                {/* Controls */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => setIsShuffle(!isShuffle)}
                    className={`p-2 rounded-lg transition-colors ${isShuffle ? 'text-violet-400' : 'text-white/30 hover:text-white/60'}`}
                  >
                    <Shuffle size={15} />
                  </button>

                  <button
                    onClick={playPrev}
                    className="p-2 text-white/60 hover:text-white transition-colors"
                  >
                    <SkipBack size={18} />
                  </button>

                  <button
                    onClick={togglePlay}
                    className="w-10 h-10 rounded-full bg-violet-600 hover:bg-violet-500 flex items-center justify-center transition-colors"
                  >
                    {isPlaying
                      ? <Pause size={18} />
                      : <Play size={18} className="ml-0.5" />
                    }
                  </button>

                  <button
                    onClick={playNext}
                    className="p-2 text-white/60 hover:text-white transition-colors"
                  >
                    <SkipForward size={18} />
                  </button>

                  <button
                    onClick={cycleRepeat}
                    className={`p-2 rounded-lg transition-colors ${repeatMode !== 'none' ? 'text-violet-400' : 'text-white/30 hover:text-white/60'}`}
                  >
                    {repeatMode === 'one' ? <Repeat1 size={15} /> : <Repeat size={15} />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}