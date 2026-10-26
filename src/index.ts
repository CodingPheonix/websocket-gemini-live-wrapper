import { sendTextMessage, sendAudioChunk, sendVideoFrame } from './dataInput.js';
import { AudioStreamer } from './audioOutput.js';
import { AudioRecorder } from './audioInput.js';

export interface ParameterProperty {
  type: string;
  description?: string;
  required?: boolean | string[];
  enum?: string[];
  format?: string;
  minimum?: number;
  maximum?: number;
  nullable?: boolean;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  default?: any;
  example?: any;
  examples?: any[];
  properties?: Record<string, ParameterProperty>;
  items?: ParameterProperty | { type: string; [key: string]: any } | string;
  [key: string]: any;
}

export interface ToolParameters {
  type?: 'OBJECT' | 'object' | string;
  properties?: Record<string, ParameterProperty>;
  required?: string[];
  [key: string]: any;
}

export interface LiveTool {
  name: string;
  description: string;
  parameters?: ToolParameters | Record<string, ParameterProperty>;
  behavior?: 'BLOCKING' | 'NON_BLOCKING' | string;
  handler: (args: Record<string, any>) => any | Promise<any>;
}

export interface GeminiLiveOptions {
  prompt?: string;
  tools?: LiveTool | LiveTool[];
  enableLogs?: boolean;
  enableSessionResumption?: boolean;
  enableCompression?: boolean;
}

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

  private videoStream?: MediaStream;
  private videoIntervalId?: any;
  private videoElement?: HTMLVideoElement;
  private videoCanvas?: HTMLCanvasElement;
  private videoTrackEndedListener?: () => void;

  public onVideoStreamEnded?: () => void;

  public get isConnected(): boolean {
    return this.websocket?.readyState === WebSocket.OPEN;
  }

  public get isStreamingVideo(): boolean {
    return !!this.videoIntervalId;
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
    ephemeralToken: string,
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

    this.registerTools(tools);
  }

  /**
   * Automatically normalizes user-supplied parameters into the standard
   * OpenAPI schema required by Gemini Live WebSocket setup (supports recursion
   * for nested objects and arrays of objects).
   */
  public normalizeParameters(rawParams?: Record<string, any>): Record<string, any> {
    if (!rawParams || Object.keys(rawParams).length === 0) {
      return {
        type: 'OBJECT',
        properties: {}
      };
    }

    const properties: Record<string, any> = {};
    const required: string[] = Array.isArray(rawParams.required) ? [...rawParams.required] : [];
    const sourceProps = rawParams.properties || rawParams;

    for (const [key, val] of Object.entries(sourceProps)) {
      if (key === 'type' || key === 'required' || typeof val !== 'object' || !val) continue;

      const prop = val as ParameterProperty;
      properties[key] = this.normalizeProperty(key, prop);

      if (prop.required === true && !required.includes(key)) {
        required.push(key);
      }
    }

    return {
      type: 'OBJECT',
      properties,
      ...(required.length > 0 ? { required } : {})
    };
  }

  /**
   * Helper to normalize an individual property or schema node recursively.
   */
  private normalizeProperty(key: string, prop: Record<string, any>, isItem: boolean = false): Record<string, any> {
    const propType = (prop.type || 'string').toUpperCase();
    const result: Record<string, any> = {
      type: propType
    };

    if (prop.description) {
      result.description = prop.description;
    } else if (!isItem) {
      result.description = `The ${key} parameter`;
    }

    if (prop.enum) {
      result.enum = prop.enum;
    }
    if (prop.format) {
      result.format = prop.format;
    }
    if (typeof prop.minimum === 'number') {
      result.minimum = prop.minimum;
    }
    if (typeof prop.maximum === 'number') {
      result.maximum = prop.maximum;
    }
    if (typeof prop.nullable === 'boolean') {
      result.nullable = prop.nullable;
    }
    if (typeof prop.minItems === 'number') {
      result.minItems = prop.minItems;
    }
    if (typeof prop.maxItems === 'number') {
      result.maxItems = prop.maxItems;
    }
    if (typeof prop.minLength === 'number') {
      result.minLength = prop.minLength;
    }
    if (typeof prop.maxLength === 'number') {
      result.maxLength = prop.maxLength;
    }
    if (typeof prop.pattern === 'string') {
      result.pattern = prop.pattern;
    }
    if (prop.default !== undefined) {
      result.default = prop.default;
    }
    if (prop.example !== undefined) {
      result.example = prop.example;
    }
    if (Array.isArray(prop.examples)) {
      result.examples = prop.examples;
    }

    // 1. Nested OBJECT schema: normalize nested properties
    if (propType === 'OBJECT' || prop.properties) {
      result.type = 'OBJECT';
      const nestedNormalized = this.normalizeParameters({
        properties: prop.properties || {},
        required: prop.required
      });
      result.properties = nestedNormalized.properties;
      if (nestedNormalized.required && nestedNormalized.required.length > 0) {
        result.required = nestedNormalized.required;
      }
    }

    // 2. ARRAY schema: normalize items schema
    if (propType === 'ARRAY') {
      if (prop.items) {
        if (typeof prop.items === 'string') {
          result.items = { type: prop.items.toUpperCase() };
        } else if (typeof prop.items === 'object') {
          result.items = this.normalizeProperty('item', prop.items, true);
        }
      } else {
        // Fallback default to prevent schema validation failure
        result.items = { type: 'STRING' };
      }
    }

    return result;
  }

  private registerTools(tools: LiveTool | LiveTool[]) {
    if (!tools) return;
    const toolList = Array.isArray(tools) ? tools : [tools];

    for (const tool of toolList) {
      if (!tool || !tool.name || typeof tool.handler !== 'function') continue;

      const normalizedParams = this.normalizeParameters(tool.parameters);

      this.toolDeclarations.push({
        name: tool.name,
        description: tool.description || `Calls the ${tool.name} function`,
        parameters: normalizedParams,
        ...(tool.behavior ? { behavior: tool.behavior } : {})
      });

      this.toolHandlers[tool.name] = tool.handler;
    }
  }

  private log(...args: any[]) {
    if (this.enableLogs) {
      console.log(...args);
    }
  }

  private warn(...args: any[]) {
    if (this.enableLogs) {
      console.warn(...args);
    }
  }

  private error(...args: any[]) {
    if (this.enableLogs) {
      console.error(...args);
    }
  }

  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectTimer?: any;
  private isExplicitDisconnect: boolean = false;

  public onStatusChange?: (status: string, details?: any) => void;

  connect() {
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

      // 1. Send the initial configuration
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

      // Add session resumption (with previous handle if reconnecting)
      if (this.enableSessionResumption) {
        setupMessage.setup.sessionResumption = this.sessionHandle
          ? { handle: this.sessionHandle }
          : {};
      }

      // Add context window compression for extended/unlimited duration
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

      // Handle Session Resumption Handle updates
      if (response.sessionResumptionUpdate) {
        const update = response.sessionResumptionUpdate;
        if (update.resumable && update.newHandle) {
          this.sessionHandle = update.newHandle;
          this.log('Updated session resumption handle:', this.sessionHandle);
        }
      }

      // Handle Server GoAway warning (approaching connection reset)
      if (response.goAway) {
        this.log('Received GoAway signal from server. Time left:', response.goAway.timeLeft);
        this.onStatusChange?.('Connection expiring soon', response.goAway);
      }

      if (response.serverContent) {
        const serverContent = response.serverContent;
        // Receiving Audio
        if (serverContent.modelTurn?.parts) {
          for (const part of serverContent.modelTurn.parts) {
            if (part.inlineData) {
              const audioData = part.inlineData.data; // Base64 encoded string
              this.audioStreamer.playAudioChunk(audioData);
              this.log(`Received audio data (base64 len: ${audioData.length})`);
            }
          }
        }

        // Receiving Text Transcriptions
        if (serverContent.inputTranscription) {
          this.log('User:', serverContent.inputTranscription.text);
        }
        if (serverContent.outputTranscription) {
          this.log('Gemini:', serverContent.outputTranscription.text);
        }
      }

      // Handling Tool Calls
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
      // 1. Execute the function locally (sync or async)
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

      // 2. Prepare the response
      functionResponses.push({
        name: fc.name,
        id: fc.id,
        response: typeof result === 'object' && result !== null ? result : { result }
      });
    }

    // 3. Send the tool response back to the session
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

  // public sendAudio(chunk: Buffer | any) {
  //   if (this.websocket) {
  //     sendAudioChunk(this.websocket, chunk, this.enableLogs);
  //   } else {
  //     this.warn('WebSocket is not initialized.');
  //   }
  // }

  public sendVideo(frame: Buffer | string | Uint8Array | ArrayBuffer | any, mimeType: string = 'image/jpeg') {
    if (this.websocket) {
      sendVideoFrame(this.websocket, frame, mimeType, this.enableLogs);
    } else {
      this.warn('WebSocket is not initialized.');
    }
  }

  /**
   * Automatically streams video or screen frames to Gemini from a MediaStream.
   * Handles canvas rendering, scaling, periodic frame capture, and track lifecycle.
   *
   * @param stream The MediaStream (camera or screen share)
   * @param options Optional configuration: fps (default 1), maxWidth (default 640), quality (default 0.6), mimeType (default 'image/jpeg')
   */
  public startVideoStream(
    stream: MediaStream,
    options?: {
      fps?: number;
      maxWidth?: number;
      quality?: number;
      mimeType?: string;
    }
  ) {
    if (!this.websocket) {
      this.warn('WebSocket is not initialized. Call connect() first.');
      return;
    }

    if (typeof window === 'undefined' || typeof document === 'undefined') {
      this.warn('startVideoStream is only supported in browser environments.');
      return;
    }

    // Stop any existing stream before starting a new one
    this.stopVideoStream();

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
      if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) return;
      if (!video || video.readyState < 2 || !ctx) return;

      const videoWidth = video.videoWidth || 640;
      const videoHeight = video.videoHeight || 480;
      const scale = Math.min(1, maxWidth / videoWidth);

      canvas.width = Math.round(videoWidth * scale);
      canvas.height = Math.round(videoHeight * scale);

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const base64DataUrl = canvas.toDataURL(mimeType, quality);
      this.sendVideo(base64DataUrl, mimeType);
    }, intervalMs);

    // Listen to track end (e.g. user clicks "Stop Sharing" in browser UI)
    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length > 0) {
      this.videoTrackEndedListener = () => {
        this.log('Video track ended.');
        this.stopVideoStream();
        this.onVideoStreamEnded?.();
      };
      videoTracks[0].addEventListener('ended', this.videoTrackEndedListener);
    }

    this.log('Started video streaming at ~' + fps + ' FPS.');
  }

  /**
   * Stops streaming video frames and cleans up internal canvas, video element, and media tracks.
   *
   * @param stopTracks Whether to call track.stop() on the MediaStream tracks (default: true).
   */
  public stopVideoStream(stopTracks: boolean = true) {
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

  public stopRecording() {
    this.audioRecorder.stopRecording();
  }
}