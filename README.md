# @codingpheonix/gemini-live-wrapper

A robust, real-time WebSocket client wrapper for the Google Gemini Multimodal Live API in browsers and client-side applications. It handles bi-directional audio streaming, automatic PCM audio recording/resampling, low-latency audio playback, tool/function calling, session resumption, and connection lifecycle management.

---

## Pattern of Documentation

To integrate and work with this library, follow this structured pattern:

1. **Define Tools (Function Declarations)**: Create executable client-side functions that the Gemini model can call.
2. **Initialize `GeminiLive`**: Instantiate the wrapper with your credentials (API key or ephemeral token), model name, instructions, and tools.
3. **Handle Connection Lifecycle & Status Events**: Attach listener callbacks (`onStatusChange`) to track live connection states.
4. **Establish the WebSocket Connection**: Initiate the session with `.connect()`.
5. **Connect & Stream Media**:
   - **i.** Connect and Stream Microphone Audio (`.startRecording()`)
   - **ii.** Disconnect Microphone Audio (`.stopRecording()`)
   - **iii.** Connect and Stream Camera Video (`.startVideoStream()`)
   - **iv.** Connect and Stream Screen Share (`.startVideoStream()`)
   - **v.** Disconnect Video / Screen Stream (`.stopVideoStream()`)
6. **Disconnect & Teardown**: Gracefully close WebSocket connections and release audio/video resources via `.disconnect()`.

---

## What It Does

- **Real-Time Bidirectional Streaming**: Establishes a direct WebSocket connection to Google's Gemini Multimodal Live API.
- **Microphone Capture & Resampling (`AudioRecorder`)**: Automatically captures user audio at 16kHz mono PCM and streams chunks directly over WebSocket. Includes a live volume calculation callback and automatic hardware device release.
- **Automated Video Streaming (`VideoStreamer` / `startVideoStream`)**: Pass any camera or screen share `MediaStream`—the wrapper handles canvas creation, downscaling, JPEG encoding, periodic frame transmission (~1 FPS), and track termination automatically.
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
    apiKey,                                     // 1. apiKey (Required)
    'gemini-3.1-flash-live-preview',            // 2. model (Required)
    false,                                      // 3. useEphemeralToken (Optional, default: false)
    '',                                         // 4. ephemeralToken (Optional, pass "" if not used)
    'You are a helpful assistant.',             // 5. prompt (Optional, default: 'You are a helpful assistant.')
    getRandomTemperature,                      // 6. tools (Optional, default: [])
    true,                                       // 7. enableLogs (Optional, default: false)
    true,                                       // 8. enableSessionResumption (Optional, default: true)
    true                                        // 9. enableCompression (Optional, default: true)
);
```

#### Constructor Parameters

| # | Parameter | Type | Required / Optional | Default Value | Description |
|---|---|---|---|---|---|
| 1 | `apiKey` | `string` | **Required** | *(None)* | Your Google Gemini API Key. Can be passed as `""` if using ephemeral tokens. |
| 2 | `model` | `string` | **Required** | *(None)* | The Gemini Live model ID (e.g., `'gemini-3.1-flash-live-preview'`). |
| 3 | `useEphemeralToken` | `boolean` | **Optional** | `false` | Set to `true` when connecting from untrusted client browsers with a short-lived token instead of exposing your API key. |
| 4 | `ephemeralToken` | `string` | **Optional** | *(None)* | The ephemeral access token string. Required only when `useEphemeralToken` is `true`. Otherwise pass `""`. |
| 5 | `prompt` | `string` | **Optional** | `'You are a helpful assistant.'` | System instructions and persona for Gemini. |
| 6 | `tools` | `LiveTool \| LiveTool[]` | **Optional** | `[]` | A single tool definition or an array of tool objects for client-side function calling. |
| 7 | `enableLogs` | `boolean` | **Optional** | `false` | Enables verbose console logging for debugging connection events, frame transfers, and tool executions. |
| 8 | `enableSessionResumption` | `boolean` | **Optional** | `true` | Persists session resumption handles (`sessionResumptionUpdate`) and context across unexpected network drops and reconnect attempts. |
| 9 | `enableCompression` | `boolean` | **Optional** | `true` | Enables Gemini's context window compression for extended multi-turn conversations. |

#### Useful Instance Properties & Getters

- **`geminiLive.isConnected`** (`boolean`): Returns `true` if the WebSocket connection is open.
- **`geminiLive.currentSessionHandle`** (`string | undefined`): Returns the current session resumption token provided by Gemini.
- **`geminiLive.registeredTools`** (`any[]`): Returns the list of normalized OpenAPI tool declarations sent to Gemini.

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

### Step 5: Connect Media

Once connected, you can stream audio and video to Gemini simultaneously or independently.

---

#### i. Connect and Stream Microphone Audio

Acquire microphone access from the browser with recommended real-time settings and stream PCM chunks to Gemini while monitoring real-time volume:

```javascript
// 1. Acquire microphone stream
const audioStream = await navigator.mediaDevices.getUserMedia({
    audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true, // Enables browser hardware automatic gain control
        sampleRate: 16000,
        channelCount: 1
    }
});

// 2. Stream audio to Gemini
await geminiLive.startRecording(audioStream, (volume) => {
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

#### ii. Disconnect Microphone Audio

Pause or stop audio capture without closing the WebSocket connection:

```javascript
geminiLive.stopRecording();
```

**Description:**
- **`geminiLive.stopRecording(stopTracks = true)`**: Disconnects the internal `AudioContext` and processing nodes, and automatically calls `track.stop()` on the microphone hardware tracks to turn off the browser's mic indicator.
- The WebSocket connection remains active, allowing the model to finish speaking or await future input.

---

#### iii. Connect and Stream Camera Video

Acquire webcam access and hand the stream to the wrapper. The wrapper automatically creates an internal canvas, scales frames down for low latency, encodes to JPEG, and sends frames at ~1 FPS:

```javascript
// 1. Acquire camera stream
const cameraStream = await navigator.mediaDevices.getUserMedia({
    video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 15 }
    }
});

// 2. Hand stream to the wrapper
geminiLive.startVideoStream(cameraStream);
```

**Description:**
- **`geminiLive.startVideoStream(stream, options?)`**:
  - `stream`: Active `MediaStream` from `getUserMedia`.
  - `options` (optional):
    - `fps`: Frame rate (default: `1` FPS, optimal for Gemini Live).
    - `maxWidth`: Maximum resolution width before downscaling (default: `640` px).
    - `quality`: Image compression quality (default: `0.6`).
    - `mimeType`: Image MIME type (default: `'image/jpeg'`).
  - Automatically renders frames onto an internal canvas, encodes to base64, pipes to the active WebSocket session, and monitors track end events.

---

#### iv. Connect and Stream Screen Share

Share your screen or an application window using standard `getDisplayMedia`:

```javascript
// 1. Acquire screen share stream
const screenStream = await navigator.mediaDevices.getDisplayMedia({
    video: { cursor: 'always' }
});

// 2. Hand stream to the wrapper
geminiLive.startVideoStream(screenStream);

// Optional: listen when the user stops screen sharing from browser UI
geminiLive.onVideoStreamEnded = () => {
    console.log('Screen sharing ended');
};
```

**Description:**
- Uses the same `startVideoStream()` method to stream your screen to Gemini.
- `onVideoStreamEnded`: Fired automatically when the user clicks the browser's native "Stop sharing" button.

---

#### v. Disconnect Video / Screen Stream

Stop video capture and release camera or screen sharing hardware:

```javascript
geminiLive.stopVideoStream();
```

**Description:**
- **`geminiLive.stopVideoStream(stopTracks = true)`**: Clears the frame sampling timer, cleans up internal video/canvas elements, and automatically calls `track.stop()` on the video tracks to turn off camera indicators.
- Leaves the WebSocket session alive so the assistant can continue conversing.

---

### Step 6: Disconnect the Session

Gracefully terminate the entire live session when finished.

```javascript
geminiLive.disconnect();
```

**Description:**
- Signals explicit user disconnection (`code 1000`).
- Stops active audio recording (`stopRecording()`), stops active video streaming (`stopVideoStream()`), halts audio output playback, cleans up active timers, and closes the WebSocket connection.

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

