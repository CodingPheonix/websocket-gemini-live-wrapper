# @codingpheonix/gemini-live-wrapper

A robust, real-time WebSocket client wrapper for the Google Gemini Multimodal Live API in browsers and client-side applications. It handles bi-directional audio streaming, automatic PCM audio recording/resampling, low-latency audio playback, tool/function calling, session resumption, and connection lifecycle management.

---

## Pattern of Documentation

To integrate and work with this library, follow this structured pattern:

1. **Define Tools (Function Declarations)**: Create executable client-side functions that the Gemini model can call.
2. **Initialize `GeminiLive`**: Instantiate the wrapper with your credentials (API key or ephemeral token), model name, instructions, and tools.
3. **Handle Connection Lifecycle & Status Events**: Attach listener callbacks (`onStatusChange`) to track live connection states.
4. **Establish the WebSocket Connection**: Initiate the session with `.connect()`.
5. **Capture & Stream Microphone Audio**: Acquire microphone access using `navigator.mediaDevices.getUserMedia` and pipe it via `.startRecording()`.
6. **Capture & Stream Video Frames (Camera / Screen)**: Capture webcam or screen share frames via `<canvas>` or `Buffer` and pipe them via `.sendVideo()`.
7. **Stop Audio & Video Streaming**: End microphone capture cleanly via `.stopRecording()` and stop your video capture loop.
8. **Disconnect & Teardown**: Gracefully close WebSocket connections and audio contexts via `.disconnect()`.

---

## What It Does

- **Real-Time Bidirectional Streaming**: Establishes a direct WebSocket connection to Google's Gemini Multimodal Live API.
- **Microphone Capture & Resampling (`AudioRecorder`)**: Automatically captures user audio at 16kHz mono PCM and streams chunks directly over WebSocket. Includes a live volume calculation callback.
- **Video Streaming (`sendVideo`)**: Easily send camera or screen share snapshots (JPEG, WebP) directly to Gemini over WebSocket at ~1 FPS using base64 data URLs, Buffers, or Uint8Arrays.
- **Audio Output Playback (`AudioStreamer`)**: Buffers and seamlessly streams 24kHz PCM audio received from the Gemini model in real-time.
- **Automatic Client-Side Function / Tool Calling**: Registers tools, automatically normalizes parameter schemas to OpenAPI specifications, executes matching local handlers (sync or async), and sends return values back to the model.
- **Session Resumption & Reconnection**: Tracks session resumption tokens (`sessionResumptionUpdate`) and context window compression for long-running sessions, with automatic exponential backoff reconnection.
- **Dual Authentication**: Supports direct API keys as well as secure client-side ephemeral tokens.

---

## Step-by-Step Implementation Guide

Below is the complete implementation workflow showing the code and a detailed explanation of each step.

### Step 1: Define Tools (Optional Function Calling)

Define any client-side functions the model can call when answering user queries. You can declare scalar parameters (e.g. `string`, `number`, `boolean`) as well as `array` parameters with `items`.

```javascript
// Example 1: Scalar parameters
const getRandomTemperature = {
    name: 'getRandomTemperature',
    description: 'Returns a random temperature for a given city or location for testing.',
    parameters: {
        city: { 
            type: 'string', 
            description: 'The name of the city or location', 
            required: true 
        }
    },
    handler: (args) => {
        const city = args.city || 'your location';
        const temp = Math.floor(Math.random() * 25) + 15; // Random 15°C - 39°C
        return {
            city: city,
            temperature: `${temp}°C`,
            condition: 'Partly Cloudy'
        };
    }
};

// Example 2: Array parameters with items schema
const saveRecommendations = {
    name: 'saveRecommendations',
    description: 'Saves action steps and treatment advice into the session.',
    parameters: {
        suggestions: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of actionable recommendations or steps',
            required: true
        },
        priority: {
            type: 'string',
            enum: ['LOW', 'MEDIUM', 'HIGH'],
            description: 'Priority level of recommendations'
        }
    },
    handler: async (args) => {
        console.log('Received suggestions:', args.suggestions);
        return { success: true, count: args.suggestions?.length || 0 };
    }
};

// Example 3: Nested objects, arrays of objects, & numeric/format constraints
const recordDiagnosis = {
    name: 'recordDiagnosis',
    description: 'Records plant health analysis with geo-location and treatment items.',
    parameters: {
        location: {
            type: 'object',
            description: 'Geo-coordinates of the field',
            properties: {
                latitude: { type: 'number', minimum: -90, maximum: 90, required: true },
                longitude: { type: 'number', minimum: -180, maximum: 180, required: true },
                accuracy: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] }
            },
            required: true
        },
        treatments: {
            type: 'array',
            description: 'List of recommended treatments',
            items: {
                type: 'object',
                description: 'Treatment item',
                properties: {
                    productName: { type: 'string', required: true },
                    dosageMl: { type: 'number', minimum: 0, required: true }
                }
            }
        },
        timestamp: {
            type: 'string',
            format: 'date-time',
            description: 'ISO 8601 recording timestamp'
        }
    },
    handler: async (args) => {
        return { success: true, savedAt: args.timestamp };
    }
};
```

**Description:**
- **`name`**: The unique identifier Gemini uses to invoke this function.
- **`description`**: Clear prompt description helping Gemini decide when to call the tool.
- **`parameters`**: The expected input schema. The wrapper automatically normalizes this into OpenAPI schema format (`type: 'OBJECT'`) recursively:
  - **Scalar types**: Supports `'string'`, `'number'`, `'integer'`, `'boolean'`.
  - **Nested Objects**: Supports nested `type: 'object'` schemas with their own `properties` and `required` fields.
  - **Arrays & Arrays of Objects**: For `type: 'array'`, supports scalar elements (`items: { type: 'string' }` or shorthand `items: 'string'`) as well as nested objects (`items: { type: 'object', properties: { ... } }`).
  - **Constraints & Formats**: Preserves `minimum`, `maximum`, `format` (e.g. `'date-time'`, `'email'`), `pattern` (regex), `minLength`, `maxLength`, `minItems`, `maxItems`, `enum`, and `required` flags.
  - **Values & Metadata**: Supports `nullable: true`, `default` values, and `example`/`examples` to guide model adherence.
  - **Defensive Fallback**: If `type: 'array'` is passed without an explicit `items` field, the wrapper automatically provides `{ type: 'STRING' }` so Gemini's WebSocket schema validation never fails.
- **`handler`**: The local callback (synchronous or `async`) executed when Gemini triggers this function. The wrapper automatically captures the returned object and sends it back to Gemini via a `toolResponse` message.

---

### Step 2: Initialize the `GeminiLive` Client

Create an instance of `GeminiLive` with your configuration.

```javascript
import { GeminiLive } from '@codingpheonix/gemini-live-wrapper';

const geminiLive = new GeminiLive(
    apiKey,  // Google Gemini API Key
    'gemini-3.8-live',   // Live Model ID 
    false,   // useEphemeralToken (set true if using client-side ephemeral token)
    '',  // Ephemeral token string (if useEphemeralToken is true)
    'You are a helpful assistant. If the user asks about the weather or temperature, use the getRandomTemperature tool.', // System instruction / prompt
    getRandomTemperature,  // Single tool or array of tools
    true  // enableLogs (verbose logging)
);
```

**Description:**
- Configures the WebSocket endpoint, audio streamer (for model output), audio recorder (for input capture), system prompt, and registered tool declarations.
- Optional parameters like `enableSessionResumption` (default `true`) and `enableCompression` (default `true`) can also be passed to maintain sessions over network resets.

---

### Step 3: Listen to Connection Status Changes

Register the `onStatusChange` callback to track connection transitions and update application state.

```javascript
geminiLive.onStatusChange = (status, details) => {
    console.log('Gemini Live Status:', status, details);
    
    if (status === 'Connected') {
        // WebSocket is connected, setup configuration sent, ready for interaction
    } else if (status === 'Disconnected' || status === 'Reconnect Failed') {
        // Session ended or connection closed
    } else if (status.startsWith('Reconnecting')) {
        // Automatic exponential backoff attempt in progress
    }
};
```

**Description:**
- Receives state updates including `'Connecting...'`, `'Connected'`, `'Disconnected'`, `'Reconnecting (x/5)...'`, `'Connection expiring soon'`, and `'Reconnect Failed'`.
- Allows your application to adapt UI elements, indicators, and buttons based on connection state.

---

### Step 4: Connect to the Live Session

Establish the WebSocket connection to Gemini's bidirectional live service.

```javascript
geminiLive.connect();
```

**Description:**
- Opens the WebSocket connection to Google's Live API endpoint.
- Upon opening, automatically constructs and sends the initial `setup` frame containing the model configuration, audio modality settings, system instructions, tools, and session resumption tokens.

---

### Step 5: Acquire User Microphone Stream

Request audio access from the browser with recommended real-time settings.

```javascript
const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true, // Enables browser hardware automatic gain control
        sampleRate: 16000,
        channelCount: 1
    }
});
```

**Description:**
- Requests a single-channel (mono) audio stream from the client microphone.
- Enables browser-level acoustic echo cancellation (`echoCancellation`), noise suppression (`noiseSuppression`), and hardware auto gain control (`autoGainControl`) for optimal voice clarity and interruption handling.

---

### Step 6: Start Recording and Streaming Audio

Begin capturing audio, streaming PCM chunks to Gemini, and monitoring real-time volume.

```javascript
await geminiLive.startRecording(stream, (volume) => {
    // volume is a normalized RMS floating-point value (e.g., 0.0 to 1.0)
    console.log('Input volume:', volume);
});
```

**Description:**
- **`geminiLive.startRecording(stream, onVolumeChange)`**:
  - Initializes the internal `AudioRecorder` and Web Audio `AudioContext`.
  - Continuously encodes incoming microphone audio into 16,000Hz 16-bit linear PCM format.
  - Automatically packages and sends the raw audio frames across the active WebSocket to Gemini inside `realtimeInput.mediaChunks`.
  - Calculates Root Mean Square (RMS) volume and invokes the `onVolumeChange` callback in real-time for visualizers, audio meters, or animations.

---

### Step 7: Stream Video Frames (Camera or Screen Share)

Stream video or screen frames alongside audio using `.sendVideo()`. Frames are typically sampled using an HTML `<canvas>` at ~1 FPS (recommended rate for Gemini Live API).

```javascript
// Example: Capturing webcam or screen share stream
const videoStream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } }
});

// Or for screen sharing:
// const videoStream = await navigator.mediaDevices.getDisplayMedia({ video: true });

const videoElement = document.createElement('video');
videoElement.srcObject = videoStream;
videoElement.autoplay = true;
videoElement.playsInline = true;

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');

// Stream frames periodically (e.g. 1 frame every second)
const intervalId = setInterval(() => {
    if (!geminiLive || videoElement.readyState < 2) return;

    // Scale down to max 640px width for low latency
    const scale = Math.min(1, 640 / (videoElement.videoWidth || 640));
    canvas.width = (videoElement.videoWidth || 640) * scale;
    canvas.height = (videoElement.videoHeight || 480) * scale;

    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

    // Get JPEG base64 Data URL and send frame
    const base64DataUrl = canvas.toDataURL('image/jpeg', 0.6);
    geminiLive.sendVideo(base64DataUrl, 'image/jpeg');
}, 1000);
```

**Description:**
- **`geminiLive.sendVideo(frame, mimeType)`**:
  - `frame`: Accepts a base64 string (including data URL prefix `data:image/jpeg;base64,...`), `Buffer`, `Uint8Array`, or `ArrayBuffer`.
  - `mimeType`: MIME format string, e.g. `'image/jpeg'` (default) or `'image/webp'`.
  - Sends real-time visual context to Gemini inside the WebSocket `realtimeInput.video` payload so Gemini can see and converse about what the camera or screen displays.

---

### Step 8: Stop Streaming Audio & Video

Pause or stop audio and video streams cleanly.

```javascript
// Stop audio recording
geminiLive.stopRecording();

// Stop video interval and release camera/screen tracks
clearInterval(intervalId);
videoStream.getTracks().forEach((track) => track.stop());
```

**Description:**
- Disconnects audio processing nodes and stops media hardware tracks without closing the WebSocket connection.
- The session remains active, allowing the model to finish speaking or answer follow-up questions.

---

### Step 9: Disconnect the Session

Gracefully terminate the entire live session when finished.

```javascript
geminiLive.disconnect();
```

**Description:**
- Signals explicit user disconnection (`code 1000`).
- Stops active recording, halts audio playback, cleans up timers, and closes the WebSocket connection.

---

## Additional Capabilities

### Sending Text Messages
You can send text queries directly to the active session:
```javascript
geminiLive.sendText("Hello Gemini! Can you hear me?");
```

---

## License

ISC
