import { sendTextMessage, sendVideoFrame } from './dataInput.js';
import { AudioStreamer } from './audioOutput.js';
import { AudioRecorder } from './audioInput.js';
import { VideoStreamer } from './videoStreamer.js';
import { normalizeParameters, parseToolDeclarations } from './toolParser.js';
import {
  ParameterProperty,
  ToolParameters,
  LiveTool,
  GeminiLiveOptions,
  VideoStreamOptions
} from './types.js';

// Re-export types and utilities for consumers
export {
  ParameterProperty,
  ToolParameters,
  LiveTool,
  GeminiLiveOptions,
  VideoStreamOptions,
  AudioStreamer,
  AudioRecorder,
  VideoStreamer,
  normalizeParameters
};

export class GeminiLive {
  private apiKey: string;
  private model: string;
  private useEphemeralToken: boolean;
  private ephemeralToken: string;
  private prompt: string;
  private toolHandlers: { [key: string]: (args: Record<string, any>) => any | Promise<any> } = {};
  private toolDeclarations: any[] = [];
  private enableLogs: boolean;
  private enableSessionResumption: boolean;
  private enableCompression: boolean;
  private sessionHandle?: string;
  private websocket?: WebSocket;

  private WS_URL!: string;
  private audioStreamer: AudioStreamer;
  private audioRecorder: AudioRecorder;
  private videoStreamer: VideoStreamer;

  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectTimer?: any;
  private isExplicitDisconnect: boolean = false;

  public onStatusChange?: (status: string, details?: any) => void;

  public get onVideoStreamEnded(): (() => void) | undefined {
    return this.videoStreamer.onVideoStreamEnded;
  }

  public set onVideoStreamEnded(handler: (() => void) | undefined) {
    this.videoStreamer.onVideoStreamEnded = handler;
  }

  public get isConnected(): boolean {
    return this.websocket?.readyState === WebSocket.OPEN;
  }

  public get isStreamingVideo(): boolean {
    return this.videoStreamer.isStreaming;
  }

  public get currentSessionHandle(): string | undefined {
    return this.sessionHandle;
  }

  public get registeredTools(): any[] {
    return this.toolDeclarations;
  }

  constructor(
    apiKey: string,
    model: string,
    useEphemeralToken: boolean = false,
    ephemeralToken: string = '',
    prompt: string = 'You are a helpful assistant.',
    tools: LiveTool | LiveTool[] = [],
    enableLogs: boolean = false,
    enableSessionResumption: boolean = true,
    enableCompression: boolean = true
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.ephemeralToken = ephemeralToken;
    this.useEphemeralToken = useEphemeralToken;
    this.prompt = prompt;
    this.enableLogs = enableLogs;
    this.enableSessionResumption = enableSessionResumption;
    this.enableCompression = enableCompression;
    this.audioStreamer = new AudioStreamer(enableLogs);
    this.audioRecorder = new AudioRecorder(enableLogs);
    this.videoStreamer = new VideoStreamer(enableLogs);

    this.registerTools(tools);
  }

  /**
   * Automatically normalizes user-supplied parameters into OpenAPI schema format.
   */
  public normalizeParameters(rawParams?: Record<string, any>): Record<string, any> {
    return normalizeParameters(rawParams);
  }

  private registerTools(tools: LiveTool | LiveTool[]) {
    const { declarations, handlers } = parseToolDeclarations(tools);
    this.toolDeclarations = declarations;
    this.toolHandlers = handlers;
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

  public connect() {
    this.isExplicitDisconnect = false;
    this.WS_URL = this.useEphemeralToken ?
      `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${this.ephemeralToken}` :
      `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;

    if (this.reconnectAttempts > 0) {
      this.onStatusChange?.(`Reconnecting (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
    } else {
      this.onStatusChange?.('Connecting...');
    }

    this.websocket = new WebSocket(this.WS_URL);

    this.websocket.onopen = () => {
      this.log('WebSocket Connected');
      this.reconnectAttempts = 0;
      this.onStatusChange?.('Connected');

      // 1. Send the initial setup configuration
      const setupMessage: any = {
        setup: {
          model: `models/${this.model}`,
          generationConfig: {
            responseModalities: ['AUDIO']
          },
          systemInstruction: {
            parts: [{ text: this.prompt }]
          }
        }
      };

      if (this.enableSessionResumption) {
        setupMessage.setup.sessionResumption = this.sessionHandle
          ? { handle: this.sessionHandle }
          : {};
      }

      if (this.enableCompression) {
        setupMessage.setup.contextWindowCompression = {
          slidingWindow: {}
        };
      }

      if (this.toolDeclarations.length > 0) {
        setupMessage.setup.tools = [
          { functionDeclarations: this.toolDeclarations }
        ];
      }

      this.websocket?.send(JSON.stringify(setupMessage));
      this.log('Configuration sent with setup:', setupMessage.setup);
    };

    this.websocket.onmessage = async (event) => {
      let data = event.data;
      if (data instanceof Blob) {
        data = await data.text();
      }
      const response = JSON.parse(data);
      this.log('Received:', response);

      // Session Resumption Handle updates
      if (response.sessionResumptionUpdate) {
        const update = response.sessionResumptionUpdate;
        if (update.resumable && update.newHandle) {
          this.sessionHandle = update.newHandle;
          this.log('Updated session resumption handle:', this.sessionHandle);
        }
      }

      // Server GoAway warning
      if (response.goAway) {
        this.log('Received GoAway signal from server. Time left:', response.goAway.timeLeft);
        this.onStatusChange?.('Connection expiring soon', response.goAway);
      }

      // Model audio and transcription updates
      if (response.serverContent) {
        const serverContent = response.serverContent;
        if (serverContent.modelTurn?.parts) {
          for (const part of serverContent.modelTurn.parts) {
            if (part.inlineData) {
              const audioData = part.inlineData.data;
              this.audioStreamer.playAudioChunk(audioData);
              this.log(`Received audio data (base64 len: ${audioData.length})`);
            }
          }
        }

        if (serverContent.inputTranscription) {
          this.log('User:', serverContent.inputTranscription.text);
        }
        if (serverContent.outputTranscription) {
          this.log('Gemini:', serverContent.outputTranscription.text);
        }
      }

      // Tool Call Execution
      if (response.toolCall) {
        this.handleToolCall(response.toolCall);
      }
    };

    this.websocket.onerror = (error) => {
      this.error('WebSocket Error:', error);
      this.onStatusChange?.('Error', error);
    };

    this.websocket.onclose = (event) => {
      this.log('WebSocket Closed', { code: event.code, reason: event.reason, wasClean: event.wasClean });
      this.onStatusChange?.('Disconnected', { code: event.code, reason: event.reason });

      if (!this.isExplicitDisconnect) {
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.warn('Max reconnection attempts reached.');
      this.onStatusChange?.('Reconnect Failed');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 8000);
    this.log(`Reconnecting in ${delay}ms...`);

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  public disconnect() {
    this.isExplicitDisconnect = true;
    clearTimeout(this.reconnectTimer);
    this.stopRecording();
    this.stopVideoStream();
    if (this.websocket) {
      this.websocket.close(1000, 'Client closed connection');
      this.websocket = undefined;
    }
    this.onStatusChange?.('Disconnected');
  }

  private async handleToolCall(toolCall: any) {
    const functionResponses: any[] = [];
    for (const fc of toolCall.functionCalls) {
      let result;
      try {
        const toolFunc = this.toolHandlers[fc.name];
        if (toolFunc) {
          result = await toolFunc(fc.args || {});
        } else {
          this.warn(`Tool ${fc.name} not found.`);
          result = { error: `Tool ${fc.name} not found` };
        }
      } catch (e: any) {
        this.error(`Error executing tool ${fc.name}:`, e);
        result = { error: e.message };
      }

      functionResponses.push({
        name: fc.name,
        id: fc.id,
        response: typeof result === 'object' && result !== null ? result : { result }
      });
    }

    if (this.websocket?.readyState === WebSocket.OPEN) {
      const toolResponseMessage = {
        toolResponse: {
          functionResponses: functionResponses
        }
      };
      this.websocket.send(JSON.stringify(toolResponseMessage));
      this.log('Sent tool response:', toolResponseMessage);
    } else {
      this.warn('WebSocket not open to send tool response.');
    }
  }

  public sendText(text: string) {
    if (this.websocket) {
      sendTextMessage(this.websocket, text, this.enableLogs);
    } else {
      this.warn('WebSocket is not initialized.');
    }
  }

  public sendVideo(frame: Buffer | string | Uint8Array | ArrayBuffer | any, mimeType: string = 'image/jpeg') {
    if (this.websocket) {
      sendVideoFrame(this.websocket, frame, mimeType, this.enableLogs);
    } else {
      this.warn('WebSocket is not initialized.');
    }
  }

  /**
   * Streams video or screen frames to Gemini from a MediaStream.
   */
  public startVideoStream(stream: MediaStream, options?: VideoStreamOptions) {
    if (!this.websocket) {
      this.warn('WebSocket is not initialized. Call connect() first.');
      return;
    }
    this.videoStreamer.start(stream, this.websocket, options);
  }

  /**
   * Stops video frame streaming and releases hardware device tracks.
   */
  public stopVideoStream(stopTracks: boolean = true) {
    this.videoStreamer.stop(stopTracks);
  }

  public async startRecording(stream: MediaStream, onVolumeChange?: (volume: number) => void) {
    if (!this.websocket) {
      this.warn('WebSocket is not initialized. Call connect() first.');
      return;
    }
    if (onVolumeChange) {
      this.audioRecorder.onVolumeChange = onVolumeChange;
    }
    await this.audioRecorder.startRecording(stream, this.websocket);
  }

  public stopRecording(stopTracks: boolean = true) {
    this.audioRecorder.stopRecording(stopTracks);
  }
}