import { sendVideoFrame } from './dataInput.js';
import { VideoStreamOptions } from './types.js';

export class VideoStreamer {
  private videoStream?: MediaStream;
  private videoIntervalId?: any;
  private videoElement?: HTMLVideoElement;
  private videoCanvas?: HTMLCanvasElement;
  private videoTrackEndedListener?: () => void;
  public enableLogs: boolean;

  public onVideoStreamEnded?: () => void;

  constructor(enableLogs: boolean = false) {
    this.enableLogs = enableLogs;
  }

  public get isStreaming(): boolean {
    return !!this.videoIntervalId;
  }

  private log(...args: any[]) {
    if (this.enableLogs) console.log(...args);
  }

  private warn(...args: any[]) {
    if (this.enableLogs) console.warn(...args);
  }

  /**
   * Automatically streams video or screen frames to Gemini from a MediaStream.
   * Handles canvas rendering, scaling, periodic frame capture, and track lifecycle.
   */
  public start(
    stream: MediaStream,
    websocket: WebSocket,
    options?: VideoStreamOptions
  ) {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
      this.warn('WebSocket is not connected. Cannot start video stream.');
      return;
    }

    if (typeof window === 'undefined' || typeof document === 'undefined') {
      this.warn('startVideoStream is only supported in browser environments.');
      return;
    }

    // Stop any existing stream before starting a new one
    this.stop();

    this.videoStream = stream;

    const fps = options?.fps ?? 1;
    const maxWidth = options?.maxWidth ?? 640;
    const quality = options?.quality ?? 0.6;
    const mimeType = options?.mimeType ?? 'image/jpeg';
    const intervalMs = Math.max(200, Math.round(1000 / fps));

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.srcObject = stream;
    this.videoElement = video;

    const canvas = document.createElement('canvas');
    this.videoCanvas = canvas;
    const ctx = canvas.getContext('2d');

    this.videoIntervalId = setInterval(() => {
      if (!websocket || websocket.readyState !== WebSocket.OPEN) return;
      if (!video || video.readyState < 2 || !ctx) return;

      const videoWidth = video.videoWidth || 640;
      const videoHeight = video.videoHeight || 480;
      const scale = Math.min(1, maxWidth / videoWidth);

      canvas.width = Math.round(videoWidth * scale);
      canvas.height = Math.round(videoHeight * scale);

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const base64DataUrl = canvas.toDataURL(mimeType, quality);
      sendVideoFrame(websocket, base64DataUrl, mimeType, this.enableLogs);
    }, intervalMs);

    // Listen to track end (e.g. user clicks "Stop Sharing" in browser UI)
    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length > 0) {
      this.videoTrackEndedListener = () => {
        this.log('Video track ended.');
        this.stop();
        this.onVideoStreamEnded?.();
      };
      videoTracks[0].addEventListener('ended', this.videoTrackEndedListener);
    }

    this.log('Started video streaming at ~' + fps + ' FPS.');
  }

  /**
   * Stops streaming video frames and cleans up internal canvas, video element, and media tracks.
   */
  public stop(stopTracks: boolean = true) {
    if (this.videoIntervalId) {
      clearInterval(this.videoIntervalId);
      this.videoIntervalId = undefined;
    }

    if (this.videoStream) {
      if (this.videoTrackEndedListener) {
        const tracks = this.videoStream.getVideoTracks();
        if (tracks.length > 0) {
          tracks[0].removeEventListener('ended', this.videoTrackEndedListener);
        }
        this.videoTrackEndedListener = undefined;
      }

      if (stopTracks) {
        this.videoStream.getTracks().forEach((track) => track.stop());
      }
      this.videoStream = undefined;
    }

    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement = undefined;
    }

    this.videoCanvas = undefined;
    this.log('Stopped video streaming.');
  }
}
