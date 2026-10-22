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
6. **Stop Audio Streaming**: End microphone capture cleanly via `.stopRecording()`.
7. **Disconnect & Teardown**: Gracefully close WebSocket connections and audio contexts via `.disconnect()`.

---

## What It Does

- **Real-Time Bidirectional Streaming**: Establishes a direct WebSocket connection to Google's Gemini Multimodal Live API.
- **Microphone Capture & Resampling (`AudioRecorder`)**: Automatically captures user audio at 16kHz mono PCM and streams chunks directly over WebSocket. Includes a live volume calculation callback.
- **Audio Output Playback (`AudioStreamer`)**: Buffers and seamlessly streams 24kHz PCM audio received from the Gemini model in real-time.
- **Automatic Client-Side Function / Tool Calling**: Registers tools, automatically normalizes parameter schemas to OpenAPI specifications, executes matching local handlers (sync or async), and sends return values back to the model.
- **Session Resumption & Reconnection**: Tracks session resumption tokens (`sessionResumptionUpdate`) and context window compression for long-running sessions, with automatic exponential backoff reconnection.
- **Dual Authentication**: Supports direct API keys as well as secure client-side ephemeral tokens.

---

## Step-by-Step Implementation Guide

Below is the complete implementation workflow showing the code and a detailed explanation of each step.

### Step 1: Define Tools (Optional Function Calling)

Define any client-side functions the model can call when answering user queries.

```javascript
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
```

**Description:**
- **`name`**: The unique identifier Gemini uses to invoke this function.
- **`description`**: Clear prompt description helping Gemini decide when to call the tool.
- **`parameters`**: The expected input schema. The wrapper automatically normalizes this into OpenAPI schema format.
- **`handler`**: The local callback executed when Gemini triggers this function. The wrapper automatically captures the returned object and sends it back to Gemini via a `toolResponse` message.

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

### Step 7: Stop Recording Audio

Pause or stop audio capture while preserving the WebSocket session.

```javascript
geminiLive.stopRecording();
```

**Description:**
- Disconnects the `AudioContext` and processing nodes, stopping audio capture and data transmission over the WebSocket.
- The WebSocket connection remains active, allowing the model to finish speaking or await future input.

---

### Step 8: Disconnect the Session

Gracefully terminate the entire live session when finished.

```javascript
geminiLive.disconnect();
```

**Description:**
- Signals explicit user disconnection (`code 1000`).
- Stops any active recording, halts audio output playback, cleans up active timers, and closes the WebSocket connection.

---

## Additional Capabilities

### Sending Text Messages
You can send text queries directly to the active session:
```javascript
geminiLive.sendText("Hello Gemini! Can you hear me?");
```

### Streaming Video Frames
You can stream video / canvas snapshots (e.g., JPEG or WebP) alongside audio:
```javascript
// buffer: ArrayBuffer or Uint8Array representing image bytes
geminiLive.sendVideo(buffer, 'image/jpeg');
```

---

## License

ISC
