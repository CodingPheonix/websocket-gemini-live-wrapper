import { sendAudioChunk } from './dataInput.js';

export class AudioRecorder {
    private recordContext?: AudioContext;
    public mediaStream?: MediaStream;
    private processor?: AudioWorkletNode;
    private isPushing: boolean = false;
    public enableLogs: boolean;

    public onVolumeChange?: (volume: number) => void;

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

    public async startRecording(stream: MediaStream, websocket: WebSocket) {
        if (this.recordContext) return;
        if (typeof window === 'undefined' || (!window.AudioContext && !(window as any).webkitAudioContext)) {
            this.warn('Audio recording is not supported in this environment.');
            return;
        }

        try {
            this.mediaStream = stream;
            const context = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            this.recordContext = context;
            const source = context.createMediaStreamSource(stream);

            if (websocket.readyState === WebSocket.OPEN) {
                websocket.send(JSON.stringify({ realtimeInput: { activityStart: {} } }));
            }

            const pcmProcessorCode = `
                class PCMProcessor extends AudioWorkletProcessor {
                    process(inputs, outputs, parameters) {
                        const input = inputs[0];
                        if (input && input.length > 0) {
                            const channelData = input[0];
                            const pcm16 = new Int16Array(channelData.length);
                            let sum = 0;
                            for (let i = 0; i < channelData.length; i++) {
                                const s = Math.max(-1, Math.min(1, channelData[i]));
                                sum += s * s;
                                pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                            }
                            const rms = Math.sqrt(sum / channelData.length);
                            this.port.postMessage({ pcm: pcm16.buffer, volume: rms }, [pcm16.buffer]);
                        }
                        return true;
                    }
                }
                registerProcessor('pcm-processor', PCMProcessor);
            `;
            const blob = new Blob([pcmProcessorCode], { type: 'application/javascript' });
            const workletUrl = URL.createObjectURL(blob);

            await context.audioWorklet.addModule(workletUrl);
            const workletNode = new AudioWorkletNode(context, 'pcm-processor');

            this.isPushing = true;
            this.processor = workletNode;

            workletNode.port.onmessage = (event) => {
                if (!websocket || websocket.readyState !== WebSocket.OPEN) return;
                if (!this.isPushing) return;

                const { pcm, volume } = event.data;
                if (this.onVolumeChange) this.onVolumeChange(volume);

                let binary = '';
                const bytes = new Uint8Array(pcm);
                for (let i = 0; i < bytes.byteLength; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                const base64Data = window.btoa(binary);

                sendAudioChunk(websocket, base64Data);
            };

            source.connect(workletNode);
            // Optionally connecting to destination might cause audio feedback. 
            // We follow the user's snippet, but normally it's better not to.
            // workletNode.connect(context.destination);

        } catch (error: unknown) {
            this.error("Error starting recording:", error);
        }
    }

    public stopRecording(stopTracks: boolean = true) {
        this.isPushing = false;
        if (this.processor) {
            this.processor.disconnect();
            this.processor = undefined;
        }
        if (this.recordContext) {
            this.recordContext.close();
            this.recordContext = undefined;
        }
        if (this.mediaStream) {
            if (stopTracks) {
                this.mediaStream.getTracks().forEach((track) => track.stop());
            }
            this.mediaStream = undefined;
        }
    }
}
