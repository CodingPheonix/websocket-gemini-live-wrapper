export class AudioStreamer {
  private playbackContext?: AudioContext;
  private nextPlayTime: number = 0;
  public enableLogs: boolean;

  constructor(enableLogs: boolean = false) {
    this.enableLogs = enableLogs;
  }

  private log(...args: any[]) {
    if (this.enableLogs) console.log(...args);
  }

  private warn(...args: any[]) {
    if (this.enableLogs) console.warn(...args);
  }

  private error(...args: any[]) {
    if (this.enableLogs) console.error(...args);
  }

  public playAudioChunk(base64Audio: string) {
    if (typeof window === 'undefined' || (!window.AudioContext && !(window as any).webkitAudioContext)) {
      this.warn('Audio playback is not supported in this environment.');
      return;
    }

    try {
      if (!this.playbackContext) {
        this.playbackContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      const context = this.playbackContext;
      if (context.state === 'suspended') {
        context.resume().catch(() => { });
      }

      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const int16Array = new Int16Array(bytes.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 0x8000;
      }

      const audioBuffer = context.createBuffer(1, float32Array.length, 24000);
      audioBuffer.getChannelData(0).set(float32Array);

      const source = context.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(context.destination);

      if (this.nextPlayTime < context.currentTime) {
        this.nextPlayTime = context.currentTime;
      }
      source.start(this.nextPlayTime);
      this.nextPlayTime += audioBuffer.duration;

      source.onended = () => {
        source.disconnect();
      };
    } catch (error) {
      this.error('Error playing audio chunk:', error);
    }
  }
}
